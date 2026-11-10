import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { createFollower } from '../follower.js'

const target = { window: '123', pid: 42, title: 'Verified conversation' }
function harness(options = {}) {
  const children = [], commands = []
  const spawn = () => {
    const child = new EventEmitter()
    child.stdout = new PassThrough(); child.stderr = new PassThrough()
    child.stdin = new PassThrough(); child.ends = 0
    child.stdin.on('finish', () => { child.ends++ })
    let buffer = ''
    child.stdin.on('data', chunk => {
      buffer += chunk
      let i
      while ((i = buffer.indexOf('\n')) >= 0) {
        const command = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1)
        commands.push({ child, command })
        if (options.auto !== false) queueMicrotask(() => reply(child, command))
      }
    })
    children.push(child)
    return child
  }
  const reply = (child, command, extra = {}) => child.stdout.write(JSON.stringify({ id: command.id, ok: true, result: { op: command.op }, ...extra }) + '\n')
  return { follower: createFollower({ spawn, heartbeatMs: 100000, timeoutMs: 100, ...options }), children, commands, reply }
}
const tick = () => new Promise(resolve => setImmediate(resolve))

test('serializes attach, viewport, release and dispose without launching target software', async () => {
  const h = harness()
  const a = h.follower.attach(target)
  const b = h.follower.viewport({ rect: { x: 1 } })
  await Promise.all([a, b]); await h.follower.release(); await h.follower.dispose()
  assert.equal(h.children.length, 1)
  assert.deepEqual(h.commands.map(x => x.command.op), ['attach', 'viewport', 'release', 'release', 'exit'])
  await assert.rejects(h.follower.attach(target), /disposed/)
})

test('coalesces queued viewport bursts to newest rectangle', async () => {
  const h = harness({ auto: false })
  const attached = h.follower.attach(target); await tick()
  h.reply(h.children[0], h.commands[0].command); await attached
  const p1 = h.follower.viewport({ rect: { x: 1 } }); await tick()
  const p2 = h.follower.viewport({ rect: { x: 2 } })
  const p3 = h.follower.viewport({ rect: { x: 3 } })
  h.reply(h.children[0], h.commands[1].command); await tick()
  assert.equal(h.commands[2].command.viewport.rect.x, 3)
  h.reply(h.children[0], h.commands[2].command)
  await Promise.all([p1, p2, p3])
  h.children[0].emit('exit', 0, null)
  await assert.rejects(h.follower.dispose(), /exited/)
})

test('timeout requests EOF restoration and blocks replacement until old worker exits', async () => {
  const h = harness({ auto: false, timeoutMs: 20 })
  await assert.rejects(h.follower.attach(target), /timed out/)
  await tick(); assert.equal(h.children[0].ends, 1)
  await assert.rejects(h.follower.attach(target), /Previous follower/)
  assert.equal(h.children.length, 1)
  const old = h.commands[0]
  h.children[0].emit('exit', 0, null)
  const next = h.follower.attach(target); await tick()
  h.reply(old.child, old.command)
  h.reply(h.children[1], h.commands[1].command)
  await next
  h.children[1].emit('exit', 0, null)
  await assert.rejects(h.follower.dispose(), /exited/)
})

test('native rejection is exposed and never represented as attachment success', async () => {
  const h = harness({ auto: false })
  const attaching = h.follower.attach(target); await tick()
  h.reply(h.children[0], h.commands[0].command, { ok: false, error: 'Ambiguous DSH window' })
  await assert.rejects(attaching, /Ambiguous/)
  h.children[0].emit('exit', 1, null)
  await assert.rejects(h.follower.dispose(), /exited/)
})

test('failed spawn closes recovery fence and permits retry', async () => {
  const h = harness({ auto: false })
  const first = h.follower.attach(target); await tick()
  h.children[0].emit('error', new Error('spawn ENOENT'))
  await assert.rejects(first, /ENOENT/)
  h.children[0].emit('close', -4058, null)
  const second = h.follower.attach(target); await tick()
  assert.equal(h.children.length, 2)
  h.reply(h.children[1], h.commands.at(-1).command); await second
  h.children[1].emit('exit', 0, null)
  await assert.rejects(h.follower.dispose(), /exited/)
})

test('invalid identity is rejected before worker spawn', async () => {
  const h = harness()
  await assert.rejects(h.follower.attach({ ...target, window: 'not-hwnd' }), /Invalid/)
  assert.equal(h.children.length, 0)
  await h.follower.dispose()
})
