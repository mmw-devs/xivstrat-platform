export const TEXT_SIZES = ['16px', '20px', '24px'] as const
export const TEXT_COLORS = ['#f87171', '#facc15', '#4ade80', '#60a5fa', '#c084fc'] as const
export type BasicTextMark = 'bold' | 'italic' | 'underline' | 'strike'
export type RichTextMark =
  | { type: BasicTextMark }
  | { type: 'link'; attrs: { href: string } }
  | { type: 'textStyle'; attrs: { color?: string; fontSize?: string } }
export type RichTextInline = { type: 'text'; text: string; marks?: RichTextMark[] } | { type: 'hardBreak' }
export interface RichTextDocument {
  type: 'doc'
  content: { type: 'paragraph'; content?: RichTextInline[] }[]
}
const BASIC_MARKS: readonly string[] = ['bold', 'italic', 'underline', 'strike']

export function isSafeLinkHref(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 2000 || /[\s\u0000-\u001f\u007f]/u.test(value))
    return false
  try {
    const url = new URL(value)
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) && !url.username && !url.password
  } catch {
    return false
  }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('富文本节点必须是对象')
  return value as Record<string, unknown>
}
function keys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error('富文本包含未知字段')
}
function parseMark(raw: unknown): RichTextMark {
  const mark = record(raw)
  if (typeof mark.type === 'string' && BASIC_MARKS.includes(mark.type)) {
    keys(mark, ['type'])
    return { type: mark.type as BasicTextMark }
  }
  keys(mark, ['type', 'attrs'])
  const attrs = record(mark.attrs)
  if (mark.type === 'link') {
    keys(attrs, ['href'])
    if (!isSafeLinkHref(attrs.href)) throw new Error('链接必须使用有效的 http、https 或 mailto 地址')
    return { type: 'link', attrs: { href: attrs.href } }
  }
  if (mark.type !== 'textStyle') throw new Error('不支持的正文格式')
  keys(attrs, ['color', 'fontSize'])
  if (attrs.color != null && !(TEXT_COLORS as readonly unknown[]).includes(attrs.color))
    throw new Error('不支持的正文颜色')
  if (attrs.fontSize != null && !(TEXT_SIZES as readonly unknown[]).includes(attrs.fontSize))
    throw new Error('不支持的正文字号')
  return {
    type: 'textStyle',
    attrs: {
      ...(attrs.color ? { color: attrs.color as string } : {}),
      ...(attrs.fontSize ? { fontSize: attrs.fontSize as string } : {}),
    },
  }
}
export function parseRichText(value: unknown): RichTextDocument {
  const doc = record(value)
  keys(doc, ['type', 'content'])
  if (doc.type !== 'doc' || !Array.isArray(doc.content) || !doc.content.length || doc.content.length > 5000)
    throw new Error('无效的富文本文档')
  let length = 0
  let nodes = 0
  const content = doc.content.map((raw) => {
    const p = record(raw)
    keys(p, ['type', 'content'])
    if (p.type !== 'paragraph' || (p.content !== undefined && !Array.isArray(p.content)))
      throw new Error('只支持普通段落')
    const children = (p.content ?? []) as unknown[]
    const inline = children.map((raw): RichTextInline => {
      if (++nodes > 20000) throw new Error('正文节点过多')
      const node = record(raw)
      if (node.type === 'hardBreak') {
        keys(node, ['type'])
        return { type: 'hardBreak' }
      }
      keys(node, ['type', 'text', 'marks'])
      if (node.type !== 'text' || typeof node.text !== 'string' || !node.text.length)
        throw new Error('无效的正文节点')
      length += node.text.length
      if (length > 200000) throw new Error('正文块过长')
      if (node.marks !== undefined && (!Array.isArray(node.marks) || node.marks.length > 6))
        throw new Error('无效的正文格式')
      const seen = new Set<string>()
      const marks = ((node.marks ?? []) as unknown[])
        .map((raw) => {
          const mark = parseMark(raw)
          if (seen.has(mark.type)) throw new Error('重复正文格式')
          seen.add(mark.type)
          return mark
        })
        .filter((mark) => mark.type !== 'textStyle' || Object.keys(mark.attrs).length)
      return { type: 'text', text: node.text, ...(marks.length ? { marks } : {}) }
    })
    return { type: 'paragraph' as const, ...(inline.length ? { content: inline } : {}) }
  })
  return { type: 'doc', content }
}
export function plainTextDocument(lines: string[]): RichTextDocument {
  return {
    type: 'doc',
    content: (lines.length ? lines : ['']).map((text) => ({
      type: 'paragraph',
      ...(text ? { content: [{ type: 'text', text }] } : {}),
    })),
  }
}
export function richTextLines(doc: RichTextDocument): string[] {
  return doc.content.map((p) => (p.content ?? []).map((n) => (n.type === 'text' ? n.text : '\n')).join(''))
}
export function renderRichText(
  doc: RichTextDocument,
  astro = false,
  highlight?: { paragraph: number; from: number; to: number },
): string {
  const escape = (s: string): string =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\{/g, astro ? '&#123;' : '{')
      .replace(/\}/g, astro ? '&#125;' : '}')
  const tags: Record<BasicTextMark, string> = { bold: 'strong', italic: 'em', underline: 'u', strike: 's' }
  return parseRichText(doc)
    .content.map((p, paragraph) => {
      let offset = 0
      const inline = (p.content ?? [])
        .map((n) => {
          if (n.type === 'hardBreak') {
            offset++
            return '<br />'
          }
          let html = escape(n.text)
          if (highlight?.paragraph === paragraph) {
            const from = Math.max(0, highlight.from - offset)
            const to = Math.min(n.text.length, highlight.to - offset)
            if (from < to)
              html = `${escape(n.text.slice(0, from))}<mark class="proofread-highlight">${escape(n.text.slice(from, to))}</mark>${escape(n.text.slice(to))}`
          }
          offset += n.text.length
          for (const mark of n.marks ?? []) {
            if (mark.type === 'textStyle') {
              const style = `${mark.attrs.color ? `color:${mark.attrs.color};` : ''}${mark.attrs.fontSize ? `font-size:${mark.attrs.fontSize};` : ''}`
              html = `<span style="${style}">${html}</span>`
            } else if (mark.type === 'link') {
              const href = escape(mark.attrs.href).replace(/"/g, '&quot;').replace(/'/g, '&#39;')
              html = `<a href="${href}" target="_blank" rel="noopener noreferrer">${html}</a>`
            } else {
              const tag = tags[mark.type]
              html = `<${tag}>${html}</${tag}>`
            }
          }
          return html
        })
        .join('')
      return `<div class="paragraph" style="white-space:pre-wrap;min-height:1.6em">${inline}</div>`
    })
    .join('\n')
}
