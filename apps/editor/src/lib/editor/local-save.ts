import { structureToJson, type StrategyStructure } from '@xivstrat/content-schema'
import { errorMessage, type ElementLookup } from '../ui/dom'

/** Temporary local backup, independent of submission availability and validation. */
export function mountLocalSave(byId: ElementLookup, collect: () => StrategyStructure, signal: AbortSignal): void {
  byId('btn-save-local').addEventListener('click', () => {
    const status = byId('local-save-status')
    try {
      const structure = collect()
      const json = structureToJson(structure)
      const name = structure.metadata.id.replace(/[^a-z0-9-]/gi, '-').slice(0, 80) || 'strategy-draft'
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${name}.json`
      document.body.append(anchor)
      try {
        anchor.click()
        status.textContent = '已发起 JSON 下载，请确认文件已保存；后续修改需要再次保存。'
      } finally {
        anchor.remove()
        // Let the browser consume the object URL before releasing it.
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
    } catch (error) {
      status.textContent = `保存失败：${errorMessage(error)}`
    }
  }, { signal })
}
