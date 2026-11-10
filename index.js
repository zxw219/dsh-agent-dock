import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import registerWorkbench from './workbench.js'
import registerWorkBuddy from './workbuddy.js'

export const name = 'dsh-agent-dock'
export const inject = ['webServer', 'connection']
const root = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(root, 'data')
const configPath = path.join(dataDir, 'android.json')
const sdkRoot = path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk')
const adb = process.env.ADB_PATH || path.join(sdkRoot, 'platform-tools', 'adb.exe')
const emulator = process.env.EMULATOR_PATH || path.join(sdkRoot, 'emulator', 'emulator.exe')
const defaultDevice = { id: 'pixel-tablet', serial: 'emulator-5554', avd: 'Pixel_Tablet', name: 'Pixel Tablet', icon: '📱', enabled: true }
let launchPromise = null
let launchUntil = 0
let launchError = null
let emulatorPid = 0

const json = (res, code, value, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(type.startsWith('image/') ? value : JSON.stringify(value))
}
async function body(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}
function run(command, args, { binary = false, timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true })
    const out = [], err = []
    const timer = setTimeout(() => { child.kill(); reject(new Error('命令请求超时')) }, timeout)
    child.stdout.on('data', b => out.push(b))
    child.stderr.on('data', b => err.push(b))
    child.once('error', e => { clearTimeout(timer); reject(e) })
    child.once('close', code => {
      clearTimeout(timer)
      const stdout = Buffer.concat(out)
      if (code !== 0) return reject(new Error(Buffer.concat(err).toString('utf8').trim() || `${path.basename(command)} exited ${code}`))
      resolve(binary ? stdout : stdout.toString('utf8').trim())
    })
  })
}
function normalise(raw) {
  if (raw?.devices && Array.isArray(raw.devices)) return { version: 2, activeDeviceId: raw.activeDeviceId || raw.devices[0]?.id, devices: raw.devices, agents: Array.isArray(raw.agents) ? raw.agents : [] }
  const device = raw && typeof raw === 'object' ? { ...defaultDevice, ...raw } : defaultDevice
  return { version: 2, activeDeviceId: device.id || defaultDevice.id, devices: [{ ...defaultDevice, ...device }], agents: [] }
}
async function loadConfig() {
  try { return normalise(JSON.parse(await readFile(configPath, 'utf8'))) } catch { return normalise({ devices: [defaultDevice], agents: [] }) }
}
function currentDevice(config) {
  return config.devices.find(d => d.id === config.activeDeviceId && d.enabled !== false) || config.devices.find(d => d.enabled !== false) || defaultDevice
}
async function devices() {
  const output = await run(adb, ['devices'])
  return output.split(/\r?\n/).filter(Boolean).slice(1).map(line => {
    const [serial, status] = line.trim().split(/\s+/)
    return { serial, status }
  })
}
async function emulatorProcess(device) {
  try {
    const avd = String(device?.avd || '').replace(/'/g, "''")
    const output = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `@(Get-CimInstance Win32_Process -Filter \"Name='qemu-system-x86_64.exe'\" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match '${avd}' }).Count`])
    return Number(output) > 0
  } catch { return false }
}
async function stopEmulatorProcess(device) {
  try {
    const avd = String(device?.avd || '').replace(/'/g, "''")
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$p=Get-CimInstance Win32_Process -Filter \"Name='qemu-system-x86_64.exe'\" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match '${avd}' }; if($p){$p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }}`], { timeout: 10000 })
  } catch {}
}
async function waitForDevice(device, attempts = 120) {
  let last = 'Android device is not ready'
  for (let i = 0; i < attempts; i++) {
    try {
      const found = (await devices()).find(d => d.serial === device.serial)
      if (found?.status === 'device') return true
      if (found?.status) last = `ADB device ${found.status}`
    } catch (e) { last = e.message }
    await wait(1000)
  }
  throw new Error(last)
}
async function windowCommand(device, action) {
  const mode = action === 'show' ? 5 : 0
  const needle = String(device.avd || device.serial).replace(/'/g, "''")
  const script = `$ErrorActionPreference='Stop'; Add-Type @'\nusing System; using System.Text; using System.Runtime.InteropServices; public static class DshWindow { public delegate bool EnumWindowsProc(IntPtr h, IntPtr l); [DllImport(\"user32.dll\")] public static extern bool EnumWindows(EnumWindowsProc f, IntPtr l); [DllImport(\"user32.dll\")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n); [DllImport(\"user32.dll\")] public static extern bool IsWindow(IntPtr h); [DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr h, int n); [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr h); public static IntPtr Find(string needle) { IntPtr result=IntPtr.Zero; EnumWindows((h,l)=>{ var b=new StringBuilder(512); GetWindowText(h,b,b.Capacity); if(b.ToString().IndexOf(needle,StringComparison.OrdinalIgnoreCase)>=0){ result=h; return false; } return true; }, IntPtr.Zero); return result; } }\n'@; $h=[DshWindow]::Find('${needle}'); if($h -eq [IntPtr]::Zero){ throw 'Android emulator window not found' }; [DshWindow]::ShowWindow($h,${mode}) | Out-Null; if('${action}' -eq 'show'){ [DshWindow]::SetForegroundWindow($h) | Out-Null }; Write-Output $h`
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { timeout: 10000 })
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
async function waitForWindow(device, action, attempts = 40) {
  let lastError
  for (let i = 0; i < attempts; i++) {
    try { return await windowCommand(device, action) } catch (e) { lastError = e; await wait(500) }
  }
  throw lastError || new Error('Android emulator window not found')
}
async function keepWindowHidden(device) {
  for (let i = 0; i < 120; i++) {
    try { await windowCommand(device, 'hide'); return } catch { await wait(500) }
  }
}
async function saveConfig(config) { await mkdir(dataDir, { recursive: true }); await writeFile(configPath, JSON.stringify(config, null, 2)) }
async function inspect(config) {
  const device = currentDevice(config)
  let connected = false, error = null
  try { connected = (await devices()).some(d => d.serial === device.serial && d.status === 'device') } catch (e) { error = e.message }
  const processRunning = connected || await emulatorProcess(device)
  const starting = Date.now() < launchUntil || processRunning
  return { device: { ...device, running: connected }, available: connected, status: connected ? 'running' : (starting ? 'starting' : 'stopped'), error: launchError || error, agents: config.agents || [] }
}
async function launch(config) {
  const device = currentDevice(config)
  const before = await inspect(config)
  if (before.status === 'running') return before
  if (before.status === 'starting' || launchPromise) return { ok: true, status: 'starting' }
  launchError = null
  launchUntil = Date.now() + 120000
  let child
  try {
    child = spawn(emulator, ['-avd', device.avd, '-no-boot-anim', '-no-snapshot-load'], { detached: true, windowsHide: true, stdio: 'ignore' })
    child.unref()
  } catch (e) {
    launchUntil = 0
    launchError = e.message
    return { ok: false, status: 'stopped', error: e.message }
  }
  launchPromise = (async () => {
    try {
      await waitForDevice(device)
      await keepWindowHidden(device)
      launchError = null
    } catch (e) {
      launchError = e.message
    } finally {
      launchUntil = 0
      launchPromise = null
    }
  })()
  child.once('error', e => { launchError = e.message })
  return { ok: true, status: 'starting' }
}
async function waitForStopped(device, attempts = 30) {
  for (let i = 0; i < attempts; i++) {
    let connected = false
    try { connected = (await devices()).some(d => d.serial === device.serial) } catch {}
    if (!connected && !(await emulatorProcess(device))) return true
    await wait(1000)
  }
  return false
}
export function apply(ctx) {
  ctx.effect(() => {
    let configPromise = loadConfig()
    const guard = (req, res) => { const rejection = ctx.connection.requestRejection(req); if (rejection !== undefined) { json(res, rejection, { error: 'Access denied' }); return false } return true }
    const routes = [registerWorkbench(ctx), registerWorkBuddy(ctx)]
    routes.push(ctx.webServer.register({ kind: 'exact', path: '/api/agent-dock/workbuddy-icon', handler: async (req, res) => { if (!guard(req, res)) return; if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' }); try { json(res, 200, await readFile(path.join(root, 'workbuddy.svg')), 'image/svg+xml') } catch { json(res, 500, { error: 'Icon unavailable' }) } } }))
    const register = (route, method, handler) => routes.push(ctx.webServer.register({ kind: 'exact', path: `/api/agent-dock/${route}`, handler: async (req, res) => { if (!guard(req, res)) return; if (req.method !== method) return json(res, 405, { error: 'Method not allowed' }); try { await handler(req, res) } catch (e) { json(res, 400, { ok: false, error: e.message }) } } }))
    register('state', 'GET', async (_req, res) => { const c = await configPromise; json(res, 200, await inspect(c)) })
    register('launch', 'POST', async (_req, res) => { const c = await configPromise; json(res, 200, await launch(c)) })
    register('show', 'POST', async (_req, res) => { const c = await configPromise; const s = await inspect(c); if (s.status !== 'running') throw new Error(s.error || '请先点击“启动模拟器”'); await waitForWindow(currentDevice(c), 'show'); json(res, 200, { ok: true }) })
    register('hide', 'POST', async (_req, res) => { const c = await configPromise; await waitForWindow(currentDevice(c), 'hide', 8); json(res, 200, { ok: true }) })
    register('stop', 'POST', async (_req, res) => { const c = await configPromise; const device = currentDevice(c); launchUntil = 0; launchError = null; try { await run(adb, ['-s', device.serial, 'emu', 'kill'], { timeout: 10000 }) } catch (e) { if (!/unknown|offline|not found|cannot connect/i.test(e.message)) throw e }; const stopped = await waitForStopped(device, 45); if (!stopped) await stopEmulatorProcess(device); await waitForStopped(device, 10); json(res, 200, { ok: true, stopped: true }) })
    register('config', 'POST', async (req, res) => {
      const next = await body(req)
      if (typeof next.serial !== 'string' || !/^[\w.-]+$/.test(next.serial)) throw new Error('设备编号无效')
      const c = await configPromise
      const device = { ...currentDevice(c), serial: next.serial, avd: String(next.avd || currentDevice(c).avd), name: String(next.name || 'Pixel Tablet').slice(0, 100), icon: String(next.icon || '📱').slice(0, 100), enabled: next.enabled !== false }
      const saved = { ...c, version: 2, activeDeviceId: device.id, devices: [device], agents: c.agents || [] }
      await saveConfig(saved); configPromise = Promise.resolve(saved); json(res, 200, { ok: true, device })
    })
    return () => routes.forEach(dispose => dispose())
  }, 'android emulator control dock')
}
