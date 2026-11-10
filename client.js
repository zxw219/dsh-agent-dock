window.__ModuleLoader__.load({ id: 'dsh-agent-dock', factory(require) {
  const React = require('react'), h = React.createElement, { createPortal } = require('react-dom')
  const WORKBUDDY_ICON = '/api/agent-dock/workbuddy-icon'
  const isWorkBuddy = agent => /work\s*buddy|work\s*beauty/i.test(agent.name) || /workbuddy\.exe$/i.test(agent.executable || '')
  // Configuration and demo conversations are never connection-health evidence.
  const connectionHealthy = (agent, state) => isWorkBuddy(agent) && state.realSidebars[agent.id]?.connected === true
  const realSource = agent => JSON.stringify([agent.id, agent.name, agent.executable, agent.enabled])
  const AGENT_CHOICES = ['WorkBuddy', '豆包', 'Kimi', 'Claude', 'ChatGPT', 'Codex']
  const automaticIcon = name => ({ WorkBuddy: 'W', 豆包: '豆', Kimi: 'K', Claude: '✳', ChatGPT: '◎', Codex: '⌘' })[name] || Array.from(name.trim())[0]?.toUpperCase() || '✦'
  const agentIcon = agent => isWorkBuddy(agent) ? WORKBUDDY_ICON : automaticIcon(agent.name)
  const DISCOVERY_PROMPT = `请帮我检查这台电脑已经安装了哪些 AI 智能体或聊天客户端，供 DSH「其他小天才们」插件选择。
请直接执行只读本机检查：优先检查 Windows 卸载注册表、开始菜单快捷方式和常见安装目录。只列出有安装证据的客户端，例如 WorkBuddy、豆包、Kimi、Claude、ChatGPT、Codex；区分桌面软件与命令行工具。不要把浏览器网页、缓存目录或只有名称相似的文件当成已安装软件。不要全盘递归扫描。
不要启动、关闭、安装或修改软件，不访问聊天记录、账号、密码、令牌或原始进程命令行。不调用第三方软件的私有接口。
请用表格列出：智能体名称、桌面版/命令行、已验证的程序完整路径、安装证据；路径不能确认就写未确认。程序图标由插件自动匹配，用户不必选择图标。
本轮只检查并报告结果，不修改插件配置。检查结束后让我选择添加哪些；我选定后，再通过这个 DSH 会话的工具保存设置。不要声称配置好了就等于已经接通真实对话。
若当前会话不能读取本机，请说明具体缺少的能力，不要编造安装结果。`
  const NS = 'dsh-agent-dock', BASE = '/api/agent-dock', TITLE = '其他小天才们'
  const api = async (route, method = 'GET', value) => {
    const response = await fetch(`${BASE}/${route}`, { method, credentials: 'same-origin', cache: 'no-store', ...(value === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }) })
    const data = await response.json()
    if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`)
    return data
  }
  const css = `
.adk{--ad-bg:var(--dsw-alias-bg-base,#fff);--ad-card:var(--dsw-alias-bg-layer-1,#f7f8fa);--ad-border:var(--dsw-alias-border-l1,#e3e5e9);--ad-text:var(--dsw-alias-label-primary,#202124);--ad-muted:var(--dsw-alias-label-secondary,#68707d);--ad-brand:var(--dsw-alias-brand-primary,#4265db);color:var(--ad-text);font-size:14px;box-sizing:border-box}
.adk *{box-sizing:border-box}.adk button,.adk input,.adk select{font:inherit;color:inherit}.adk button{cursor:pointer}.adk button:disabled{cursor:default;opacity:.5}.adk button:focus-visible,.adk input:focus-visible,.adk select:focus-visible{outline:2px solid var(--ad-brand);outline-offset:2px}.adk .btn{padding:8px 13px;border:1px solid var(--ad-border);border-radius:8px;background:var(--ad-bg)}.adk .btn:hover:not(:disabled){background:var(--ad-card)}.adk .primary{background:var(--ad-brand);color:white;border-color:transparent}.adk .danger{color:var(--dsw-alias-state-error-primary,#b42318)}.adk .muted{color:var(--ad-muted);line-height:1.7}.adk .row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.adk .grow{flex:1}.adk .badge{font-size:12px;padding:3px 8px;border-radius:6px;background:var(--ad-card);color:var(--ad-muted);white-space:nowrap}.adk .notice{padding:12px 15px;border:1px solid var(--ad-border);border-radius:9px;background:var(--ad-card);line-height:1.7}.adk .error{color:var(--dsw-alias-state-error-primary,#b42318)}.adk .page{height:100%;overflow:auto;padding:28px;background:var(--ad-bg)}.adk h1{font-size:23px;margin:0}.adk h2{font-size:17px;margin:0 0 12px}.adk h3{font-size:15px;margin:0}.adk .tabs{display:flex;gap:6px;border-bottom:1px solid var(--ad-border);margin:22px 0}.adk .tab{border:0;background:transparent;padding:11px 14px;border-bottom:2px solid transparent;color:var(--ad-muted)}.adk .tab[aria-selected=true]{color:var(--ad-brand);border-bottom-color:var(--ad-brand)}.adk .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(235px,1fr));gap:14px;margin-top:18px}.adk .card{border:1px solid var(--ad-border);border-radius:12px;padding:19px;background:var(--ad-bg)}.adk .field{display:grid;gap:7px;min-width:0}.adk .input{padding:9px 11px;border:1px solid var(--ad-border);border-radius:7px;background:var(--ad-bg);width:100%;min-width:0}.adk .form{display:grid;gap:17px;max-width:730px}.adk .formgrid{display:grid;grid-template-columns:1fr 1fr;gap:15px}.adk .listrow{padding:12px;border:1px solid var(--ad-border);border-radius:8px;margin-top:8px}.adk .empty{text-align:center;padding:50px 20px}.adk .preview{height:100%;display:flex;flex-direction:column;background:var(--ad-bg)}.adk .previewhead{padding:18px 24px;border-bottom:1px solid var(--ad-border)}.adk .previewbody{overflow:auto;flex:1;padding:30px;display:grid;place-content:center;text-align:center}.adk .previewbox{width:min(620px,100%);padding:32px;border:1px dashed var(--ad-border);border-radius:14px;margin:20px auto}.adk .rail{padding:12px;height:100%;overflow:auto;background:var(--dsw-specific-sidebar-fill,var(--ad-bg))}.adk .railbtn{width:100%;text-align:left;border:0;background:transparent;padding:11px 10px;border-radius:8px;display:flex;align-items:center;gap:8px}.adk .railbtn:hover,.adk .railbtn[aria-current=true]{background:var(--ad-card)}.adk .truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.adk .navicon{border:0;background:transparent;display:inline-flex;align-items:center;justify-content:center;padding:3px;color:inherit}.adk .dot{width:6px;height:6px;border-radius:50%;background:var(--ad-muted);display:inline-block;margin-left:3px}.adk .foot{padding:15px 24px;border-top:1px solid var(--ad-border)}@media(max-width:650px){.adk .page{padding:16px}.adk .formgrid{grid-template-columns:1fr}}
`
  const workspaceCss = `.adk.agent-workspaces{padding-top:4px;pointer-events:auto}.adk .agent-workspace-row,.adk .agent-conversation-row{display:flex;align-items:center;gap:8px;width:100%;min-height:34px;padding:6px 8px;border:0;border-radius:7px;background:transparent;text-align:left;font-size:13px}.adk .agent-workspace-row:hover,.adk .agent-conversation-row:hover{background:var(--dsw-alias-interactive-bg-hover,#e9ebee)}.adk .workspace-chevron{width:10px;color:var(--ad-muted);flex:none}.adk .agent-conversation-row{padding-left:42px}.adk .agent-conversation-row[aria-current=page]{background:var(--ad-card)}.adk .workspace-empty{padding:8px 12px 10px 42px;color:var(--ad-muted);font-size:12px}`
  const button = (label, onClick, extra = {}) => h('button', { type: 'button', className: 'btn', onClick, ...extra }, label)
  const badge = label => h('span', { className: 'badge' }, label)
  const field = (label, control, hint) => h('label', { className: 'field' }, h('span', null, label), control, hint && h('small', { className: 'muted' }, hint))
  const uid = () => `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const demo = () => ['项目讨论', '日常问答', '写作灵感'].map((title, i) => ({ id: uid(), title: `${title}（演示）`, pinned: i === 0, updatedAt: new Date().toISOString() }))
  const freshAgent = (name = '', icon = '✦') => ({ id: uid(), name, icon, enabled: true, executable: '', openMethod: 'auto', windowPolicy: 'close', conversations: [] })
  function Icon({ value, size = 23, healthy }) {
    const style = { width: size, height: size, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: size, lineHeight: 1, ...(healthy === false ? { filter: 'grayscale(1)', opacity: .6 } : {}) }
    return value === WORKBUDDY_ICON ? h('img', { src: value, alt: '', 'aria-hidden': true, width: size, height: size, style }) : h('span', { 'aria-hidden': true, style }, value || '✦')
  }
  function useModel(model) { return React.useSyncExternalStore(model.subscribe, model.snapshot) }

  function AndroidPanel() {
    const [state, setState] = React.useState(null), [error, setError] = React.useState(''), [busy, setBusy] = React.useState(false)
    const refresh = React.useCallback(async () => { try { setState(await api('state')) } catch (e) { setError(e.message) } }, [])
    React.useEffect(() => { let live = true; const poll = async () => { try { const next = await api('state'); if (live) setState(next) } catch (e) { if (live) setError(e.message) } }; poll(); const timer = setInterval(poll, 4000); return () => { live = false; clearInterval(timer) } }, [])
    const action = async route => { setBusy(true); setError(''); try { await api(route, 'POST'); await refresh() } catch (e) { setError(e.message) } finally { setBusy(false) } }
    const status = state?.status || 'stopped', labels = { running: '运行中', starting: '启动中', stopped: '未运行' }
    return h('section', { style: { maxWidth: 740 } }, h('h2', null, 'Android 模拟器 · 备用方案'), h('p', { className: 'muted' }, '保留原来的模拟器控制功能。进入这个页面不会启动模拟器。'), h('div', { className: 'notice' }, labels[status], ' · ', state?.device?.name || 'Pixel Tablet', h('div', { className: 'muted' }, state?.device?.serial || '正在读取设备状态…')), h('div', { className: 'row', style: { marginTop: 20 } }, button('启动模拟器', () => action('launch'), { disabled: busy || status !== 'stopped' }), button('打开模拟器页面', () => action('show'), { disabled: busy || status !== 'running' }), button('隐藏模拟器', () => action('hide'), { disabled: busy || status !== 'running' }), button('停止模拟器', () => action('stop'), { disabled: busy || status === 'stopped' }), button('刷新状态', refresh, { disabled: busy })), (error || state?.error) && h('p', { role: 'alert', className: 'error' }, error || state.error), h(AndroidSettings))
  }
  function AndroidSettings() {
    const [device, setDevice] = React.useState(null), [message, setMessage] = React.useState(''), [busy, setBusy] = React.useState(false)
    React.useEffect(() => { let live = true; api('state').then(d => { if (live) setDevice(d.device) }).catch(e => { if (live) setMessage(e.message) }); return () => { live = false } }, [])
    const save = async e => { e.preventDefault(); setBusy(true); try { await api('config', 'POST', device); setMessage('模拟器设置已保存') } catch (e) { setMessage(e.message) } finally { setBusy(false) } }
    return h('details', { style: { marginTop: 26 } }, h('summary', { style: { cursor: 'pointer' } }, '模拟器设置'), device && h('form', { className: 'form', onSubmit: save, style: { marginTop: 16 } }, ...[['name', '显示名称'], ['serial', '设备编号'], ['avd', 'AVD 名称']].map(([key, label]) => field(label, h('input', { className: 'input', value: device[key] || '', onChange: e => setDevice({ ...device, [key]: e.target.value }) }))), button('保存模拟器设置', undefined, { type: 'submit', disabled: busy })), message && h('p', { role: 'status' }, message))
  }

  function AgentEditor({ agent, model, cancel }) {
    const [draft, setDraft] = React.useState(() => JSON.parse(JSON.stringify(agent))), [error, setError] = React.useState(''), [busy, setBusy] = React.useState(false), [newTitle, setNewTitle] = React.useState('')
    const change = (key, value) => setDraft(old => ({ ...old, [key]: value }))
    const save = async e => { e.preventDefault(); setBusy(true); setError(''); try { await model.saveAgent(draft); cancel() } catch (e) { setError(e.message) } finally { setBusy(false) } }
    const state = useModel(model)
    const editConversation = (id, patch) => change('conversations', draft.conversations.map(c => c.id === id ? { ...c, ...patch } : c))
    return h('form', { className: 'form', onSubmit: save }, h('div', { className: 'row' }, h('h2', { className: 'grow' }, '智能体设置'), button('取消', cancel, { disabled: busy })), h('div', { className: 'notice' }, isWorkBuddy(draft) ? connectionHealthy(agent, state) ? '真实侧栏已读取：仅当前展开可见的列表。此处仍只管理本地设置和演示对话。' : '真实侧栏尚未验证。请在 WorkBuddy 视图中刷新真实列表；本地设置不代表连接成功。' : '连接状态：未接入。当前为本地交互预览，尚未配置真实连接。工作区图标显示灰色；连接验证成功后才显示彩色。'), field('选择智能体', h('select', { className: 'input', value: AGENT_CHOICES.includes(draft.name) ? draft.name : 'other', onChange: e => { const name = e.target.value === 'other' ? '' : e.target.value; setDraft(old => ({ ...old, name, icon: automaticIcon(name) })) } }, h('option', { value: 'other' }, '其他智能体'), ...AGENT_CHOICES.map(name => h('option', { key: name, value: name }, name)))), !AGENT_CHOICES.includes(draft.name) && field('智能体名称', h('input', { className: 'input', value: draft.name, required: true, maxLength: 100, onChange: e => setDraft(old => ({ ...old, name: e.target.value, icon: automaticIcon(e.target.value) })), placeholder: '输入软件名称' })), h('details', null, h('summary', { style: { cursor: 'pointer' } }, '高级设置'), field('桌面软件路径（可选）', h('input', { className: 'input', value: draft.executable, maxLength: 1000, onChange: e => change('executable', e.target.value), placeholder: 'C:\\…\\WorkBuddy.exe' }), '先保存设置，本版不会运行该路径。'), h('div', { className: 'formgrid' }, field('将来打开对话的方式', h('select', { className: 'input', value: draft.openMethod, onChange: e => change('openMethod', e.target.value) }, h('option', { value: 'auto' }, '自动选择最快的可用方式'), h('option', { value: 'official' }, '官方链接或命令'), h('option', { value: 'interface' }, '通过软件界面操作'))), field('切回 DSH 后的小窗行为', h('select', { className: 'input', value: draft.windowPolicy, onChange: e => change('windowPolicy', e.target.value) }, h('option', { value: 'close' }, '仅关闭对话小窗'), h('option', { value: 'hide' }, '隐藏小窗，下次恢复'))))), h('label', { className: 'row' }, h('input', { type: 'checkbox', checked: draft.enabled, onChange: e => change('enabled', e.target.checked) }), '打开这个智能体的左侧工作区'), h('section', null, h('div', { className: 'row' }, h('h3', { className: 'grow' }, '演示对话'), button('填入三条示例', () => change('conversations', [...draft.conversations, ...demo()]), { disabled: draft.conversations.length > 97 })), h('p', { className: 'muted' }, '这些是供你检查点击流程的本地条目，不是软件里的真实历史。'), ...draft.conversations.map(c => h('div', { className: 'row listrow', key: c.id }, h('input', { className: 'input grow', 'aria-label': '演示对话标题', value: c.title, maxLength: 160, required: true, style: { width: 200 }, onChange: e => editConversation(c.id, { title: e.target.value }) }), button(c.pinned ? '取消置顶' : '置顶', () => editConversation(c.id, { pinned: !c.pinned })), button('移除条目', () => change('conversations', draft.conversations.filter(item => item.id !== c.id))))), h('div', { className: 'row', style: { marginTop: 12 } }, h('input', { className: 'input grow', 'aria-label': '新演示对话标题', value: newTitle, maxLength: 160, placeholder: '自定义演示对话标题', style: { width: 200 }, onChange: e => setNewTitle(e.target.value) }), button('添加条目', () => { change('conversations', [...draft.conversations, { id: uid(), title: newTitle.trim(), pinned: false, updatedAt: new Date().toISOString() }]); setNewTitle('') }, { disabled: !newTitle.trim() || draft.conversations.length >= 100 }))), error && h('p', { role: 'alert', className: 'error' }, error), h('div', { className: 'row' }, button(busy ? '保存中…' : '保存设置', undefined, { type: 'submit', disabled: busy, className: 'btn primary' }), button('取消', cancel, { disabled: busy })))
  }

  function Manager({ model }) {
    const state = useModel(model), [tab, setTab] = React.useState('agents'), [editing, setEditing] = React.useState(null), [pendingDelete, setPendingDelete] = React.useState(null), [error, setError] = React.useState(''), [busy, setBusy] = React.useState(false)
    const operation = async fn => { setBusy(true); setError(''); try { await fn() } catch (e) { setError(e.message) } finally { setBusy(false) } }
    const presets = AGENT_CHOICES.map(name => [name, automaticIcon(name)])
    const cards = state.agents.map((agent, i) => {
      const actions = pendingDelete === agent.id
        ? h('div', { className: 'notice' }, h('p', null, '移除这个本地入口及其演示条目？'), button('确认移除', () => operation(async () => { await model.removeAgent(agent.id); setPendingDelete(null) }), { disabled: busy, className: 'btn danger' }), ' ', button('取消', () => setPendingDelete(null), { disabled: busy }))
        : h(React.Fragment, null,
          h('div', { className: 'row' }, button('查看对话', () => model.openAgent(agent.id), { disabled: !agent.enabled }), isWorkBuddy(agent) && button('刷新真实列表', () => model.refreshReal(agent.id), { disabled: !agent.enabled || !!state.realSidebars[agent.id]?.loading }), button('设置', () => setEditing(agent)), button(agent.enabled ? '关闭工作区' : '打开工作区', () => operation(() => model.saveAgent({ ...agent, enabled: !agent.enabled })), { disabled: busy })),
          h('div', { className: 'row', style: { marginTop: 10 } }, button('上移', () => operation(() => model.moveAgent(agent.id, -1)), { disabled: busy || i === 0 }), button('下移', () => operation(() => model.moveAgent(agent.id, 1)), { disabled: busy || i === state.agents.length - 1 }), button('移除', () => setPendingDelete(agent.id), { disabled: busy, className: 'btn danger' })))
      return h('article', { className: 'card', key: agent.id },
        h('div', { className: 'row' }, h(Icon, { value: agentIcon(agent), healthy: connectionHealthy(agent, state), size: 30 }), h('h3', { className: 'grow' }, agent.name), badge(agent.enabled ? connectionHealthy(agent, state) ? '真实侧栏已读取' : '未接入' : '工作区已关闭')),
        h('p', { className: 'muted' }, `${agent.conversations.length} 条演示对话 · ${agent.enabled ? '工作区已打开' : '工作区已关闭，设置已保留'}`), state.realSidebars[agent.id]?.error && h('p', { role: 'alert', className: 'error' }, state.realSidebars[agent.id].error), actions)
    })
    const empty = !state.loaded ? h('p', { className: 'muted' }, '正在读取设置…') : !state.agents.length ? h('div', { className: 'empty' },
      h('h2', null, '先添加一个智能体'), h('p', { className: 'muted' }, '选择下方名字填好设置，再添加演示对话试试。'),
      h('div', { className: 'row', style: { justifyContent: 'center' } }, ...presets.map(([name, icon]) => button(`添加 ${name}`, () => setEditing(freshAgent(name, icon)))))) : null
    const list = h(React.Fragment, null,
      h('div', { className: 'notice' }, badge('交互预览'), ' 可以管理本地演示对话；WorkBuddy 可手动读取当前展开可见的真实侧栏列表。'),
      state.error && h('p', { role: 'alert', className: 'error' }, state.error, ' ', button('重新读取设置', model.reload)),
      error && h('p', { role: 'alert', className: 'error' }, error),
      h('div', { className: 'row', style: { marginTop: 22 } }, h('h2', { className: 'grow', style: { margin: 0 } }, '我的智能体'), button(state.searching ? '正在打开搜索会话…' : '搜索本机智能体', () => model.searchInstalled(), { disabled: state.searching || busy }), button('添加智能体', () => setEditing(freshAgent('WorkBuddy', automaticIcon('WorkBuddy'))), { disabled: !state.loaded || busy })),
      empty, h('div', { className: 'grid' }, ...cards))
    return h('main', { className: 'adk', 'data-agent-dock': 'manager', style: { height: '100%' } },
      h('div', { className: 'page' },
        h('header', { className: 'row' }, h(Icon, { value: '✦', size: 30 }), h('div', { className: 'grow' }, h('h1', null, TITLE), h('div', { className: 'muted', style: { marginTop: 5 } }, '把常用的智能体，放在顺手的位置。')), button('返回 DSH', model.back)),
        h('div', { className: 'tabs', role: 'tablist', 'aria-label': '管理功能' }, ...[['agents', '桌面智能体'], ['android', 'Android 模拟器']].map(([id, label]) => h('button', { type: 'button', role: 'tab', key: id, 'aria-selected': tab === id, className: 'tab', onClick: () => { setTab(id); setEditing(null) } }, label))),
        tab === 'android' ? h(AndroidPanel) : editing ? h(AgentEditor, { key: editing.id, agent: editing, model, cancel: () => setEditing(null) }) : list))
  }

  function RealSidebarList({ model, agent, state }) {
    const real = state.realSidebars[agent.id]
    return h('section', { 'data-agent-dock': 'real-sidebar' },
      h('p', { className: 'muted' }, '真实侧栏 · 仅原软件当前展开且可见的列表，不代表完整历史记录。'),
      button(real?.loading ? '正在读取真实列表…' : '刷新真实列表', () => model.refreshReal(agent.id), { disabled: !!real?.loading }),
      real?.error && h('p', { role: 'alert', className: 'error' }, real.error),
      real?.connected && h('div', null, h('p', { className: 'muted' }, real.window, ' · ', real.fetchedAt), ...real.groups.map((group, index) => h('section', { key: index }, h('h3', null, group.name), ...group.conversations.map(item => h('button', { type: 'button', className: 'agent-conversation-row', key: item.key, title: item.title, 'aria-current': state.selectedReal[agent.id]?.key === item.key && state.selectedReal[agent.id]?.group === group.name ? 'page' : undefined, onClick: () => model.selectReal(agent.id, { key: item.key, title: item.title, group: group.name }) }, item.title)))), !real.groups.some(group => group.conversations.length) && h('p', { className: 'muted' }, '当前展开可见的侧栏没有对话条目。')))
  }

  function PopupViewport({ model, lease }) {
    const [node, setNode] = React.useState(null)
    React.useEffect(() => {
      if (!node) return
      let live = true, tail = Promise.resolve(), last = null
      const geometry = visible => { const r = node.getBoundingClientRect(); return { rect: { x: r.x, y: r.y, width: r.width, height: r.height }, devicePixelRatio: window.devicePixelRatio, visible, screen: { x: window.screenX, y: window.screenY, width: window.outerWidth, height: window.outerHeight, innerWidth: window.innerWidth, innerHeight: window.innerHeight } } }
      const send = visible => { const value = geometry(visible); last = value; tail = model.popupViewport(value, lease).catch(error => { if (live) model.popupError(error.message, lease) }); return tail }
      const refresh = () => { if (live) send(model.popupActive(lease)) }
      refresh(); const timer = setInterval(refresh, 1500)
      window.addEventListener('resize', refresh); document.addEventListener('visibilitychange', refresh)
      return () => { live = false; clearInterval(timer); window.removeEventListener('resize', refresh); document.removeEventListener('visibilitychange', refresh); if (last) { last = { ...last, visible: false }; model.popupViewport(last, lease).catch(() => {}) } }
    }, [node, lease])
    return h('div', { ref: setNode, 'data-agent-dock': 'native-viewport', style: { flex: 1, minHeight: 300, marginTop: 12, border: '1px solid var(--ad-border)' } }, 'WorkBuddy 原生对话窗口区域')
  }

  function ConversationPreview({ model, agentId }) {
    const state = useModel(model), agent = state.agents.find(a => a.id === agentId && a.enabled), conversation = agent?.conversations.find(c => c.id === state.selected[agentId]), [query, setQuery] = React.useState('')
    if (!agent) return h('div', { className: 'adk page' }, h('p', null, '这个入口已停用或移除。'), button('返回管理页', model.home))
    if (isWorkBuddy(agent) && state.previewModes[agentId] !== 'demo') {
      const selected = state.selectedReal[agentId]
      return h('main', { className: 'adk page', 'data-agent-dock': 'preview', style: { height: '100%', minHeight: 0, padding: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
        h('header', { className: 'row' }, h(Icon, { value: agentIcon(agent), healthy: connectionHealthy(agent, state) }), h('h2', { className: 'grow' }, agent.name), button('管理页', model.home), button('返回 DSH', model.back)),
        !state.popup?.opened && h(RealSidebarList, { model, agent, state }),
        state.popup?.opened && state.popup.agentId === agentId && h(PopupViewport, { key: state.popup.lease, model, lease: state.popup.lease }),
        selected && !state.popup?.opened && h('div', { className: 'notice', 'data-agent-dock': 'real-selection', style: { marginTop: 18 } }, h('strong', null, selected.title), h('p', { className: 'muted' }, selected.group), h('p', { role: state.popup?.error ? 'alert' : 'status' }, state.popup?.opening ? '正在通过 WorkBuddy 原生菜单打开…' : state.popup?.error || '已选择真实列表条目。'), button('取消选择', () => model.selectReal(agentId, null))),
        !state.popup?.opened && h('p', { className: 'muted' }, '点击真实条目将操作 WorkBuddy 自己的“在独立窗口中打开”菜单。小窗跟随右侧区域；切回 DSH 时隐藏，返回时恢复。'), !state.popup?.opened && button('查看本地演示', () => model.showDemo(agentId)))
    }
    return h('main', { className: 'adk preview', 'data-agent-dock': 'preview' }, h('header', { className: 'row previewhead' }, h(Icon, { value: agentIcon(agent), healthy: connectionHealthy(agent, state) }), h('div', { className: 'grow' }, h('h2', { style: { margin: 0 } }, conversation?.title || agent.name), h('small', { className: 'muted' }, agent.name, ' · 演示对话')), isWorkBuddy(agent) && button('查看真实列表', () => model.openAgent(agentId)), button('管理页', model.home), button('返回 DSH', model.back)), h('div', { className: 'previewbody' }, conversation ? h('div', null, h(Icon, { value: agentIcon(agent), healthy: connectionHealthy(agent, state), size: 44 }), h('h2', { style: { marginTop: 18 } }, '已选择这条演示对话'), h('p', { className: 'muted' }, conversation.title), h('div', { className: 'previewbox' }, h('strong', null, '这里预留给原软件的对话小窗'), h('p', { className: 'muted' }, '当前只验证选择、切换和返回流程，没有打开外部窗口，也不会发送消息。')), h('p', { className: 'muted' }, '切回 DSH 后按设置：', agent.windowPolicy === 'hide' ? '隐藏小窗，下次恢复' : '仅关闭对话小窗', '（连接后生效）'), button('取消选择', () => model.select(agent.id, null))) : h('div', null, h('h2', null, `选择 ${agent.name} 的演示对话`), h('p', { className: 'muted' }, '可以点击左侧列表，也可以在下面选择。'), h('input', { className: 'input', 'aria-label': '搜索演示对话', placeholder: '搜索演示对话', value: query, onChange: e => setQuery(e.target.value) }), ...model.conversations(agent, query).map(c => h('div', { key: c.id, style: { marginTop: 10 } }, button(`${c.pinned ? '★ ' : ''}${c.title}`, () => model.select(agent.id, c.id)))), !agent.conversations.length && h('div', { className: 'notice' }, '还没有演示条目。', ' ', button('去设置里添加', model.home)))), h('footer', { className: 'foot muted' }, '本地交互预览 · 不读取、同步或修改原软件的真实对话。'))
  }
  function WorkspaceList({ model, agentId, wide, expandSidebar }) {
    const state = useModel(model), agent = state.agents.find(a => a.id === agentId), [query, setQuery] = React.useState('')
    if (!agent) return null
    if (wide === false) return h('div', { className: 'adk rail' }, button(agent.icon || '✦', expandSidebar, { title: `${agent.name} · 展开演示对话` }), button('DSH', model.back))
    const items = model.conversations(agent, query)
    return h('aside', { className: 'adk rail', 'data-agent-dock': 'conversations' }, h('div', { className: 'row' }, h(Icon, { value: agentIcon(agent), healthy: connectionHealthy(agent, state) }), h('strong', { className: 'grow truncate' }, agent.name), badge('演示')), h('input', { className: 'input', style: { marginTop: 14 }, value: query, placeholder: '搜索演示对话', 'aria-label': '筛选左侧演示对话', onChange: e => setQuery(e.target.value) }), h('div', { className: 'row', style: { marginTop: 10 } }, button('管理', model.home), button('返回 DSH', model.back)), h('p', { className: 'muted', style: { fontSize: 12 } }, '本地演示列表，尚未读取原软件'), ...items.map(c => h('button', { type: 'button', className: 'railbtn', key: c.id, title: c.title, 'aria-current': state.selected[agentId] === c.id, onClick: () => model.select(agentId, c.id) }, h('span', null, c.pinned ? '★' : '◌'), h('span', { className: 'truncate' }, c.title))), !items.length && h('p', { className: 'muted' }, agent.conversations.length ? '没有匹配的演示对话' : '还没有条目，请到管理页添加。'))
  }

  return { inject: ['slots', 'layout', 'sessions', 'uiWorkspace'], apply(ctx) {
    ctx.effect(() => {
      const style = document.createElement('style'); style.textContent = css + workspaceCss; document.head.appendChild(style)
      let state = { agents: [], revision: 0, loaded: false, error: '', searching: false, selected: {}, expanded: {}, realSidebars: {}, selectedReal: {}, previewModes: {} }, alive = true, workspaceDispose = null, activeAgentId = null, saving = false
      let popupTail = Promise.resolve(), popupGeneration = 0
      const popupRequest = (route, value) => { const result = popupTail.catch(() => {}).then(() => api(`workbuddy/${route}`, 'POST', value)); popupTail = result.catch(() => {}); return result }
      const hidePopup = () => { if (state.popup?.lease) popupRequest('viewport', { lease: state.popup.lease, visible: false }).catch(() => {}) }
      const realRequests = new Map(), realSources = new Map()
      const listeners = new Set(), entries = new Map(), disposers = []
      const emit = patch => { state = { ...state, ...patch }; listeners.forEach(fn => fn()) }
      const panelKey = id => `${NS}:agent:${id}`
      const clearWorkspace = () => { hidePopup(); workspaceDispose?.(); workspaceDispose = null; activeAgentId = null; emit({}) }
      const model = {
        popupActive: lease => alive && state.popup?.lease === lease && ctx.layout.panelInfo?.getSnapshot().activePanelId === panelKey(state.popup.agentId),
        popupViewport: (value, lease) => popupRequest('viewport', { ...value, lease }),
        popupError: (error, lease) => { if (alive && state.popup?.lease === lease) emit({ popup: { ...state.popup, error, opened: false, opening: false } }) },
        snapshot: () => state, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) },
        conversations: (agent, query = '') => agent.conversations.filter(c => c.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice().sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt)),
        home: () => { clearWorkspace(); ctx.layout.selectPanel(NS) },
        back: () => { clearWorkspace(); ctx.layout.selectPanel(null) },
        select: (id, conversationId) => { model.showDemo(id); emit({ selected: { ...state.selected, [id]: conversationId } }) },
        showDemo: id => { hidePopup(); if (!state.agents.some(a => a.id === id && a.enabled)) return; emit({ previewModes: { ...state.previewModes, [id]: 'demo' } }); ctx.layout.selectPanel(panelKey(id)); activateWorkspace(id) },
        selectReal: async (id, item) => {
          if (!state.agents.some(a => a.id === id && a.enabled && isWorkBuddy(a)) || state.popup?.opening) return
          hidePopup()
          const generation = ++popupGeneration, lease = uid()
          emit({ selectedReal: { ...state.selectedReal, [id]: item }, previewModes: { ...state.previewModes, [id]: 'real' }, popup: item ? { opening: true, error: '', lease, agentId: id } : null })
          ctx.layout.selectPanel(panelKey(id)); activateWorkspace(id)
          if (!item) return
          try {
            const result = await popupRequest('open', { window: state.realSidebars[id]?.window, ...item, lease })
            if (alive && generation === popupGeneration && state.selectedReal[id] === item) {
              emit({ popup: { opening: false, opened: true, title: result.title, error: '', lease, agentId: id } })
              if (ctx.layout.panelInfo?.getSnapshot().activePanelId !== panelKey(id)) await popupRequest('viewport', { lease, visible: false })
            } else await popupRequest('viewport', { lease, visible: false })
          } catch (error) { if (alive && generation === popupGeneration && state.selectedReal[id] === item) emit({ popup: { opening: false, opened: false, error: error.message, lease } }) }
        },
        toggleWorkspace: id => { const expanded = !state.expanded[id]; emit({ expanded: { ...state.expanded, [id]: expanded } }); if (expanded) return model.refreshReal(id) },
        openAgent: id => { if (activeAgentId && activeAgentId !== id) hidePopup(); const agent = state.agents.find(a => a.id === id && a.enabled); if (!agent) return; emit({ previewModes: { ...state.previewModes, [id]: 'real' } }); ctx.layout.selectPanel(panelKey(id)); activateWorkspace(id); if (isWorkBuddy(agent) && !(state.popup?.opened && state.popup.agentId === id)) return model.refreshReal(id) },
        refreshReal: id => {
          const agent = state.agents.find(a => a.id === id && a.enabled && isWorkBuddy(a))
          if (!alive || !agent) return Promise.resolve()
          if (realRequests.has(id)) return realRequests.get(id).promise
          const request = { source: realSource(agent), promise: null }
          realSources.set(id, request.source)
          const valid = () => alive && realRequests.get(id) === request && state.agents.some(a => a.id === id && realSource(a) === request.source)
          request.promise = (async () => {
            try {
              const data = await api('workbuddy/sidebar')
              if (!valid()) return
              if (data.ok !== true || data.connected !== true || data.scope !== 'visible-sidebar' || typeof data.window !== 'string' || typeof data.fetchedAt !== 'string' || !Array.isArray(data.groups) || data.groups.some(g => typeof g.name !== 'string' || !Array.isArray(g.conversations) || g.conversations.some(c => typeof c.key !== 'string' || typeof c.title !== 'string'))) throw new Error('真实侧栏返回格式无效或尚未连接。')
              emit({ realSidebars: { ...state.realSidebars, [id]: { connected: true, loading: false, error: '', window: data.window, scope: data.scope, fetchedAt: data.fetchedAt, groups: data.groups.map(g => ({ name: g.name, conversations: g.conversations.map(c => ({ key: c.key, title: c.title })) })) } }, selectedReal: { ...state.selectedReal, [id]: (state.popup?.opened || state.popup?.opening) && state.popup.agentId === id ? state.selectedReal[id] : null } })
            } catch (error) {
              if (valid()) emit({ realSidebars: { ...state.realSidebars, [id]: { connected: false, loading: false, error: error.message, groups: [] } }, selectedReal: { ...state.selectedReal, [id]: (state.popup?.opened || state.popup?.opening) && state.popup.agentId === id ? state.selectedReal[id] : null } })
            } finally {
              if (realRequests.get(id) === request) { realRequests.delete(id); if (alive && state.realSidebars[id]?.loading) emit({ realSidebars: { ...state.realSidebars, [id]: { connected: false, loading: false, error: '', groups: [] } } }) }
            }
          })()
          realRequests.set(id, request)
          emit({ realSidebars: { ...state.realSidebars, [id]: { ...state.realSidebars[id], loading: true, error: '' } } })
          return request.promise
        },
        reload: async () => { try { const data = await api('workbench'); if (!alive) return; emit({ ...data, loaded: true, error: '' }); reconcile() } catch (e) { if (alive) emit({ error: e.message }) } },
        searchInstalled: async () => {
          if (state.searching) return
          emit({ searching: true, error: '' })
          try {
            const sessionId = await ctx.sessions.create()
            if (!alive) return
            clearWorkspace()
            ctx.uiWorkspace.openSession(sessionId)
            await ctx.sessions.using(sessionId, { source: 'controllerOperation' }, async reference => {
              const result = await reference.binding.session.prompt([{ type: 'text', text: DISCOVERY_PROMPT }], 'queue')
              if (!result.ok) throw new Error(result.error?.message || '搜索提示词提交失败')
            })
          } catch (error) {
            if (alive) { emit({ error: `未能发送搜索提示词：${error.message}` }); ctx.layout.selectPanel(NS) }
          } finally { if (alive) emit({ searching: false }) }
        },
        saveAgent: agent => commit(state.agents.some(a => a.id === agent.id) ? state.agents.map(a => a.id === agent.id ? agent : a) : [...state.agents, agent]),
        removeAgent: id => commit(state.agents.filter(a => a.id !== id)),
        moveAgent: (id, offset) => { const agents = [...state.agents], i = agents.findIndex(a => a.id === id), j = i + offset; if (i < 0 || j < 0 || j >= agents.length) return; [agents[i], agents[j]] = [agents[j], agents[i]]; return commit(agents) }
      }
      async function commit(agents) {
        if (saving) throw new Error('上一项设置正在保存，请稍等。')
        saving = true
        try { const data = await api('workbench', 'PUT', { revision: state.revision, agents }); if (!alive) return; emit({ ...data, loaded: true, error: '' }); reconcile() } catch (e) { if (alive) emit({ error: e.message }); throw e } finally { saving = false }
      }
      function activateWorkspace(id) { activeAgentId = id; emit({ expanded: { ...state.expanded, [id]: true } }) }
      function WorkspaceEntries() {
        const current = useModel(model)
        return h('div', { className: 'adk agent-workspaces', 'data-agent-dock': 'workspace-entries' }, ...current.agents.filter(a => a.enabled).map(agent => {
          const expanded = !!current.expanded[agent.id]
          return h('section', { key: agent.id, 'data-agent-workspace': agent.id },
            h('button', { type: 'button', className: 'agent-workspace-row', title: agent.name, 'aria-expanded': expanded, onClick: () => model.toggleWorkspace(agent.id) },
              h('span', { className: 'workspace-chevron', 'aria-hidden': true }, expanded ? '⌄' : '›'), h(Icon, { value: agentIcon(agent), size: 16, healthy: connectionHealthy(agent, current) }), h('span', { className: 'truncate' }, agent.name)),
            expanded && h('div', { className: 'agent-workspace-conversations' }, isWorkBuddy(agent) && h(RealSidebarList, { model, agent, state: current }), isWorkBuddy(agent) && h('div', { className: 'workspace-empty' }, '本地演示对话'), ...model.conversations(agent).map(c => h('button', { type: 'button', className: 'agent-conversation-row', key: c.id, title: c.title, 'aria-current': activeAgentId === agent.id && current.selected[agent.id] === c.id ? 'page' : undefined, onClick: () => model.select(agent.id, c.id) }, h('span', { className: 'truncate' }, `${c.pinned ? '★ ' : ''}${c.title}`))), !agent.conversations.length && h('div', { className: 'workspace-empty' }, '暂无演示对话')))
        }))
      }
      // Compatibility adapter: mount our rows inside the existing scrollable tree.
      // The display:contents slot anchor itself is not a visible list container.
      function WorkspacePortal() {
        const [target, setTarget] = React.useState(null)
        React.useEffect(() => {
          const node = document.createElement('div'); node.dataset.agentDockMount = 'workspaces'
          const attach = () => {
            const anchor = document.querySelector('[data-slot="sidebar.workspaces"]')
            const list = anchor?.querySelector('[role="tree"]')
            if (list && node.parentNode !== list) list.appendChild(node)
            if (!list && node.parentNode) node.remove()
            setTarget(list ? node : null)
          }
          attach(); const observer = new MutationObserver(attach); observer.observe(document.body, { childList: true, subtree: true })
          return () => { observer.disconnect(); node.remove() }
        }, [])
        return target ? createPortal(h(WorkspaceEntries), target) : null
      }
      disposers.push(ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: `${NS}:workspace-portal` }, WorkspacePortal)))
      function AgentRoot({ id }) {
        React.useEffect(() => { activateWorkspace(id); return () => { if (activeAgentId === id) clearWorkspace() } }, [id])
        return h(ConversationPreview, { model, agentId: id })
      }
      function reconcile() {
        for (const [id, source] of realSources) {
          if (!state.agents.some(a => a.id === id && a.enabled && isWorkBuddy(a) && realSource(a) === source)) {
            realRequests.delete(id); realSources.delete(id)
            const realSidebars = { ...state.realSidebars }, selectedReal = { ...state.selectedReal }
            delete realSidebars[id]; delete selectedReal[id]; emit({ realSidebars, selectedReal })
          }
        }
        for (const [id, entry] of entries) {
          const next = state.agents.find(a => a.id === id && a.enabled)
          if (!next) { if (activeAgentId === id) model.home(); entry.side(); entry.main(); entries.delete(id) }
        }
        for (const [i, agent] of state.agents.entries()) {
          if (!agent.enabled) continue
          let entry = entries.get(agent.id)
          if (!entry) { entry = { main: ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: panelKey(agent.id) }, () => h(AgentRoot, { id: agent.id }))), side: () => {}, signature: null }; entries.set(agent.id, entry) }
          const signature = JSON.stringify([i, agent.name, agent.icon])
          if (signature !== entry.signature) {
            entry.side(); entry.signature = signature
            // Agent entries live below the workspace list, not in global navigation.
          }
        }
      }
      disposers.push(ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: NS }, () => h(Manager, { model }))))
      disposers.push(ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: NS, order: 31, label: () => TITLE }, ({ size = 22 }) => h('span', { className: 'adk' }, h(Icon, { value: '✦', size })))))
      disposers.push(ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: NS, order: 60, label: () => TITLE }, () => h('div', { className: 'adk', style: { padding: 24 } }, h('h2', null, TITLE), h('p', { className: 'muted' }, '在管理页设置智能体、演示对话和模拟器。'), button('打开管理页', model.home)))))
      if (ctx.layout.panelInfo?.subscribe) disposers.push(ctx.layout.panelInfo.subscribe(() => { const id = state.popup?.agentId; if (id && ctx.layout.panelInfo.getSnapshot().activePanelId !== panelKey(id)) hidePopup() }))
      model.reload()
      return () => { alive = false; clearWorkspace(); for (const entry of entries.values()) { entry.side(); entry.main() } disposers.reverse().forEach(dispose => dispose()); style.remove(); listeners.clear() }
    }, 'agent workbench local preview')
  } }
} })
