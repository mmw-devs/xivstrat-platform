import { button, el, errorMessage, type ElementLookup } from '../ui/dom'
import { exportImagePackage, importImagePackage } from './image-package'
import { createImageAssets, type ImageAssets } from './image-assets'
import type { StrategyStructure } from '@xivstrat/content-schema'

export function mountImagePackage(byId: ElementLookup, collect: () => StrategyStructure, replace: (value: StrategyStructure) => void, assets: ImageAssets, signal: AbortSignal) {
  const status = el('p', { class: 'hint', role: 'status' }, '攻略包包含本地图片；外链图片仍需联网。关闭页面前请下载备份。')
  const download = button('下载攻略包（ZIP）', () => { void save() })
  const input = el('input', { type: 'file', accept: '.zip,application/zip', 'aria-label': '导入攻略包 ZIP' })
  const root = el('div', { class: 'stack' }, download, el('label', {}, '导入攻略包（会替换当前攻略）', input), status)
  byId('btn-save-local').insertAdjacentElement('afterend', root)
  async function save() {
    download.disabled = true
    try {
      const snapshot = structuredClone(collect())
      const bytes = await exportImagePackage(snapshot, assets)
      if (signal.aborted) return
      const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes).buffer], { type: 'application/zip' }))
      const anchor = el('a', { href: url, download: 'strategy-package.zip' })
      document.body.append(anchor); anchor.click(); anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      status.textContent = '已发起攻略包下载，请确认文件已保存；外链图片仍需联网，后续修改需再次下载。'
    } catch (error) { status.textContent = `导出失败：${errorMessage(error)}` }
    finally { download.disabled = false }
  }
  input.addEventListener('change', async () => {
    const file = input.files?.[0]
    if (!file || !confirm('导入攻略包将替换当前攻略，请确认已备份当前内容。')) { input.value = ''; return }
    input.disabled = true
    const staged = createImageAssets()
    try {
      const result = await importImagePackage(file)
      for (const blob of result.images) await staged.add(blob)
      if (signal.aborted) return
      // Validation finishes before replacing the current document and its assets.
      assets.replaceFrom(staged)
      replace(result.structure)
      status.textContent = '攻略包导入成功，图片已恢复到当前页面。'
    } catch (error) { status.textContent = `导入失败：${errorMessage(error)}` }
    finally { staged.clear(); input.disabled = false; input.value = '' }
  }, { signal })
  signal.addEventListener('abort', () => root.remove(), { once: true })
}
