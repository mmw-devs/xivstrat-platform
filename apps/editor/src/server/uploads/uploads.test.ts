import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer, request as nodeRequest } from 'node:http'
import { once } from 'node:events'
import sharp from 'sharp'
import { structureToJson } from '@xivstrat/content-schema'
import { createDemo } from '../../lib/editor/demo.ts'
import { UploadStore, UploadError, MIB } from './store.ts'
import { snapshotDigest, MAX_BODY_BYTES } from './multipart.ts'
import { createUploadHandler } from './http.ts'

function fixture() {
  const structure = createDemo()
  structure.metadata.name = 'upload-test'; structure.metadata.type = 'other'; structure.metadata.banner = ''
  structure.phases = [{ name: 'p1', mechanics: [{ name: '测试', sections: [{ type: 'note', title: '', content: [] }], sub_mechanics: [] }] }]
  return structure
}
function workspace() { return mkdtempSync(join(tmpdir(), 'xivstrat-upload-test-')) }
const digest = 'a'.repeat(64)
function code(expected: string) { return (error: unknown) => error instanceof UploadError && error.code === expected }

test('space reservations count before bytes arrive; owner and global concurrency are bounded', () => {
  const root = workspace()
  const store = new UploadStore(root, { maxBytes: 44 * MIB })
  try {
    const id = randomUUID()
    store.reserve(id, 'a', digest)
    assert.throws(() => store.reserve(randomUUID(), 'a', digest), code('UPLOAD_BUSY'))
    store.reserve(randomUUID(), 'b', digest)
    assert.throws(() => store.reserve(randomUUID(), 'c', digest), code('UPLOAD_BUSY'))
    assert.throws(() => store.reserve(id, 'b', digest), code('NOT_FOUND'))
    assert.throws(() => store.reserve(id, 'a', 'b'.repeat(64)), code('SNAPSHOT_CHANGED'))
    assert.throws(() => store.reserve('../outside', 'a', digest), code('INVALID_TASK_ID'))
    assert.equal(store.get(id, 'b'), undefined)
  } finally { store.close(); rmSync(root, { recursive: true, force: true }) }
})

test('completed spool bytes still consume capacity, and cleanup preserves live receivers', () => {
  const root = workspace()
  let now = 0
  const store = new UploadStore(root, { maxBytes: 22 * MIB, now: () => now, ttlMs: 100 })
  try {
    const id = randomUUID()
    store.reserve(id, 'a', digest)
    now = 200; store.cleanup()
    assert.equal(store.get(id, 'a')?.state, 'receiving')
    writeFileSync(join(store.directory(id), 'strategy.json'), '{}')
    store.ready(id, 'a', ['strategy.json'])
    assert.throws(() => store.reserve(randomUUID(), 'b', digest), code('SPOOL_FULL'))
    assert.equal(store.reserve(id, 'a', digest).reused, true)
    now = 301; store.cleanup()
    assert.equal(store.get(id, 'a')?.state, 'reupload-required')
    assert.deepEqual(readdirSync(store.spool), [])
    store.reserve(id, 'a', digest)
  } finally { store.close(); rmSync(root, { recursive: true, force: true }) }
})

test('restart recovers interrupted transfers, preserves valid ready tasks and excludes other processes', () => {
  const root = workspace()
  let store = new UploadStore(root)
  try {
    assert.throws(() => new UploadStore(root), /locked/)
    const interrupted = randomUUID(), ready = randomUUID()
    store.reserve(interrupted, 'a', digest)
    writeFileSync(join(store.directory(interrupted), 'partial'), 'partial bytes')
    store.reserve(ready, 'b', digest)
    writeFileSync(join(store.directory(ready), 'strategy.json'), '{}')
    store.ready(ready, 'b', ['strategy.json'])
    store.close(); store = new UploadStore(root)
    assert.equal(store.get(interrupted, 'a')?.state, 'reupload-required')
    assert.equal(store.get(interrupted, 'a')?.bytes, 0)
    assert.equal(store.get(ready, 'b')?.state, 'ready')
    rmSync(join(store.directory(ready), 'strategy.json'))
    store.close(); store = new UploadStore(root)
    assert.equal(store.get(ready, 'b')?.state, 'reupload-required')
  } finally { store.close(); rmSync(root, { recursive: true, force: true }) }
})

test('task record cap and expiry bound persistent metadata', () => {
  const root = workspace()
  let now = 0
  const store = new UploadStore(root, { maxTasks: 1, now: () => now })
  try {
    const id = randomUUID()
    store.reserve(id, 'a', digest); store.release(id)
    assert.throws(() => store.reserve(randomUUID(), 'a', digest), code('TASK_CAPACITY'))
    now = 8 * 24 * 60 * 60 * 1000
    store.cleanup()
    assert.equal(store.get(id, 'a'), undefined)
    store.reserve(randomUUID(), 'a', digest)
  } finally { store.close(); rmSync(root, { recursive: true, force: true }) }
})

async function service(timeoutMs = 3000) {
  const root = workspace(), store = new UploadStore(root)
  // Test-only identity injection. The real local adapter never trusts this header.
  const handler = createUploadHandler(store, { timeoutMs, async authenticate(req) {
    return typeof req.headers['x-test-owner'] === 'string' ? req.headers['x-test-owner'] : null
  } })
  const server = createServer((req, res) => { void handler(req, res) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}/api/upload-tasks/`
  return { base, store, async close() {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
    store.close(); rmSync(root, { recursive: true, force: true })
  } }
}
async function packageFixture() {
  const image = await sharp({ create: { width: 24, height: 24, channels: 4, background: '#ffffff' } }).webp().toBuffer()
  // Image digest hashes bytes, while the snapshot helper hashes canonical UTF-8 JSON.
  const { createHash } = await import('node:crypto')
  const filename = `${createHash('sha256').update(image).digest('hex')}.webp`
  const structure = fixture()
  structure.phases[0].mechanics[0].sections[0].content = [{ type: 'image', file: `assets/images/${filename}`, caption: '站位图' }]
  const json = structureToJson(structure)
  const form = () => {
    const result = new FormData(); result.set('strategy', json)
    result.append('images', new Blob([Uint8Array.from(image).buffer], { type: 'image/webp' }), filename)
    return result
  }
  return { image, filename, structure, json, form, digest: snapshotDigest(json) }
}

test('multipart persists a validated snapshot, exposes owner-scoped status and reuses retries', async () => {
  const app = await service()
  try {
    const pkg = await packageFixture(), id = randomUUID()
    const headers = { 'x-test-owner': 'a', 'x-submission-digest': pkg.digest }
    const response = await fetch(app.base + id, { method: 'PUT', headers, body: pkg.form() })
    assert.equal(response.status, 201, await response.clone().text())
    const body = await response.json()
    assert.equal(body.task.state, 'ready'); assert.equal(body.task.remoteSubmission, 'not-started')
    assert.equal('owner' in body.task, false)
    assert.deepEqual(readdirSync(app.store.directory(id)).sort(), [pkg.filename, 'strategy.json'].sort())
    const repeat = await fetch(app.base + id, { method: 'PUT', headers, body: pkg.form() })
    assert.equal(repeat.status, 200)
    assert.equal((await repeat.json()).task.updatedAt, body.task.updatedAt)
    assert.equal((await fetch(app.base + id, { headers: { 'x-test-owner': 'b' } })).status, 404)
    assert.equal((await fetch(app.base + id)).status, 401)
    const conflict = await fetch(app.base + id, { method: 'PUT', headers: { ...headers, 'x-submission-digest': digest }, body: pkg.form() })
    assert.equal(conflict.status, 409)
  } finally { await app.close() }
})

test('invalid hashes, missing/unreferenced files, traversal and invalid bytes leave no spool files', async () => {
  const app = await service()
  try {
    const pkg = await packageFixture()
    for (const kind of ['hash', 'missing', 'extra', 'path', 'invalid-image', 'digest', 'duplicate', 'json'] as const) {
      const id = randomUUID(), form = new FormData()
      const structure = structuredClone(pkg.structure)
      if (kind === 'extra') structure.phases[0].mechanics[0].sections[0].content = []
      const json = structureToJson(structure)
      form.set('strategy', kind === 'json' ? '{}' : json)
      if (kind !== 'missing') {
        const bytes = kind === 'hash' || kind === 'invalid-image' ? Buffer.from('not an image') : pkg.image
        const { createHash } = await import('node:crypto')
        const filename = kind === 'path' ? `../${pkg.filename}` : kind === 'invalid-image' ? `${createHash('sha256').update(bytes).digest('hex')}.webp` : pkg.filename
        if (kind === 'invalid-image') {
          structure.phases[0].mechanics[0].sections[0].content = [{ type: 'image', file: `assets/images/${filename}`, caption: '' }]
          form.set('strategy', structureToJson(structure))
        }
        form.append('images', new Blob([Uint8Array.from(bytes).buffer]), filename)
        if (kind === 'duplicate') form.append('images', new Blob([Uint8Array.from(bytes).buffer]), filename)
      }
      const response = await fetch(app.base + id, { method: 'PUT', headers: {
        'x-test-owner': 'a', 'x-submission-digest': kind === 'digest' ? digest : snapshotDigest(String(form.get('strategy'))),
      }, body: form })
      assert.ok(response.status >= 400, `${kind}: ${response.status}`)
      await response.arrayBuffer()
      assert.equal(app.store.get(id, 'a')?.state, 'reupload-required', kind)
      assert.equal(app.store.get(id, 'a')?.bytes, 0, kind)
      assert.deepEqual(readdirSync(app.store.spool), [], kind)
    }
  } finally { await app.close() }
})

test('declared oversize requests are rejected before reserving disk', async () => {
  const app = await service()
  try {
    const id = randomUUID()
    const status = await new Promise<number>((resolve, reject) => {
      const req = nodeRequest(app.base + id, { method: 'PUT', headers: {
        'x-test-owner': 'a', 'x-submission-digest': digest,
        'content-type': 'multipart/form-data; boundary=x', 'content-length': MAX_BODY_BYTES + 1,
      } }, res => { res.resume(); resolve(res.statusCode!) })
      req.on('error', reject); req.end()
    })
    assert.equal(status, 413)
    assert.equal(app.store.get(id, 'a'), undefined)
  } finally { await app.close() }
})

test('slow chunked upload times out and returns its reservation', async () => {
  const app = await service(100)
  try {
    const id = randomUUID()
    const status = await new Promise<number>((resolve, reject) => {
      const req = nodeRequest(app.base + id, { method: 'PUT', headers: {
        'x-test-owner': 'a', 'x-submission-digest': digest, 'content-type': 'multipart/form-data; boundary=x',
      } }, res => { res.resume(); res.on('end', () => { req.destroy(); resolve(res.statusCode!) }) })
      req.on('error', reject)
      req.write('--x\r\nContent-Disposition: form-data; name="strategy"\r\n\r\n{')
    })
    assert.equal(status, 408)
    assert.equal(app.store.get(id, 'a')?.bytes, 0)
    assert.deepEqual(readdirSync(app.store.spool), [])
  } finally { await app.close() }
})

test('per-image and JSON limits reject actual content and clean partial files', async () => {
  const app = await service()
  try {
    for (const kind of ['image', 'json'] as const) {
      const id = randomUUID(), form = new FormData()
      form.set('strategy', kind === 'json' ? 'x'.repeat(MIB + 1) : structureToJson(fixture()))
      if (kind === 'image') form.append('images', new Blob([new Uint8Array(3 * MIB + 1)]), `${digest}.webp`)
      const response = await fetch(app.base + id, { method: 'PUT', headers: { 'x-test-owner': 'a', 'x-submission-digest': digest }, body: form })
      assert.ok(response.status >= 400)
      await response.arrayBuffer()
      assert.equal(app.store.get(id, 'a')?.bytes, 0)
      assert.deepEqual(readdirSync(app.store.spool), [])
    }
  } finally { await app.close() }
})

test('chunked body limit does not trust Content-Length', async () => {
  const app = await service()
  try {
    const id = randomUUID()
    const status = await new Promise<number>((resolve, reject) => {
      const req = nodeRequest(app.base + id, { method: 'PUT', headers: {
        'x-test-owner': 'a', 'x-submission-digest': digest, 'content-type': 'multipart/form-data; boundary=x',
      } }, res => { res.resume(); res.on('end', () => { req.destroy(); resolve(res.statusCode!) }) })
      // Closing a rejected oversized streaming request can reset the socket
      // before its error response reaches Windows clients. Either rejects input.
      req.on('error', error => { if ('code' in error && error.code === 'ECONNRESET') resolve(0); else reject(error) })
      // Oversized multipart preamble, so the raw request cap must act before fields.
      for (let i = 0; i < 22; i++) req.write(Buffer.alloc(MIB, 120))
      req.end()
    })
    assert.ok(status === 413 || status === 0)
    for (let i = 0; i < 100 && app.store.get(id, 'a')?.state === 'receiving'; i++) await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(app.store.get(id, 'a')?.bytes, 0)
    assert.deepEqual(readdirSync(app.store.spool), [])
  } finally { await app.close() }
})

test('client disconnect closes file streams before releasing disk reservations', async () => {
  const app = await service()
  try {
    const id = randomUUID()
    const req = nodeRequest(app.base + id, { method: 'PUT', headers: {
      'x-test-owner': 'a', 'x-submission-digest': digest, 'content-type': 'multipart/form-data; boundary=x',
    } })
    req.on('error', () => {})
    req.write(`--x\r\nContent-Disposition: form-data; name="images"; filename="${digest}.webp"\r\nContent-Type: image/webp\r\n\r\npartial`)
    for (let i = 0; i < 100 && !app.store.get(id, 'a'); i++) await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(app.store.get(id, 'a')?.state, 'receiving')
    req.destroy()
    for (let i = 0; i < 100 && app.store.get(id, 'a')?.state === 'receiving'; i++) await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(app.store.get(id, 'a')?.state, 'reupload-required')
    assert.deepEqual(readdirSync(app.store.spool), [])
  } finally { await app.close() }
})
