import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeStructure } from '@xivstrat/content-schema'
import { createProofreadPanel } from './panel.ts'

// Only the DOM operations used by this panel: state/collection regression tests,
// not a substitute for browser rendering or Tiptap integration tests.
class ElementDouble extends EventTarget {
  children: ElementDouble[] = []
  textContent = ''
  className = ''
  value = ''
  disabled = false
  setAttribute() {}
  append(...children: ElementDouble[]) {
    this.children.push(...children)
  }
  replaceChildren(...children: ElementDouble[]) {
    this.children = children
  }
  descendants(): ElementDouble[] {
    return [this, ...this.children.flatMap((child) => child.descendants())]
  }
  click() {
    if (!this.disabled) this.dispatchEvent(new Event('click'))
  }
}

test('panel invalidates accepted cards after undo even if already expired; render collects once', async (t) => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: () => new ElementDouble() },
  })
  t.after(() => {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument)
    else Reflect.deleteProperty(globalThis, 'document')
  })
  const structure = normalizeStructure({
    phases: [
      { mechanics: [{ sections: [{ type: 'note', content: [{ type: 'text', value: ['H 提前'] }] }] }] },
    ],
  })
  let collections = 0
  const host = new ElementDouble()
  const panel = createProofreadPanel(
    host as unknown as HTMLElement,
    () => {
      collections++
      return structure
    },
    () => ({
      replaceRange: () => true,
      getDocument: () => ({ type: 'doc', content: [{ type: 'paragraph' }] }),
      focusRange: () => true,
      insertText() {},
      destroy() {},
    }),
    () => {},
  )
  t.after(() => panel.destroy())
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const request = JSON.parse(String(init.body))
    return Response.json({
      requestId: request.requestId,
      snapshotId: request.snapshotId,
      suggestions: Array.from({ length: 100 }, () => ({
        blockId: request.blocks[0].blockId,
        paragraphId: 'p-0',
        kind: 'terminology',
        action: 'replace',
        original: 'H',
        replacement: '奶妈',
        prefix: '',
        suffix: ' 提前',
        reason: '测试',
      })),
    })
  })
  const byText = (text: string) => host.descendants().find((node) => node.textContent === text)!
  byText('AI 校对全文').click()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(host.descendants().filter((node) => node.className === 'proofread-suggestion').length, 100)
  collections = 0
  byText('忽略').click()
  assert.equal(collections, 1, 'one full snapshot per render, regardless of suggestion count')
  // Start a new round because ignoring the only applicable overlap winner disables acceptance.
  byText('AI 校对全文').click()
  await new Promise((resolve) => setImmediate(resolve))
  byText('接受').click()
  assert.ok(byText('已接受'))
  const terms = host.children[1]!
  terms.value = '变更术语'
  terms.dispatchEvent(new Event('input'))
  assert.ok(byText('已接受'), 'ordinary invalidation retains historical acceptance')
  panel.changed(true)
  assert.equal(byText('已接受'), undefined, 'undo invalidates accepted even after earlier expiration')
  assert.ok(byText('已过期'))
  panel.changed(true)
  assert.equal(byText('已接受'), undefined, 'redo must not claim acceptance was revalidated')
})
