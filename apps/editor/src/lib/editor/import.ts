import { normalizeStructure, type StrategyMetadata, type StrategyStructure } from '@xivstrat/content-schema'

// Identity shape shared by historical exports and current canonical drafts.
// Empty strings are valid here: import recognition is not publication validation.
const IDENTITY_FIELDS = ['id', 'name', 'title'] as const satisfies readonly (keyof StrategyMetadata)[]
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseTemplate(text: string): StrategyStructure {
  const value: unknown = JSON.parse(text)
  if (!isRecord(value) || !Array.isArray(value.phases) || !isRecord(value.metadata)) {
    throw new Error('攻略 JSON 必须包含 metadata 对象和 phases 数组')
  }
  const metadata = value.metadata
  if (!IDENTITY_FIELDS.every(key => typeof metadata[key] === 'string')) {
    throw new Error('攻略 metadata 必须包含字符串类型的 id、name 和 title（未填写时可为空字符串）')
  }
  for (const key of ['references', 'macros'] as const) {
    if (key in value && !Array.isArray(value[key])) throw new Error('攻略 ' + key + ' 必须为数组')
  }
  return normalizeStructure(value)
}
