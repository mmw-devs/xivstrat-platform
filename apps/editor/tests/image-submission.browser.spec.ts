import { test, expect, type Page } from '@playwright/test'
import { createEmptyStructure, normalizeStructure } from '@xivstrat/content-schema'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { UploadStore } from '../src/server/uploads/store'
import { createUploadHandler } from '../src/server/uploads/http'
import { createImageSubmissionWorker } from '../src/server/github/image-submission'
import { remote } from './fixtures/image-remote'
import { importStructure, isolateNetwork } from './helpers'

async function imageDraft(page: Page) {
  await importStructure(page, normalizeStructure({ ...createEmptyStructure(), metadata: {
    ...createEmptyStructure().metadata, name: 'browser-image', title: '图片提交原快照', type: 'other', banner: '',
  }, phases: [{ name: 'p1', mechanics: [{ name: '机制', sub_mechanics: [], sections: [{ type: 'note', title: '',
    content: [{ type: 'image', file: '', caption: '图示' }],
  }] }] }] }))
  await page.locator('[data-step="3"]').click()
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 40
    canvas.getContext('2d')!.fillRect(0, 0, 80, 40)
    return canvas.toDataURL().split(',')[1]
  })
  await page.locator('#phases input[type="file"]').setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await expect(page.locator('#phases [role="status"]')).toContainText('尚未上传')
  await page.locator('[data-step="5"]').click()
}

test.beforeEach(async ({ page }) => { await isolateNetwork(page); await page.goto('/editor/'); await imageDraft(page) })

test('browser → real multipart/SQLite/worker → simulated GitHub; lost response recovers without duplicate PR', async ({ page }, info) => {
  const directory = mkdtempSync(join(tmpdir(), 'xivstrat-browser-upload-'))
  const store = new UploadStore(directory), api = remote()
  const worker = createImageSubmissionWorker(store, api.runtime())
  const server = createServer(createUploadHandler(store, { authenticate: async () => 'browser', startSubmission: worker.start }))
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing address')
  const calls: string[] = []
  let taskId = '', loseResponse = true
  try {
    await page.route('**/api/upload-tasks/**', async route => {
      const request = route.request(), url = new URL(request.url())
      taskId = url.pathname.split('/')[3]
      calls.push(request.method())
      const response = await route.fetch({ url: `http://127.0.0.1:${address.port}${url.pathname}`, maxRetries: 0 })
      if (request.method() === 'POST' && loseResponse) {
        loseResponse = false
        await worker.idle()
        await route.abort('connectionreset')
      } else await route.fulfill({ response })
    })
    await page.getByRole('button', { name: '提交审核', exact: true }).click()
    await expect(page.locator('#image-submission-status')).toContainText('请先查询原任务')
    expect(store.submission(taskId, 'browser')?.status).toBe('submitted')
    expect(readdirSync(store.spool)).toEqual([])
    const uploadedJson = [...api.blobs.values()].map(bytes => bytes.toString()).find(value => value.startsWith('{'))!
    expect(JSON.parse(uploadedJson).metadata.title).toBe('图片提交原快照')
    expect(api.blobs.size).toBe(2)
    expect(api.prs.length).toBe(1)
    await page.reload()
    await page.locator('[data-step="5"]').click()
    await expect(page.locator('#image-submission-status')).toContainText(taskId)
    await page.getByRole('button', { name: '查询图片任务', exact: true }).click()
    await expect(page.locator('#image-submission-status')).toContainText('提交成功')
    expect(calls.filter(value => value === 'POST')).toHaveLength(1)
    expect(calls.filter(value => value === 'PUT')).toHaveLength(1)
    expect(api.prs.length).toBe(1)
    await page.locator('.submission-card').scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath('image-submission.png'), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath('image-submission-mobile.png'), fullPage: true })
  } finally {
    await worker.idle()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    store.close()
    // The directory is a newly created child of the OS temp folder, never a user path.
    rmSync(directory, { recursive: true, force: true })
  }
})

test('unknown outcome uses read-only queries and explicit resume; frozen upload excludes subsequent editing', async ({ page }) => {
  const methods: string[] = []
  let id = '', state = 'unknown', uploaded = ''
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/upload-tasks/**', async route => {
    const method = route.request().method()
    methods.push(method); id = new URL(route.request().url()).pathname.split('/')[3]
    if (method === 'GET' && !uploaded) return route.fulfill({ status: 404, json: { ok: false, error: { code: 'NOT_FOUND' } } })
    if (method === 'PUT') { uploaded = route.request().postDataBuffer()!.toString(); await gate }
    await route.fulfill({ status: 200, json: { ok: true, task: { id, state: method === 'PUT' ? 'ready' : 'reupload-required', remoteSubmission: method === 'PUT' ? 'not-started' : state } } })
  })
  await page.getByRole('button', { name: '提交审核', exact: true }).click()
  await expect.poll(() => uploaded.length).toBeGreaterThan(0)
  await page.locator('[data-step="1"]').click()
  await page.locator('#inp-title').fill('提交之后的修改')
  release()
  await page.locator('[data-step="5"]').click()
  await expect(page.locator('#image-submission-status')).toContainText('远端结果尚未确认')
  expect(uploaded).toContain('图片提交原快照'); expect(uploaded).not.toContain('提交之后的修改')
  await page.getByRole('button', { name: '查询图片任务', exact: true }).click()
  await expect(page.getByRole('button', { name: '继续图片任务', exact: true })).toBeEnabled()
  expect(methods.filter(value => value === 'POST')).toHaveLength(1)
  await page.getByRole('button', { name: '提交审核', exact: true }).click()
  await expect(page.locator('#image-submission-status')).toContainText('上一图片任务尚未结束')
  await page.reload(); await page.locator('[data-step="5"]').click()
  await page.getByRole('button', { name: '继续图片任务', exact: true }).click()
  await expect(page.locator('#image-submission-status')).toContainText('远端结果尚未确认')
  expect(methods.filter(value => value === 'POST')).toHaveLength(2)
  expect(methods.filter(value => value === 'PUT')).toHaveLength(1) // Remote verification works without local images after reload.
  state = 'needs-attention'
  await page.getByRole('button', { name: '继续图片任务', exact: true }).click()
  await expect(page.locator('#image-submission-status')).toContainText('需要维护者处理')
  expect(methods.filter(value => value === 'POST')).toHaveLength(2) // GET already found a terminal state.
})

test('unavailable receipt storage prevents remote writes', async ({ page }) => {
  let calls = 0
  await page.route('**/api/upload-tasks/**', route => { calls++; return route.abort() })
  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Storage blocked', 'SecurityError') }
  })
  await page.getByRole('button', { name: '提交审核', exact: true }).click()
  await expect(page.locator('#image-submission-status')).toContainText('浏览器无法保存任务编号')
  expect(calls).toBe(0)
})

test('expired upload restores from ZIP under the same receipt, despite export operation time', async ({ page }) => {
  let id = '', uploaded = false, putCount = 0, digest = ''
  await page.route('**/api/upload-tasks/**', async route => {
    const request = route.request(), current = new URL(request.url()).pathname.split('/')[3]
    if (id) expect(current).toBe(id)
    id = current
    if (request.method() === 'GET' && !uploaded) return route.fulfill({ status: 404, json: { ok: false, error: { code: 'NOT_FOUND' } } })
    if (request.method() === 'PUT') {
      putCount++; uploaded = true
      const next = request.headers()['x-submission-digest']
      if (digest) expect(next).toBe(digest)
      digest = next
    }
    if (request.method() === 'POST') return route.fulfill({ status: 503, json: { ok: false, error: { message: '图片远程投稿未启用' } } })
    await route.fulfill({ json: { ok: true, task: { id, state: 'ready', remoteSubmission: 'not-started' } } })
  })
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载攻略包（ZIP）' }).click()
  const path = await (await download).path()
  await page.getByRole('button', { name: '提交审核', exact: true }).click()
  await expect(page.locator('#image-submission-status')).toContainText('图片远程投稿未启用')
  uploaded = false
  await page.reload(); await page.locator('[data-step="5"]').click()
  await page.getByRole('button', { name: '继续图片任务', exact: true }).click()
  await expect(page.locator('#image-submission-status')).toContainText('请先查询原任务')
  expect(putCount).toBe(1)
  page.once('dialog', dialog => dialog.accept())
  await page.getByLabel('导入攻略包 ZIP', { exact: true }).setInputFiles(path!)
  await expect(page.getByText('攻略包导入成功，图片已恢复到当前页面。')).toBeVisible()
  await page.getByRole('button', { name: '继续图片任务', exact: true }).click()
  await expect(page.locator('#image-submission-status')).toContainText('图片远程投稿未启用')
  expect(putCount).toBe(2)
})
