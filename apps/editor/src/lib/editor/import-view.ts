import { errorMessage, type ElementLookup } from '../ui/dom'
import { parseTemplate } from './import'
import { importImagePackage } from './image-package'
import { createImageAssets, type ImageAssets } from './image-assets'
import type { StrategyStructure } from '@xivstrat/content-schema'

export function mountImport(byId: ElementLookup, replace: (value: StrategyStructure) => void, assets: ImageAssets, signal: AbortSignal) {
  const input = byId<HTMLInputElement>('import-file')
  const choose = byId<HTMLButtonElement>('btn-choose-import')
  const confirm = byId<HTMLButtonElement>('btn-confirm-import')
  const filename = byId('import-filename')
  const status = byId('import-status')
  let selected: File | undefined
  choose.addEventListener('click', () => input.click(), { signal })
  input.addEventListener('change', () => {
    const file = input.files?.[0]
    if (!file) return
    selected = file
    filename.textContent = file.name
    status.textContent = ''
    confirm.disabled = false
    input.value = ''
  }, { signal })
  confirm.addEventListener('click', () => { void run() }, { signal })
  async function run() {
    const file = selected
    if (!file || confirm.disabled) return
    choose.disabled = confirm.disabled = input.disabled = true
    confirm.textContent = '正在校验…'
    const staged = createImageAssets()
    try {
      const extension = file.name.split('.').at(-1)?.toLowerCase()
      let structure: StrategyStructure
      if (extension === 'zip') {
        const result = await importImagePackage(file)
        structure = result.structure
        for (const blob of result.images) await staged.add(blob)
      } else if (extension === 'json') {
        if (file.size > 1024 * 1024) throw new Error('JSON 文件超过 1 MiB')
        structure = parseTemplate(await file.text())
      } else throw new Error('请选择 JSON 或 ZIP 文件')
      if (signal.aborted) return
      // Validate the complete input before replacing either content or assets.
      if (extension === 'zip') assets.replaceFrom(staged)
      replace(structure)
      if (extension === 'zip') status.textContent = '攻略包导入成功，图片已恢复到当前页面。'
      selected = undefined
      filename.textContent = '未选择文件'
    } catch (error) {
      if (!signal.aborted) status.textContent = `导入失败：${errorMessage(error)}`
    } finally {
      staged.clear()
      choose.disabled = input.disabled = false
      confirm.disabled = !selected
      confirm.textContent = '确认导入'
    }
  }
}
