import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeStructure, validateStructure, SECTION_RULES } from '@xivstrat/content-schema'
import { createOrderedList } from './ordered-list.ts'
import { createSnapshotCache } from './snapshot.ts'

test('nested list order changes without rebuilding live body handles', () => {
  const list = createOrderedList<{ id: string; history: string[] }>()
  const text = { id: 'text', history: ['edit', 'undo'] }
  const image = { id: 'image', history: [] }
  const note = { id: 'note', history: [] }
  list.add(text); list.add(image); list.add(note)
  assert.equal(list.move(note, -1), true)
  assert.equal(list.move(note, -1), true)
  assert.deepEqual(list.values().map(item => item.id), ['note', 'text', 'image'])
  assert.equal(list.values()[1], text)
  assert.deepEqual(text.history, ['edit', 'undo'])
  assert.equal(list.move(note, -1), false)
  assert.equal(list.remove(text), true)
  assert.equal(list.remove(text), false)
  assert.equal(list.move(text, 1), false)
  assert.deepEqual(list.values().map(item => item.id), ['note', 'image'])
})
test('consumers cannot mutate list order through a returned array', () => {
  const list = createOrderedList<string>()
  list.add('a'); list.add('b')
  const copy = list.values() as string[]
  copy.reverse(); copy.push('c')
  assert.deepEqual(list.values(), ['a', 'b'])
})
test('preview caches content and validation until an edit invalidates it', () => {
  let reads = 0
  let source = normalizeStructure({ metadata: { id: 'first' } })
  const cache = createSnapshotCache(() => { reads++; return structuredClone(source) })
  cache.invalidate(); cache.invalidate()
  assert.equal(reads, 0)
  const first = cache.get()
  assert.equal(cache.get(), first)
  assert.equal(reads, 1)
  source.metadata.id = 'second'
  cache.invalidate()
  assert.equal(reads, 1)
  const second = cache.get()
  assert.equal(reads, 2)
  assert.equal(first.structure.metadata.id, 'first')
  assert.equal(second.structure.metadata.id, 'second')
})
test('section title validation uses the same business rules as editing and preview', () => {
  for (const type of ['mechanic', 'solution', 'note'] as const) {
    const structure = normalizeStructure({ phases: [{ id: 'p1', name: '阶段', mechanics: [{ id: 'm', name: '机制', sections: [{ type, title: '', content: [{ type: 'text', value: ['正文'] }] }] }] }] })
    const errors = validateStructure(structure)
    const titleErrors = errors.filter(error => error.includes('标题'))
    // Metadata has its own missing title; compare the section path only.
    assert.equal(titleErrors.some(error => error.includes('阶段')), SECTION_RULES[type].titleRequired)
  }
})
