import { expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import type { StrategyStructure } from '@xivstrat/content-schema'

export async function isolateNetwork(page: Page): Promise<void> {
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.hostname !== '127.0.0.1' || url.pathname.startsWith('/api/')) return route.abort()
    return route.continue()
  })
}

export async function saveLocal(page: Page): Promise<StrategyStructure> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存到本地（JSON）', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^[a-z0-9-]+\.json$/i)
  const file = await download.path()
  expect(file).not.toBeNull()
  return JSON.parse(await readFile(file!, 'utf8')) as StrategyStructure
}

export async function importStructure(page: Page, structure: StrategyStructure): Promise<void> {
  await page.locator('[data-step="5"]').click()
  await page.locator('#importArea').fill(JSON.stringify(structure))
  await page.getByRole('button', { name: '导入已有攻略', exact: true }).click()
  await expect(page.locator('#import-status')).toContainText('导入成功')
}
