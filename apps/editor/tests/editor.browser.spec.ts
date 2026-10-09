import { test, expect } from '@playwright/test'
import { createEmptyStructure, normalizeStructure, plainTextDocument, type StrategyStructure } from '@xivstrat/content-schema'
import { importStructure, isolateNetwork, saveLocal } from './helpers'
import { zipSync, strToU8 } from 'fflate'

const metadata = {
  ...createEmptyStructure().metadata, name: 'browser-test', type: 'other' as const,
  title: '当前攻略标题', banner: 'banners/test.webp',
}
const fields = { name: 'inp-name', title: 'inp-title', banner: 'inp-banner' } as const

test.beforeEach(async ({ page }) => { await isolateNetwork(page); await page.goto('/editor/') })

test('local images survive ZIP backup and fresh-page import without uploading', async ({ page }, testInfo) => {
  let uploads = 0
  await page.route('**/api/submissions', route => { uploads++; return route.abort() })
  const fixture = normalizeStructure({ ...createEmptyStructure(), metadata: { ...metadata, banner: '' }, phases: [{ name: 'p1', mechanics: [{
    name: '图片机制', sub_mechanics: [], sections: [{ type: 'note', title: '', content: [{ type: 'image', file: '', caption: '站位图' }] }],
  }] }] })
  await importStructure(page, fixture)
  await page.locator('[data-step="3"]').click()
  const bytes = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 240
    const context = canvas.getContext('2d')!
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, 480, 240)
    context.fillStyle = '#111111'; context.font = '24px sans-serif'; context.fillText('站位 A → B', 30, 100)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  await page.locator('#phases input[type="file"]').setInputFiles({ name: 'diagram.png', mimeType: 'image/png', buffer: Buffer.from(bytes, 'base64') })
  await expect(page.locator('#phases [role="status"]')).toContainText('尚未上传')
  await page.locator('[data-step="5"]').click()
  await expect(page.locator('#preview img')).toBeVisible()
  expect(await page.locator('#preview img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(480)
  expect(uploads).toBe(0)
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载攻略包（ZIP）' }).click()
  const downloaded = await downloading
  const path = await downloaded.path()
  await page.reload()
  await page.locator('[data-step="5"]').click()
  page.once('dialog', dialog => dialog.accept())
  await page.getByLabel('导入攻略包 ZIP', { exact: true }).setInputFiles(path!)
  await expect(page.getByText('攻略包导入成功，图片已恢复到当前页面。')).toBeVisible()
  await expect(page.locator('#preview img')).toBeVisible()
  expect(await page.locator('#preview img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(480)
  page.once('dialog', dialog => dialog.accept())
  await page.getByLabel('导入攻略包 ZIP', { exact: true }).setInputFiles({
    name: 'unsafe.zip', mimeType: 'application/zip', buffer: Buffer.from(zipSync({ '../outside.webp': strToU8('invalid') })),
  })
  await expect(page.getByText('导入失败：攻略包包含不允许的路径')).toBeVisible()
  await expect(page.locator('#preview img')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('image-package.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('#preview img')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('image-package-mobile.png'), fullPage: true })
})

async function mockSubmission(page: import('@playwright/test').Page) {
  const requests: StrategyStructure[] = []
  await page.route('**/api/submissions', async route => {
    requests.push(route.request().postDataJSON() as StrategyStructure)
    await route.fulfill({ status: 201, json: { ok: true, submission: {
      submissionId: 'browser-test', prNumber: 123, prUrl: 'https://github.com/mmw-devs/xivstrat-platform/pull/123',
    } } })
  })
  return requests
}

test('actual form, Tiptap edits and block ordering reach preview, local save and submitted body', async ({ page }) => {
  const requests = await mockSubmission(page)
  for (const [field, id] of Object.entries(fields)) await page.locator(`#${id}`).fill(metadata[field as keyof typeof fields])
  await page.locator('#inp-type').selectOption('other')
  await page.locator('[data-step="3"]').click()
  await page.getByLabel('阶段名称', { exact: false }).fill('p1-前半')
  await page.getByRole('button', { name: '＋ 添加机制', exact: true }).click()
  await page.getByLabel('机制名称', { exact: false }).fill('测试机制')
  await page.getByRole('button', { name: '＋ 添加区块', exact: true }).click()
  await page.getByLabel('区块类型').selectOption('note')
  const section = page.locator('.section-box')
  await section.getByRole('button', { name: '＋ 添加文字', exact: true }).click()
  await page.getByRole('textbox', { name: '攻略正文', exact: true }).fill('第一段原文')
  await section.getByRole('button', { name: '＋ 添加文字', exact: true }).click()
  await page.getByRole('textbox', { name: '攻略正文', exact: true }).nth(1).fill('第二段')
  await section.locator('.block-row').nth(1).getByRole('button', { name: '↑', exact: true }).click()
  await page.getByRole('textbox', { name: '攻略正文', exact: true }).nth(1).fill('第一段修改后')
  await page.locator('[data-step="5"]').click()
  await expect(page.locator('#preview .paragraph')).toHaveText(['第二段', '第一段修改后'])
  const expected = { metadata: { ...metadata, publish_time: expect.any(String) }, references: [], macros: [], phases: [{
    name: 'p1-前半', mechanics: [{ name: '测试机制', sub_mechanics: [], sections: [{
      type: 'note', title: '', content: ['第二段', '第一段修改后'].map(text => ({ type: 'text', id: expect.any(String), doc: plainTextDocument([text]) })),
    }] }],
  }] }
  const saved = await saveLocal(page)
  expect(saved).toEqual(expected)
  await page.getByRole('button', { name: '提交审核', exact: true }).click()
  await expect(page.locator('#submission-status')).toContainText('提交成功')
  expect(requests).toEqual([saved])
  await importStructure(page, saved)
  expect(withoutTime(await saveLocal(page))).toEqual(withoutTime(saved))
})

test('import then edit metadata and rich text submits the current document, not imported or cached data', async ({ page }) => {
  const requests = await mockSubmission(page)
  const original = normalizeStructure({ ...createEmptyStructure(), metadata, phases: [{ name: 'p1-导入阶段', mechanics: [{
    name: '导入机制', sub_mechanics: [], sections: [{ type: 'note', title: '', content: [{ type: 'text', id: 'body-import', doc: plainTextDocument(['导入原文']) }] }],
  }] }] })
  await importStructure(page, original)
  await expect(page.locator('#preview')).toContainText('导入原文')
  await page.locator('[data-step="1"]').click()
  await page.locator('#inp-title').fill('导入后修改的标题')
  await page.locator('[data-step="3"]').click()
  await page.getByRole('textbox', { name: '攻略正文', exact: true }).fill('导入后修改的正文')
  await page.locator('[data-step="5"]').click()
  await expect(page.locator('#preview .paragraph')).toHaveText(['导入后修改的正文'])
  const expected = structuredClone(original)
  expected.metadata.title = '导入后修改的标题'
  const block = expected.phases[0].mechanics[0].sections[0].content[0]
  if (block.type !== 'text') throw new Error('Expected text fixture')
  block.doc = plainTextDocument(['导入后修改的正文'])
  await page.getByRole('button', { name: '提交审核', exact: true }).click()
  await expect(page.locator('#submission-status')).toContainText('提交成功')
  expect(requests).toEqual([expected])
  expect(withoutTime(await saveLocal(page))).toEqual(withoutTime(expected))
})

test('rejected unrelated JSON preserves unsaved editor content and subsequent submission', async ({ page }) => {
  const requests = await mockSubmission(page)
  await page.locator('[data-step="5"]').click()
  await page.locator('#btn-load-demo').click()
  await page.locator('[data-step="1"]').click()
  await page.locator('#inp-title').fill('误导入前尚未保存的标题')
  await page.locator('[data-step="3"]').click()
  await page.getByRole('textbox', { name: '攻略正文', exact: true }).first().fill('误导入前尚未保存的正文')
  await page.locator('[data-step="5"]').click()
  const before = await saveLocal(page)
  for (const raw of ['{"phases":[]}', '{"foo":"完全无关的数据","phases":[]}', '{"metadata":{},"phases":[]}']) {
    await page.locator('#importArea').fill(raw)
    await page.getByRole('button', { name: '导入已有攻略', exact: true }).click()
    await expect(page.locator('#import-status')).toContainText('导入失败')
    await expect(page.locator('#preview')).toContainText('误导入前尚未保存的正文')
    expect(withoutTime(await saveLocal(page))).toEqual(withoutTime(before))
  }
  await page.getByRole('button', { name: '提交审核', exact: true }).click()
  await expect(page.locator('#submission-status')).toContainText('提交成功')
  expect(requests.map(withoutTime)).toEqual([withoutTime(before)])
})

function withoutTime(value: any) { return { ...value, metadata: { ...value.metadata, publish_time: '' } } }

test('readonly operation fields, visible name conversion and imported status reset', async ({ page }, testInfo) => {
  await page.locator('#inp-type').selectOption('ultimate')
  await page.locator('#inp-name').fill('the epic of alexander')
  await expect(page.locator('#inp-name')).toHaveValue('the-epic-of-alexander')
  await expect(page.locator('#inp-status')).toHaveValue('draft')
  await expect(page.locator('#inp-status')).toHaveAttribute('readonly','')
  await expect(page.locator('#inp-date')).toHaveAttribute('readonly','')
  await expect(page.locator('#inp-id, #inp-short, #inp-desc, #inp-group, #btn-sync-time')).toHaveCount(0)
  const draft=createEmptyStructure();draft.metadata.name='the-epic-of-alexander';draft.metadata.type='ultimate';draft.metadata.status='review'
  draft.metadata.publish_time='2000-01-01T00:00:00.000Z'
  await importStructure(page,draft)
  await expect(page.locator('#import-status')).toContainText('作为草稿编辑')
  const saved=await saveLocal(page)
  expect(saved.metadata.status).toBe('draft')
  expect(Date.parse(saved.metadata.publish_time)).toBeGreaterThan(Date.parse(draft.metadata.publish_time))
  await page.locator('[data-step="1"]').click()
  await expect(page.locator('#inp-date')).toHaveValue(saved.metadata.publish_time)
  await page.locator('#inp-name').fill('another-name')
  await expect(page.locator('#name-warning')).toContainText('原文件不会重命名')
  await page.screenshot({path:testInfo.outputPath('metadata-fields.png'),fullPage:true})
})

test('numeric phase reordering preserves live body and id; invalid values block submission', async ({ page }) => {
  const requests=await mockSubmission(page)
  const draft=createEmptyStructure();draft.metadata={...metadata}
  draft.macros=[{name:'站位',code:' /p hello world\n/p second\tline'}]
  draft.phases=['p2','p10'].map((name,i)=>({name,mechanics:[{name:'机制',sub_mechanics:[],sections:[{type:'note',title:'',content:[{type:'text',id:`stable-${i}`,doc:plainTextDocument([`正文${i}`])}]}]}]}))
  await importStructure(page,draft)
  await page.locator('[data-step="3"]').click()
  const body=page.getByRole('textbox',{name:'攻略正文',exact:true}).nth(1)
  await body.fill('移动后保留的正文')
  await page.getByLabel('阶段名称',{exact:false}).nth(1).fill('p1.5-转场')
  expect(await page.getByLabel('阶段名称',{exact:false}).evaluateAll(nodes=>nodes.map(n=>(n as HTMLInputElement).value))).toEqual(['p1.5-转场','p2'])
  await expect(page.getByLabel('阶段名称',{exact:false}).first()).toBeFocused()
  await expect(page.getByRole('textbox',{name:'攻略正文',exact:true}).first()).toHaveText('移动后保留的正文')
  await page.locator('[data-step="5"]').click()
  const saved=await saveLocal(page)
  expect(saved.phases[0].mechanics[0].sections[0].content[0]).toMatchObject({type:'text',id:'stable-1'})
  expect(saved.macros).toEqual(draft.macros)
  await page.locator('[data-step="1"]').click()
  await page.locator('#inp-title').fill('禁止 空格')
  await page.locator('[data-step="5"]').click()
  await page.getByRole('button',{name:'提交审核',exact:true}).click()
  await expect(page.locator('#submission-status')).toContainText('metadata.title')
  expect(requests).toHaveLength(0)
})
