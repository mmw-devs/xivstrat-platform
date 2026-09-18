import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeStructure, structureToJson } from '@xivstrat/content-schema'
import { parseTemplate } from './import.ts'

test('incomplete and completely empty canonical drafts can be saved and imported', () => {
  for (const metadata of [{ title: '未完成草稿' }, {}]) {
    const draft = normalizeStructure({ metadata, phases: [] })
    assert.deepEqual(parseTemplate(structureToJson(draft)), draft)
  }
})

test('unrelated phases and malformed metadata are rejected before normalization supplies defaults', () => {
  for (const value of [
    {}, null, [], { phases: null }, { phases: [] }, { foo: '无关数据', phases: [] },
    { schemaVersion: 2, phases: [] },
    ...[null, [], 'metadata', {}, { foo: 'bar' }, { title: '缺少标识字段' },
      { id: 12, name: '', title: '' }].map(metadata => ({ metadata, phases: [] })),
    { metadata: { id: '', name: '', title: '' }, phases: [], references: {} },
    { metadata: { id: '', name: '', title: '' }, phases: [], macros: null },
  ]) assert.throws(() => parseTemplate(JSON.stringify(value)), JSON.stringify(value))
  assert.throws(() => parseTemplate(''))
})

test('legacy unversioned and v1 strategy exports still migrate their plain text bodies', () => {
  for (const schemaVersion of [undefined, 1]) {
    const legacy = { schemaVersion, metadata: { id: 'legacy', name: '旧副本', title: '旧攻略' }, phases: [
      { id: 'p1', name: '阶段', mechanics: [{ id: 'm1', name: '机制', sections: [
        { type: 'note', content: [{ type: 'text', value: ['旧版正文'] }] },
      ] }] },
    ] }
    const parsed = parseTemplate(JSON.stringify(legacy))
    assert.equal(parsed.schemaVersion, 2)
    const block = parsed.phases[0].mechanics[0].sections[0].content[0]
    assert.equal(block.type, 'text')
    if (block.type === 'text') assert.equal(block.doc.content[0].content?.[0].type, 'text')
    assert.match(structureToJson(parsed), /旧版正文/)
  }
})
