import { createBodyEditor, type BodyEditorHandle } from '../lib/richtext/editor'
import { createProofreadPanel, type ProofreadPanel } from '../lib/proofread/panel'
import { snapshotBlocks, snapshotLabel } from '../lib/proofread/contracts'
import { structureToJson, validateStructure, normalizeStructure, plainTextDocument, renderRichText, richTextLines } from '@xivstrat/content-schema'
import type {
  ContentBlock,
  ContentType,
  DutyType,
  SectionType,
  StrategyMechanic,
  StrategyPhase,
  StrategySection,
  StrategyStatus,
  StrategyStructure,
} from '@xivstrat/content-schema'
import { filesFromStructure, parseTemplate } from '../lib/editor/core'
import {
  createSubmissionController,
  submissionCanStart,
  type SubmissionController,
  type SubmissionUiState,
} from '../lib/editor/submission'
import type { CosSettings, GeneratedFiles, ImageLibraryEntry } from '../lib/editor/types'

type DutyTypeLabel = '极神' | '零式' | '绝本' | '其他'
type StatusLabel = '草稿' | '审核中' | '已完成'
type AttributeValue = string | number | boolean | ((event: Event) => void) | undefined
type ElementAttributes = Record<string, AttributeValue>
type DomChild = Node | string | number | null | undefined | false
type SectionOption = readonly [SectionType, string, string, string, boolean]
type HomeImageKey = keyof typeof HOME_IMAGES

interface GeneratedSnapshot {
  files: GeneratedFiles
  structure: StrategyStructure
  schemaText: string
}

interface CosProgress {
  loaded: number
  total: number
}

interface CosPutObjectOptions {
  Bucket: string
  Region: string
  Key: string
  Body: File
  ContentLength: number
  onProgress?: (progress: CosProgress) => void
}

interface CosClient {
  getService(options: Record<string, never>, callback: (error?: unknown) => void): void
  putObject(options: CosPutObjectOptions, callback: (error?: unknown) => void): void
}

interface CosConstructor {
  new (options: { SecretId: string; SecretKey: string }): CosClient
}

interface XivSearchResult {
  RowId?: number | string
  Fields?: Record<string, unknown>
}

declare global {
  interface Window {
    COS?: CosConstructor
  }
}

const TYPE_TO_JSON: Record<DutyTypeLabel, DutyType> = {
  极神: 'extreme',
  零式: 'savage',
  绝本: 'ultimate',
  其他: 'other',
}

const TYPE_FROM_JSON: Record<DutyType, DutyTypeLabel> = {
  extreme: '极神',
  savage: '零式',
  ultimate: '绝本',
  other: '其他',
}

const STATUS_TO_JSON: Record<StatusLabel, StrategyStatus> = {
  草稿: 'draft',
  审核中: 'review',
  已完成: 'done',
}

const STATUS_FROM_JSON: Record<StrategyStatus, StatusLabel> = {
  draft: '草稿',
  review: '审核中',
  done: '已完成',
}

const SECTION_TYPE_OPTIONS: readonly SectionOption[] = [
  ['mechanic', '机制（黄框）', '机制标题', '例如：分摊处理', true],
  ['solution', '解法（绿框）', '解法标题', '例如：固定站位解法', true],
  ['note', '注意（蓝框）', '注意标题（可选）', '例如：特殊提醒', false],
]

const COS_SETTING_KEYS = ['cos-secret-id', 'cos-secret-key', 'cos-bucket', 'cos-region'] as const
const HOME_IMAGES = { banner: 'banners/07/' } as const

const bodyEditors = new Map<HTMLElement, BodyEditorHandle>()
let proofreadPanel: ProofreadPanel | undefined
let lastBodyEditor: BodyEditorHandle | undefined
let initialized = false
let latestGenerated: GeneratedSnapshot | null = null
let submissionController: SubmissionController | undefined
let libPendingFile: File | null = null
let lastInput: HTMLInputElement | HTMLTextAreaElement | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) throw new Error(`编辑器缺少 #${id}`)
  return element as T
}

function optionalById<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null
}

function query<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector)
  if (!element) throw new Error(`编辑器缺少 ${selector}`)
  return element
}

function all<T extends Element>(root: ParentNode, selector: string): T[] {
  return Array.from(root.querySelectorAll<T>(selector))
}

function isValueElement(element: HTMLElement): element is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  )
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: ElementAttributes,
  ...children: DomChild[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  if (attrs) {
    Object.entries(attrs).forEach(([name, value]) => {
      if (value === undefined) return
      if (name === 'class') element.className = String(value)
      else if (name.startsWith('on') && typeof value === 'function') element.addEventListener(name.slice(2), value)
      else if (name === 'value' && isValueElement(element)) element.value = String(value)
      else if (typeof value === 'boolean') {
        if (value) element.setAttribute(name, '')
      } else element.setAttribute(name, String(value))
    })
  }
  children.forEach((child) => {
    if (child == null || child === false) return
    element.append(child instanceof Node ? child : document.createTextNode(String(child)))
  })
  return element
}

function selectedDutyType(): DutyType | '' {
  return TYPE_TO_JSON[byId<HTMLSelectElement>('inp-type').value as DutyTypeLabel] ?? ''
}

function selectedStatus(): StrategyStatus | '' {
  return STATUS_TO_JSON[byId<HTMLSelectElement>('inp-status').value as StatusLabel] ?? ''
}

function selectedSectionType(select: HTMLSelectElement): SectionType {
  const type = select.value as SectionType
  return SECTION_TYPE_OPTIONS.some(([value]) => value === type) ? type : 'mechanic'
}

function showProofreadReading(highlight?: { blockId: string; paragraph: number; from: number; to: number }): void {
  const reading = byId<HTMLElement>('proofread-reading')
  reading.replaceChildren()
  for (const snapshot of snapshotBlocks(collect())) {
    const block = [...bodyEditors.keys()].find(block => block.dataset.blockId === snapshot.blockId)
    const handle = block && bodyEditors.get(block)
    if (!handle) continue
    const article = el('article', { class: 'card proofread-body', 'data-reading-block': snapshot.blockId }, el('h3', {}, snapshotLabel(snapshot.path)))
    const body = el('div', { class: 'proofread-prose' })
    body.innerHTML = renderRichText(handle.getDocument(), false, highlight?.blockId === snapshot.blockId ? highlight : undefined)
    article.append(body)
    reading.append(article)
    if (highlight?.blockId === snapshot.blockId) article.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
  if (!reading.childElementCount) reading.append(el('p', { class: 'hint' }, '还没有正文，请先在第③步填写阶段与机制。'))
}
function goStep(step: number): void {
  if (step === 4) showProofreadReading()
  const panel = optionalById<HTMLElement>(`step${step}`)
  if (!panel) return
  all<HTMLElement>(document, '.panel').forEach((item) => {
    item.classList.remove('active')
  })
  panel.classList.add('active')
  all<HTMLButtonElement>(document, 'nav.steps button[data-step]').forEach((button) => {
    button.classList.toggle('active', Number(button.dataset.step) === step)
  })
  if (step === 5) refresh()
}

function addRef(reference?: StrategyStructure['references'][number]): void {
  const row = el(
    'div',
    { class: 'row', style: 'margin-bottom:8px' },
    el('input', { placeholder: '标题', class: 'inp-ref-label' }),
    el('input', { placeholder: 'https://链接', class: 'inp-ref-url' }),
    el(
      'button',
      {
        class: 'btn sm danger',
        onclick: (event) => (event.currentTarget as HTMLElement).closest('.row')?.remove(),
      },
      '删除',
    ),
  )
  if (reference) {
    query<HTMLInputElement>(row, '.inp-ref-label').value = reference.label
    query<HTMLInputElement>(row, '.inp-ref-url').value = reference.url
  }
  byId<HTMLElement>('refs').append(row)
}

function addMacro(macro?: StrategyStructure['macros'][number]): void {
  const card = el(
    'div',
    { class: 'card', style: 'margin:8px 0' },
    el(
      'div',
      { class: 'row' },
      el('div', {}, el('label', {}, 'name'), el('input', { class: 'inp-macro-title', placeholder: '站位方案' })),
      el(
        'button',
        {
          class: 'btn sm danger',
          onclick: (event) => (event.currentTarget as HTMLElement).closest('.card')?.remove(),
        },
        '删除宏',
      ),
    ),
    el('label', { style: 'margin-top:6px' }, '代码（多行，如 /p 开头的宏）'),
    el('textarea', { class: 'code inp-macro-code', rows: 3, placeholder: '/p 第一行\n/p 第二行' }),
  )
  if (macro) {
    query<HTMLInputElement>(card, '.inp-macro-title').value = macro.name
    query<HTMLTextAreaElement>(card, '.inp-macro-code').value = macro.code
  }
  byId<HTMLElement>('macros').append(card)
}

function moveListItem(item: HTMLElement, direction: -1 | 1): void {
  const parent = item.parentElement
  const sibling = direction < 0 ? item.previousElementSibling : item.nextElementSibling
  if (!parent || !sibling) return
  if (direction < 0) parent.insertBefore(item, sibling)
  else parent.insertBefore(sibling, item)
}

function addContentBlock(container: HTMLElement, type: ContentType, item?: ContentBlock): void {
  const contentType = item?.type ?? type
  const isImage = contentType === 'image'
  const block = el('div', { class: 'block-row content-block', 'data-content-type': contentType })
  const textFields = el(
    'div',
    { class: 'content-text-fields' },
    el('label', { style: 'margin-top:8px' }, '正文 · Enter 另起一段 · Shift + Enter 同段换行', el('span', { class: 'required' }, '*')),
    el('div', { class: 'content-value' }),
  )
  const imageFields = el(
    'div',
    { class: 'content-image-fields row', style: `${isImage ? '' : 'display:none;'}margin-top:8px` },
    el(
      'div',
      {},
      el('label', {}, '图片链接', el('span', { class: 'required' }, '*')),
      el('input', { class: 'content-image-file', placeholder: '输入图片链接' }),
    ),
    el(
      'div',
      {},
      el('label', {}, '图片说明', el('span', { class: 'required' }, '*')),
      el('input', { class: 'content-image-caption', placeholder: '图片说明' }),
    ),
  )
  const header = el(
    'div',
    { class: 'row' },
    el('div', { style: 'flex:0 0 120px;padding:5px 0;color:var(--dim);font-size:13px' }, isImage ? '图片' : '文字'),
    el('button', { class: 'btn sm', title: '上移', onclick: () => moveListItem(block, -1) }, '↑'),
    el('button', { class: 'btn sm', title: '下移', onclick: () => moveListItem(block, 1) }, '↓'),
    el('button', { class: 'btn sm danger', onclick: () => block.remove() }, '删除'),
  )
  textFields.style.display = isImage ? 'none' : ''
  block.append(header, textFields, imageFields)
  if (item?.type === 'image') {
    query<HTMLInputElement>(block, '.content-image-file').value = item.file
    query<HTMLInputElement>(block, '.content-image-caption').value = item.caption
  }
  container.append(block)
  if (!isImage) {
    block.dataset.blockId = item?.type === 'text' ? item.id : crypto.randomUUID()
    const handle = createBodyEditor(query<HTMLElement>(block, '.content-value'), item?.type === 'text' ? item.doc : plainTextDocument([]), (history) => {
      proofreadPanel?.changed(history)
      refresh()
    })
    bodyEditors.set(block, handle)
    query<HTMLElement>(block, '.content-value').addEventListener('focusin', () => { lastBodyEditor = handle; lastInput = null })
  }
}

function sectionMeta(type: SectionType): SectionOption {
  return SECTION_TYPE_OPTIONS.find(([value]) => value === type) ?? SECTION_TYPE_OPTIONS[0]
}

function addSection(mechanicBox: HTMLElement, section?: StrategySection): void {
  const sectionBox = el('div', { class: 'card section-box', style: 'margin:8px 0;padding:10px' })
  const typeSelect = el('select', { class: 'section-type' })
  SECTION_TYPE_OPTIONS.forEach(([value, label]) => {
    typeSelect.append(el('option', { value }, label))
  })
  const titleLabel = el('label', {})
  const required = el('span', { class: 'required' }, '*')
  const titleInput = el('input', { class: 'section-title' })
  const contentBox = el('div', { class: 'section-content' })
  const header = el(
    'div',
    { class: 'row' },
    el(
      'div',
      { style: 'flex:0 0 160px' },
      el('label', {}, '区块类型', el('span', { class: 'required' }, '*')),
      typeSelect,
    ),
    el('div', { style: 'flex:1' }, titleLabel, titleInput),
    el(
      'button',
      { class: 'btn sm', style: 'margin-top:22px', title: '上移', onclick: () => moveListItem(sectionBox, -1) },
      '↑',
    ),
    el(
      'button',
      { class: 'btn sm', style: 'margin-top:22px', title: '下移', onclick: () => moveListItem(sectionBox, 1) },
      '↓',
    ),
    el('button', { class: 'btn sm danger', style: 'margin-top:22px', onclick: () => sectionBox.remove() }, '删除区块'),
  )
  const renderFields = (): void => {
    const type = selectedSectionType(typeSelect)
    const [, , label, placeholder, isRequired] = sectionMeta(type)
    sectionBox.className = `card section-box section-${type}`
    titleLabel.textContent = label
    if (isRequired) titleLabel.append(required)
    titleInput.placeholder = placeholder
  }
  typeSelect.addEventListener('change', renderFields)
  sectionBox.append(
    header,
    contentBox,
    el(
      'div',
      { class: 'row', style: 'margin-top:8px;gap:8px' },
      el(
        'button',
        { class: 'btn sm', style: 'flex:0 0 auto', onclick: () => addContentBlock(contentBox, 'text') },
        '＋ 添加文字',
      ),
      el(
        'button',
        { class: 'btn sm', style: 'flex:0 0 auto', onclick: () => addContentBlock(contentBox, 'image') },
        '＋ 添加图片',
      ),
    ),
  )
  if (section) {
    typeSelect.value = section.type
    titleInput.value = section.title
    section.content.forEach((item) => {
      addContentBlock(contentBox, item.type, item)
    })
  }
  renderFields()
  query<HTMLElement>(mechanicBox, ':scope > .sections').append(sectionBox)
}

function addMechanic(parentBox: HTMLElement, mechanic?: StrategyMechanic, isSub = false): void {
  const box = el(
    'div',
    { class: 'mech-box' },
    el(
      'div',
      { class: 'row', style: 'margin-bottom:6px' },
      el(
        'div',
        { style: 'flex:2' },
        el('label', {}, '机制名称', el('span', { class: 'required' }, '*')),
        el('input', { class: 'inp-mech-name', placeholder: '无之膨胀' }),
      ),
      el(
        'div',
        { style: 'flex:1' },
        el('label', {}, '编号（英文小写+短横线，本阶段唯一）', el('span', { class: 'required' }, '*')),
        el('input', { class: 'inp-mech-id', placeholder: 'expansion' }),
      ),
      el('button', { class: 'btn sm danger', style: 'margin-top:22px', onclick: () => box.remove() }, '删除机制'),
    ),
    el('div', { style: 'margin-top:8px;font-size:13px;color:var(--dim)' }, '内容区块（按顺序渲染）'),
    el('div', { class: 'sections' }),
    el(
      'div',
      { style: 'margin:6px 0' },
      el('button', { class: 'btn sm', onclick: () => addSection(box) }, '＋ 添加区块'),
    ),
    el(
      'div',
      { style: 'margin:6px 0' },
      el(
        'button',
        {
          class: 'btn sm',
          style: 'margin-left:6px',
          onclick: () => {
            query<HTMLDetailsElement>(box, ':scope > .sub-mechanics-box').open = true
            addMechanic(box, undefined, true)
          },
        },
        '＋ 子机制',
      ),
    ),
    el(
      'details',
      { class: 'sub-mechanics-box' },
      el('summary', {}, '子机制列表'),
      el('div', { class: 'sub-mechanics' }),
    ),
  )
  if (mechanic) {
    query<HTMLInputElement>(box, '.inp-mech-name').value = mechanic.name
    query<HTMLInputElement>(box, '.inp-mech-id').value = mechanic.id
    mechanic.sections.forEach((section) => {
      addSection(box, section)
    })
    if (mechanic.sub_mechanics.length) query<HTMLDetailsElement>(box, ':scope > .sub-mechanics-box').open = true
    mechanic.sub_mechanics.forEach((subMechanic) => {
      addMechanic(box, subMechanic, true)
    })
  }
  const target = isSub ? query<HTMLElement>(parentBox, '.sub-mechanics') : query<HTMLElement>(parentBox, '.mechs')
  target.append(box)
}

function addPhase(phase?: StrategyPhase): void {
  const box = el(
    'div',
    { class: 'card' },
    el(
      'div',
      { class: 'head' },
      el('div', {}, el('span', { class: 'phase-tag' }, 'Phase'), el('b', {}, '阶段')),
      el('button', { class: 'btn sm danger', onclick: () => box.remove() }, '删除阶段'),
    ),
    el(
      'div',
      { class: 'grid2' },
      el(
        'div',
        {},
        el('label', {}, '阶段 id（如 p1）', el('span', { class: 'required' }, '*')),
        el('input', { class: 'inp-phase-title', placeholder: 'p1' }),
      ),
      el(
        'div',
        {},
        el('label', {}, '阶段 name（如 前半）', el('span', { class: 'required' }, '*')),
        el('input', { class: 'inp-phase-sub', placeholder: '前半' }),
      ),
    ),
    el('div', { class: 'mechs', style: 'margin-top:10px' }),
    el(
      'div',
      { style: 'margin-top:8px' },
      el('button', { class: 'btn sm', onclick: () => addMechanic(box) }, '＋ 添加机制'),
    ),
  )
  if (phase) {
    query<HTMLInputElement>(box, '.inp-phase-title').value = phase.id
    query<HTMLInputElement>(box, '.inp-phase-sub').value = phase.name
    phase.mechanics.forEach((mechanic) => {
      addMechanic(box, mechanic)
    })
  }
  byId<HTMLElement>('phases').append(box)
}

function parseStoredJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as unknown) : null
  } catch {
    return null
  }
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function getCosSettings(): CosSettings {
  const stored = parseStoredJson('xivstrat_cos_settings')
  const source = isRecord(stored) ? stored : {}
  return {
    'cos-secret-id': stringField(source['cos-secret-id']),
    'cos-secret-key': stringField(source['cos-secret-key']),
    'cos-bucket': stringField(source['cos-bucket']),
    'cos-region': stringField(source['cos-region']),
  }
}

function loadCosSettings(): void {
  const settings = getCosSettings()
  COS_SETTING_KEYS.forEach((key) => {
    byId<HTMLInputElement>(key).value = settings[key]
  })
}

function saveCosSettings(): void {
  const settings = {} as CosSettings
  COS_SETTING_KEYS.forEach((key) => {
    settings[key] = byId<HTMLInputElement>(key).value.trim()
  })
  localStorage.setItem('xivstrat_cos_settings', JSON.stringify(settings))
  byId<HTMLElement>('cos-status').textContent = '✓ 已保存'
}

function ensureCosSdk(): Promise<CosConstructor> {
  if (window.COS) return Promise.resolve(window.COS)
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://unpkg.com/cos-js-sdk-v5/dist/cos-js-sdk-v5.min.js'
    script.onload = () => (window.COS ? resolve(window.COS) : reject(new Error('COS SDK 未正确加载')))
    script.onerror = () => reject(new Error('无法加载 COS SDK（需要联网），请改用腾讯云 COS 控制台手动上传'))
    document.head.append(script)
  })
}

async function testCos(): Promise<void> {
  const settings = getCosSettings()
  const status = byId<HTMLElement>('cos-status')
  if (!settings['cos-secret-id'] || !settings['cos-secret-key']) {
    status.textContent = '请先填写 SecretId / SecretKey'
    return
  }
  try {
    const COS = await ensureCosSdk()
    const client = new COS({ SecretId: settings['cos-secret-id'], SecretKey: settings['cos-secret-key'] })
    client.getService({}, (error) => {
      status.textContent = error ? `连接失败：${errorMessage(error)}` : '✓ 连接成功'
    })
  } catch (error) {
    status.textContent = errorMessage(error)
  }
}

function sanitizeName(name: string): string {
  const sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return sanitized || `img-${Math.floor(Date.now() % 100000)}`
}

function initHomeImageRows(): void {
  ;(Object.keys(HOME_IMAGES) as HomeImageKey[]).forEach((key) => {
    const fileInput = byId<HTMLInputElement>(`f-${key}`)
    const pathInput = byId<HTMLInputElement>(`inp-${key}`)
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0]
      if (!file) return
      const dutyId = byId<HTMLInputElement>('inp-id').value.trim() || 'duty'
      const base = sanitizeName(file.name.replace(/\.[^.]+$/, ''))
      const extension = (file.name.match(/\.[^.]+$/) ?? ['.png'])[0].toLowerCase()
      pathInput.value = `${HOME_IMAGES[key]}${dutyId}/${base}${extension}`
      byId<HTMLElement>(`st-${key}`).textContent = '待上传'
      refresh()
    })
  })
}

function hasCosUploadSettings(settings: CosSettings): boolean {
  return Boolean(
    settings['cos-secret-id'] && settings['cos-secret-key'] && settings['cos-bucket'] && settings['cos-region'],
  )
}

function uploadHomeImage(key: HomeImageKey): void {
  const file = byId<HTMLInputElement>(`f-${key}`).files?.[0]
  const path = byId<HTMLInputElement>(`inp-${key}`).value.trim()
  if (!file) {
    alert('请先点击「🖼 选图」选择图片文件')
    return
  }
  if (!path) {
    alert('请先填写图片路径')
    return
  }
  const settings = getCosSettings()
  if (!hasCosUploadSettings(settings)) {
    alert('请先在「☁️ 图片直传 COS 设置」里填写并保存密钥')
    return
  }
  const status = byId<HTMLElement>(`st-${key}`)
  void ensureCosSdk()
    .then((COS) => {
      const client = new COS({ SecretId: settings['cos-secret-id'], SecretKey: settings['cos-secret-key'] })
      client.putObject(
        {
          Bucket: settings['cos-bucket'],
          Region: settings['cos-region'],
          Key: path,
          Body: file,
          ContentLength: file.size,
          onProgress: (progress) => {
            status.textContent = `上传中 ${Math.round((progress.loaded / progress.total) * 100)}%`
          },
        },
        (error) => {
          if (error) {
            status.textContent = '✗ 失败'
            alert(`上传失败：${errorMessage(error)}`)
          } else status.textContent = '✓ 已上传'
        },
      )
    })
    .catch((error) => alert(errorMessage(error)))
}

function readImageLibrary(): ImageLibraryEntry[] {
  const stored = parseStoredJson('xivstrat_img_lib')
  if (!Array.isArray(stored)) return []
  return stored.flatMap((item) => {
    if (!isRecord(item)) return []
    const path = stringField(item.path)
    if (!path) return []
    return [{ name: stringField(item.name), path, thumb: stringField(item.thumb) }]
  })
}

function saveImageLibrary(entries: ImageLibraryEntry[]): void {
  localStorage.setItem('xivstrat_img_lib', JSON.stringify(entries))
}

function renderImageLibrary(): void {
  const list = byId<HTMLElement>('lib-list')
  const entries = readImageLibrary()
  list.innerHTML = ''
  if (!entries.length) {
    list.append(el('div', { class: 'hint' }, '（图库为空：选图后点「＋ 加入图库」，或手动填名称+路径加入）'))
    return
  }
  entries.forEach((entry) => {
    list.append(
      el(
        'div',
        { class: 'img-row' },
        entry.thumb
          ? el('img', {
              src: entry.thumb,
              style: 'width:44px;height:44px;object-fit:cover;border-radius:6px;border:1px solid var(--line)',
            })
          : el('span', { style: 'font-size:22px' }, '🖼'),
        el('span', { style: 'flex:1;min-width:100px' }, entry.name),
        el('span', { class: 'hint', style: 'flex:2;min-width:140px;word-break:break-all' }, entry.path),
        el('button', { class: 'btn sm danger', onclick: () => removeImageLibraryEntry(entry.path) }, '删除'),
      ),
    )
  })
}

function removeImageLibraryEntry(path: string): void {
  saveImageLibrary(readImageLibrary().filter((entry) => entry.path !== path))
  renderImageLibrary()
  refresh()
}

function clearImageLibrary(): void {
  if (!confirm('确定清空整个图片图库吗？')) return
  localStorage.removeItem('xivstrat_img_lib')
  renderImageLibrary()
  refresh()
}

function makeThumbnail(file: File): Promise<string> {
  return new Promise((resolve) => {
    const image = new Image()
    const url = URL.createObjectURL(file)
    const finish = (result: string): void => {
      URL.revokeObjectURL(url)
      resolve(result)
    }
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        const size = 48
        const scale = Math.min(1, size / Math.max(image.width || 1, image.height || 1))
        canvas.width = Math.max(1, Math.round((image.width || 1) * scale))
        canvas.height = Math.max(1, Math.round((image.height || 1) * scale))
        const context = canvas.getContext('2d')
        if (!context) return finish('')
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        finish(canvas.toDataURL('image/jpeg', 0.7))
      } catch {
        finish('')
      }
    }
    image.onerror = () => finish('')
    image.src = url
  })
}

async function addImageLibraryEntry(): Promise<void> {
  const nameInput = byId<HTMLInputElement>('lib-name')
  const pathInput = byId<HTMLInputElement>('lib-path')
  const name = nameInput.value.trim()
  const path = pathInput.value.trim()
  if (!name && !path) {
    alert('请填写名称或路径')
    return
  }
  if (!path) {
    alert('请填写 COS 路径（或先选图自动生成）')
    return
  }
  const entries = readImageLibrary()
  if (entries.some((entry) => entry.path === path)) {
    alert('该路径已在图库中')
    return
  }
  const file = libPendingFile
  const finalName = name || (file ? file.name.replace(/\.[^.]+$/, '') : (path.split('/').pop() ?? path))
  const entry: ImageLibraryEntry = { name: finalName, path, thumb: file ? await makeThumbnail(file) : '' }
  entries.push(entry)
  saveImageLibrary(entries)
  renderImageLibrary()
  nameInput.value = ''
  pathInput.value = ''
  libPendingFile = null
  const status = optionalById<HTMLElement>('lib-status')
  if (status) status.textContent = '✓ 已加入图库'
  refresh()
}

function uploadSelectedLibraryImage(): void {
  const file = libPendingFile
  const path = byId<HTMLInputElement>('lib-path').value.trim()
  if (!file) {
    alert('请先点「🖼 选图」选择本地图片')
    return
  }
  if (!path) {
    alert('请先填写路径')
    return
  }
  const settings = getCosSettings()
  if (!hasCosUploadSettings(settings)) {
    alert('请先配置 COS 密钥（上方设置面板）')
    return
  }
  const status = byId<HTMLElement>('lib-status')
  void ensureCosSdk()
    .then((COS) => {
      const client = new COS({ SecretId: settings['cos-secret-id'], SecretKey: settings['cos-secret-key'] })
      client.putObject(
        {
          Bucket: settings['cos-bucket'],
          Region: settings['cos-region'],
          Key: path,
          Body: file,
          ContentLength: file.size,
          onProgress: (progress) => {
            status.textContent = `上传中 ${Math.round((progress.loaded / progress.total) * 100)}%`
          },
        },
        (error) => {
          if (error) {
            status.textContent = '✗ 失败'
            alert(`上传失败：${errorMessage(error)}`)
          } else status.textContent = `✓ 已上传：${path}`
        },
      )
    })
    .catch((error) => alert(errorMessage(error)))
}

function xivKey(): string {
  try {
    return localStorage.getItem('xivstrat_xivapi_key') ?? ''
  } catch {
    return ''
  }
}

function saveXivKey(): void {
  localStorage.setItem('xivstrat_xivapi_key', byId<HTMLInputElement>('xiv-key').value.trim())
  byId<HTMLElement>('xiv-status').textContent = '✓ Key 已保存（只存在本机浏览器）'
}

function loadXivKey(): void {
  const key = xivKey()
  if (key) byId<HTMLInputElement>('xiv-key').value = key
}

function xivAssetUrl(iconField: string): string {
  return iconField ? `https://v2.xivapi.com/api/asset/${iconField}` : ''
}

function xivResults(value: unknown): XivSearchResult[] {
  if (!isRecord(value) || !Array.isArray(value.Results)) return []
  return value.Results.filter(isRecord).map((result) => ({
    RowId: typeof result.RowId === 'number' || typeof result.RowId === 'string' ? result.RowId : undefined,
    Fields: isRecord(result.Fields) ? result.Fields : undefined,
  }))
}

async function searchXiv(): Promise<void> {
  const sheet = byId<HTMLSelectElement>('xiv-sheet').value
  const language = byId<HTMLSelectElement>('xiv-lang').value
  const keyword = byId<HTMLInputElement>('xiv-q').value.trim()
  const status = byId<HTMLElement>('xiv-status')
  const resultsBox = byId<HTMLElement>('xiv-results')
  if (!keyword) {
    status.textContent = '请输入关键词'
    return
  }
  status.textContent = '搜索中…（XIVAPI v2）'
  resultsBox.innerHTML = ''
  const params = new URLSearchParams({
    sheets: sheet,
    query: keyword,
    language,
    limit: '10',
    fields: 'Name,Singular,Icon',
  })
  const headers: Record<string, string> = {}
  const key = xivKey()
  if (key) headers['X-Api-Key'] = key
  try {
    const response = await fetch(`https://v2.xivapi.com/api/search?${params.toString()}`, { headers })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const results = xivResults((await response.json()) as unknown)
    status.textContent = `找到 ${results.length} 条（${sheet} / ${language}）`
    if (!results.length) {
      resultsBox.append(el('div', { class: 'hint' }, '没有结果，试试英文关键词或切换语言'))
      return
    }
    results.forEach((result) => {
      const fields = result.Fields ?? {}
      const name = (stringField(fields.Name) || stringField(fields.Singular)).trim() || `#${result.RowId ?? ''}`
      const icon = xivAssetUrl(stringField(fields.Icon))
      resultsBox.append(
        el(
          'div',
          { class: 'img-row' },
          icon
            ? el('img', {
                src: icon,
                style: 'width:40px;height:40px;object-fit:contain;border-radius:6px;background:#000;flex:0 0 auto',
              })
            : el('span', { style: 'width:40px;text-align:center;flex:0 0 auto' }, '🗒'),
          el(
            'span',
            { style: 'flex:1;min-width:100px' },
            name,
            el('span', { class: 'hint' }, ` #${result.RowId ?? ''}`),
          ),
          el('button', { class: 'btn sm', onclick: () => insertXivName(name) }, '插入名字'),
          icon ? el('button', { class: 'btn sm', onclick: () => addXivIconToLibrary(name, icon) }, '图标→图库') : null,
          icon ? el('button', { class: 'btn sm', onclick: () => copyXivIcon(icon) }, '复制图标地址') : null,
        ),
      )
    })
  } catch (error) {
    status.textContent = `查询失败：${errorMessage(error)}`
  }
}

function insertAtCaret(input: HTMLInputElement | HTMLTextAreaElement, text: string, caretOffset = text.length): void {
  const start = input.selectionStart ?? input.value.length
  const end = input.selectionEnd ?? start
  input.value = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`
  const position = start + caretOffset
  input.focus()
  input.setSelectionRange(position, position)
}

function insertXivName(name: string): void {
  if (lastBodyEditor) { lastBodyEditor.insertText(name); return }
  if (!lastInput) {
    alert('请先点击一个输入框，再点「插入名字」')
    return
  }
  insertAtCaret(lastInput, name)
}

function addXivIconToLibrary(name: string, icon: string): void {
  const entries = readImageLibrary()
  if (entries.some((entry) => entry.path === icon)) {
    alert('该图标已在图库中')
    return
  }
  entries.push({ name: `${name} 图标`, path: icon, thumb: '' })
  saveImageLibrary(entries)
  renderImageLibrary()
  refresh()
  alert(`已加入图库：${name}`)
}

function copyXivIcon(icon: string): void {
  if (navigator.clipboard) {
    void navigator.clipboard
      .writeText(icon)
      .then(() => alert(`已复制图标地址：${icon}`))
      .catch(() => alert(icon))
  } else alert(icon)
}

function syncTime(): void {
  const date = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  byId<HTMLInputElement>('inp-date').value =
    `${pad(date.getFullYear() % 100)}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  refresh()
}

function collectContent(container: HTMLElement): ContentBlock[] {
  return all<HTMLElement>(container, ':scope > .content-block').map((block) => {
    if (block.dataset.contentType === 'image') {
      return {
        type: 'image',
        file: query<HTMLInputElement>(block, '.content-image-file').value.trim(),
        caption: query<HTMLInputElement>(block, '.content-image-caption').value.trim(),
      }
    }
    const handle = bodyEditors.get(block)
    if (!handle) throw new Error('正文编辑器未初始化')
    return { type: 'text', id: block.dataset.blockId!, doc: handle.getDocument() }
  })
}

function collectSection(sectionBox: HTMLElement): StrategySection {
  const type = selectedSectionType(query<HTMLSelectElement>(sectionBox, '.section-type'))
  return {
    type,
    title: query<HTMLInputElement>(sectionBox, '.section-title').value.trim(),
    content: collectContent(query<HTMLElement>(sectionBox, ':scope > .section-content')),
  }
}

function collectMechanic(mechanicBox: HTMLElement): StrategyMechanic {
  return {
    id: query<HTMLInputElement>(mechanicBox, '.inp-mech-id').value.trim(),
    name: query<HTMLInputElement>(mechanicBox, '.inp-mech-name').value.trim(),
    sections: all<HTMLElement>(mechanicBox, ':scope > .sections > .section-box').map(collectSection),
    sub_mechanics: all<HTMLElement>(mechanicBox, ':scope > .sub-mechanics-box > .sub-mechanics > .mech-box').map(
      collectMechanic,
    ),
  }
}

function collect(): StrategyStructure {
  const references = all<HTMLElement>(document, '#refs > .row')
    .map((row) => ({
      label: query<HTMLInputElement>(row, '.inp-ref-label').value.trim(),
      url: query<HTMLInputElement>(row, '.inp-ref-url').value.trim(),
    }))
    .filter((reference) => reference.label || reference.url)
  const macros = all<HTMLElement>(document, '#macros > .card')
    .map((card) => ({
      name: query<HTMLInputElement>(card, '.inp-macro-title').value.trim(),
      code: query<HTMLTextAreaElement>(card, '.inp-macro-code').value,
    }))
    .filter((macro) => macro.name || macro.code)
  const phases = all<HTMLElement>(document, '#phases > .card')
    .map((card) => {
      const id = query<HTMLInputElement>(card, '.inp-phase-title').value.trim().toLowerCase()
      const name = query<HTMLInputElement>(card, '.inp-phase-sub').value.trim()
      return {
        id,
        name,
        mechanics: all<HTMLElement>(card, ':scope > .mechs > .mech-box').map(collectMechanic),
      }
    })
    .filter((phase) => phase.id || phase.name || phase.mechanics.length)
  return {
    schemaVersion: 2,
    metadata: {
      id: byId<HTMLInputElement>('inp-id').value.trim(),
      name: byId<HTMLInputElement>('inp-name').value.trim(),
      short_name: byId<HTMLInputElement>('inp-short').value.trim(),
      type: selectedDutyType(),
      title: byId<HTMLInputElement>('inp-title').value.trim(),
      description: byId<HTMLInputElement>('inp-desc').value.trim(),
      banner: byId<HTMLInputElement>('inp-banner').value.trim(),
      publish_time: byId<HTMLInputElement>('inp-date').value.trim(),
      status: selectedStatus(),
      video: byId<HTMLInputElement>('inp-video').value.trim(),
      team: byId<HTMLInputElement>('inp-group').value.trim(),
    },
    references,
    macros,
    phases,
  }
}

function renderPreview(structure: StrategyStructure, target: HTMLElement): void {
  target.innerHTML = ''
  if (!structure.phases.length) {
    target.append(
      el(
        'div',
        { class: 'empty-state' },
        el('div', { class: 'es-title' }, '📭 还没有内容'),
        el('div', { class: 'hint' }, '去第③步添加“阶段”和“机制”，或先看看示例长什么样：'),
        el('button', { class: 'btn primary', onclick: () => loadDemo() }, '🎲 载入示例'),
      ),
    )
    return
  }
  const showContent = (container: HTMLElement, content: ContentBlock[]): void => {
    content.forEach((item) => {
      if (item.type === 'image')
        container.append(el('span', { class: 'img-chip' }, `🖼 ${item.file}${item.caption ? ` · ${item.caption}` : ''}`))
      else {
        const text = el('div', {})
        text.innerHTML = renderRichText(item.doc)
        container.append(text)
      }
    })
  }
  const showSection = (container: HTMLElement, section: StrategySection): void => {
    const label = section.type === 'solution' ? '解法' : section.type === 'note' ? '注意' : '机制'
    const colorClass = section.type === 'solution' ? 'sol' : section.type === 'note' ? 'note' : 'mech'
    const box = el('div', { class: `box ${colorClass}` })
    box.append(el('div', { class: 'ptag' }, `${label}${section.title ? ` · ${section.title}` : ''}`))
    showContent(box, section.content)
    container.append(box)
  }
  const showMechanic = (container: HTMLElement, mechanic: StrategyMechanic): void => {
    if (!mechanic.id && !mechanic.name) return
    const box = el('div', { class: 'preview-mechanic' })
    const name = mechanic.name || '未命名机制'
    box.append(el('div', { class: 'sep' }, `◆ ${name}${mechanic.id ? ` #${mechanic.id}` : '（缺少 id）'}`))
    mechanic.sections.forEach((section) => {
      showSection(box, section)
    })
    const subMechanics = el('div', { class: 'preview-sub-mechanics' })
    mechanic.sub_mechanics.forEach((subMechanic) => {
      showMechanic(subMechanics, subMechanic)
    })
    if (subMechanics.childNodes.length) box.append(subMechanics)
    container.append(box)
  }
  structure.phases.forEach((phase) => {
    target.append(el('div', { class: 'p-title' }, `🕐 ${phase.id}${phase.name ? ` · ${phase.name}` : ''}`))
    phase.mechanics.forEach((mechanic) => {
      showMechanic(target, mechanic)
    })
  })
}

function refresh(): void {
  proofreadPanel?.changed()
  const structure = collect()
  const errors = validateStructure(structure)
  const files = filesFromStructure(structure)
  const list = byId<HTMLUListElement>('vlist')
  const badge = byId<HTMLElement>('vbadge')
  list.innerHTML = ''
  if (errors.length) {
    badge.innerHTML = `<span class="err-badge">${errors.length} 个问题</span>`
    errors.forEach((error) => {
      list.append(el('li', { class: 'err' }, `❌ ${error}`))
    })
  } else {
    badge.innerHTML = '<span class="ok-badge">✓ 全部通过（0 错误）</span>'
    list.append(el('li', {}, '✅ 可以导出并进网站了'))
  }
  if (byId<HTMLElement>('step4').classList.contains('active')) showProofreadReading()
  renderPreview(structure, byId<HTMLElement>('preview'))
  const fileList = byId<HTMLElement>('filelist')
  fileList.innerHTML = ''
  Object.entries(files).forEach(([path, content]) => {
    fileList.append(
      el(
        'div',
        { class: 'f' },
        el('span', {}, path),
        el('button', { class: 'btn sm', onclick: () => downloadFile(path, content) }, '下载'),
      ),
    )
  })
  latestGenerated = { files, structure, schemaText: structureToJson(structure) }
}

function generated(): GeneratedSnapshot {
  refresh()
  if (!latestGenerated) throw new Error('未生成编辑器数据')
  return latestGenerated
}

function renderSubmissionState(state: SubmissionUiState): void {
  const button = byId<HTMLButtonElement>('btn-submit-review')
  const status = byId<HTMLElement>('submission-status')
  button.disabled = !submissionCanStart(state)
  button.textContent = state.status === 'submitting'
    ? '正在提交…'
    : state.status === 'error' && !state.retrySafe
      ? '等待人工确认'
      : '提交审核'
  button.setAttribute('aria-busy', String(state.status === 'submitting'))
  status.replaceChildren()

  if (state.status === 'idle') {
    status.textContent = '提交前会使用当前编辑器中的 schema 数据，并由服务端再次校验。'
    return
  }
  if (state.status === 'submitting') {
    status.textContent = '正在提交，请不要关闭页面或重复点击。'
    return
  }
  if (state.status === 'success') {
    const result = el('div', { class: 'submission-result success' })
    result.append(
      el('strong', {}, `提交成功，已创建 PR #${state.prNumber}`),
      el('a', {
        href: state.prUrl,
        target: '_blank',
        rel: 'noopener noreferrer',
      }, '查看 PR'),
      el('span', { class: 'submission-id' }, `Submission ID: ${state.submissionId}`),
    )
    status.append(result)
    return
  }

  const result = el('div', { class: `submission-result ${state.retrySafe ? 'error' : 'warning'}` })
  result.append(el('strong', {}, state.message))
  if (state.details.length) {
    const details = el('ul', { class: 'vlist' })
    state.details.forEach((detail) => details.append(el('li', { class: 'err' }, detail)))
    result.append(details)
  }
  status.append(result)
}

function submitForReview(): void {
  if (!submissionController) return
  void submissionController.submit(generated().structure)
}

function initSubmission(): void {
  if (import.meta.env.PROD) {
    byId<HTMLButtonElement>('btn-submit-review').disabled = true
    byId<HTMLElement>('submission-status').textContent = '当前环境暂未开放提交功能'
    return
  }
  submissionController = createSubmissionController({
    fetch: (...args) => fetch(...args),
    onStateChange: renderSubmissionState,
  })
  renderSubmissionState(submissionController.getState())
}

function downloadFile(name: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = name.split('/').pop() ?? name
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 3000)
}

function downloadTemplate(): void {
  const snapshot = generated()
  downloadFile(`${snapshot.structure.metadata.id || 'duty'}-schema.json`, snapshot.schemaText)
}

function downloadBundle(): void {
  const snapshot = generated()
  const parts = ['==== XivStrat YAML schema v0.1 数据 ====\n', snapshot.schemaText, '\n']
  Object.entries(snapshot.files).forEach(([path, content]) => {
    parts.push(`==== ${path} ====\n${content}\n`)
  })
  downloadFile('xivstrat-攻略文件包.txt', parts.join(''))
}

function copyAllFiles(): void {
  const snapshot = generated()
  const parts = ['==== schema 数据 ====\n', snapshot.schemaText, '\n']
  Object.entries(snapshot.files).forEach(([path, content]) => {
    parts.push(`==== ${path} ====\n${content}\n`)
  })
  const text = parts.join('')
  const fallback = (): void => {
    const textarea = document.createElement('textarea')
    textarea.value = text
    document.body.append(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
    alert('已复制！')
  }
  if (!navigator.clipboard) {
    fallback()
    return
  }
  void navigator.clipboard
    .writeText(text)
    .then(() => alert('已复制全部文件内容到剪贴板！'))
    .catch(fallback)
}

function importTemplate(): void {
  let structure: StrategyStructure
  try {
    structure = parseTemplate(byId<HTMLTextAreaElement>('importArea').value)
  } catch (error) {
    alert(`导入失败：请输入合法的 schema JSON（${errorMessage(error)}）`)
    return
  }
  if (!structure.phases.length) {
    alert('没有解析到 phases，请检查 schema 数据结构')
    return
  }
  const { metadata } = structure
  byId<HTMLInputElement>('inp-id').value = metadata.id
  byId<HTMLInputElement>('inp-name').value = metadata.name
  byId<HTMLInputElement>('inp-short').value = metadata.short_name
  byId<HTMLSelectElement>('inp-type').value = metadata.type ? TYPE_FROM_JSON[metadata.type] : '极神'
  byId<HTMLInputElement>('inp-title').value = metadata.title
  byId<HTMLInputElement>('inp-desc').value = metadata.description
  byId<HTMLInputElement>('inp-banner').value = metadata.banner
  byId<HTMLInputElement>('inp-date').value = metadata.publish_time
  byId<HTMLSelectElement>('inp-status').value = metadata.status ? STATUS_FROM_JSON[metadata.status] : '草稿'
  byId<HTMLInputElement>('inp-video').value = metadata.video
  byId<HTMLInputElement>('inp-group').value = metadata.team
  byId<HTMLElement>('refs').innerHTML = ''
  structure.references.forEach(addRef)
  byId<HTMLElement>('macros').innerHTML = ''
  structure.macros.forEach(addMacro)
  proofreadPanel?.changed(true)
  bodyEditors.forEach(handle => handle.destroy())
  bodyEditors.clear()
  lastBodyEditor = undefined
  byId<HTMLElement>('phases').innerHTML = ''
  structure.phases.forEach(addPhase)
  goStep(5)
  alert(`导入成功！共 ${structure.phases.length} 个阶段。`)
}

function loadDemo(): void {
  const demo = normalizeStructure({
    metadata: {
      id: 'demo',
      name: '示例副本',
      short_name: '极示例',
      type: 'extreme',
      title: '示例副本攻略',
      description: '最终幻想14 示例副本攻略',
      banner: 'banners/07/demo.webp',
      publish_time: '26/01/01 12:00',
      status: 'done',
      video: 'https://www.bilibili.com/video/BVxxxxxx/',
      team: 'MMW攻略组',
    },
    references: [{ label: '示例视频', url: 'https://www.bilibili.com/video/BVxxxxxx/' }],
    macros: [{ name: '示例站位', code: '/p 【机制】MT去A点\n/p {D}去B点' }],
    phases: [
      {
        id: 'p1',
        name: '前半',
        mechanics: [
          {
            id: 'demo-mech',
            name: '示例机制',
            sections: [
              {
                type: 'mechanic',
                title: '机制说明',
                content: [
                  { type: 'text', value: ['处理机制时注意观察标记。'] },
                  { type: 'image', file: 'P1/demo-1.webp', caption: '示意图' },
                ],
              },
              { type: 'solution', title: '固定站位', content: [{ type: 'text', value: ['被点名的人远离人群。'] }] },
              { type: 'note', title: '', content: [{ type: 'text', value: ['这是注意事项。'] }] },
            ],
            sub_mechanics: [],
          },
        ],
      },
    ],
  })
  byId<HTMLTextAreaElement>('importArea').value = structureToJson(demo)
  importTemplate()
}

function bindStaticEvents(): void {
  all<HTMLButtonElement>(document, 'nav.steps button[data-step]').forEach((button) => {
    button.addEventListener('click', () => goStep(Number(button.dataset.step)))
  })
  byId<HTMLButtonElement>('btn-upload-banner').addEventListener('click', () => uploadHomeImage('banner'))
  byId<HTMLButtonElement>('btn-sync-time').addEventListener('click', syncTime)
  byId<HTMLButtonElement>('btn-step-1-next').addEventListener('click', () => goStep(2))
  byId<HTMLButtonElement>('btn-add-ref').addEventListener('click', () => addRef())
  byId<HTMLButtonElement>('btn-add-macro').addEventListener('click', () => addMacro())
  byId<HTMLButtonElement>('btn-step-2-back').addEventListener('click', () => goStep(1))
  byId<HTMLButtonElement>('btn-step-2-next').addEventListener('click', () => goStep(3))
  byId<HTMLButtonElement>('btn-add-phase').addEventListener('click', () => addPhase())
  byId<HTMLButtonElement>('btn-step-3-back').addEventListener('click', () => goStep(2))
  byId<HTMLButtonElement>('btn-step-3-next').addEventListener('click', () => goStep(4))
  byId<HTMLButtonElement>('btn-step-4-back').addEventListener('click', () => goStep(3))
  byId<HTMLButtonElement>('btn-step-4-next').addEventListener('click', () => goStep(5))
  byId<HTMLButtonElement>('btn-submit-review').addEventListener('click', submitForReview)
  byId<HTMLButtonElement>('btn-download-template').addEventListener('click', downloadTemplate)
  byId<HTMLButtonElement>('btn-download-legacy').addEventListener('click', () => {
    if (!confirm('导出旧版纯文本 JSON 会丢失加粗、字号和颜色。继续？')) return
    const legacy = JSON.parse(structureToJson(collect()), (_key, value: unknown) => {
      if (isRecord(value) && value.type === 'text' && 'doc' in value) return { type: 'text', value: richTextLines(value.doc as import('@xivstrat/content-schema').RichTextDocument) }
      return value
    }) as Record<string, unknown>
    delete legacy.schemaVersion
    downloadFile('strategy-legacy.json', JSON.stringify(legacy, null, 2))
  })
  byId<HTMLButtonElement>('btn-copy-all-files').addEventListener('click', copyAllFiles)
  byId<HTMLButtonElement>('btn-download-bundle').addEventListener('click', downloadBundle)
  byId<HTMLButtonElement>('btn-load-demo').addEventListener('click', loadDemo)
  byId<HTMLButtonElement>('btn-save-cos').addEventListener('click', saveCosSettings)
  byId<HTMLButtonElement>('btn-test-cos').addEventListener('click', () => {
    void testCos()
  })
  byId<HTMLButtonElement>('btn-lib-add').addEventListener('click', () => {
    void addImageLibraryEntry()
  })
  byId<HTMLButtonElement>('btn-lib-upload').addEventListener('click', uploadSelectedLibraryImage)
  byId<HTMLButtonElement>('btn-lib-clear').addEventListener('click', clearImageLibrary)
  byId<HTMLButtonElement>('btn-xiv-search').addEventListener('click', () => {
    void searchXiv()
  })
  byId<HTMLButtonElement>('btn-xiv-save-key').addEventListener('click', saveXivKey)
  byId<HTMLButtonElement>('btn-import-template').addEventListener('click', importTemplate)
}

function bindInputTracking(): void {
  document.addEventListener('focusin', (event) => {
    const target = event.target
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) { lastInput = target; lastBodyEditor = undefined }
  })
  document.addEventListener('input', (event) => {
    const target = event.target
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLTextAreaElement
    )
      refresh()
  })
  byId<HTMLInputElement>('lib-file').addEventListener('change', (event) => {
    const input = event.currentTarget
    if (!(input instanceof HTMLInputElement)) return
    const file = input.files?.[0]
    if (!file) return
    libPendingFile = file
    const base = sanitizeName(file.name.replace(/\.[^.]+$/, ''))
    const extension = (file.name.match(/\.[^.]+$/) ?? ['.png'])[0].toLowerCase()
    byId<HTMLInputElement>('lib-path').value = `07/entity_icons/${base}${extension}`
    byId<HTMLElement>('lib-status').textContent = `已选：${file.name}（可改路径后加入图库）`
  })
}

export function initEditor(): void {
  if (initialized) return
  initialized = true
  initSubmission()
  bindStaticEvents()
  bindInputTracking()
  proofreadPanel = createProofreadPanel(byId<HTMLElement>('proofread'), collect, id => {
    for (const [block, handle] of bodyEditors) if (block.isConnected && block.dataset.blockId === id) return handle
    return undefined
  }, (blockId, paragraph, from, to) => showProofreadReading({ blockId, paragraph, from, to }))
  new MutationObserver(records => {
    if (records.every(record => (record.target as HTMLElement).closest?.('.content-value'))) return
    for (const [block, handle] of bodyEditors) if (!block.isConnected) { handle.destroy(); bodyEditors.delete(block); if (lastBodyEditor === handle) lastBodyEditor = undefined }
    refresh()
  }).observe(byId<HTMLElement>('phases'), { childList: true, subtree: true })
  addRef()
  addMacro()
  addPhase()
  loadCosSettings()
  initHomeImageRows()
  renderImageLibrary()
  loadXivKey()
  refresh()
}
