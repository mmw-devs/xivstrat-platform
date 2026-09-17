import { normalizeStructure, type StrategyStructure } from '@xivstrat/content-schema'

export function parseTemplate(text: string): StrategyStructure {
  const raw = text.trim()
  return raw ? normalizeStructure(JSON.parse(raw) as unknown) : normalizeStructure({})
}
