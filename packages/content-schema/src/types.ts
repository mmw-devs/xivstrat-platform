/**
 * 编辑器与提交服务共用的攻略数据契约。
 * 层级：攻略 → 阶段 → 机制（可递归包含子机制）→ 区块 → 正文/图片。
 * 类型描述数据形状；结构解析和业务必填校验由 core.ts 负责。
 * 草稿允许字段为空，符合这些类型不等于已经满足提交条件。
 */

/** 持久化内容块的类型；作为联合类型的判别字段使用。 */
export const CONTENT_TYPES = ['text', 'image'] as const
export type ContentType = (typeof CONTENT_TYPES)[number]

/** 区块角色：机制说明、处理解法、注意事项。 */
export const SECTION_TYPES = ['mechanic', 'solution', 'note'] as const
export type SectionType = (typeof SECTION_TYPES)[number]

/** 区块名称和标题必填规则的单一来源，供编辑界面、预览及校验复用。 */
export const SECTION_RULES = {
  mechanic: { label: '机制', titleRequired: true },
  solution: { label: '解法', titleRequired: true },
  note: { label: '注意', titleRequired: false },
} as const satisfies Record<SectionType, { label: string; titleRequired: boolean }>

/** 副本分类：极神、零式、绝本、其他。 */
export const DUTY_TYPES = ['extreme', 'savage', 'ultimate', 'other'] as const
export type DutyType = (typeof DUTY_TYPES)[number]

/** 攻略内容状态；不代表 GitHub 请求状态，也不保证 PR 已合并或已部署。 */
export const STRATEGY_STATUSES = ['draft', 'review', 'done'] as const
export type StrategyStatus = (typeof STRATEGY_STATUSES)[number]

/** 正文使用受限富文本文档，稳定 id 用于校对定位。 */
export interface TextContentBlock {
  type: 'text'
  /** 全篇唯一的稳定标识，用于定位正文及校对建议；移动正文块时保持不变。 */
  id: string
  /** 允许的节点、格式、颜色和字号由 richtext.ts 定义与校验。 */
  doc: import('./richtext.ts').RichTextDocument
}

export interface ImageContentBlock {
  type: 'image'
  /** 图片路径或地址，保存引用而非图片二进制。 */
  file: string
  /** 图片说明。 */
  caption: string
}

export type ContentBlock = TextContentBlock | ImageContentBlock

/** 一个机制下的说明区块；content 的数组顺序即展示顺序。 */
export interface StrategySection {
  type: SectionType
  /** 是否必填由 SECTION_RULES 决定，注意事项允许空标题。 */
  title: string
  content: ContentBlock[]
}

/** 机制与子机制使用相同结构，可递归组织。 */
export interface StrategyMechanic {
  /** 同一阶段（含所有递归子机制）名称唯一，禁止空白和控制字符。 */
  name: string
  sections: StrategySection[]
  /** 没有子机制时使用空数组。 */
  sub_mechanics: StrategyMechanic[]
}

export interface StrategyPhase {
  /** p + 数字 + 可选中文标题；数字 0.5–10.5，步长 0.5，全篇唯一。 */
  name: string
  mechanics: StrategyMechanic[]
}

/** 攻略基本信息；字符串字段可以在编辑过程中暂时留空。 */
export interface StrategyMetadata {
  /** 副本名称兼文件标识；不同副本类型的格式由共享规则校验。 */
  name: string
  /** 空字符串表示尚未选择有效分类。 */
  type: DutyType | ''
  /** 攻略页面标题。 */
  title: string
  /** 封面图片路径或地址。 */
  banner: string
  /** 本地保存或服务端提交时生成的 ISO 8601 时间；不是审核或部署时间。 */
  publish_time: string
  /** 编辑器固定 draft；review/done 由后续审核平台管理，不与 PR 状态绑定。 */
  status: StrategyStatus
  /** 可选的视频链接，无视频时保存空字符串。 */
  video: string
}

/** 外部参考资料的展示名称与链接。 */
export interface StrategyReference {
  label: string
  url: string
}

export interface StrategyMacro {
  name: string
  /** 游戏宏原文，包含多行内容及换行。 */
  code: string
}

/** 规范化后的攻略根对象，供预览、校对、本地保存及提交共同消费。 */
export interface StrategyStructure {
  metadata: StrategyMetadata
  /** 无参考资料或宏时保留空数组。 */
  references: StrategyReference[]
  macros: StrategyMacro[]
  /** 按 name 的数字排序；草稿可为空，提交至少一个阶段。 */
  phases: StrategyPhase[]
}
