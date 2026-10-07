import { DUTY_TYPES, normalizeDutyName, type StrategyMetadata } from '@xivstrat/content-schema'
import type { ElementLookup } from '../ui/dom'
const FIELDS = { name: 'inp-name', type: 'inp-type', title: 'inp-title', banner: 'inp-banner', publish_time: 'inp-date', status: 'inp-status', video: 'inp-video' } as const satisfies Record<keyof StrategyMetadata, string>
export function createMetadata(byId: ElementLookup, changed: () => void, signal: AbortSignal) {
  const values = {} as Record<keyof StrategyMetadata, string>
  const keys = Object.keys(FIELDS) as (keyof StrategyMetadata)[]
  let importedName: string | undefined
  const showName = (): void => {
    const type = DUTY_TYPES.find(type => type === values.type) ?? ''
    values.name = normalizeDutyName(values.name, type)
    byId<HTMLInputElement>('inp-name').value = values.name
    byId('name-warning').textContent = importedName !== undefined && values.name !== importedName ? '名称已改变，将指向另一个攻略文件；原文件不会重命名。' : ''
  }
  for (const key of keys) {
    const input = byId<HTMLInputElement | HTMLSelectElement>(FIELDS[key])
    values[key] = input.value
    if (key === 'status' || key === 'publish_time') continue
    input.addEventListener('input', () => { values[key] = input.value; if (key === 'name' || key === 'type') showName(); changed() }, { signal })
  }
  return {
    read(): StrategyMetadata { return { ...values, type: DUTY_TYPES.find(type => type === values.type) ?? '', status: 'draft' } as StrategyMetadata },
    setOperationTime(value: string) { values.publish_time = value; byId<HTMLInputElement>('inp-date').value = value; changed() },
    replace(value: StrategyMetadata) {
      for (const key of keys) { values[key] = key === 'status' ? 'draft' : value[key]; byId<HTMLInputElement | HTMLSelectElement>(FIELDS[key]).value = values[key] }
      importedName = value.name; showName(); changed()
    },
  }
}
