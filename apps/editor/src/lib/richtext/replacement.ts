import { Mark } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'

export function replacementTransaction(
  state: EditorState,
  range: { from: number; to: number },
  original: string,
  replacement: string,
): Transaction | null {
  if (state.doc.textBetween(range.from, range.to, '', '\n') !== original || replacement.includes('\n'))
    return null
  // Preserve unchanged prefix/suffix and reject changes spanning incompatible marks.
  let left = 0
  let right = 0
  while (left < original.length && left < replacement.length && original[left] === replacement[left]) left++
  while (
    right < original.length - left &&
    right < replacement.length - left &&
    original[original.length - 1 - right] === replacement[replacement.length - 1 - right]
  )
    right++
  // Do not split UTF-16 surrogate pairs.
  if (left && /[\uD800-\uDBFF]/.test(original[left - 1]!)) left--
  if (right && /[\uDC00-\uDFFF]/.test(original[original.length - right]!)) right--
  const start = range.from + left
  const end = range.to - right
  const markSets: string[] = []
  let marks: readonly Mark[] = []
  if (start === end) {
    // Inherit from the original span, never its outside neighbour. At an
    // interior boundary both sides must agree, including link/color attrs.
    const position = state.doc.resolve(start)
    const before = position.nodeBefore
    const after = position.nodeAfter
    const source = start === range.from ? after : start === range.to ? before : null
    if (source) {
      if (!source.isText) return null
      marks = source.marks
    } else {
      if (!before?.isText || !after?.isText || !Mark.sameSet(before.marks, after.marks)) return null
      marks = before.marks
    }
  }
  let unsupported = false
  if (start !== end)
    state.doc.nodesBetween(start, end, (node) => {
      if (node.isText) {
        marks = node.marks
        markSets.push(JSON.stringify(node.marks.map((mark) => mark.toJSON())))
      } else if (node.isLeaf) unsupported = true
    })
  if (unsupported || new Set(markSets).size > 1) return null
  const text = replacement.slice(left, replacement.length - right)
  const tr = closeHistory(state.tr)
  if (text) tr.replaceWith(start, end, state.schema.text(text, marks))
  else tr.delete(start, end)
  return tr
}
