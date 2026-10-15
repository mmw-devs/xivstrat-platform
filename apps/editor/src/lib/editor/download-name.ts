import { isValidDutyName, type StrategyStructure } from '@xivstrat/content-schema'

/** Download presentation only; does not change content or server target paths. */
export function localDownloadName(structure: StrategyStructure, extension: 'json' | 'zip'): string {
  const { name, type } = structure.metadata
  return `${isValidDutyName(name, type) ? name : 'strategy-draft'}.${extension}`
}
