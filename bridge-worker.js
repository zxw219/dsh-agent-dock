import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const script = fileURLToPath(new URL('./native/WorkBuddyBridge.ps1', import.meta.url))

// Serial requests, fresh UI capture on every operation. Never replay a failed open.
export function createBridgeWorker({ spawnChild = spawn, command = process.env.DSH_PWSH_PATH || 'pwsh.exe', timeout = 20000, idleMs = 60000 } = {}) {
  let worker = null, tail = Promise.resolve(), stopping = Promise.resolve(), idle = null, disposed = false, sequence = 0, generation = 0
  function close(w, error) {
    if (w.closed) return
    w.closed = true
    generation++
    stopping = w.exited
    if (worker === w) { worker = null; clearTimeout(idle) }
    if (w.pending) { clearTimeout(w.pending.timer); w.pending.reject(error); w.pending = null }
    w.child.stdin.end()
    // This reader owns no windows or recovery state. Termination prevents late clicks.
    w.child.kill()
  }
  function start() {
    if (worker) return worker
    const child = spawnChild(command, ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-File', script, '-Operation', 'serve'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let markExited
    const exited = new Promise(resolve => { markExited = resolve })
    const w = { child, buffer: '', pending: null, closed: false, exited }; worker = w
    child.stdin.on('error', error => close(w, error))
    child.stderr.on('data', () => {})
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      if (w.closed) return
      w.buffer += chunk
      if (w.buffer.length > 262144) return close(w, new Error('WorkBuddy reader response exceeds limit'))
      let i
      while ((i = w.buffer.indexOf('\n')) >= 0) {
        const line = w.buffer.slice(0, i).replace(/^\uFEFF/, '').trim(); w.buffer = w.buffer.slice(i + 1)
        if (!line) continue
        let value
        try { value = JSON.parse(line) } catch { return close(w, new Error('WorkBuddy reader returned invalid JSON')) }
        if (!value || typeof value !== 'object' || typeof value.ok !== 'boolean') return close(w, new Error('WorkBuddy reader returned invalid response'))
        const pending = w.pending
        if (!pending || value.id !== pending.id) return close(w, new Error('WorkBuddy reader response identity mismatch'))
        w.pending = null; clearTimeout(pending.timer)
        value.ok ? pending.resolve(value.result) : pending.reject(new Error(value.error || 'WorkBuddy reader failed'))
      }
    })
    child.once('error', error => close(w, error))
    child.once('close', () => { markExited(); close(w, new Error('WorkBuddy reader exited; operation was not retried')) })
    return w
  }
  return {
    run(operation, request) {
      const submittedGeneration = generation
      const task = tail.then(async () => {
        await stopping
        if (disposed) throw new Error('WorkBuddy reader disposed')
        if (operation === 'open' && submittedGeneration !== generation) throw new Error('Reader changed; open cancelled, select the conversation again')
        if (!['sidebar', 'open'].includes(operation)) throw new Error('Invalid reader operation')
        clearTimeout(idle)
        const w = start(), id = String(++sequence)
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => close(w, new Error('WorkBuddy reader timed out; operation was not retried')), timeout)
          w.pending = { id, resolve, reject, timer }
          w.child.stdin.write(JSON.stringify({ id, operation, request }) + '\n')
        }).finally(() => {
          if (worker === w && !w.closed) { idle = setTimeout(() => close(w, new Error('Idle reader closed')), idleMs); idle.unref?.() }
        })
      })
      tail = task.catch(() => {})
      return task
    },
    async dispose() { disposed = true; clearTimeout(idle); if (worker) close(worker, new Error('WorkBuddy reader disposed')); await stopping },
  }
}
