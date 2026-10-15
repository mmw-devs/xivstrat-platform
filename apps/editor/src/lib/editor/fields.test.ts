import assert from 'node:assert/strict'
import test from 'node:test'
import { createEmptyStructure, normalizeStructure, validateStructure, structureToJson, stampOperation, parsePhaseName, isValidDutyName, normalizeDutyName, plainTextDocument } from '@xivstrat/content-schema'
import { createDemo } from './demo.ts'

test('duty identifiers enforce category, lowercase, punctuation and explicit space conversion', () => {
  for (const name of ['o4s','p8s','e12s','m1s']) assert.ok(isValidDutyName(name,'savage'), name)
  for (const name of ['m0s','m13s','m01s','M1s','ab1s','m1s\n']) assert.ok(!isValidDutyName(name,'savage'), name)
  for (const type of ['extreme','ultimate','other'] as const) {
    assert.ok(isValidDutyName('the-epic-of-alexander',type))
    for (const name of ['The-name','name2','a--b','-name','name-','name\u3000name',"kings-fall's",'con']) assert.ok(!isValidDutyName(name,type),name)
    assert.equal(normalizeDutyName('the epic of alexander',type),'the-epic-of-alexander')
  }
  assert.equal(normalizeDutyName(' m1s','savage'),' m1s')
})
test('phases parse numerically, allow only half steps and Chinese titles', () => {
  for (let n=.5;n<=10.5;n+=.5) assert.equal(parsePhaseName(`p${n}`)?.number,n)
  assert.equal(parsePhaseName('p1.5-转场（甲），乙·丙、丁')?.title,'转场（甲），乙·丙、丁')
  for (const name of ['p0','p11','p11.5','p01','p1.0','p1.2','p1-','p1-abc','p1-甲1','p1-（）','p1 -甲','P1']) assert.equal(parsePhaseName(name),null,name)
  const draft=createEmptyStructure()
  draft.phases=['p10','p','p2','p0.5','p1.5-转场','未完成'].map(name=>({name,mechanics:[]}))
  assert.deepEqual(normalizeStructure(draft).phases.map(p=>p.name),['p0.5','p1.5-转场','p2','p10','p','未完成'])
  assert.deepEqual(draft.phases.map(p=>p.name),['p10','p','p2','p0.5','p1.5-转场','未完成'])
})
test('phase number uniqueness and recursive mechanism uniqueness have distinct scopes', () => {
  const s=createDemo(), m=s.phases[0]!.mechanics[0]!
  m.sub_mechanics=[{name:m.name,sections:[],sub_mechanics:[]}]
  assert.ok(validateStructure(s).some(e=>e.includes('在本阶段重复')))
  m.sub_mechanics[0]!.name='OTHER'
  m.sub_mechanics.push({name:'other',sections:[],sub_mechanics:[]})
  assert.ok(!validateStructure(s).some(e=>e.includes('在本阶段重复')))
  s.phases.push({name:'p2',mechanics:[{name:m.name,sections:[],sub_mechanics:[]}]})
  assert.ok(!validateStructure(s).some(e=>e.includes('在本阶段重复')))
  s.phases[1]!.name='p1-另一个标题'
  assert.ok(validateStructure(s).some(e=>e.includes('阶段编号 1 重复')))
})
test('ordinary strings report Unicode whitespace and controls without silently trimming', () => {
  for (const ch of [' ','\n','\t','\u00a0','\u3000','\u200b','\ufeff','\u0000']) {
    const s=createDemo(); s.metadata.title=`甲${ch}乙`
    assert.ok(validateStructure(s).some(e=>e.includes('metadata.title')&&e.includes('Unicode')),JSON.stringify(ch))
    assert.equal(normalizeStructure(s).metadata.title,s.metadata.title)
  }
  const s=createDemo(); s.macros[0]!.code=' /p hello\tworld\n\u3000'
  const b=s.phases[0]!.mechanics[0]!.sections[0]!.content[0]!
  if(b.type!=='text') throw new Error('fixture')
  b.doc=plainTextDocument([' 正文\t空格','第二行'])
  assert.deepEqual(validateStructure(s),[])
  assert.deepEqual(JSON.parse(structureToJson(s)),s)
})
test('draft roundtrip preserves unfinished values, stable ids and macro originals', () => {
  const s=createDemo(); s.phases[0]!.name='p'; s.metadata.title='';s.metadata.name=''
  const time=new Date('2026-10-03T08:01:02.003Z')
  const saved=stampOperation(s,time)
  assert.equal(saved.metadata.publish_time,time.toISOString())
  assert.equal(s.metadata.publish_time,'')
  assert.deepEqual(normalizeStructure(JSON.parse(structureToJson(saved))),saved)
  assert.ok(validateStructure(saved).length>0)
  assert.equal(stampOperation(saved,new Date('2026-10-04T00:00:00Z')).metadata.publish_time,'2026-10-04T00:00:00.000Z')
})
test('removed fields are rejected instead of silently discarded at every level', () => {
  for(const key of ['id','short_name','description','team']) {
    const s=createDemo(); Object.assign(s.metadata,{[key]:'old'})
    assert.throws(()=>normalizeStructure(s),new RegExp(`metadata.${key}`))
  }
  const s=createDemo(); Object.assign(s.phases[0],{id:'p1'})
  assert.throws(()=>normalizeStructure(s),/不支持的字段/)
  const m=createDemo();Object.assign(m.phases[0]!.mechanics[0],{id:'old'})
  assert.throws(()=>normalizeStructure(m),/不支持的字段/)
  assert.throws(()=>normalizeStructure({...createDemo(),schemaVersion:2}),/schemaVersion/)
})
test('unsafe references fail draft import, optional fields still validate when populated', () => {
  for(const file of ['../secret','images/%2e%2e/secret','javascript:alert(1)','//host/file','a\\b','data:image/png;base64,a']) {
    const s=createDemo();s.metadata.banner=file
    assert.throws(()=>normalizeStructure(s),/不安全/)
  }
  const s=createDemo();s.metadata.video='relative/video';s.references[0]!.url='relative/ref'
  assert.ok(validateStructure(s).some(e=>e.includes('metadata.video')))
  assert.ok(validateStructure(s).some(e=>e.includes('references[0].url')))
  s.metadata.status='review';assert.ok(validateStructure(s).some(e=>e.includes('status')))
})

test('richtext link attributes do not inherit the body whitespace exception',()=>{
  for(const character of ['\u0085','\u200b','\ufeff','\u0000']) {
    const s=createDemo(), b=s.phases[0]!.mechanics[0]!.sections[0]!.content[0]!
    if(b.type!=='text')throw new Error('fixture')
    b.doc={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'链接',marks:[{type:'link',attrs:{href:`https://example.com/${character}path`}}]}]}]}
    assert.throws(()=>normalizeStructure(s),/链接/)
  }
})
