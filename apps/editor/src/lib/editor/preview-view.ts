import { el, type ElementLookup } from '../ui/dom'
import { renderPreview } from './preview'
import type { createSnapshotCache } from './snapshot'

export function mountPreview(byId: ElementLookup, snapshot: ReturnType<typeof createSnapshotCache>['get'], loadDemo: () => void, signal: AbortSignal) {
  byId('btn-load-demo').addEventListener('click', loadDemo, { signal })
  return {
    render() {
      const { structure, errors } = snapshot()
      const list = byId('vlist')
      list.replaceChildren()
      byId('vbadge').replaceChildren(el('span', { class: errors.length ? 'err-badge' : 'ok-badge' }, errors.length ? `${errors.length} 个问题` : '✓ 全部通过（0 错误）'))
      if (errors.length) errors.forEach(error => list.append(el('li', { class: 'err' }, `❌ ${error}`)))
      else list.append(el('li', {}, '✅ 内容校验通过，可以提交审核'))
      renderPreview(structure, byId('preview'), loadDemo)
    },
  }
}
