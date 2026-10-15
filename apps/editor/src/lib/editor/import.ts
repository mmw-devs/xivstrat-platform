import { normalizeStructure, type StrategyStructure } from '@xivstrat/content-schema'
/** Strict contract recognition is distinct from submission completeness. */
export function parseTemplate(text: string): StrategyStructure { return normalizeStructure(JSON.parse(text)) }
