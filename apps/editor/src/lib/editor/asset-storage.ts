import { isRecord } from '../ui/dom'
import type { CosSettings, ImageLibraryEntry } from './types'
export const COS_SETTING_KEYS = ['cos-secret-id', 'cos-secret-key', 'cos-bucket', 'cos-region'] as const
function parseStoredJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as unknown) : null
  } catch {
    return null
  }
}

export function stringField(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function getCosSettings(): CosSettings {
  const stored = parseStoredJson('xivstrat_cos_settings')
  const source = isRecord(stored) ? stored : {}
  return {
    'cos-secret-id': stringField(source['cos-secret-id']),
    'cos-secret-key': stringField(source['cos-secret-key']),
    'cos-bucket': stringField(source['cos-bucket']),
    'cos-region': stringField(source['cos-region']),
  }
}

export function readImageLibrary(): ImageLibraryEntry[] {
  const stored = parseStoredJson('xivstrat_img_lib')
  if (!Array.isArray(stored)) return []
  return stored.flatMap((item) => {
    if (!isRecord(item)) return []
    const path = stringField(item.path)
    if (!path) return []
    return [{ name: stringField(item.name), path, thumb: stringField(item.thumb) }]
  })
}

export function saveImageLibrary(entries: ImageLibraryEntry[]): void {
  localStorage.setItem('xivstrat_img_lib', JSON.stringify(entries))
}
