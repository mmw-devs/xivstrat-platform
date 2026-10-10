import { el, errorMessage, type ElementLookup } from '../ui/dom'
import { exportImagePackage } from './image-package'
import type { ImageAssets } from './image-assets'
import type { StrategyStructure } from '@xivstrat/content-schema'

export function mountImagePackage(byId: ElementLookup, collect: () => StrategyStructure, assets: ImageAssets, signal: AbortSignal) {
  const status = byId('package-save-status')
  const download = byId<HTMLButtonElement>('btn-save-package')
  download.addEventListener('click', () => { void save() }, { signal })
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
}
