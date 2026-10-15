import assert from 'node:assert/strict'
import test from 'node:test'
import { createEmptyStructure, structureToJson } from '@xivstrat/content-schema'
import { createDemo } from './demo.ts'
import { parseTemplate } from './import.ts'
test('empty and incomplete drafts round-trip without deleted fields', () => {
  for (const title of ['', '未完成草稿']) { const draft=createEmptyStructure();draft.metadata.title=title;assert.deepEqual(parseTemplate(structureToJson(draft)),draft) }
})
test('unrelated JSON, malformed structure and obsolete fields fail recognition', () => {
  for (const value of [{},null,[],{phases:[]},{metadata:{},phases:[]},{...createDemo(),schemaVersion:2},{...createDemo(),references:{}}]) assert.throws(()=>parseTemplate(JSON.stringify(value)))
  const draft=createDemo(); Object.assign(draft.metadata,{id:'old'});assert.throws(()=>parseTemplate(JSON.stringify(draft)))
})
test('richtext documents require stable ids; old text arrays are not migrated',()=>{
  const draft=createDemo();draft.phases[0].mechanics[0].sections[0].content=[{type:'text',value:['old']} as never]
  assert.throws(()=>parseTemplate(JSON.stringify(draft)))
})
