import { richTextLines, type StrategyStructure, type StrategyMechanic } from '@xivstrat/content-schema'
export interface SnapshotBlock {
  blockId: string
  path: string[]
  paragraphs: { paragraphId: string; text: string }[]
}
export interface ProofreadRequest {
  requestId: string
  snapshotId: string
  terminology: string
  blocks: SnapshotBlock[]
}
export interface ModelSuggestion {
  blockId: string
  paragraphId: string
  kind: 'grammar' | 'terminology' | 'reference'
  action: 'replace' | 'review'
  original: string
  replacement: string | null
  prefix: string
  suffix: string
  reason: string
}
export interface Suggestion extends ModelSuggestion {
  id: string
  from: number
  to: number
  status: 'pending' | 'accepted' | 'ignored' | 'stale'
  applicable: boolean
  note: string
}
export function snapshotBlocks(structure: StrategyStructure): SnapshotBlock[] {
  const blocks: SnapshotBlock[] = []
  const visit = (mechanic: StrategyMechanic, path: string[]): void => {
    const current = [...path, mechanic.id, mechanic.name]
    mechanic.sections.forEach((section) =>
      section.content.forEach((block) => {
        if (block.type === 'text')
          blocks.push({
            blockId: block.id,
            path: [...current, section.type, section.title],
            paragraphs: richTextLines(block.doc).map((text, i) => ({ paragraphId: `p-${i}`, text })),
          })
      }),
    )
    mechanic.sub_mechanics.forEach((child) => visit(child, current))
  }
  structure.phases.forEach((phase) =>
    phase.mechanics.forEach((mechanic) => visit(mechanic, [phase.id, phase.name])),
  )
  return blocks
}
export function parseRequest(raw: unknown): ProofreadRequest {
  if (!raw || typeof raw !== 'object') throw new Error('校对请求必须是对象')
  const request = raw as ProofreadRequest
  if (
    typeof request.requestId !== 'string' ||
    request.requestId.length > 100 ||
    typeof request.snapshotId !== 'string' ||
    request.snapshotId.length > 100 ||
    typeof request.terminology !== 'string' ||
    request.terminology.length > 2000 ||
    !Array.isArray(request.blocks) ||
    request.blocks.length > 500
  )
    throw new Error('校对请求格式不正确')
  const ids = new Set<string>()
  for (const b of request.blocks) {
    if (
      !b ||
      typeof b.blockId !== 'string' ||
      !b.blockId ||
      b.blockId.length > 100 ||
      ids.has(b.blockId) ||
      !Array.isArray(b.path) ||
      b.path.length > 100 ||
      b.path.some((s) => typeof s !== 'string' || s.length > 500) ||
      !Array.isArray(b.paragraphs) ||
      b.paragraphs.length > 5000
    )
      throw new Error('校对正文结构不正确')
    ids.add(b.blockId)
    b.paragraphs.forEach((p, i) => {
      if (!p || p.paragraphId !== `p-${i}` || typeof p.text !== 'string')
        throw new Error('校对段落格式不正确')
    })
  }
  if (JSON.stringify(request).length > 60000)
    throw new Error('全文超过校对预算（60000 字符），未发送或截断正文')
  return {
    requestId: request.requestId,
    snapshotId: request.snapshotId,
    terminology: request.terminology,
    blocks: request.blocks.map((b) => ({
      blockId: b.blockId,
      path: b.path,
      paragraphs: b.paragraphs.map((p) => ({ paragraphId: p.paragraphId, text: p.text })),
    })),
  }
}
export function resolveSuggestions(raw: unknown, blocks: SnapshotBlock[]): Suggestion[] {
  if (!Array.isArray(raw) || raw.length > 100) throw new Error('校对响应必须是最多 100 条建议的数组')
  const suggestions = raw.map((value, index): Suggestion => {
    if (!value || typeof value !== 'object') throw new Error('建议格式不正确')
    const s = value as ModelSuggestion
    for (const key of ['blockId', 'paragraphId', 'original', 'prefix', 'suffix', 'reason'] as const) {
      if (typeof s[key] !== 'string' || s[key].length > 2000) throw new Error('建议字段格式不正确')
    }
    if (
      !['grammar', 'terminology', 'reference'].includes(s.kind) ||
      !['replace', 'review'].includes(s.action) ||
      !s.original ||
      !s.reason ||
      (s.replacement !== null && (typeof s.replacement !== 'string' || s.replacement.length > 2000)) ||
      (s.action === 'replace' && s.replacement === null)
    )
      throw new Error('建议内容不正确')
    const paragraph = blocks
      .find((b) => b.blockId === s.blockId)
      ?.paragraphs.find((p) => p.paragraphId === s.paragraphId)
    if (!paragraph) throw new Error('建议引用了不存在的正文或段落')
    const positions: number[] = []
    for (
      let at = paragraph.text.indexOf(s.original);
      at !== -1;
      at = paragraph.text.indexOf(s.original, at + 1)
    ) {
      if (
        paragraph.text.slice(0, at).endsWith(s.prefix) &&
        paragraph.text.slice(at + s.original.length).startsWith(s.suffix)
      )
        positions.push(at)
    }
    const from = positions.length === 1 ? positions[0]! : -1
    const applicable =
      from >= 0 && s.action === 'replace' && !s.replacement?.includes('\n') && s.replacement !== s.original
    return {
      blockId: s.blockId,
      paragraphId: s.paragraphId,
      kind: s.kind,
      action: s.action,
      original: s.original,
      replacement: s.replacement,
      prefix: s.prefix,
      suffix: s.suffix,
      reason: s.reason,
      id: `suggestion-${index}`,
      from,
      to: from + s.original.length,
      status: 'pending',
      applicable,
      note: from < 0 ? '原文无法唯一定位，请手动检查' : '',
    }
  })
  suggestions.forEach((s, i) => {
    if (s.from < 0) return
    if (
      suggestions
        .slice(0, i)
        .some(
          (other) =>
            other.blockId === s.blockId &&
            other.paragraphId === s.paragraphId &&
            other.from < s.to &&
            s.from < other.to,
        )
    ) {
      s.applicable = false
      s.note = '与其他建议重叠，请手动检查'
    }
  })
  return suggestions
}
export function rebaseSuggestions(suggestions: Suggestion[], accepted: Suggestion): void {
  const delta = (accepted.replacement ?? '').length - accepted.original.length
  for (const s of suggestions) {
    if (
      s === accepted ||
      s.status !== 'pending' ||
      s.blockId !== accepted.blockId ||
      s.paragraphId !== accepted.paragraphId ||
      s.from < 0
    )
      continue
    // Prefix/suffix are semantic evidence, not only locator offsets.
    const contextFrom = s.from - s.prefix.length
    const contextTo = s.to + s.suffix.length
    if (contextFrom < accepted.to && accepted.from < contextTo) {
      s.status = 'stale'
      s.note = '原文或定位上下文已修改，请重新校对'
    } else if (s.from >= accepted.to) {
      s.from += delta
      s.to += delta
    }
  }
}

export function snapshotLabel(path: string[]): string {
  const labels: Record<string, string> = { mechanic: '机制', solution: '解法', note: '注意' }
  return [
    path.slice(0, 2).filter(Boolean).join(' · '),
    ...path.slice(2, -2).filter((_part, i) => i % 2 === 1),
    labels[path.at(-2) ?? ''] ?? '',
    path.at(-1) ?? '',
  ]
    .filter(Boolean)
    .join(' / ')
}
