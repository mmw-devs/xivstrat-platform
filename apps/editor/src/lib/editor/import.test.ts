import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeStructure, structureToJson } from '@xivstrat/content-schema'
import { parseTemplate } from './import.ts'

test('incomplete canonical drafts including zero phases can be saved and imported', () => {
  const draft = normalizeStructure({ metadata: { title: '未完成草稿' }, phases: [] })
  assert.deepEqual(parseTemplate(structureToJson(draft)), draft)
})

test('unrelated or empty JSON cannot replace the editor as an empty draft', () => {
  for (const source of ['', '{}', 'null', '[]', '{"phases":null}']) assert.throws(() => parseTemplate(source))
})
