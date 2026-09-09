export const CONTENT_TYPES = ['text', 'image'] as const
export type ContentType = (typeof CONTENT_TYPES)[number]

export const SECTION_TYPES = ['mechanic', 'solution', 'note'] as const
export type SectionType = (typeof SECTION_TYPES)[number]

export const DUTY_TYPES = ['extreme', 'savage', 'ultimate', 'other'] as const
export type DutyType = (typeof DUTY_TYPES)[number]

export const STRATEGY_STATUSES = ['draft', 'review', 'done'] as const
export type StrategyStatus = (typeof STRATEGY_STATUSES)[number]

export interface TextContentBlock {
  type: 'text'
  value: string[]
}

export interface ImageContentBlock {
  type: 'image'
  file: string
  caption: string
}

export type ContentBlock = TextContentBlock | ImageContentBlock

export interface StrategySection {
  type: SectionType
  title: string
  content: ContentBlock[]
}

export interface StrategyMechanic {
  id: string
  name: string
  sections: StrategySection[]
  sub_mechanics: StrategyMechanic[]
}

export interface StrategyPhase {
  id: string
  name: string
  mechanics: StrategyMechanic[]
}

export interface StrategyMetadata {
  id: string
  name: string
  short_name: string
  type: DutyType | ''
  title: string
  description: string
  banner: string
  publish_time: string
  status: StrategyStatus | ''
  video: string
  team: string
}

export interface StrategyReference {
  label: string
  url: string
}

export interface StrategyMacro {
  name: string
  code: string
}

export interface StrategyStructure {
  metadata: StrategyMetadata
  references: StrategyReference[]
  macros: StrategyMacro[]
  phases: StrategyPhase[]
}
