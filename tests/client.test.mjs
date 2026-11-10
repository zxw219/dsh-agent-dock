import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createWorkbenchStore } from '../workbench.js'

// Component/controller tests only. This harness does not emulate DSH's DOM or renderer.
async function setup(t, sessionOptions = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-workbench-client-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createWorkbenchStore({ dataDir: directory }), calls = [], slots = [], effects = [], sessionCalls = []
  let plugin, selected = null, hooks = [], cursor = 0, pendingEffects = []
  const React = {
    Fragment: 'fragment',
    createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.flat(Infinity).filter(x => x !== false && x != null) } }),
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial; return [hooks[i], value => { hooks[i] = typeof value === 'function' ? value(hooks[i]) : value }] },
    useCallback: fn => fn,
    useEffect: fn => { pendingEffects.push(fn) },
  }
  const element = () => ({ dataset: {}, style: {}, children: [], parentNode: null, appendChild(node) { node.remove(); this.children.push(node); node.parentNode = this }, remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(n => n !== this); this.parentNode = null } })
  let anchor = element(), list = element(), observerCallback, disconnected = false
  const history = element(); list.appendChild(history); anchor.appendChild(list)
  anchor.querySelector = () => list
  const dom = { history, anchor: () => list, replaceAnchor() { anchor = element(); list = element(); anchor.appendChild(list); anchor.querySelector = () => list; observerCallback?.() }, notify: () => observerCallback?.(), disconnected: () => disconnected }
  const context = {
    window: { __ModuleLoader__: { load: ({ factory }) => { plugin = factory(name => name === 'react-dom' ? { createPortal: (child, target) => ({ child, target }) } : React) } } },
    MutationObserver: class { constructor(callback) { observerCallback = callback } observe() {} disconnect() { disconnected = true } },
    document: { createElement: element, body: element(), querySelector: selector => { assert.equal(selector, '[data-slot="sidebar.workspaces"]'); return anchor }, head: { appendChild() {} } },
    fetch: async (url, options) => {
      calls.push({ url, method: options.method })
      assert.ok(['/api/agent-dock/workbench', '/api/agent-dock/workbuddy/sidebar', '/api/agent-dock/workbuddy/open', '/api/agent-dock/workbuddy/viewport'].includes(url), 'desktop flows must never call Android/launch/native-open routes')
      if (url === '/api/agent-dock/workbuddy/viewport') return { ok: true, json: async () => ({ ok: true }) }
      if (url === '/api/agent-dock/workbuddy/open') {
        assert.equal(options.method, 'POST')
        const request = JSON.parse(options.body)
        const value = sessionOptions.open ? await sessionOptions.open(request) : { ok: true, window: '123', pid: 42, title: request.title }
        return { ok: !value.error, status: value.error ? 400 : 200, json: async () => value }
      }
      if (url === '/api/agent-dock/workbuddy/sidebar') {
        assert.equal(options.method, 'GET')
        const value = sessionOptions.sidebar ? await sessionOptions.sidebar() : { ok: true, connected: true, window: 'WorkBuddy', scope: 'visible-sidebar', groups: [{ name: '最近', conversations: [{ key: 'native-one', title: '真实对话' }] }], fetchedAt: '2026-11-09T00:00:00Z' }
        return { ok: !value.error, status: value.error ? 503 : 200, json: async () => value }
      }
      try {
        const value = options.method === 'PUT' ? await store.put(JSON.parse(options.body)) : await store.get()
        return { ok: true, json: async () => JSON.parse(JSON.stringify(value)) }
      } catch (error) { return { ok: false, json: async () => ({ error: error.message }) } }
    },
    setInterval, clearInterval, console,
  }
  vm.runInNewContext(await readFile(new URL('../client.js', import.meta.url), 'utf8'), context)
  plugin.apply({
    effect: fn => effects.push(fn()),
    layout: { panelInfo: { getSnapshot: () => ({ activePanelId: selected }) }, selectPanel: id => { selected = id } },
    sessions: {
      create: async () => { sessionCalls.push({ kind: 'create' }); if (sessionOptions.createError) throw new Error(sessionOptions.createError); await sessionOptions.wait; return 'search-session' },
      using: async (target, options, operation) => { sessionCalls.push({ kind: 'using', target, options }); return operation({ binding: { session: { prompt: async (content, mode) => { sessionCalls.push({ kind: 'prompt', content, mode }); return sessionOptions.promptResult || { ok: true, value: { accepted: true } } } } } }) },
    },
    uiWorkspace: { openSession: target => { sessionCalls.push({ kind: 'open', target }) } },
    slots: {
      inject: (_key, fn) => fn(),
      register: (meta, render) => { const row = { meta, render }; slots.push(row); return () => { const i = slots.indexOf(row); if (i >= 0) slots.splice(i, 1) } },
    },
  })
  t.after(() => effects.reverse().forEach(fn => fn?.()))
  await new Promise(resolve => setImmediate(resolve))
  const home = slots.find(s => s.meta.name === 'main' && s.meta.key === 'dsh-agent-dock')
  const { model } = home.render().props
  await model.reload()
  const render = (component, props, reset = true) => { if (reset) hooks = []; cursor = 0; pendingEffects = []; const tree = component(props); return { tree, effects: () => pendingEffects.map(fn => fn()) } }
  return { slots, calls, sessionCalls, model, store, home, render, dom, dispose: () => effects.splice(0).reverse().forEach(fn => fn?.()), selected: () => selected }
}
function nodes(tree) { return tree && typeof tree === 'object' ? [tree, ...tree.props.children.flatMap(nodes)] : [] }
function text(tree) { return typeof tree === 'string' || typeof tree === 'number' ? String(tree) : tree?.props?.children.map(text).join('') || '' }
function click(tree, label) { const node = nodes(tree).find(n => n.type === 'button' && text(n) === label); assert.ok(node, `button ${label}`); return node.props.onClick() }
function agent(id = 'workbuddy') { return { id, name: 'WorkBuddy', icon: 'W', enabled: true, executable: 'C:\\Example\\WorkBuddy.exe', openMethod: 'official', windowPolicy: 'close', conversations: [{ id: 'demo-one', title: '项目讨论（演示）', pinned: true, updatedAt: '2026-11-09T00:00:00.000Z' }] } }

test('late popup open after returning to DSH is hidden with its own lease', async t => {
  let finish
  const app = await setup(t, { open: request => new Promise(resolve => { finish = () => resolve({ ok: true, title: request.title }) }) })
  await app.model.saveAgent(agent())
  await app.model.refreshReal('workbuddy')
  const opening = app.model.selectReal('workbuddy', { key: 'native-one', title: '真实对话', group: '最近' })
  await new Promise(resolve => setImmediate(resolve))
  app.model.back()
  finish(); await opening
  assert.equal(app.selected(), null)
  assert.ok(app.calls.some(c => c.url.endsWith('/viewport')))
  assert.ok(app.model.snapshot().popup.lease)
})

test('popup activity follows selected panel and ignores errors from an old lease', async t => {
  const app = await setup(t)
  await app.model.saveAgent(agent())
  await app.model.refreshReal('workbuddy')
  await app.model.selectReal('workbuddy', { key: 'native-one', title: '真实对话', group: '最近' })
  const lease = app.model.snapshot().popup.lease
  assert.equal(app.model.popupActive(lease), true)
  app.model.back()
  const reads = app.calls.filter(c => c.url.endsWith('/sidebar')).length
  await app.model.openAgent('workbuddy')
  assert.equal(app.calls.filter(c => c.url.endsWith('/sidebar')).length, reads)
  assert.equal(app.model.snapshot().selectedReal.workbuddy.title, '真实对话')
  assert.equal(app.model.popupActive(lease), true)
  app.model.popupError('old failure', 'old-lease')
  assert.equal(app.model.snapshot().popup.opened, true)
  app.model.back()
  assert.equal(app.model.popupActive(lease), false)
  app.model.popupError('current failure', lease)
  assert.equal(app.model.snapshot().popup.error, 'current failure')
})

test('empty manager, local save/reload, enabled navigation and order stay consistent', async t => {
  const app = await setup(t)
  assert.equal(app.model.snapshot().loaded, true)
  assert.equal(app.model.snapshot().agents.length, 0)
  const { type, props } = app.home.render()
  assert.match(text(app.render(type, props).tree), /先添加一个智能体/)
  await app.model.saveAgent(agent())
  await app.model.saveAgent({ ...agent('kimi'), name: 'Kimi' })
  await app.model.moveAgent('kimi', -1)
  assert.equal(app.model.snapshot().agents[0].id, 'kimi')
  assert.ok(app.slots.find(s => s.meta.key === 'dsh-agent-dock:agent:workbuddy'))
  assert.equal(app.slots.some(s => s.meta.name === 'sidebar.panellist' && s.meta.id.includes(':agent:')), false)
  await app.model.reload()
  assert.equal(app.model.snapshot().agents[1].conversations[0].title, '项目讨论（演示）')
  assert.equal((await app.store.get()).revision, 3)
  assert.equal(app.selected(), null, 'saving must not navigate or launch anything')
})

test('agent selection renders demo list/preview and return restores workspace slot', async t => {
  const app = await setup(t)
  await app.model.saveAgent(agent())
  app.model.openAgent('workbuddy')
  assert.equal(app.selected(), 'dsh-agent-dock:agent:workbuddy')
  assert.equal(app.slots.some(s => s.meta.name === 'sidebar.workspaces'), false, 'must retain DSH workspace renderer')
  app.model.select('workbuddy', 'demo-one')
  const main = app.slots.find(s => s.meta.key === app.selected())
  const root = main.render(), rootRendered = app.render(root.type, root.props)
  const cleanups = rootRendered.effects()
  const preview = app.render(rootRendered.tree.type, rootRendered.tree.props).tree
  assert.match(text(preview), /已选择这条演示对话/)
  assert.doesNotMatch(text(preview), /未接入桌面软件/)
  click(preview, '返回 DSH')
  assert.equal(app.selected(), null)
  assert.equal(app.slots.some(s => s.meta.name === 'sidebar.workspaces'), false)
  cleanups.forEach(fn => fn?.())
})

test('disabling/removing active entry returns home and disposes its navigation', async t => {
  const app = await setup(t)
  const value = agent()
  await app.model.saveAgent(value)
  app.model.openAgent(value.id)
  await app.model.saveAgent({ ...value, enabled: false })
  assert.equal(app.selected(), 'dsh-agent-dock')
  assert.equal(app.slots.some(s => s.meta.id === 'dsh-agent-dock:agent:workbuddy'), false)
  assert.equal(app.slots.some(s => s.meta.name === 'sidebar.workspaces'), false)
  await app.model.saveAgent(value)
  app.model.openAgent(value.id)
  await app.model.removeAgent(value.id)
  assert.equal(app.selected(), 'dsh-agent-dock')
  assert.equal(app.model.snapshot().agents.length, 0)
  assert.equal(app.slots.some(s => s.meta.key === 'dsh-agent-dock:agent:workbuddy'), false)
})

test('manager preset opens editable settings and form saves demo titles', async t => {
  const app = await setup(t)
  const manager = app.home.render()
  let view = app.render(manager.type, manager.props)
  click(view.tree, '添加 WorkBuddy')
  view = app.render(manager.type, manager.props, false)
  const editor = nodes(view.tree).find(node => typeof node.type === 'function' && node.type.name === 'AgentEditor')
  assert.ok(editor)
  const initial = app.render(editor.type, editor.props).tree
  assert.doesNotMatch(text(initial), /图标（文字或 Emoji）/)
  assert.match(text(initial), /选择智能体/)
  assert.ok(nodes(initial).some(n => n.type === 'details' && text(n).includes('高级设置')))
  let form = app.render(editor.type, editor.props)
  click(form.tree, '填入三条示例')
  form = app.render(editor.type, editor.props, false)
  assert.equal(nodes(form.tree).filter(n => n.type === 'input' && n.props['aria-label'] === '演示对话标题').length, 3)
  await form.tree.props.onSubmit({ preventDefault() {} })
  assert.equal(app.model.snapshot().agents.length, 1)
  assert.equal(app.model.snapshot().agents[0].name, 'WorkBuddy')
  assert.equal(app.model.snapshot().agents[0].conversations.length, 3)
})

test('workspace portal keeps history, reattaches and removes only its own node; official icon is gray', async t => {
  const app = await setup(t)
  await app.model.saveAgent(agent())
  const portal = app.slots.find(s => s.meta.name === 'shell.overlay')
  const first = app.render(portal.render, {})
  const cleanups = first.effects()
  const anchor = app.dom.anchor(), node = anchor.children.find(n => n.dataset.agentDockMount)
  assert.ok(node)
  assert.equal(anchor.children[0], app.dom.history)
  const rendered = app.render(portal.render, {}, false).tree
  assert.equal(rendered.target, node)
  const entries = app.render(rendered.child.type, {}).tree
  const row = nodes(entries).find(n => n.type === 'button')
  assert.match(text(row), /WorkBuddy$/)
  assert.doesNotMatch(text(row), /未接入/)
  assert.equal(row.props['aria-expanded'], false)
  const icon = nodes(row).find(n => typeof n.type === 'function')
  const image = app.render(icon.type, icon.props).tree
  assert.equal(image.type, 'img')
  assert.equal(image.props.src, '/api/agent-dock/workbuddy-icon')
  assert.equal(image.props.style.filter, 'grayscale(1)')
  row.props.onClick()
  assert.equal(app.selected(), null, 'expanding a workspace must not navigate')
  const expanded = app.render(rendered.child.type, {}).tree
  const conversationRow = nodes(expanded).find(n => n.props.className === 'agent-conversation-row')
  assert.ok(conversationRow)
  conversationRow.props.onClick()
  assert.equal(app.selected(), 'dsh-agent-dock:agent:workbuddy')
  assert.equal(app.model.snapshot().selected.workbuddy, 'demo-one')
  const expandedRow = nodes(expanded).find(n => n.props.className === 'agent-workspace-row')
  expandedRow.props.onClick()
  assert.equal(app.model.snapshot().expanded.workbuddy, false)
  app.dom.notify()
  assert.equal(anchor.children.length, 2)
  app.dom.replaceAnchor()
  assert.equal(node.parentNode, app.dom.anchor())
  assert.deepEqual(anchor.children, [app.dom.history])
  cleanups.forEach(fn => fn?.())
  assert.equal(node.parentNode, null)
  assert.equal(app.dom.disconnected(), true)
})

test('manager closes and reopens workspace while preserving settings and conversations', async t => {
  const app = await setup(t)
  await app.model.saveAgent(agent())
  const manager = app.home.render()
  await click(app.render(manager.type, manager.props).tree, '关闭工作区')
  let saved = (await app.store.get()).agents[0]
  assert.equal(saved.enabled, false)
  assert.equal(saved.conversations[0].id, 'demo-one')
  assert.equal(saved.executable, agent().executable)
  await app.model.reload()
  const closed = app.render(manager.type, manager.props).tree
  assert.match(text(closed), /设置已保留/)
  await click(closed, '打开工作区')
  saved = (await app.store.get()).agents[0]
  assert.equal(saved.enabled, true)
  assert.equal(saved.conversations.length, 1)
  assert.ok(app.slots.some(s => s.meta.key === 'dsh-agent-dock:agent:workbuddy'))
})

test('search creates and opens one DSH conversation, sends prompt once, and ignores double click', async t => {
  let release
  const wait = new Promise(resolve => { release = resolve })
  const app = await setup(t, { wait })
  assert.equal(app.sessionCalls.length, 0, 'mount and reload must not start a scan')
  const manager = app.home.render()
  const pending = click(app.render(manager.type, manager.props).tree, '搜索本机智能体')
  assert.equal(app.model.snapshot().searching, true)
  await app.model.searchInstalled()
  release()
  await pending
  assert.deepEqual(app.sessionCalls.map(c => c.kind), ['create', 'open', 'using', 'prompt'])
  assert.equal(app.sessionCalls[1].target, 'search-session')
  const prompt = app.sessionCalls.find(c => c.kind === 'prompt')
  assert.equal(prompt.mode, 'queue')
  assert.equal(prompt.content[0].type, 'text')
  assert.match(prompt.content[0].text, /只读本机检查/)
  assert.match(prompt.content[0].text, /不修改插件配置/)
  assert.equal(app.model.snapshot().searching, false)
  assert.equal(app.model.snapshot().error, '')
  assert.equal((await app.store.get()).agents.length, 0)
})

test('search creation and submission failures show errors without automatic retries', async t => {
  for (const options of [{ createError: 'creation denied' }, { promptResult: { ok: false, error: { message: 'submission denied' } } }]) {
    const app = await setup(t, options)
    await app.model.searchInstalled()
    assert.match(app.model.snapshot().error, /denied/)
    assert.equal(app.model.snapshot().searching, false)
    assert.equal(app.selected(), 'dsh-agent-dock')
    assert.equal(app.sessionCalls.filter(c => c.kind === 'create').length, 1)
    assert.equal(app.sessionCalls.filter(c => c.kind === 'prompt').length, options.createError ? 0 : 1)
  }
})

test('real WorkBuddy reads require explicit actions; groups and duplicate titles use native keys without persistence', async t => {
  const native = { ok: true, connected: true, window: 'WorkBuddy actual', scope: 'visible-sidebar', fetchedAt: '2026-11-09T02:00:00Z', groups: [{ name: '项目', conversations: [{ key: 'first', title: '同名' }, { key: 'second', title: '同名' }] }, { name: '最近', conversations: [{ key: 'third', title: '其他' }] }] }
  const app = await setup(t, { sidebar: async () => native })
  await app.model.saveAgent(agent())
  await app.model.saveAgent({ ...agent('kimi'), name: 'Kimi', executable: '' })
  await app.model.reload()
  const reads = () => app.calls.filter(c => c.url.endsWith('/workbuddy/sidebar')).length
  assert.equal(reads(), 0, 'mount, save and reload do not read software')
  app.model.openAgent('kimi')
  await app.model.toggleWorkspace('kimi')
  assert.equal(reads(), 0, 'other agents do not read WorkBuddy')
  const before = JSON.stringify(await app.store.get())
  await app.model.openAgent('workbuddy')
  assert.equal(reads(), 1)
  assert.equal(app.model.snapshot().realSidebars.workbuddy.connected, true)
  const root = app.slots.find(s => s.meta.key === app.selected()).render()
  const previewElement = app.render(root.type, root.props).tree
  const preview = app.render(previewElement.type, previewElement.props).tree
  assert.match(text(preview), /独立窗口中打开/)
  const list = nodes(preview).find(n => n.props['data-agent-dock'] === undefined && typeof n.type === 'function' && n.type.name === 'RealSidebarList')
  const tree = app.render(list.type, list.props).tree
  assert.match(text(tree), /仅原软件当前展开且可见的列表/)
  assert.match(text(tree), /项目.*同名同名.*最近.*其他/)
  const duplicates = nodes(tree).filter(n => n.type === 'button' && text(n) === '同名')
  assert.deepEqual(duplicates.map(n => n.props.key), ['first', 'second'])
  await duplicates[1].props.onClick()
  assert.equal(app.calls.filter(c => c.url.endsWith('/workbuddy/open')).length, 1)
  assert.equal(app.model.snapshot().popup.opened, true)
  assert.equal(app.model.snapshot().selectedReal.workbuddy.key, 'second')
  assert.equal(app.model.snapshot().selectedReal.workbuddy.group, '项目')
  assert.equal(reads(), 1, 'selecting metadata does not open or reread software')
  assert.equal(JSON.stringify(await app.store.get()), before)
  assert.equal(app.model.snapshot().agents[0].conversations[0].id, 'demo-one')
  app.model.showDemo('workbuddy')
  assert.equal(app.model.snapshot().previewModes.workbuddy, 'demo')
  assert.equal(reads(), 1)
  await app.model.toggleWorkspace('workbuddy') // collapse
  assert.equal(reads(), 1)
  await app.model.toggleWorkspace('workbuddy') // explicit expand
  assert.equal(reads(), 2)
  await click(tree, '刷新真实列表')
  assert.equal(reads(), 3, 'preview refresh button explicitly reads again')
  const manager = app.home.render()
  await click(app.render(manager.type, manager.props).tree, '刷新真实列表')
  assert.equal(reads(), 4, 'manager refresh button explicitly reads again')
  assert.equal(JSON.stringify(await app.store.get()), before)
})

test('real reads coalesce, failure clears health and explicit refresh recovers', async t => {
  let release, fail = false
  const wait = new Promise(resolve => { release = resolve })
  const app = await setup(t, { sidebar: async () => { await wait; return fail ? { error: 'WorkBuddy window unavailable' } : { ok: true, connected: true, window: 'WorkBuddy', scope: 'visible-sidebar', groups: [], fetchedAt: 'now' } } })
  await app.model.saveAgent(agent())
  const first = app.model.openAgent('workbuddy'), second = app.model.refreshReal('workbuddy')
  assert.equal(first, second)
  assert.equal(app.calls.filter(c => c.url.endsWith('/workbuddy/sidebar')).length, 1)
  assert.equal(app.model.snapshot().realSidebars.workbuddy.loading, true)
  release(); await first
  const manager = app.home.render()
  let icon = nodes(app.render(manager.type, manager.props).tree).find(n => typeof n.type === 'function' && n.type.name === 'Icon' && n.props.value.includes('workbuddy-icon'))
  assert.equal(app.render(icon.type, icon.props).tree.props.style.filter, undefined)
  fail = true
  await app.model.refreshReal('workbuddy')
  const failed = app.model.snapshot().realSidebars.workbuddy
  assert.equal(failed.connected, false)
  assert.equal(failed.groups.length, 0)
  assert.match(failed.error, /window unavailable/)
  icon = nodes(app.render(manager.type, manager.props).tree).find(n => typeof n.type === 'function' && n.type.name === 'Icon' && n.props.value.includes('workbuddy-icon'))
  assert.equal(app.render(icon.type, icon.props).tree.props.style.filter, 'grayscale(1)')
  fail = false
  await app.model.refreshReal('workbuddy')
  assert.equal(app.model.snapshot().realSidebars.workbuddy.connected, true)
})

test('unverified or wrong-scope native responses cannot mark WorkBuddy connected', async t => {
  for (const patch of [{ connected: false }, { scope: 'full-history' }, { groups: [{ name: 'invalid', conversations: [{ title: 'missing key' }] }] }]) {
    const app = await setup(t, { sidebar: async () => ({ ok: true, connected: true, window: 'WorkBuddy', scope: 'visible-sidebar', groups: [], fetchedAt: 'now', ...patch }) })
    await app.model.saveAgent(agent())
    await app.model.openAgent('workbuddy')
    assert.equal(app.model.snapshot().realSidebars.workbuddy.connected, false)
    assert.match(app.model.snapshot().realSidebars.workbuddy.error, /格式无效或尚未连接/)
  }
})

test('real reads ignore results after removal or disposal', async t => {
  for (const dispose of [false, true]) {
    let release
    const wait = new Promise(resolve => { release = resolve })
    const app = await setup(t, { sidebar: async () => { await wait; return { ok: true, connected: true, window: 'WorkBuddy', scope: 'visible-sidebar', groups: [], fetchedAt: 'now' } } })
    await app.model.saveAgent(agent())
    const pending = app.model.openAgent('workbuddy')
    if (dispose) app.dispose(); else await app.model.removeAgent('workbuddy')
    const before = JSON.stringify(app.model.snapshot())
    release(); await pending
    assert.equal(JSON.stringify(app.model.snapshot()), before)
    assert.notEqual(app.model.snapshot().realSidebars.workbuddy?.connected, true)
  }
})

test('stale write fails without overwriting newer settings and reload recovers', async t => {
  const app = await setup(t)
  await app.model.saveAgent(agent())
  const current = await app.store.get()
  await app.store.put({ ...current, agents: [{ ...current.agents[0], name: 'newer edit' }] })
  await assert.rejects(app.model.saveAgent({ ...agent(), name: 'stale edit' }), /revision conflict/)
  assert.match(app.model.snapshot().error, /revision conflict/)
  await app.model.reload()
  assert.equal(app.model.snapshot().error, '')
  assert.equal(app.model.snapshot().agents[0].name, 'newer edit')
})
