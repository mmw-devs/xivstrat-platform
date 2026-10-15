import { parseRichText, richTextLines } from './richtext.ts'
import { DUTY_TYPES, SECTION_RULES, SECTION_TYPES, STRATEGY_STATUSES, type StrategyStructure, type StrategyMetadata, type StrategyMechanic, type StrategyPhase, type StrategySection, type ContentBlock } from './types.ts'
import { FORBIDDEN_CHARACTERS, hasUnsafeReference, isHttpUrl, isImageReference, isValidDutyName, normalizeDutyName, parsePhaseName, sortPhases } from './rules.ts'

type RecordValue = Record<string, unknown>
function object(value: unknown, path: string, keys: string[]): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path}：必须是对象`)
  const result = value as RecordValue
  for (const key of Object.keys(result)) if (!keys.includes(key)) throw new Error(`${path}.${key}：不支持的字段`)
  return result
}
function string(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new Error(`${path}：必须是字符串`)
  return value
}
function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path}：必须是数组`)
  return value
}
function member<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new Error(`${path}：无效的枚举值`)
  return value as T
}
function reference(value: unknown, path: string): string {
  const result = string(value, path)
  if (result && hasUnsafeReference(result)) throw new Error(`${path}：不安全的路径或协议`)
  return result
}
export function createEmptyStructure(): StrategyStructure {
  return { metadata: { name: '', type: '', title: '', banner: '', publish_time: '', status: 'draft', video: '' }, references: [], macros: [], phases: [] }
}
/** Strict single-contract parser. Empty scalar values are drafts, malformed shapes are not. */
export function normalizeStructure(raw: unknown): StrategyStructure {
  const root = object(raw, '$', ['metadata', 'references', 'macros', 'phases'])
  const m = object(root.metadata, 'metadata', ['name','type','title','banner','publish_time','status','video'])
  const type = member(m.type, ['', ...DUTY_TYPES], 'metadata.type')
  const metadata: StrategyMetadata = {
    name: normalizeDutyName(string(m.name, 'metadata.name'), type), type,
    title: string(m.title, 'metadata.title'), banner: reference(m.banner, 'metadata.banner'),
    publish_time: string(m.publish_time, 'metadata.publish_time'),
    status: member(m.status, STRATEGY_STATUSES, 'metadata.status'), video: reference(m.video, 'metadata.video'),
  }
  const seen = new Set<string>()
  function content(value: unknown, path: string): ContentBlock {
    const block = object(value, path, ['type','id','doc','file','caption'])
    if (block.type === 'image') {
      object(value, path, ['type','file','caption'])
      return { type: 'image', file: reference(block.file, `${path}.file`), caption: string(block.caption, `${path}.caption`) }
    }
    object(value, path, ['type','id','doc'])
    if (block.type !== 'text') throw new Error(`${path}.type：内容必须是 text 或 image`)
    const id = string(block.id, `${path}.id`)
    if (!id || id.length > 100 || FORBIDDEN_CHARACTERS.test(id)) throw new Error(`${path}.id：正文缺少有效 id`)
    if (seen.has(id)) throw new Error(`${path}.id：正文 id 重复`)
    seen.add(id)
    return { type: 'text', id, doc: parseRichText(block.doc) }
  }
  function section(value: unknown, path: string): StrategySection {
    const s = object(value, path, ['type','title','content'])
    return { type: member(s.type, SECTION_TYPES, `${path}.type`), title: string(s.title, `${path}.title`), content: array(s.content, `${path}.content`).map((v,i) => content(v, `${path}.content[${i}]`)) }
  }
  function mechanic(value: unknown, path: string, depth: number): StrategyMechanic {
    if (depth > 64) throw new Error(`${path}：机制嵌套过深`)
    const m = object(value, path, ['name','sections','sub_mechanics'])
    return { name: string(m.name, `${path}.name`), sections: array(m.sections, `${path}.sections`).map((v,i) => section(v, `${path}.sections[${i}]`)), sub_mechanics: array(m.sub_mechanics, `${path}.sub_mechanics`).map((v,i) => mechanic(v, `${path}.sub_mechanics[${i}]`, depth+1)) }
  }
  const phases: StrategyPhase[] = array(root.phases, 'phases').map((v,i) => {
    const path = `phases[${i}]`, p = object(v, path, ['name','mechanics'])
    return { name: string(p.name, `${path}.name`), mechanics: array(p.mechanics, `${path}.mechanics`).map((v,j) => mechanic(v, `${path}.mechanics[${j}]`, 0)) }
  })
  return { metadata, phases: sortPhases(phases),
    references: array(root.references, 'references').map((v,i) => { const p=`references[${i}]`, r=object(v,p,['label','url']); return { label:string(r.label,`${p}.label`),url:reference(r.url,`${p}.url`) } }),
    macros: array(root.macros, 'macros').map((v,i) => { const p=`macros[${i}]`, m=object(v,p,['name','code']); return { name:string(m.name,`${p}.name`),code:string(m.code,`${p}.code`) } }),
  }
}
export function structureToJson(structure: StrategyStructure): string { return `${JSON.stringify(normalizeStructure(structure), null, 2)}\n` }
export function stampOperation(structure: StrategyStructure, now: Date = new Date()): StrategyStructure {
  const result = normalizeStructure(structure)
  result.metadata.publish_time = now.toISOString()
  return result
}
/** Business errors are reportable while editing; only submission requires none. */
export function validateStructure(input: StrategyStructure): string[] {
  let s: StrategyStructure
  try { s = normalizeStructure(input) } catch (error) { return [error instanceof Error ? error.message : '攻略结构无效'] }
  const errors: string[] = []
  const check = (value: string, path: string, required = false): void => {
    if (required && !value) errors.push(`${path}：未填写`)
    if (FORBIDDEN_CHARACTERS.test(value)) errors.push(`${path}：禁止 Unicode 空白和控制字符`)
  }
  for (const [key,value] of Object.entries(s.metadata)) check(value, `metadata.${key}`, ['name','title','type'].includes(key))
  if (s.metadata.name && !isValidDutyName(s.metadata.name,s.metadata.type)) errors.push('metadata.name：副本名称不符合所选类型的格式或文件名要求')
  if (s.metadata.status !== 'draft') errors.push('metadata.status：提交只接受 draft')
  if (s.metadata.publish_time && (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s.metadata.publish_time) || !Number.isFinite(Date.parse(s.metadata.publish_time)) || new Date(s.metadata.publish_time).toISOString() !== s.metadata.publish_time)) errors.push('metadata.publish_time：必须是有效的 UTC ISO 8601 操作时间')
  if (s.metadata.banner && !isImageReference(s.metadata.banner)) errors.push('metadata.banner：需要安全图片路径或 http/https 地址')
  if (s.metadata.video && !isHttpUrl(s.metadata.video)) errors.push('metadata.video：需要 http/https 地址')
  s.references.forEach((r,i) => { check(r.label,`references[${i}].label`,true); check(r.url,`references[${i}].url`,true); if (r.url && !isHttpUrl(r.url)) errors.push(`references[${i}].url：需要 http/https 地址`) })
  s.macros.forEach((m,i) => { check(m.name,`macros[${i}].name`,true); if (!m.code) errors.push(`macros[${i}].code：未填写`) })
  const phaseNumbers = new Set<number>()
  function visit(m: StrategyMechanic, path: string, names: Set<string>): void {
    check(m.name,`${path}.name`,true)
    if (m.name && names.has(m.name)) errors.push(`${path}.name：「${m.name}」在本阶段重复`)
    if (m.name) names.add(m.name)
    if (!m.sub_mechanics.length && !m.sections.length) errors.push(`${path}.sections：叶子机制至少一个区块`)
    m.sections.forEach((sec,i) => {
      const p=`${path}.sections[${i}]`
      check(sec.title,`${p}.title`,SECTION_RULES[sec.type].titleRequired)
      if (!sec.content.length) errors.push(`${p}.content：至少一个内容块`)
      sec.content.forEach((c,j) => {
        const cp=`${p}.content[${j}]`
        if (c.type === 'text') { if (!richTextLines(c.doc).some(text => /[^\p{White_Space}\p{Cc}\p{Cf}]/u.test(text))) errors.push(`${cp}.doc：至少填写一行文字`) }
        else { check(c.file,`${cp}.file`,true);check(c.caption,`${cp}.caption`);if(c.file && !isImageReference(c.file)) errors.push(`${cp}.file：需要安全图片路径或 http/https 地址`) }
      })
    })
    m.sub_mechanics.forEach((sub,i) => visit(sub,`${path}.sub_mechanics[${i}]`,names))
  }
  if (!s.phases.length) errors.push('phases：至少一个阶段')
  s.phases.forEach((p,i) => {
    const path=`phases[${i}]`; check(p.name,`${path}.name`,true)
    const phase=parsePhaseName(p.name)
    if (!phase) errors.push(`${path}.name：使用 p1、p1-中文标题或 p1.5-转场，编号范围 0.5–10.5`)
    else { if(phaseNumbers.has(phase.number)) errors.push(`${path}.name：阶段编号 ${phase.number} 重复`);phaseNumbers.add(phase.number) }
    if (!p.mechanics.length) errors.push(`${path}.mechanics：至少一个机制`)
    const names=new Set<string>();p.mechanics.forEach((m,j)=>visit(m,`${path}.mechanics[${j}]`,names))
  })
  return errors
}
