import { DUTY_TYPES, STRATEGY_STATUSES, type StrategyMetadata } from '@xivstrat/content-schema'
import type { ElementLookup } from '../ui/dom'

const FIELDS = {
  id: 'inp-id', name: 'inp-name', short_name: 'inp-short', type: 'inp-type',
  title: 'inp-title', description: 'inp-desc', banner: 'inp-banner',
  publish_time: 'inp-date', status: 'inp-status', video: 'inp-video', team: 'inp-group',
} as const satisfies Record<keyof StrategyMetadata, string>

export function createMetadata(byId: ElementLookup, changed: () => void, signal: AbortSignal) {
  const values = {} as Record<keyof StrategyMetadata, string>
  const keys = Object.keys(FIELDS) as (keyof StrategyMetadata)[]
  for (const key of keys) {
    const input = byId<HTMLInputElement | HTMLSelectElement>(FIELDS[key])
    values[key] = input.value
    input.addEventListener('input', () => { values[key] = input.value; changed() }, { signal })
  }
  return {
    read(): StrategyMetadata {
      const text = Object.fromEntries(keys.map(key => [key, values[key].trim()])) as Record<keyof StrategyMetadata, string>
      return { ...text, type: DUTY_TYPES.find(type => type === text.type) ?? '', status: STRATEGY_STATUSES.find(status => status === text.status) ?? '' }
    },
    replace(value: StrategyMetadata) {
      for (const key of keys) {
        values[key] = value[key]
        byId<HTMLInputElement | HTMLSelectElement>(FIELDS[key]).value = value[key]
      }
      changed()
    },
  }
}
