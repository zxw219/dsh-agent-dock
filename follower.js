import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./native/WorkBuddyFollower.ps1', import.meta.url))

/** A single persistent, public-Win32 popup follower. Rectangles are CSS client coordinates.
 * screen = { x:screenX, y:screenY, width:outerWidth, height:outerHeight,
 * innerWidth, innerHeight }. No HWND is guessed from a title or a process name alone.
 * dispose() returns a Promise; await it when unloading to allow restoration.
 */
export function createFollower(options = {}) {
  const spawnChild = options.spawn || spawn
  const timeoutMs = options.timeoutMs ?? 5000
  const heartbeatMs = options.heartbeatMs ?? 1500
  let worker = null, recovering = null, generation = 0, sequence = 0, disposed = false
  let tail = Promise.resolve(), heartbeat = null, lastError = null
  const enqueue = operation => {
    const result = tail.then(operation)
    tail = result.catch(() => {})
    return result
  }
  const stopHeartbeat = () => { clearInterval(heartbeat); heartbeat = null }
  function fail(w, error) {
    if (w.failed) return
    w.failed = error
    for (const { reject, timer } of w.pending.values()) { clearTimeout(timer); reject(error) }
    w.pending.clear()
    if (worker === w) { worker = null; stopHeartbeat(); lastError = error; if (!w.exited) recovering = w }
    // EOF is the native worker's restoration signal. Do not kill it before restore.
    try { w.child.stdin.end() } catch {}
  }
  function start() {
    if (worker) return worker
    if (recovering) throw new Error('Previous follower has not exited after restoration request')
    if (disposed) throw new Error('Follower is disposed')
    const child = spawnChild(options.powershell || 'pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], cwd: fileURLToPath(new URL('.', import.meta.url)),
    })
    const w = { child, generation: ++generation, pending: new Map(), buffer: '', stderr: '', failed: null }
    worker = w
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      if (w.failed || worker !== w) return
      w.buffer += chunk
      if (w.buffer.length > 262144) return fail(w, new Error('Follower protocol exceeded limit'))
      let index
      while ((index = w.buffer.indexOf('\n')) !== -1) {
        const line = w.buffer.slice(0, index).trim(); w.buffer = w.buffer.slice(index + 1)
        if (!line) continue
        let response
        try { response = JSON.parse(line) } catch { fail(w, new Error('Invalid follower response')); return }
        if (!response || typeof response !== 'object' || Array.isArray(response)) { fail(w, new Error('Invalid follower response envelope')); return }
        if (response.event) {
          lastError = response.error ? new Error(response.error) : null
          if (response.event === 'error' || response.event === 'released') stopHeartbeat()
          options.onEvent?.(response)
          continue
        }
        if (typeof response.id !== 'string' || typeof response.ok !== 'boolean') { fail(w, new Error('Invalid follower response envelope')); return }
        const pending = w.pending.get(response.id)
        if (!pending) continue
        w.pending.delete(response.id); clearTimeout(pending.timer)
        if (response.ok) pending.resolve(response.result)
        else pending.reject(new Error(response.error || 'Native follower operation failed'))
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => { w.stderr = (w.stderr + chunk).slice(-4096) })
    child.on('error', error => fail(w, error))
    const terminal = (code, signal) => {
      w.exited = true
      if (recovering === w) recovering = null
      fail(w, new Error(`Follower exited (${signal || code})${w.stderr ? ': ' + w.stderr : ''}`))
    }
    child.on('exit', terminal)
    child.on('close', terminal)
    return w
  }
  function request(w, op, data = {}) {
    if (w.failed || worker !== w) return Promise.reject(w.failed || new Error('Stale follower generation'))
    const id = `${w.generation}:${++sequence}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail(w, new Error(`Follower ${op} timed out; restoration requested`)), timeoutMs)
      w.pending.set(id, { resolve, reject, timer })
      try { w.child.stdin.write(JSON.stringify({ id, op, ...data }) + '\n', error => { if (error) fail(w, error) }) }
      catch (error) { fail(w, error) }
    })
  }
  function beginHeartbeat(w) {
    stopHeartbeat()
    heartbeat = setInterval(() => {
      if (worker === w && !w.failed) request(w, 'heartbeat').catch(error => {
        stopHeartbeat(); lastError = error
        options.onEvent?.({ event: 'error', error: error.message })
      })
    }, heartbeatMs)
    heartbeat.unref?.()
  }
  // Viewport bursts are folded to the latest rectangle while an earlier request runs.
  let latestViewport = null, viewportDrain = null
  const api = {
    attach(target) {
      return enqueue(async () => {
        if (disposed) throw new Error('Follower is disposed')
        if (!target || !/^\d+$/.test(target.window) || !Number.isSafeInteger(target.pid) || target.pid <= 0 || typeof target.title !== 'string' || !target.title.trim()) throw new Error('Invalid popup identity')
        const w = start()
        const result = await request(w, 'attach', { target })
        lastError = null; beginHeartbeat(w)
        return result
      })
    },
    viewport(value) {
      if (disposed) return Promise.reject(new Error('Follower is disposed'))
      latestViewport = value
      if (!viewportDrain) {
        viewportDrain = enqueue(async () => {
          let result
          while (latestViewport) {
            const viewport = latestViewport; latestViewport = null
            if (!worker) throw lastError || new Error('Follower is not attached')
            result = await request(worker, 'viewport', { viewport })
          }
          return result
        }).finally(() => { viewportDrain = null })
      }
      return viewportDrain
    },
    release() {
      latestViewport = null
      return enqueue(async () => {
        stopHeartbeat()
        if (!worker) { if (lastError) throw lastError; return { attached: false, restored: true } }
        return request(worker, 'release')
      })
    },
    dispose() {
      if (disposed) return tail
      disposed = true; latestViewport = null
      return enqueue(async () => {
        stopHeartbeat()
        const w = worker
        if (!w) { if (lastError) throw lastError; return }
        try { await request(w, 'release'); await request(w, 'exit') }
        finally { if (worker === w) worker = null; try { w.child.stdin.end() } catch {} }
      })
    },
  }
  return api
}
