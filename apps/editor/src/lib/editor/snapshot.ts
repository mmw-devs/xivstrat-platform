import { validateStructure, type StrategyStructure } from '@xivstrat/content-schema'

/** Content commands invalidate the preview; auxiliary UI never computes a new snapshot. */
export function createSnapshotCache(read: () => StrategyStructure) {
  let cached: { structure: StrategyStructure; errors: string[] } | undefined
  return {
    invalidate(): void { cached = undefined },
    get() {
      if (!cached) {
        const structure = read()
        cached = { structure, errors: validateStructure(structure) }
      }
      return cached
    },
  }
}
