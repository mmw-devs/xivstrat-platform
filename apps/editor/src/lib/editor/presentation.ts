import { SECTION_RULES, type SectionType } from '@xivstrat/content-schema'
export const SECTION_PRESENTATION = {
  mechanic: { placeholder: '例如：分摊处理' },
  solution: { placeholder: '例如：固定站位解法' },
  note: { placeholder: '例如：特殊提醒' },
} satisfies Record<SectionType, { placeholder: string }>
export function sectionTitleLabel(type: SectionType): string {
  const rule = SECTION_RULES[type]
  return `${rule.label}标题${rule.titleRequired ? '' : '（可选）'}`
}
