import type { DutyType, StrategyPhase } from './types.ts'

export const FORBIDDEN_CHARACTERS = /[\p{White_Space}\p{Cc}\p{Cf}]/u
const SAVAGE_NAME = /^[a-z](?:[1-9]|1[0-2])s$/
const ENGLISH_NAME = /^[a-z]+(?:-[a-z]+)*$/
const RESERVED_FILE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
export function normalizeDutyName(name: string, type: DutyType | ''): string {
  return type && type !== 'savage' ? name.replace(/ /g, '-') : name
}
export function isValidDutyName(name: string, type: DutyType | ''): boolean {
  return !FORBIDDEN_CHARACTERS.test(name) && name.length <= 120 && !RESERVED_FILE_NAME.test(name) && (type === 'savage' ? SAVAGE_NAME.test(name) : Boolean(type) && ENGLISH_NAME.test(name))
}
export interface PhaseName { number: number; title: string }
export function parsePhaseName(name: string): PhaseName | null {
  if (FORBIDDEN_CHARACTERS.test(name)) return null
  const match = /^p(0\.5|(?:[1-9]|10)(?:\.5)?)(?:-([\p{Script=Han}·、，（）]+))?$/u.exec(name)
  if (!match || (match[2] && !/\p{Script=Han}/u.test(match[2]))) return null
  return { number: Number(match[1]), title: match[2] ?? '' }
}
/** Valid phases sort numerically; incomplete drafts remain in their relative order at the end. */
export function comparePhaseNames(a: string, b: string): number {
  const first = parsePhaseName(a), second = parsePhaseName(b)
  return first && second ? first.number - second.number : first ? -1 : second ? 1 : 0
}
export function sortPhases(phases: StrategyPhase[]): StrategyPhase[] {
  return [...phases].sort((a, b) => comparePhaseNames(a.name, b.name))
}
export function isHttpUrl(value: string): boolean {
  if (FORBIDDEN_CHARACTERS.test(value)) return false
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password } catch { return false }
}
/** Security rejection used for drafts as well as complete submissions. */
export function hasUnsafeReference(value: string): boolean {
  let decoded: string
  try { decoded = decodeURIComponent(value) } catch { return true }
  if (/[\p{Cc}\p{Cf}]/u.test(decoded) || decoded.includes('\\') || decoded.split(/[/?#]/).includes('..')) return true
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(decoded)
  return (Boolean(scheme) && !/^https?:\/\//i.test(decoded)) || decoded.startsWith('//')
}
export function isImageReference(value: string): boolean {
  if (FORBIDDEN_CHARACTERS.test(value) || hasUnsafeReference(value)) return false
  if (/^https?:/i.test(value)) return isHttpUrl(value)
  return Boolean(value) && !value.startsWith('/') && !/[<>:"|?*#]/.test(value) && value.split('/').every(part => Boolean(part) && part !== '.')
}
