import { renderRichText, type StrategyStructure } from '@xivstrat/content-schema'
import { snapshotBlocks, snapshotLabel } from './contracts'
import type { BodyEditorHandle } from '../richtext/editor'
import { el } from '../ui/dom'
export interface ReadingHighlight { blockId: string; paragraph: number; from: number; to: number }
export function renderReading(host: HTMLElement, structure: StrategyStructure, find: (id: string) => BodyEditorHandle | undefined, highlight?: ReadingHighlight): void {
  host.replaceChildren()
  for (const snapshot of snapshotBlocks(structure)) {
    const handle = find(snapshot.blockId)
    if (!handle) continue
    const article = el('article', { class: 'card proofread-body', 'data-reading-block': snapshot.blockId }, el('h3', {}, snapshotLabel(snapshot.path)))
    const body = el('div', { class: 'proofread-prose' })
    body.innerHTML = renderRichText(handle.getDocument(), highlight?.blockId === snapshot.blockId ? highlight : undefined)
    article.append(body)
    host.append(article)
    if (highlight?.blockId === snapshot.blockId) article.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
  if (!host.childElementCount) host.append(el('p', { class: 'hint' }, '还没有正文，请先在第③步填写阶段与机制。'))
}
