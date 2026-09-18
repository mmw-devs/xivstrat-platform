import { normalizeStructure, type StrategyStructure } from '@xivstrat/content-schema'

export function parseTemplate(text: string): StrategyStructure {
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== 'object' || !('phases' in value) || !Array.isArray(value.phases)) {
    throw new Error('攻略 JSON 必须包含 phases 数组（空草稿可为空数组）')
  }
  return normalizeStructure(value)
}
