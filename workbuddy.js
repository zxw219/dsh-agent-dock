import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const SIDEBAR_PATH = '/api/agent-dock/workbuddy/sidebar'
const script = fileURLToPath(new URL('./native/WorkBuddyBridge.ps1', import.meta.url))

// PowerShell 7 is intentional: the installed desktop app exposed its Chromium
// accessibility tree to this host during validation, but not to our Framework exe.
function runBridge(operation, request, { command = process.env.DSH_PWSH_PATH || 'pwsh.exe', timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-File', script, '-Operation', operation], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    child.stdin.on('error', () => {})
    child.stdin.end(request ? JSON.stringify(request) : '')
    const stdout = [], stderr = []
    let size = 0, settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      error ? reject(error) : resolve(value)
    }
    const timer = setTimeout(() => { child.kill(); finish(new Error('WorkBuddy 辅助功能读取超时，请还原主窗口后重试。')) }, timeout)
    child.stdout.on('data', chunk => {
      size += chunk.length
      if (size > 256 * 1024) { child.kill(); finish(new Error('侧栏数据超出读取上限。')); return }
      stdout.push(chunk)
    })
    child.stderr.on('data', chunk => { if (stderr.reduce((n, b) => n + b.length, 0) < 8192) stderr.push(chunk) })
    child.once('error', error => finish(new Error(error.code === 'ENOENT' ? '未找到 PowerShell 7，请安装后重试，或设置 DSH_PWSH_PATH。' : error.message)))
    child.once('close', code => {
      if (settled) return
      try {
        const result = JSON.parse(Buffer.concat(stdout).toString('utf8').replace(/^\uFEFF/, '').trim())
        if (code !== 0 || result.ok !== true) throw new Error(result.error || 'WorkBuddy 侧栏读取失败。')
        finish(null, result)
      } catch (error) { finish(new Error(error instanceof SyntaxError ? 'WorkBuddy 读取器未返回有效结果。' : error.message)) }
    })
  })
}

export async function readSidebar(options) {
  const result = await runBridge('sidebar', null, options)
  if (result.connected !== true || result.scope !== 'visible-sidebar' || !Array.isArray(result.groups)) throw new Error('WorkBuddy 侧栏返回格式无效。')
  return result
}

export async function openConversation(request, options) {
  for (const key of ['window', 'key', 'group', 'title']) if (typeof request?.[key] !== 'string' || !request[key] || request[key].length > 4096) throw new Error('对话定位参数无效，请刷新列表。')
  const result = await runBridge('open', request, options)
  if (!/^\d+$/.test(result.window) || !Number.isInteger(result.pid) || result.title !== request.title) throw new Error('未能核对原生小窗身份。')
  return result
}

export function registerPopup(ctx, { open = openConversation, attached = async () => {} } = {}) {
  let busy = false
  return ctx.webServer.register({ kind: 'exact', path: '/api/agent-dock/workbuddy/open', handler: async (req, res) => {
    const reply = (status, value) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)) }
    const rejection = ctx.connection.requestRejection(req)
    if (rejection !== undefined) return reply(rejection, { ok: false, error: 'Access denied' })
    if (req.method !== 'POST') return reply(405, { ok: false, error: 'Method not allowed' })
    if (busy) return reply(409, { ok: false, error: '上一条对话正在打开，请稍等。' })
    busy = true
    try {
      let size = 0; const chunks = []
      for await (const chunk of req) { size += chunk.length; if (size > 16384) throw new Error('请求过大。'); chunks.push(chunk) }
      const request = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      const result = await open(request)
      await attached(result)
      reply(200, result)
    } catch (error) { reply(400, { ok: false, error: error.message }) }
    finally { busy = false }
  } })
}

export default function registerWorkBuddy(ctx, { read = readSidebar } = {}) {
  let pending = null
  return ctx.webServer.register({
    kind: 'exact', path: SIDEBAR_PATH,
    handler: async (req, res) => {
      const reply = (status, value) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)) }
      const rejection = ctx.connection.requestRejection(req)
      if (rejection !== undefined) return reply(rejection, { ok: false, error: 'Access denied' })
      if (req.method !== 'GET') return reply(405, { ok: false, error: 'Method not allowed' })
      try {
        // Coalesce concurrent manual requests; never keep a disk history cache.
        if (!pending) pending = Promise.resolve().then(read).finally(() => { pending = null })
        reply(200, await pending)
      } catch (error) { reply(503, { ok: false, connected: false, error: error.message }) }
    },
  })
}
