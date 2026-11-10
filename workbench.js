// Local UI prototype configuration only: no executable inspection, execution, or transcripts.
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const WORKBENCH_PATH = '/api/agent-dock/workbench'
export const MAX_BODY_BYTES = 256 * 1024
const defaultDataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data')
const safeId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

export class WorkbenchError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'WorkbenchError'
    this.status = status
  }
}

function invalid(message) { throw new WorkbenchError(400, message) }
function object(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} must be an object`)
  if (Object.keys(value).some(key => !fields.includes(key))) invalid(`${label} contains unsupported fields`)
  if (fields.some(key => !Object.hasOwn(value, key))) invalid(`${label} is missing required fields`)
}
function string(value, max, label, empty = false) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || /[\u0000-\u001f\u007f]/.test(value)) {
    invalid(`${label} must be ${empty ? 'a' : 'a nonempty'} string of at most ${max} characters without control characters`)
  }
  return value
}
function boolean(value, label) {
  if (typeof value !== 'boolean') invalid(`${label} must be a boolean`)
  return value
}
function id(value, seen, label) {
  if (typeof value !== 'string' || !safeId.test(value)) invalid(`${label} must be a safe id (1–64 letters, digits, underscores or hyphens)`)
  if (seen.has(value)) invalid(`${label} must be unique`)
  seen.add(value)
  return value
}
function choice(value, values, label) {
  if (!values.includes(value)) invalid(`${label} must be one of: ${values.join(', ')}`)
  return value
}

export function validateWorkbench(value) {
  object(value, ['revision', 'agents'], 'config')
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) invalid('revision must be a nonnegative safe integer')
  if (!Array.isArray(value.agents) || value.agents.length > 40) invalid('agents must be an array of at most 40 agents')
  const agentIds = new Set()
  return {
    revision: value.revision,
    agents: value.agents.map((agent, index) => {
      const label = `agents[${index}]`
      object(agent, ['id', 'name', 'icon', 'enabled', 'executable', 'openMethod', 'windowPolicy', 'conversations'], label)
      if (!Array.isArray(agent.conversations) || agent.conversations.length > 100) invalid(`${label}.conversations must contain at most 100 items`)
      const conversationIds = new Set()
      return {
        id: id(agent.id, agentIds, `${label}.id`),
        name: string(agent.name, 120, `${label}.name`),
        icon: string(agent.icon, 100, `${label}.icon`, true),
        enabled: boolean(agent.enabled, `${label}.enabled`),
        executable: string(agent.executable, 4096, `${label}.executable`, true),
        openMethod: choice(agent.openMethod, ['auto', 'official', 'interface'], `${label}.openMethod`),
        windowPolicy: choice(agent.windowPolicy, ['close', 'hide'], `${label}.windowPolicy`),
        conversations: agent.conversations.map((conversation, conversationIndex) => {
          const convLabel = `${label}.conversations[${conversationIndex}]`
          object(conversation, ['id', 'title', 'pinned', 'updatedAt'], convLabel)
          const updatedAt = string(conversation.updatedAt, 40, `${convLabel}.updatedAt`)
          if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(updatedAt) || !Number.isFinite(Date.parse(updatedAt))) {
            invalid(`${convLabel}.updatedAt must be a UTC ISO date string`)
          }
          return {
            id: id(conversation.id, conversationIds, `${convLabel}.id`),
            title: string(conversation.title, 200, `${convLabel}.title`),
            pinned: boolean(conversation.pinned, `${convLabel}.pinned`),
            updatedAt,
          }
        }),
      }
    }),
  }
}

// A rejected operation must not poison the queue or advance the stored revision.
// The optional fs implementation enables deterministic disk-failure tests.
export function createWorkbenchStore({ dataDir = defaultDataDir, fileSystem = fs } = {}) {
  const configPath = path.join(dataDir, 'workbench.json')
  let queue = Promise.resolve()
  function serialize(operation) {
    const result = queue.then(operation)
    queue = result.catch(() => {})
    return result
  }
  async function load() {
    let text
    try { text = await fileSystem.readFile(configPath, 'utf8') } catch (error) {
      if (error.code === 'ENOENT') return { revision: 0, agents: [] }
      throw new WorkbenchError(500, `Unable to read local workbench config: ${error.message}`)
    }
    try {
      if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) throw new Error('config exceeds 256KB')
      return validateWorkbench(JSON.parse(text))
    } catch (error) {
      throw new WorkbenchError(500, `Invalid local workbench config: ${error.message}`)
    }
  }
  return {
    get() { return serialize(load) },
    put(value) {
      // Clone and validate before queueing so callers cannot mutate pending writes.
      let candidate
      try { candidate = validateWorkbench(value) } catch (error) { return Promise.reject(error) }
      return serialize(async () => {
        const current = await load()
        if (candidate.revision !== current.revision) throw new WorkbenchError(409, 'Local workbench revision conflict; reload and retry')
        if (current.revision === Number.MAX_SAFE_INTEGER) throw new WorkbenchError(409, 'Local workbench revision limit reached')
        const next = { revision: current.revision + 1, agents: candidate.agents }
        const text = JSON.stringify(next)
        if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) invalid('config exceeds 256KB')
        const temporaryPath = path.join(dataDir, `.workbench.${randomUUID()}.tmp`)
        let handle
        try {
          await fileSystem.mkdir(dataDir, { recursive: true })
          handle = await fileSystem.open(temporaryPath, 'wx', 0o600)
          await handle.writeFile(text, 'utf8')
          await handle.sync()
          await handle.close()
          handle = undefined
          await fileSystem.rename(temporaryPath, configPath)
        } catch (error) {
          throw new WorkbenchError(500, `Unable to save local workbench config: ${error.message}`)
        } finally {
          if (handle) await handle.close().catch(() => {})
          await fileSystem.unlink(temporaryPath).catch(() => {})
        }
        return next
      })
    },
  }
}

function json(res, status, value, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers })
  res.end(JSON.stringify(value))
}
async function readBody(req) {
  const length = req.headers?.['content-length']
  if (length !== undefined && (!/^\d+$/.test(String(length)) || Number(length) > MAX_BODY_BYTES)) invalid('Request body exceeds 256KB or has invalid Content-Length')
  const chunks = []
  let bytes = 0
  // destroyOnReturn:false allows a bounded-body rejection response before the
  // remaining request is discarded, instead of destroying the HTTP socket.
  const stream = typeof req.iterator === 'function' ? req.iterator({ destroyOnReturn: false }) : req
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > MAX_BODY_BYTES) invalid('Request body exceeds 256KB')
    chunks.push(buffer)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { invalid('Request body must be valid JSON') }
}

export function registerWorkbench(ctx, { store = createWorkbenchStore() } = {}) {
  return ctx.webServer.register({
    kind: 'exact',
    path: WORKBENCH_PATH,
    handler: async (req, res) => {
      const rejection = ctx.connection.requestRejection(req)
      if (rejection !== undefined) return json(res, rejection, { error: 'Access denied' })
      if (req.method !== 'GET' && req.method !== 'PUT') return json(res, 405, { error: 'Method not allowed' }, { allow: 'GET, PUT' })
      try {
        const config = req.method === 'GET' ? await store.get() : await store.put(await readBody(req))
        json(res, 200, config)
      } catch (error) {
        json(res, error instanceof WorkbenchError ? error.status : 500, { error: error.message })
      }
    },
  })
}

export default registerWorkbench
