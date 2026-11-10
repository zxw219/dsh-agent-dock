import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { createServer, request } from 'node:http'
import { once } from 'node:events'
import registerWorkbench, { createWorkbenchStore, validateWorkbench, MAX_BODY_BYTES, WORKBENCH_PATH } from '../workbench.js'

const agent = (overrides = {}) => ({
  id: 'local-demo', name: 'Local prototype', icon: '🧪', enabled: true,
  executable: 'C:\\not-installed\\prototype.exe', openMethod: 'auto', windowPolicy: 'hide',
  conversations: [{ id: 'demo-1', title: 'Demo metadata only', pinned: false, updatedAt: '2026-11-09T00:00:00.000Z' }],
  ...overrides,
})
const config = (revision = 0, agents = [agent()]) => ({ revision, agents })
async function directory(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-workbench-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}
function route(store, rejection) {
  let registered, disposed = false
  let guardCalls = 0
  const dispose = registerWorkbench({
    webServer: { register(value) { registered = value; return () => { disposed = true } } },
    connection: { requestRejection() { guardCalls++; return rejection } },
  }, { store })
  return {
    registered, dispose,
    get disposed() { return disposed },
    get guardCalls() { return guardCalls },
    async send(method, body, headers = {}) {
      const req = Readable.from(body === undefined ? [] : [Buffer.from(body)])
      req.method = method
      req.headers = headers
      let status, responseHeaders, text
      await registered.handler(req, {
        writeHead(code, values) { status = code; responseHeaders = values },
        end(value) { text = value },
      })
      return { status, headers: responseHeaders, body: JSON.parse(text) }
    },
  }
}

test('empty config is revision zero with no invented agents and no disk side effects', async t => {
  const dataDir = await directory(t)
  const store = createWorkbenchStore({ dataDir })
  assert.deepEqual(await store.get(), { revision: 0, agents: [] })
  assert.deepEqual(await readdir(dataDir), [])
})

test('save round-trips local metadata, increments revision, and survives a new store', async t => {
  const dataDir = path.join(await directory(t), 'data')
  const store = createWorkbenchStore({ dataDir })
  assert.deepEqual(await store.put(config()), config(1))
  assert.deepEqual(await createWorkbenchStore({ dataDir }).get(), config(1))
  assert.deepEqual(JSON.parse(await readFile(path.join(dataDir, 'workbench.json'), 'utf8')), config(1))
  assert.deepEqual(await readdir(dataDir), ['workbench.json'])
  assert.deepEqual(await store.put(config(1, [])), config(2, []))
})

test('concurrent saves serialize: only one caller using an old revision wins', async t => {
  const dataDir = await directory(t)
  const store = createWorkbenchStore({ dataDir })
  const results = await Promise.allSettled([store.put(config()), store.put(config(0, [agent({ name: 'Other writer' })]))])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  const failure = results.find(result => result.status === 'rejected')
  assert.equal(failure.reason.status, 409)
  assert.deepEqual(await store.get(), config(1))
  assert.deepEqual(await store.put(config(1)), config(2))
})

test('queued writes take a defensive copy and returned reads do not mutate storage', async t => {
  const store = createWorkbenchStore({ dataDir: await directory(t) })
  const input = config()
  const pending = store.put(input)
  input.agents[0].name = 'mutated'
  const saved = await pending
  assert.equal(saved.agents[0].name, 'Local prototype')
  saved.agents[0].name = 'also mutated'
  const loaded = await store.get()
  loaded.agents[0].conversations.length = 0
  assert.deepEqual(await store.get(), config(1))
})

test('strict schema validates limits, safe unique ids, enum/boolean/string fields and metadata only', () => {
  const invalid = [
    null, [], {}, { ...config(), revision: -1 }, { ...config(), revision: 0.5 },
    { ...config(), revision: Number.MAX_SAFE_INTEGER + 1 },
    { ...config(), agents: Array.from({ length: 41 }, (_, i) => agent({ id: `agent-${i}` })) },
    config(0, [agent(), agent()]),
    config(0, [agent({ id: '../bad' })]), config(0, [agent({ id: '' })]),
    config(0, [agent({ name: 'n'.repeat(121) })]), config(0, [agent({ icon: 'i'.repeat(101) })]),
    config(0, [agent({ executable: 'e'.repeat(4097) })]), config(0, [agent({ executable: 'a\u0000b' })]),
    config(0, [agent({ enabled: 1 })]), config(0, [agent({ openMethod: 'launch' })]),
    config(0, [agent({ windowPolicy: 'minimize' })]), config(0, [agent({ installed: true })]),
    config(0, [agent({ conversations: Array.from({ length: 101 }, (_, i) => ({ ...agent().conversations[0], id: `c-${i}` })) })]),
    config(0, [agent({ conversations: [agent().conversations[0], agent().conversations[0]] })]),
    config(0, [agent({ conversations: [{ ...agent().conversations[0], transcript: 'not allowed' }] })]),
    config(0, [agent({ conversations: [{ ...agent().conversations[0], pinned: 'yes' }] })]),
    config(0, [agent({ conversations: [{ ...agent().conversations[0], title: 't'.repeat(201) }] })]),
    config(0, [agent({ conversations: [{ ...agent().conversations[0], updatedAt: 'not a date' }] })]),
    { ...config(), running: true },
  ]
  for (const value of invalid) assert.throws(() => validateWorkbench(value), error => error.status === 400)
  const maximum = config(0, Array.from({ length: 40 }, (_, i) => agent({ id: `a-${i}`, conversations: Array.from({ length: 100 }, (_, j) => ({ ...agent().conversations[0], id: `c-${j}` })) })))
  assert.equal(validateWorkbench(maximum).agents.length, 40)
  for (const openMethod of ['auto', 'official', 'interface']) {
    for (const windowPolicy of ['hide', 'close']) assert.doesNotThrow(() => validateWorkbench(config(0, [agent({ openMethod, windowPolicy, executable: '', icon: '' })])))
  }
})

test('malformed or invalid disk config fails explicitly and cannot be overwritten', async t => {
  const dataDir = await directory(t)
  const file = path.join(dataDir, 'workbench.json')
  const store = createWorkbenchStore({ dataDir })
  for (const content of ['{bad JSON', JSON.stringify({ revision: 7, agents: 'bad' })]) {
    await writeFile(file, content)
    await assert.rejects(store.get(), error => error.status === 500 && /Invalid local workbench config/.test(error.message))
    await assert.rejects(store.put(config()), error => error.status === 500)
    assert.equal(await readFile(file, 'utf8'), content)
  }
  await writeFile(file, JSON.stringify(config(5)))
  assert.deepEqual(await store.get(), config(5))
})

test('non-ENOENT read errors are explicit and never trigger a write', async () => {
  let writes = 0
  const store = createWorkbenchStore({ fileSystem: {
    async readFile() { throw Object.assign(new Error('permission denied'), { code: 'EACCES' }) },
    async mkdir() { writes++ },
  } })
  await assert.rejects(store.get(), error => error.status === 500 && /permission denied/.test(error.message))
  await assert.rejects(store.put(config()), error => error.status === 500)
  assert.equal(writes, 0)
})

test('failed atomic rename preserves previous disk revision and recovers without leftover temp files', async t => {
  const dataDir = await directory(t)
  const base = createWorkbenchStore({ dataDir })
  await base.put(config())
  let fail = true
  const store = createWorkbenchStore({ dataDir, fileSystem: {
    ...fs,
    async rename(...args) { if (fail) throw Object.assign(new Error('injected rename error'), { code: 'EIO' }); return fs.rename(...args) },
  } })
  await assert.rejects(store.put(config(1)), error => error.status === 500 && /injected rename error/.test(error.message))
  assert.deepEqual(await store.get(), config(1))
  assert.deepEqual(await readdir(dataDir), ['workbench.json'])
  fail = false
  assert.deepEqual(await store.put(config(1)), config(2))
})

test('write failure after temp creation preserves file and cleans up temp file', async t => {
  const dataDir = await directory(t)
  await createWorkbenchStore({ dataDir }).put(config())
  const store = createWorkbenchStore({ dataDir, fileSystem: {
    ...fs,
    async open(...args) {
      const handle = await fs.open(...args)
      return { async writeFile() { throw new Error('injected write failure') }, sync: () => handle.sync(), close: () => handle.close() }
    },
  } })
  await assert.rejects(store.put(config(1)), error => error.status === 500 && /injected write failure/.test(error.message))
  assert.deepEqual(await store.get(), config(1))
  assert.deepEqual(await readdir(dataDir), ['workbench.json'])
})

test('registers exact authenticated GET/PUT route and returns its disposer', async t => {
  const store = createWorkbenchStore({ dataDir: await directory(t) })
  const endpoint = route(store)
  assert.equal(endpoint.registered.kind, 'exact')
  assert.equal(endpoint.registered.path, WORKBENCH_PATH)
  assert.deepEqual((await endpoint.send('GET')).body, config(0, []))
  const saved = await endpoint.send('PUT', JSON.stringify(config()))
  assert.equal(saved.status, 200)
  assert.deepEqual(saved.body, config(1))
  assert.equal(saved.headers['cache-control'], 'no-store')
  assert.equal((await endpoint.send('PUT', JSON.stringify(config()))).status, 409)
  assert.deepEqual((await endpoint.send('GET')).body, config(1))
  for (const method of ['POST', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']) {
    const response = await endpoint.send(method)
    assert.equal(response.status, 405)
    assert.equal(response.headers.allow, 'GET, PUT')
  }
  assert.equal(endpoint.guardCalls, 9)
  endpoint.dispose()
  assert.equal(endpoint.disposed, true)
})

test('authentication rejects before reading request body or accessing store for every method', async () => {
  for (const status of [401, 403]) {
    const endpoint = route({ get() { assert.fail('store read after rejection') }, put() { assert.fail('store write after rejection') } }, status)
    for (const method of ['GET', 'PUT', 'POST']) {
      const response = await endpoint.send(method, 'malformed')
      assert.equal(response.status, status)
      assert.deepEqual(response.body, { error: 'Access denied' })
    }
  }
})

test('route returns 400 for malformed/oversized bodies and 500 for disk load failures', async t => {
  const dataDir = await directory(t)
  const store = createWorkbenchStore({ dataDir })
  const endpoint = route(store)
  assert.equal((await endpoint.send('PUT', '')).status, 400)
  assert.equal((await endpoint.send('PUT', '{bad')).status, 400)
  assert.equal((await endpoint.send('PUT', JSON.stringify({ revision: 0, agents: 'bad' }))).status, 400)
  assert.equal((await endpoint.send('PUT', ' '.repeat(MAX_BODY_BYTES + 1))).status, 400)
  assert.equal((await endpoint.send('PUT', '{}', { 'content-length': String(MAX_BODY_BYTES + 1) })).status, 400)
  assert.deepEqual(await store.get(), config(0, []))
  await writeFile(path.join(dataDir, 'workbench.json'), 'bad')
  assert.equal((await endpoint.send('GET')).status, 500)
  assert.equal((await endpoint.send('PUT', JSON.stringify(config()))).status, 500)
})

test('chunked over-limit HTTP request receives bounded-body response without saving config', async t => {
  const dataDir = await directory(t)
  const endpoint = route(createWorkbenchStore({ dataDir }))
  const server = createServer(endpoint.registered.handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)) })
  const result = await new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: server.address().port, path: WORKBENCH_PATH, method: 'PUT', headers: { 'transfer-encoding': 'chunked' } }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }))
    })
    req.on('error', reject)
    req.write(Buffer.alloc(MAX_BODY_BYTES, ' '))
    req.end('x')
  })
  assert.equal(result.status, 400)
  assert.match(result.body.error, /exceeds 256KB/)
  assert.deepEqual(await readdir(dataDir), [])
})

test('direct store rejects oversized serialized config before touching disk', async t => {
  const dataDir = await directory(t)
  const store = createWorkbenchStore({ dataDir })
  const large = config(0, Array.from({ length: 40 }, (_, i) => agent({ id: `a-${i}`, conversations: Array.from({ length: 100 }, (_, j) => ({ ...agent().conversations[0], id: `c-${j}`, title: 't'.repeat(200) })) })))
  await assert.rejects(store.put(large), error => error.status === 400)
  assert.deepEqual(await readdir(dataDir), [])
})
