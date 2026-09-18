import { test, expect } from '@playwright/test'
import { normalizeStructure, plainTextDocument, type StrategyStructure } from '@xivstrat/content-schema'
import { importStructure, isolateNetwork, saveLocal } from './helpers'

const metadata = {
  id: 'browser-test', name: '浏览器测试副本', short_name: '测试', type: 'other' as const,
  title: '当前攻略标题', description: '状态链路回归', banner: 'banners/test.webp',
  publish_time: '26/09/18 12:00', status: 'draft' as const, video: '', team: '测试组',
}
const fields = { id: 'inp-id', name: 'inp-name', short_name: 'inp-short', title: 'inp-title', description: 'inp-desc', banner: 'inp-banner', publish_time: 'inp-date', team: 'inp-group' } as const

test.beforeEach(async ({ page }) => { await isolateNetwork(page); await page.goto('/editor/') })

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
  await page.getByLabel('阶段 id（如 p1）', { exact: false }).fill('p1')
  await page.getByLabel('阶段名称（如 前半）', { exact: false }).fill('前半')
  await page.getByRole('button', { name: '＋ 添加机制', exact: true }).click()
  await page.getByLabel('机制名称', { exact: false }).fill('测试机制')
  await page.getByLabel('编号（英文小写+短横线，本阶段唯一）', { exact: false }).fill('mechanic')
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
  const expected = { schemaVersion: 2, metadata, references: [], macros: [], phases: [{
    id: 'p1', name: '前半', mechanics: [{ id: 'mechanic', name: '测试机制', sub_mechanics: [], sections: [{
      type: 'note', title: '', content: ['第二段', '第一段修改后'].map(text => ({ type: 'text', id: expect.any(String), doc: plainTextDocument([text]) })),
    }] }],
  }] }
  const saved = await saveLocal(page)
  expect(saved).toEqual(expected)
  await page.getByRole('button', { name: '提交审核', exact: true }).click()
  await expect(page.locator('#submission-status')).toContainText('提交成功')
  expect(requests).toEqual([saved])
  await importStructure(page, saved)
  expect(await saveLocal(page)).toEqual(saved)
})

test('import then edit metadata and rich text submits the current document, not imported or cached data', async ({ page }) => {
  const requests = await mockSubmission(page)
  const original = normalizeStructure({ metadata, phases: [{ id: 'p1', name: '导入阶段', mechanics: [{
    id: 'm1', name: '导入机制', sections: [{ type: 'note', title: '', content: [{ type: 'text', id: 'body-import', doc: plainTextDocument(['导入原文']) }] }],
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
  expect(await saveLocal(page)).toEqual(expected)
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
    expect(await saveLocal(page)).toEqual(before)
  }
  await page.getByRole('button', { name: '提交审核', exact: true }).click()
  await expect(page.locator('#submission-status')).toContainText('提交成功')
  expect(requests).toEqual([before])
})
