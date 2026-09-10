import { parseRichText, plainTextDocument, richTextLines } from './richtext.ts'
import {
  CONTENT_TYPES,
  type ContentBlock,
  DUTY_TYPES,
  type DutyType,
  SECTION_TYPES,
  type SectionType,
  STRATEGY_STATUSES,
  type StrategyMechanic,
  type StrategyMetadata,
  type StrategyPhase,
  type StrategySection,
  type StrategyStatus,
  type StrategyStructure,
} from './types.ts'

const SECTION_LABELS: Record<SectionType, string> = {
  mechanic: '机制',
  solution: '解法',
  note: '注意',
}

const META_LABELS: Record<keyof StrategyMetadata, string> = {
  id: '编号',
  name: '副本全名',
  short_name: '副本简称',
  type: '类型',
  title: '页面标题',
  description: '攻略描述',
  banner: '横幅图',
  publish_time: '发布时间',
  status: '状态',
  video: '视频链接',
  team: '攻略组署名',
}

const REQUIRED_METADATA_FIELDS: Array<keyof StrategyMetadata> = [
  'id',
  'name',
  'short_name',
  'type',
  'title',
  'description',
  'banner',
  'publish_time',
  'status',
  'team',
]

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function asTextArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(asString) : []
}

function isContentType(value: string): value is (typeof CONTENT_TYPES)[number] {
  return (CONTENT_TYPES as readonly string[]).includes(value)
}

function isSectionType(value: string): value is SectionType {
  return (SECTION_TYPES as readonly string[]).includes(value)
}

function asDutyType(value: unknown): DutyType | '' {
  const type = asString(value)
  return (DUTY_TYPES as readonly string[]).includes(type) ? (type as DutyType) : ''
}

function asStrategyStatus(value: unknown): StrategyStatus | '' {
  const status = asString(value)
  return (STRATEGY_STATUSES as readonly string[]).includes(status) ? (status as StrategyStatus) : ''
}

function normalizeContent(value: unknown): ContentBlock | null {
  if (!isRecord(value)) return null
  const type = asString(value.type)
  if (!isContentType(type)) return null
  if (type === 'image') {
    return { type, file: asString(value.file), caption: asString(value.caption) }
  }
  if ('doc' in value && (typeof value.id !== 'string' || !value.id || value.id.length > 100)) throw new Error('新版正文缺少有效 id')
  if ('doc' in value && 'value' in value) throw new Error('正文不能同时包含 doc 和 value')
  return { type, id: typeof value.id === 'string' && value.id ? value.id : crypto.randomUUID(), doc: 'doc' in value ? parseRichText(value.doc) : parseRichText(plainTextDocument(asTextArray(value.value))) }
}

function normalizeSection(value: unknown): StrategySection | null {
  if (!isRecord(value)) return null
  const type = asString(value.type)
  if (!isSectionType(type)) return null
  const content = Array.isArray(value.content)
    ? value.content.map(normalizeContent).filter((item): item is ContentBlock => item !== null)
    : []
  return { type, title: asString(value.title), content }
}

function normalizeMechanic(value: unknown): StrategyMechanic {
  const mechanic = isRecord(value) ? value : {}
  const sections = Array.isArray(mechanic.sections)
    ? mechanic.sections.map(normalizeSection).filter((section): section is StrategySection => section !== null)
    : []
  const subMechanics = Array.isArray(mechanic.sub_mechanics) ? mechanic.sub_mechanics.map(normalizeMechanic) : []
  return {
    id: asString(mechanic.id),
    name: asString(mechanic.name),
    sections,
    sub_mechanics: subMechanics,
  }
}

function normalizePhase(value: unknown): StrategyPhase {
  const phase = isRecord(value) ? value : {}
  return {
    id: asString(phase.id),
    name: asString(phase.name),
    mechanics: Array.isArray(phase.mechanics) ? phase.mechanics.map(normalizeMechanic) : [],
  }
}

export function normalizeStructure(raw: unknown): StrategyStructure {
  const source = isRecord(raw) ? raw : {}
  if (source.schemaVersion !== undefined && source.schemaVersion !== 1 && source.schemaVersion !== 2) throw new Error('不支持的 schemaVersion')
  const seenBlockIds = new Set<string>()
  const inspect = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(inspect); return }
    if (!isRecord(value)) return
    if (value.type === 'text') {
      if (source.schemaVersion === 2 && !('doc' in value)) throw new Error('v2 正文必须使用 doc')
      if (typeof value.id === 'string') {
        if (seenBlockIds.has(value.id)) throw new Error('正文 id 重复')
        seenBlockIds.add(value.id)
      }
      return
    }
    Object.values(value).forEach(inspect)
  }
  inspect(source.phases)
  const metadata = isRecord(source.metadata) ? source.metadata : {}
  return {
    schemaVersion: 2,
    metadata: {
      id: asString(metadata.id),
      name: asString(metadata.name),
      short_name: asString(metadata.short_name),
      type: asDutyType(metadata.type),
      title: asString(metadata.title),
      description: asString(metadata.description),
      banner: asString(metadata.banner),
      publish_time: asString(metadata.publish_time),
      status: asStrategyStatus(metadata.status),
      video: asString(metadata.video),
      team: asString(metadata.team),
    },
    references: Array.isArray(source.references)
      ? source.references.map((reference) => {
          const value = isRecord(reference) ? reference : {}
          return { label: asString(value.label), url: asString(value.url) }
        })
      : [],
    macros: Array.isArray(source.macros)
      ? source.macros.map((macro) => {
          const value = isRecord(macro) ? macro : {}
          return { name: asString(value.name), code: asString(value.code) }
        })
      : [],
    phases: Array.isArray(source.phases) ? source.phases.map(normalizePhase) : [],
  }
}

export function structureToJson(structure: StrategyStructure): string {
  return `${JSON.stringify(normalizeStructure(structure), null, 2)}\n`
}

function breadcrumb(...parts: string[]): string {
  return parts.filter(Boolean).join(' > ')
}

function contentLabel(item: ContentBlock, index: number): string {
  return item.type === 'image' ? `图片 ${index + 1}` : `正文 ${index + 1}`
}

function validateContent(content: ContentBlock[], parentPath: string, errors: string[]): void {
  content.forEach((item, index) => {
    const path = breadcrumb(parentPath, contentLabel(item, index))
    if (item.type === 'image') {
      if (!item.file) errors.push(`${breadcrumb(path, '图片路径')}：未填写`)
      if (!item.caption) errors.push(`${breadcrumb(path, '图片说明')}：未填写`)
      return
    }
    if (!richTextLines(item.doc).some(line => line.trim())) errors.push(`${breadcrumb(path, '文本内容')}：至少填写一行文字`)
  })
}

function sectionLabel(section: StrategySection, index: number): string {
  const title = section.title ? `：${section.title}` : ''
  return `${SECTION_LABELS[section.type]} ${index + 1}${title}`
}

function validateSection(section: StrategySection, parentPath: string, errors: string[], index: number): void {
  const path = breadcrumb(parentPath, sectionLabel(section, index))
  if ((section.type === 'mechanic' || section.type === 'solution') && !section.title) {
    errors.push(`${breadcrumb(path, '标题')}：未填写`)
  }
  validateContent(section.content, path, errors)
}

function validateMechanic(
  mechanic: StrategyMechanic,
  parentPath: string,
  errors: string[],
  seenIds: Set<string>,
  index: number,
): void {
  const name = mechanic.name || `未命名机制 ${index + 1}`
  const path = breadcrumb(parentPath, name)
  if (!mechanic.id) errors.push(`${breadcrumb(path, '编号')}：未填写`)
  else if (!/^[a-z0-9-]+$/.test(mechanic.id)) errors.push(`${breadcrumb(path, '编号')}：只能使用英文小写、数字或短横线`)
  if (!mechanic.name) errors.push(`${breadcrumb(path, '名称')}：未填写`)
  mechanic.sections.forEach((section, sectionIndex) => {
    validateSection(section, path, errors, sectionIndex)
  })
  if (mechanic.id) {
    if (seenIds.has(mechanic.id)) errors.push(`${breadcrumb(path, '编号')}：「${mechanic.id}」在本阶段重复`)
    seenIds.add(mechanic.id)
  }
  mechanic.sub_mechanics.forEach((subMechanic, subIndex) => {
    validateMechanic(subMechanic, path, errors, seenIds, subIndex)
  })
}

export function validateStructure(input: StrategyStructure): string[] {
  const structure = normalizeStructure(input)
  const errors: string[] = []
  const { metadata } = structure
  REQUIRED_METADATA_FIELDS.forEach((key) => {
    if (!metadata[key]) errors.push(`${breadcrumb('基本信息', META_LABELS[key])}：未填写`)
  })
  if (metadata.id && !/^[a-z0-9-]+$/.test(metadata.id))
    errors.push(`${breadcrumb('基本信息', '编号')}：只能使用英文小写、数字或短横线`)
  if (metadata.type && !(DUTY_TYPES as readonly string[]).includes(metadata.type))
    errors.push(
      `${breadcrumb('基本信息', '类型')}：应为 极神（extreme）、零式（savage）、绝本（ultimate）或其他（other）`,
    )
  if (metadata.status && !(STRATEGY_STATUSES as readonly string[]).includes(metadata.status))
    errors.push(`${breadcrumb('基本信息', '状态')}：应为 草稿（draft）、审核中（review）或已完成（done）`)
  structure.references.forEach((reference, index) => {
    const path = breadcrumb('参考资料', reference.label || `第 ${index + 1} 条`)
    if (!reference.label) errors.push(`${breadcrumb(path, '标题')}：未填写`)
    if (!reference.url) errors.push(`${breadcrumb(path, '链接')}：未填写`)
  })
  structure.macros.forEach((macro, index) => {
    const path = breadcrumb('宏', macro.name || `第 ${index + 1} 条`)
    if (!macro.name) errors.push(`${breadcrumb(path, '名称')}：未填写`)
    if (!macro.code) errors.push(`${breadcrumb(path, '内容')}：未填写`)
  })
  if (!structure.phases.length) errors.push('阶段：至少需要添加一个阶段')
  structure.phases.forEach((phase, index) => {
    const name = phase.name || `未命名阶段 ${index + 1}`
    const path = breadcrumb('阶段', name)
    if (!phase.id) errors.push(`${breadcrumb(path, '编号')}：未填写`)
    else if (!/^[a-z0-9][a-z0-9.-]*$/.test(phase.id)) errors.push(`${breadcrumb(path, '编号')}：格式不正确`)
    if (!phase.name) errors.push(`${breadcrumb(path, '名称')}：未填写`)
    const seenIds = new Set<string>()
    phase.mechanics.forEach((mechanic, mechanicIndex) => {
      validateMechanic(mechanic, path, errors, seenIds, mechanicIndex)
    })
  })
  return errors
}
