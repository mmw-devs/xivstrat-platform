import assert from 'node:assert/strict'
import test from 'node:test'
import { Schema } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import { closeHistory, history, undo, redo } from '@tiptap/pm/history'
import { replacementTransaction } from './replacement.ts'
const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'inline*' },
    text: { group: 'inline' },
    hardBreak: { group: 'inline', inline: true },
  },
  marks: {
    bold: {},
    italic: {},
    underline: {},
    strike: {},
    link: { attrs: { href: {} }, inclusive: false },
    textStyle: { attrs: { color: {} } },
  },
})
test('individual proofreading transactions retain marks and form independent undo steps', () => {
  const marks = [
    schema.mark('bold'),
    schema.mark('italic'),
    schema.mark('underline'),
    schema.mark('strike'),
    schema.mark('link', { href: 'https://example.com' }),
    schema.mark('textStyle', { color: '#f87171' }),
  ]
  let state = EditorState.create({
    schema,
    plugins: [history()],
    doc: schema.node('doc', null, [
      schema.node('paragraph', null, [schema.text('H', marks), schema.text(' 提前远离人群。')]),
    ]),
  })
  const apply = (from: number, to: number, original: string, replacement: string) => {
    const tr = replacementTransaction(state, { from, to }, original, replacement)
    assert.ok(tr)
    state = state.apply(tr)
    state = state.apply(closeHistory(state.tr))
  }
  apply(1, 2, 'H', '奶妈')
  assert.deepEqual(state.doc.child(0).child(0).marks, marks)
  apply(8, 10, '人群', '队伍')
  assert.equal(state.doc.textContent, '奶妈 提前远离队伍。')
  assert.ok(
    undo(state, (tr) => {
      state = state.apply(tr)
    }),
  )
  assert.equal(state.doc.textContent, '奶妈 提前远离人群。')
  assert.ok(
    undo(state, (tr) => {
      state = state.apply(tr)
    }),
  )
  assert.equal(state.doc.textContent, 'H 提前远离人群。')
  assert.ok(
    redo(state, (tr) => {
      state = state.apply(tr)
    }),
  )
  assert.equal(state.doc.textContent, '奶妈 提前远离人群。')
})
test('mixed-format edits and stale originals are refused without changing the document', () => {
  const state = EditorState.create({
    schema,
    doc: schema.node('doc', null, [
      schema.node('paragraph', null, [schema.text('H', [schema.mark('bold')]), schema.text('1')]),
    ]),
  })
  assert.equal(replacementTransaction(state, { from: 1, to: 3 }, 'H1', '治疗'), null)
  assert.equal(replacementTransaction(state, { from: 1, to: 2 }, 'D', '奶妈'), null)
  assert.equal(state.doc.textContent, 'H1')
})
test('emoji replacement never splits a surrogate pair', () => {
  const state = EditorState.create({
    schema,
    doc: schema.node('doc', null, [schema.node('paragraph', null, [schema.text('😀 保留')])]),
  })
  const tr = replacementTransaction(state, { from: 1, to: 3 }, '😀', '😁')
  assert.ok(tr)
  assert.equal(state.apply(tr).doc.textContent, '😁 保留')
})

test('insertions use original-side marks at boundaries, including non-inclusive links and color', () => {
  const marks = [
    schema.mark('bold'),
    schema.mark('link', { href: 'https://example.com' }),
    schema.mark('textStyle', { color: '#f87171' }),
  ]
  for (const replacement of ['治疗H', 'H治疗']) {
    const state = EditorState.create({
      schema,
      doc: schema.node('doc', null, [
        schema.node('paragraph', null, [schema.text('A '), schema.text('H', marks), schema.text(' B')]),
      ]),
    })
    const tr = replacementTransaction(state, { from: 3, to: 4 }, 'H', replacement)
    assert.ok(tr)
    const paragraph = state.apply(tr).doc.child(0)
    assert.equal(paragraph.child(1).text, replacement)
    assert.deepEqual(paragraph.child(1).marks, marks)
    assert.equal(paragraph.child(0).text, 'A ')
    assert.equal(paragraph.child(2).text, ' B')
  }
})

test('middle insertion refuses incompatible marks, permits a uniform text run', () => {
  for (const rightMarks of [[], [schema.mark('bold')]]) {
    const state = EditorState.create({
      schema,
      doc: schema.node('doc', null, [
        schema.node('paragraph', null, [
          schema.text('H', [schema.mark('bold')]),
          schema.text('1', rightMarks),
        ]),
      ]),
    })
    const tr = replacementTransaction(state, { from: 1, to: 3 }, 'H1', 'H治疗1')
    if (!rightMarks.length) assert.ok(tr === null)
    else {
      assert.ok(tr)
      assert.equal(state.apply(tr).doc.child(0).child(0).text, 'H治疗1')
    }
  }
})
