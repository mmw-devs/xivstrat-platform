import { test, expect } from '@playwright/test'
import { importStructure, isolateNetwork, saveLocal } from './helpers'

test('production keeps local draft recovery available beside disabled submission on desktop and mobile', async ({ page }, testInfo) => {
  await isolateNetwork(page)
  await page.goto('/editor/')
  await page.locator('#inp-title').fill('未完成的本地草稿')
  await page.locator('[data-step="5"]').click()
  await expect(page.locator('#btn-submit-review')).toBeDisabled()
  await expect(page.locator('#btn-save-local')).toBeEnabled()
  await expect(page.locator('#local-save-hint')).toContainText('临时导出出口')
  const saved = await saveLocal(page)
  expect(saved.metadata.title).toBe('未完成的本地草稿')
  expect(saved.phases).toEqual([])
  await page.reload()
  await importStructure(page, saved)
  expect(await saveLocal(page)).toEqual(saved)
  await page.locator('#btn-load-demo').click()
  const demo = await saveLocal(page)
  expect(demo.phases.length).toBeGreaterThan(0)
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    await page.locator('.submission-card').scrollIntoViewIfNeeded()
    const submit = await page.locator('#btn-submit-review').boundingBox()
    const save = await page.locator('#btn-save-local').boundingBox()
    expect(submit).not.toBeNull(); expect(save).not.toBeNull()
    expect(Math.abs(submit!.y - save!.y)).toBeLessThan(2)
    expect(save!.x).toBeGreaterThan(submit!.x)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`save-${viewport.width}.png`) })
  }
  const paragraph = page.locator('#preview .paragraph').first()
  await expect(paragraph).not.toHaveAttribute('style')
  const styles = await paragraph.evaluate(element => {
    const css = getComputedStyle(element)
    return { whiteSpace: css.whiteSpace, minHeight: css.minHeight, lineHeight: css.lineHeight }
  })
  expect(styles.whiteSpace).toBe('pre-wrap')
  expect(parseFloat(styles.minHeight)).toBeCloseTo(parseFloat(styles.lineHeight), 1)
})
