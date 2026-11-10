import test from 'node:test'
import assert from 'node:assert/strict'
import registerWorkBuddy, { SIDEBAR_PATH, registerPopup } from '../workbuddy.js'
import { Readable } from 'node:stream'

function harness(read, rejection) {
  let route
  const dispose = registerWorkBuddy({ webServer: { register(r) { route = r; return () => {} } }, connection: { requestRejection() { return rejection } } }, { read })
  return { dispose, path: route.path, async send(method = 'GET') {
    let status, headers, body
    await route.handler({ method }, { writeHead(s, h) { status = s; headers = h }, end(b) { body = JSON.parse(b) } })
    return { status, headers, body }
  } }
}
function popupHarness(options, rejection) {
  let route
  registerPopup({ webServer: { register(r) { route = r; return () => {} } }, connection: { requestRejection: () => rejection } }, options)
  return async (body = '{}', method = 'POST') => {
    const req = Readable.from([Buffer.from(body)]); req.method = method
    let status, value
    await route.handler(req, { writeHead(s) { status = s }, end(b) { value = JSON.parse(b) } })
    return { status, value }
  }
}
test('popup authentication, methods and bounded input prevent external actions', async () => {
  let calls = 0
  const options = { open: async () => { calls++; return { ok: true } } }
  assert.equal((await popupHarness(options, 401)()).status, 401)
  assert.equal((await popupHarness(options)('{}', 'GET')).status, 405)
  assert.equal((await popupHarness(options)('invalid')).status, 400)
  assert.equal((await popupHarness(options)('x'.repeat(16385))).status, 400)
  assert.equal(calls, 0)
})
test('popup is serialized and success requires attach completion', async () => {
  let finish, attached = 0
  const result = { ok: true, window: '123', pid: 42, title: 'target' }
  const send = popupHarness({ open: () => new Promise(resolve => { finish = resolve }), attached: async () => { attached++ } })
  const first = send()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal((await send()).status, 409)
  finish(result)
  assert.deepEqual((await first).value, result)
  assert.equal(attached, 1)
  const fail = popupHarness({ open: async () => result, attached: async () => { throw new Error('attach failed') } })
  assert.match((await fail()).value.error, /attach failed/)
})

const snapshot = { ok: true, connected: true, scope: 'visible-sidebar', groups: [{ name: 'workspace', conversations: [{ key: 'opaque:0', title: 'visible title' }] }] }
test('sidebar route guards requests before reading UI and allows GET only', async () => {
  let calls = 0
  const read = () => { calls++; return snapshot }
  assert.equal((await harness(read, 401).send()).status, 401)
  assert.equal((await harness(read).send('POST')).status, 405)
  assert.equal(calls, 0)
})
test('concurrent requests share one read and later refresh reads again without cache', async () => {
  let calls = 0, release
  const h = harness(() => { calls++; return new Promise(resolve => { release = resolve }) })
  assert.equal(h.path, SIDEBAR_PATH)
  const first = h.send(), second = h.send()
  await Promise.resolve()
  assert.equal(calls, 1)
  release(snapshot)
  const replies = await Promise.all([first, second])
  for (const r of replies) { assert.equal(r.status, 200); assert.deepEqual(r.body, snapshot); assert.equal(r.headers['cache-control'], 'no-store') }
  const third = h.send(); await Promise.resolve(); assert.equal(calls, 2); release(snapshot); await third
})
test('reader failures report disconnected and permit a subsequent fresh read', async () => {
  let calls = 0
  const h = harness(() => { if (++calls === 1) throw new Error('main window minimized'); return snapshot })
  assert.deepEqual((await h.send()).body, { ok: false, connected: false, error: 'main window minimized' })
  assert.equal((await h.send()).status, 200)
})
