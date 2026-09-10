import { replacementTransaction } from './replacement'
import { Mark } from '@tiptap/core'
import { Editor } from '@tiptap/react'
import Italic from '@tiptap/extension-italic'
import Underline from '@tiptap/extension-underline'
import Strike from '@tiptap/extension-strike'
import Link from '@tiptap/extension-link'
import { mountBodyToolbar } from './toolbar'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import HardBreak from '@tiptap/extension-hard-break'
import Bold from '@tiptap/extension-bold'
import { UndoRedo } from '@tiptap/extensions'
import { closeHistory, isHistoryTransaction } from '@tiptap/pm/history'
import {
  TEXT_COLORS,
  TEXT_SIZES,
  parseRichText,
  isSafeLinkHref,
  type RichTextDocument,
} from '@xivstrat/content-schema'

// Parse and render only the platform's style vocabulary, including pasted HTML.
const TextStyle = Mark.create({
  name: 'textStyle',
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const color = el.style.color
          const probe = document.createElement('span')
          return (
            TEXT_COLORS.find((value) => {
              probe.style.color = value
              return probe.style.color === color
            }) ?? null
          )
        },
      },
      fontSize: {
        default: null,
        parseHTML: (el: HTMLElement) =>
          (TEXT_SIZES as readonly string[]).includes(el.style.fontSize) ? el.style.fontSize : null,
      },
    }
  },
  parseHTML() {
    return [
      { tag: 'span', getAttrs: (element) => ((element as HTMLElement).hasAttribute('style') ? {} : false) },
    ]
  },
  renderHTML({ mark }) {
    const color = (TEXT_COLORS as readonly unknown[]).includes(mark.attrs.color) ? mark.attrs.color : ''
    const size = (TEXT_SIZES as readonly unknown[]).includes(mark.attrs.fontSize) ? mark.attrs.fontSize : ''
    return ['span', { style: `${color ? `color:${color};` : ''}${size ? `font-size:${size};` : ''}` }, 0]
  },
})
const SafeLink = Link.extend({
  addAttributes() {
    return { href: { default: null, parseHTML: (element: HTMLElement) => element.getAttribute('href') } }
  },
}).configure({
  openOnClick: false,
  autolink: false,
  linkOnPaste: true,
  isAllowedUri: (url) => isSafeLinkHref(url),
  HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
})
export interface BodyEditorHandle {
  getDocument(): RichTextDocument
  focusRange(paragraph: number, from: number, to: number): boolean
  replaceRange(paragraph: number, from: number, to: number, original: string, replacement: string): boolean
  insertText(text: string): void
  destroy(): void
}
export function createBodyEditor(
  host: HTMLElement,
  doc: RichTextDocument,
  onChange: (history: boolean) => void,
): BodyEditorHandle {
  const toolbar = document.createElement('div')
  toolbar.className = 'richtext-toolbar-root'
  const body = document.createElement('div')
  host.append(toolbar, body)
  const editor = new Editor({
    element: body,
    extensions: [
      Document,
      Paragraph,
      Text,
      HardBreak,
      Bold,
      Italic,
      Underline,
      Strike,
      SafeLink,
      TextStyle,
      UndoRedo,
    ],
    content: doc,
    editorProps: {
      attributes: {
        class: 'richtext-body',
        role: 'textbox',
        'aria-label': '攻略正文',
        'aria-multiline': 'true',
      },
    },
    onUpdate: ({ transaction }) => onChange(isHistoryTransaction(transaction)),
  })
  const toolbarRoot = mountBodyToolbar(toolbar, editor)
  const positions = (paragraph: number, from: number, to: number): { from: number; to: number } | null => {
    const node = editor.state.doc.maybeChild(paragraph)
    if (!node || from < 0 || to < from || to > node.content.size) return null
    let start = 1
    for (let i = 0; i < paragraph; i++) start += editor.state.doc.child(i).nodeSize
    return { from: start + from, to: start + to }
  }
  return {
    getDocument: () => parseRichText(editor.getJSON()),
    focusRange(paragraph, from, to) {
      const range = positions(paragraph, from, to)
      if (!range) return false
      host.scrollIntoView({ block: 'center', behavior: 'smooth' })
      return editor.chain().focus().setTextSelection(range).run()
    },
    replaceRange(paragraph, from, to, original, replacement) {
      const range = positions(paragraph, from, to)
      if (
        !range ||
        editor.state.doc.textBetween(range.from, range.to, '', '\n') !== original ||
        replacement.includes('\n')
      )
        return false
      const tr = replacementTransaction(editor.state, range, original, replacement)
      if (!tr) return false
      editor.view.dispatch(tr)
      editor.view.dispatch(closeHistory(editor.state.tr))
      return true
    },
    insertText(text) {
      editor.chain().focus().insertContent({ type: 'text', text }).run()
    },
    destroy() {
      toolbarRoot.unmount()
      editor.destroy()
      host.replaceChildren()
    },
  }
}
