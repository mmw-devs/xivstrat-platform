import { normalizeStructure, renderRichText } from '@xivstrat/content-schema'
import type {
  ContentBlock,
  DutyType,
  ImageContentBlock,
  SectionType,
  StrategyMechanic,
  StrategyPhase,
  StrategySection,
  StrategyStatus,
  StrategyStructure,
} from '@xivstrat/content-schema'
import type { GeneratedFiles } from './types'

const TYPE_MAP: Record<DutyType, 'trial' | 'raid' | 'ultimate' | 'other'> = {
  extreme: 'trial',
  savage: 'raid',
  ultimate: 'ultimate',
  other: 'other',
}

const SITE_STATUS_MAP: Record<StrategyStatus, 'upcoming' | 'live' | 'done'> = {
  draft: 'upcoming',
  review: 'live',
  done: 'done',
}

export function escHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function escAstroText(value: string): string {
  return escHtml(value).replace(/\{/g, '&#123;').replace(/\}/g, '&#125;')
}

export function camel(value: string): string {
  return value
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')
}

export function parseTemplate(text: string): StrategyStructure {
  const raw = text.trim()
  return raw ? normalizeStructure(JSON.parse(raw) as unknown) : normalizeStructure({})
}

function quoteAstro(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function imageSource(dutyId: string, phaseDirectory: string, source: string): string {
  if (/^(?:https?:)?\/\//.test(source) || source.startsWith('data:') || source.startsWith('/')) return source
  return source.includes('/') ? `07/${dutyId}/${source}` : `07/${dutyId}/${phaseDirectory}/${source}`
}

function generateImageRow(
  images: ImageContentBlock[],
  dutyId: string,
  phaseDirectory: string,
  indent: string,
): string[] {
  const inner = `${indent}  `
  const lines = [
    `${indent}<ImgRow`,
    `${inner}class="game-img"`,
    `${inner}wrapperClass="max-w-88"`,
    `${inner}borderVariant="cyan"`,
    `${inner}rounded`,
    `${inner}imgs={[`,
  ]
  images.forEach((image) => {
    lines.push(
      `${inner}  { src: '${quoteAstro(imageSource(dutyId, phaseDirectory, image.file))}', alt: '${quoteAstro(image.caption || image.file)}', title: '${quoteAstro(image.caption || image.file)}' },`,
    )
  })
  lines.push(`${inner}]}`, `${indent}/>`)
  return lines
}

function generateContent(
  lines: string[],
  content: ContentBlock[],
  dutyId: string,
  phaseDirectory: string,
  indent: string,
): void {
  content.forEach((item) => {
    if (item.type === 'image') {
      lines.push(...generateImageRow([item], dutyId, phaseDirectory, indent))
      return
    }
    lines.push(renderRichText(item.doc, true).split('\n').map(line => indent + line).join('\n'))
  })
}

function sectionComponent(type: SectionType): 'MechanicSection' | 'SolutionSection' | 'NoteSection' {
  if (type === 'mechanic') return 'MechanicSection'
  if (type === 'solution') return 'SolutionSection'
  return 'NoteSection'
}

function generateSection(lines: string[], section: StrategySection, dutyId: string, phaseDirectory: string): void {
  const component = sectionComponent(section.type)
  const title = section.title ? ` title="${quoteAstro(section.title)}"` : ''
  lines.push(`  <${component}${title}>`)
  generateContent(lines, section.content, dutyId, phaseDirectory, '    ')
  lines.push(`  </${component}>`)
}

function generateMechanic(lines: string[], mechanic: StrategyMechanic, dutyId: string, phaseDirectory: string): void {
  if (!mechanic.id) return
  lines.push(`  <SeparatorSection id="${quoteAstro(mechanic.id)}" title={translations.${camel(mechanic.id)}} />`)
  mechanic.sections.forEach((section) => {
    generateSection(lines, section, dutyId, phaseDirectory)
  })
  mechanic.sub_mechanics.forEach((subMechanic) => {
    generateMechanic(lines, subMechanic, dutyId, phaseDirectory)
  })
}

function generatePage(dutyId: string, phase: StrategyPhase): string {
  const phaseDirectory = `P${phase.id.replace(/^p/i, '')}`
  const lines = [
    '---',
    "import ImgRow from '@/components/typography/ImgRow.astro'",
    "import SeparatorSection from '@/components/section/SeparatorSection.astro'",
    "import MechanicSection from '@/components/section/MechanicSection.astro'",
    "import SolutionSection from '@/components/section/SolutionSection.astro'",
    "import NoteSection from '@/components/section/NoteSection.astro'",
    "import DutyStratLayout from '@/layouts/DutyStratLayout.astro'",
    '',
    "import { translations } from './_translations'",
    '',
    `const dutyId = '07/${dutyId}'`,
    "const base = '00:00.00'",
    '---',
    '',
    '<DutyStratLayout dutyId={dutyId} base={base}>',
  ]
  phase.mechanics.forEach((mechanic) => {
    generateMechanic(lines, mechanic, dutyId, phaseDirectory)
  })
  lines.push('</DutyStratLayout>', '')
  return lines.join('\n')
}

function generateIndex(macros: StrategyStructure['macros'], dutyId: string): string {
  const lines = [
    '---',
    "import AreaBox from '@/components/AreaBox.astro'",
    "import CollapsibleBox from '@/components/CollapsibleBox.vue'",
    "import CosImage from '@/components/CosImage.astro'",
    "import Macro from '@/components/Macro.astro'",
    "import ReferenceItem from '@/components/ReferenceItem.astro'",
    "import ResizableImageDialog from '@/components/ResizableImageDialog.vue'",
    "import Thanks from '@/components/thanks/Thanks.astro'",
    "import WaymarkBox from '@/components/WaymarkBox.astro'",
    "import DutyHomeLayout from '@/layouts/DutyHomeLayout.astro'",
    "import ScannerSVG from '@/svg/scanner.svg'",
    '',
    "import { stgyMacros } from './_data/macro'",
    "import { referenceList } from './_data/reference'",
    "import { thanksList } from './_data/thanks'",
    '',
    `const CheatsheetsImage = 'cheatsheets/07/${dutyId}.webp'`,
    `const WaymarkImage = 'waymarks/07/${dutyId}.webp'`,
    `const TimelineImage = 'timelines/07/${dutyId}.webp'`,
    `const dutyId = '07/${dutyId}'`,
    'const navList = [',
  ]
  const navigation: Array<[string, string]> = [
    ['cheatsheet', '小抄速览'],
    ['waymark', '场地标点'],
    ['timeline', '简易时间轴'],
  ]
  if (macros.length) navigation.push(['macro', '宏'])
  navigation.push(['reference', '参考资料'], ['thanks', '攻略组'])
  navigation.forEach(([id, label]) => {
    lines.push(`  { label: '${label}', id: '${id}' },`)
  })
  lines.push(
    ']',
    '---',
    '',
    '<DutyHomeLayout dutyId={dutyId} navList={navList}>',
    '  <Fragment slot="operation">',
    `    <a href="/07/${dutyId}/p1">`,
    '      <button class="flex w-max cursor-pointer items-center justify-between rounded-lg border border-purple-400 bg-purple-500 p-2 px-4 align-middle text-white hover:bg-purple-700/60 dark:border-purple-500 dark:bg-purple-700/75">',
    '        <ScannerSVG class="mr-2 h-5 w-5" /> 查看正文',
    '      </button>',
    '    </a>',
    '  </Fragment>',
  )
  lines.push(
    '  <CollapsibleBox id="cheatsheet" client:idle class="w-full">',
    '    <Fragment slot="header"><span>小抄速览</span></Fragment>',
    '    <AreaBox><ResizableImageDialog client:idle><CosImage src={CheatsheetsImage} alt="副本小抄" loading="lazy" class="h-full object-contain" /></ResizableImageDialog></AreaBox>',
    '  </CollapsibleBox>',
  )
  lines.push(
    '  <CollapsibleBox id="waymark" client:idle class="w-full">',
    '    <AreaBox><WaymarkBox img={WaymarkImage} /></AreaBox>',
    '    <Fragment slot="header"><span>场地标点</span></Fragment>',
    '  </CollapsibleBox>',
  )
  if (macros.length)
    lines.push(
      '  <CollapsibleBox id="macro" client:idle class="w-full">',
      '    <div class="flex flex-col gap-4">{stgyMacros.map((item) => <Macro text={item.code} title={item.title} />)}</div>',
      '    <Fragment slot="header"><span>宏</span></Fragment>',
      '  </CollapsibleBox>',
    )
  lines.push(
    '  <CollapsibleBox id="timeline" client:idle class="w-full">',
    '    <AreaBox><ResizableImageDialog client:idle><CosImage src={TimelineImage} alt="简易时间轴" class="w-full object-contain" /></ResizableImageDialog></AreaBox>',
    '    <Fragment slot="header"><span>简易时间轴</span></Fragment>',
    '  </CollapsibleBox>',
  )
  lines.push(
    '  <CollapsibleBox id="reference" client:idle class="w-full">',
    '    <ReferenceItem list={referenceList} />',
    '    <Fragment slot="header"><span>参考资料</span></Fragment>',
    '  </CollapsibleBox>',
  )
  lines.push(
    '  <CollapsibleBox id="thanks" client:idle class="w-full">',
    '    <Thanks devList={[]} other={[]} groupList={thanksList.groupList} />',
    '    <Fragment slot="header"><span>攻略组</span></Fragment>',
    '  </CollapsibleBox>',
  )
  lines.push('</DutyHomeLayout>', '')
  return lines.join('\n')
}

export function filesFromStructure(input: StrategyStructure): GeneratedFiles {
  const structure = normalizeStructure(input)
  const { metadata } = structure
  const dutyId = metadata.id || 'unknown'
  const files: GeneratedFiles = {}
  const duty = {
    name: metadata.name,
    short: metadata.short_name,
    type: metadata.type ? TYPE_MAP[metadata.type] : 'other',
    title: metadata.title,
    description: metadata.description,
    banner: metadata.banner,
    date: metadata.publish_time,
    href: `/07/${dutyId}`,
    status: metadata.status ? SITE_STATUS_MAP[metadata.status] : '',
    indexAvailable: true,
    phases: structure.phases.map((phase) => ({
      href: `/07/${dutyId}/${phase.id}`,
      title: phase.id,
      subtitle: phase.name,
      name: `${phase.id}${phase.name ? ` - ${phase.name}` : ''}`,
      mechanics: phase.mechanics
        .filter((mechanic) => mechanic.id)
        .map((mechanic) => ({ href: `#${mechanic.id}`, name: mechanic.name })),
    })),
    ...(metadata.video ? { videoLink: metadata.video } : {}),
  }
  files[`duties/07/${dutyId}.json`] = `${JSON.stringify(duty, null, 2)}\n`
  structure.phases.forEach((phase) => {
    files[`pages/07/${dutyId}/${phase.id}.astro`] = generatePage(dutyId, phase)
  })
  files[`pages/07/${dutyId}/index.astro`] = generateIndex(structure.macros, dutyId)
  const dataDirectory = `pages/07/${dutyId}/_data/`
  const macroLines = structure.macros.map(
    (macro) => `  { title: '${quoteAstro(macro.name)}', code: '${quoteAstro(macro.code.replace(/\n/g, '\\n'))}' },`,
  )
  const referenceLines = structure.references.map(
    (reference) => `  { url: '${quoteAstro(reference.url)}', label: '${quoteAstro(reference.label)}' },`,
  )
  files[`${dataDirectory}macro.ts`] = `export const stgyMacros = [\n${macroLines.join('\n')}\n]\n`
  files[`${dataDirectory}reference.ts`] = `export const referenceList = [\n${referenceLines.join('\n')}\n]\n`
  files[`${dataDirectory}thanks.ts`] =
    `export const thanksList = {\n  groupList: ${JSON.stringify(metadata.team ? [metadata.team] : [])},\n  devList: [],\n  other: [],\n}\n`
  const translations = new Map<string, string>()
  const collectTranslations = (mechanics: StrategyMechanic[]): void => {
    mechanics.forEach((mechanic) => {
      if (mechanic.id) translations.set(mechanic.id, mechanic.name)
      collectTranslations(mechanic.sub_mechanics)
    })
  }
  structure.phases.forEach((phase) => {
    collectTranslations(phase.mechanics)
  })
  let translationSource = 'export const translations = {\n'
  translations.forEach((name, id) => {
    translationSource += `  ${camel(id)}: '${quoteAstro(name)}',\n`
  })
  translationSource += '}\n'
  files[`pages/07/${dutyId}/_translations/index.ts`] = "export * from './cn'\n"
  files[`pages/07/${dutyId}/_translations/cn.ts`] = translationSource
  return files
}

export { TYPE_MAP }
