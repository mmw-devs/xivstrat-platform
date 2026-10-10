import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { structureToJson } from '@xivstrat/content-schema'
import { createDemo } from '../../lib/editor/demo.ts'
import { UploadStore } from '../uploads/store.ts'
import { createUploadHandler } from '../uploads/http.ts'
import { createImageSubmissionWorker } from './image-submission.ts'

import { remote } from '../../../tests/fixtures/image-remote.ts'

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'xivstrat-image-job-'))
  let store = new UploadStore(directory)
  const id = randomUUID(), owner = 'author'
  const structure = createDemo()
  structure.metadata.name = 'image-job'; structure.metadata.type = 'other'; structure.metadata.banner = ''
  const image = Buffer.from('already validated by upload service')
  const imageName = `${createHash('sha256').update(image).digest('hex')}.webp`
  structure.phases = [{ name: 'p1', mechanics: [{ name: '示意', sub_mechanics: [], sections: [{ type: 'note', title: '', content: [{ type: 'image', file: `assets/images/${imageName}`, caption: '' }] }] }] }]
  const json = structureToJson(structure), digest = createHash('sha256').update(json).digest('hex')
  store.reserve(id, owner, digest)
  writeFileSync(join(store.directory(id), 'strategy.json'), json)
  writeFileSync(join(store.directory(id), imageName), image)
  store.ready(id, owner, ['strategy.json', imageName])
  return { id, owner, imageName, image, get store() { return store },
    reopen() { store.close(); store = new UploadStore(directory); return store },
    close() { store.close(); rmSync(directory, { recursive: true, force: true }) },
  }
}
function count(api: ReturnType<typeof remote>, suffix: string) { return api.calls.filter(call => call.route.startsWith('POST') && call.route.endsWith(suffix)).length }

test('one complete commit and PR, fixed operation time, and cleanup only after confirmation', async () => {
  const local = setup(), api = remote()
  try {
    const worker = createImageSubmissionWorker(local.store, api.runtime())
    worker.start(local.id, local.owner); worker.start(local.id, local.owner)
    await worker.idle()
    const job = local.store.submission(local.id, local.owner)!
    assert.equal(job.status, 'submitted', job.code)
    assert.equal(count(api, '/git/commits'), 1); assert.equal(count(api, '/pulls'), 1)
    assert.equal(api.blobs.size, 2)
    assert.deepEqual(api.trees.get(job.treeSha!)!.map(entry => entry.path), ['content/strategies/image-job.json', `content/assets/images/${local.imageName}`])
    const json = JSON.parse(api.blobs.get(job.entries[0].sha)!.toString())
    assert.equal(json.metadata.publish_time, job.publishTime)
    assert.deepEqual(readdirSync(local.store.spool), [])
    assert.equal(local.store.get(local.id, local.owner)?.state, 'submitted')
    const calls = api.calls.length
    const again = createImageSubmissionWorker(local.reopen(), api.runtime())
    again.start(local.id, local.owner); await again.idle()
    assert.equal(api.calls.length, calls)
  } finally { local.close() }
})

for (const suffix of ['/git/blobs', '/git/trees', '/git/commits', '/git/refs', '/pulls']) {
  test(`lost response at ${suffix} recovers after restart without duplicate mutable writes`, async () => {
    const local = setup(), api = remote()
    try {
      api.fail(suffix)
      let worker = createImageSubmissionWorker(local.store, api.runtime())
      worker.start(local.id, local.owner); await worker.idle()
      const first = local.store.submission(local.id, local.owner)!
      assert.notEqual(first.status, 'submitted')
      assert.equal(local.store.get(local.id, local.owner)?.bytes! > 0, true)
      worker = createImageSubmissionWorker(local.reopen(), api.runtime('new-base'))
      worker.start(local.id, local.owner); await worker.idle()
      const second = local.store.submission(local.id, local.owner)!
      assert.equal(second.status, 'submitted', second.code)
      assert.equal(second.publishTime, first.publishTime); assert.equal(second.baseSha, 'base')
      assert.equal(api.commits.size, 3) // two fixture base commits plus one immutable submitted commit
      assert.equal(api.refs.size, 1); assert.equal(api.prs.length, 1)
      assert.equal(count(api, '/git/refs'), 1); assert.equal(count(api, '/pulls'), 1)
    } finally { local.close() }
  })
}

for (const suffix of ['/git/refs', '/pulls']) {
  test(`unknown ${suffix} absent from lookup never triggers a second POST`, async () => {
    const local = setup(), api = remote()
    try {
      api.fail(suffix, false)
      let worker = createImageSubmissionWorker(local.store, api.runtime())
      worker.start(local.id, local.owner); await worker.idle()
      worker = createImageSubmissionWorker(local.reopen(), api.runtime())
      worker.start(local.id, local.owner); await worker.idle()
      assert.equal(local.store.submission(local.id, local.owner)?.status, 'unknown')
      assert.equal(count(api, suffix), 1)
      assert.ok(local.store.get(local.id, local.owner)!.bytes > 0)
    } finally { local.close() }
  })
}

test('closed PR recovered by lookup is never replaced; recovery works after local expiry', async () => {
  const local = setup(), api = remote()
  try {
    api.fail('/pulls')
    let worker = createImageSubmissionWorker(local.store, api.runtime())
    worker.start(local.id, local.owner); await worker.idle()
    api.prs[0].state = 'closed'
    api.refs.clear()
    local.store.release(local.id)
    worker = createImageSubmissionWorker(local.reopen(), api.runtime())
    worker.start(local.id, local.owner); await worker.idle()
    assert.equal(local.store.submission(local.id, local.owner)?.status, 'submitted')
    assert.equal(count(api, '/pulls'), 1)
  } finally { local.close() }
})

test('branch changes and remote content mismatch stop before PR creation', async () => {
  for (const kind of ['branch', 'content']) {
    const local = setup(), api = remote()
    try {
      if (kind === 'branch') api.refs.set(`content/${local.id}`, 'somebody-elses-commit')
      else api.corruptContent()
      const worker = createImageSubmissionWorker(local.store, api.runtime())
      worker.start(local.id, local.owner); await worker.idle()
      assert.equal(local.store.submission(local.id, local.owner)?.status, 'needs-attention')
      assert.equal(count(api, '/pulls'), 0)
      assert.ok(local.store.get(local.id, local.owner)!.bytes > 0)
    } finally { local.close() }
  }
})

test('ownership checks and active job pins protect retained files from cleanup', async () => {
  const local = setup(), api = remote()
  try {
    let proceed!: () => void
    const gate = new Promise<void>(resolve => { proceed = resolve })
    const worker = createImageSubmissionWorker(local.store, async () => { await gate; return api.runtime()() })
    assert.throws(() => worker.start(local.id, 'another-author'))
    worker.start(local.id, local.owner)
    assert.throws(() => local.store.pin(local.id, local.owner), /已有投稿/)
    local.store.cleanup()
    assert.ok(local.store.get(local.id, local.owner)!.bytes > 0)
    proceed(); await worker.idle()
    assert.equal(local.store.submission(local.id, local.owner)?.status, 'submitted')
  } finally { local.close() }
})

test('HTTP submit is opt-in, checks ownership, and exposes confirmed results through GET', async () => {
  const local = setup(), api = remote()
  const worker = createImageSubmissionWorker(local.store, api.runtime())
  let enabled = false
  const handler = () => createUploadHandler(local.store, {
    async authenticate(request) { return request.headers.authorization === 'test-owner' ? local.owner : request.headers.authorization === 'other-owner' ? 'other' : null },
    ...(enabled ? { startSubmission: worker.start } : {}),
  })
  const server = createServer((req, res) => { void handler()(req, res) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const url = `http://127.0.0.1:${address.port}/api/upload-tasks/${local.id}`
  const post = (authorization = 'test-owner') => fetch(`${url}/submit`, { method: 'POST', headers: { authorization } })
  try {
    assert.equal((await post()).status, 503)
    assert.equal(api.calls.length, 0)
    enabled = true
    assert.equal((await post('')).status, 401)
    assert.equal((await post('other-owner')).status, 404)
    const first = await post()
    assert.equal(first.status, 202)
    await worker.idle()
    const result = await (await fetch(url, { headers: { authorization: 'test-owner' } })).json()
    assert.equal(result.task.remoteSubmission, 'submitted')
    assert.equal(result.task.result.prNumber, 1)
    assert.equal(result.task.bytes, 0)
    assert.equal('owner' in result.task, false)
    await post(); await worker.idle()
    assert.equal(count(api, '/pulls'), 1)
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
    await worker.idle(); local.close()
  }
})

test('partial immutable upload requires the same files again after expiry, without mutable writes', async () => {
  const local = setup(), api = remote()
  try {
    api.fail('/git/blobs')
    let worker = createImageSubmissionWorker(local.store, api.runtime())
    worker.start(local.id, local.owner); await worker.idle()
    local.store.release(local.id)
    worker = createImageSubmissionWorker(local.reopen(), api.runtime())
    worker.start(local.id, local.owner); await worker.idle()
    assert.equal(local.store.submission(local.id, local.owner)?.code, 'REUPLOAD_REQUIRED')
    assert.equal(count(api, '/git/refs'), 0)
  } finally { local.close() }
})

test('changed repository configuration and changed local bytes cannot silently alter a retry', async () => {
  for (const scenario of ['repository', 'file']) {
    const local = setup(), api = remote()
    try {
      api.fail('/git/blobs')
      let worker = createImageSubmissionWorker(local.store, api.runtime())
      worker.start(local.id, local.owner); await worker.idle()
      if (scenario === 'file') writeFileSync(join(local.store.directory(local.id), local.imageName), 'changed')
      worker = createImageSubmissionWorker(local.store, async () => {
        const runtime = await api.runtime()()
        return scenario === 'repository' ? { ...runtime, config: { ...runtime.config, repo: 'other' } } : runtime
      })
      worker.start(local.id, local.owner); await worker.idle()
      assert.equal(local.store.submission(local.id, local.owner)?.status, 'needs-attention')
      assert.equal(count(api, '/git/refs'), 0)
    } finally { local.close() }
  }
})
