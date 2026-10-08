import {
  plainTextDocument, comparePhaseNames, SECTION_TYPES, SECTION_RULES,
  type ContentBlock, type StrategyStructure, type StrategyPhase,
  type StrategyMechanic, type StrategySection, type StrategyReference, type StrategyMacro,
} from '@xivstrat/content-schema'
import { createBodyEditor, type BodyEditorHandle } from '../richtext/editor'
import { el, button } from '../ui/dom'
import { createOrderedList } from './ordered-list'
import { SECTION_PRESENTATION, sectionTitleLabel } from './presentation'
import { createImagePicker } from './image-picker'
import type { ImageAssets } from './image-assets'

interface Item<T> { root: HTMLElement; read(): T; destroy(): void }
interface Actions { remove(): void; move(direction: -1 | 1): void }
type Factory<T> = (value: T | undefined, actions: Actions) => Item<T>

function createList<T>(host: HTMLElement, factory: Factory<T>, changed: () => void) {
  const state = createOrderedList<Item<T>>()
  const remove = (item: Item<T>): void => {
    if (!state.remove(item)) return
    item.destroy()
    item.root.remove()
  }
  const add = (value?: T): void => {
    const item = factory(value, {
      remove() { remove(item); changed() },
      move(direction) {
        if (!state.move(item, direction)) return
        const entries = state.values()
        const next = entries[entries.indexOf(item) + 1]
        host.insertBefore(item.root, next?.root ?? null)
        changed()
      },
    })
    state.add(item)
    host.append(item.root)
    changed()
  }
  return {
    add,
    sort(compare: (a: T, b: T) => number) {
      const focused = document.activeElement
      const selection = focused instanceof HTMLInputElement ? [focused.selectionStart, focused.selectionEnd] as const : undefined
      state.sort((a, b) => compare(a.read(), b.read()))
      state.values().forEach((item, index) => { if (host.children[index] !== item.root) host.insertBefore(item.root, host.children[index] ?? null) })
      if (focused instanceof HTMLElement && host.contains(focused) && document.activeElement !== focused) {
        focused.focus({ preventScroll: true })
        if (focused instanceof HTMLInputElement && selection) focused.setSelectionRange(...selection)
      }
    },
    read: (): T[] => state.values().map(item => item.read()),
    replace(values: T[]) { state.values().forEach(remove); values.forEach(add); changed() },
    destroy() { state.values().forEach(remove) },
  }
}

/** Scalar state is local to the item; layout never participates in serialization. */
function field(label: string, value: string, update: (value: string) => void, options: { placeholder?: string; multiline?: boolean; required?: boolean } = {}): HTMLElement {
  const id = `field-${crypto.randomUUID()}`
  const input = options.multiline
    ? el('textarea', { id, value, class: 'code', rows: 3, placeholder: options.placeholder })
    : el('input', { id, value, placeholder: options.placeholder })
  if (options.required) input.setAttribute('aria-required', 'true')
  input.addEventListener('input', () => update(input.value))
  return el('div', { class: 'grow' },
    el('label', { for: id }, label, options.required && el('span', { class: 'required' }, '*')), input)
}

interface AuthoringOptions {
  assets: ImageAssets
  references: HTMLElement
  macros: HTMLElement
  phases: HTMLElement
  changed(history?: boolean): void
}

export function createAuthoring(options: AuthoringOptions) {
  const bodies = new Map<string, BodyEditorHandle>()
  let sortPhaseItems = (): void => {}
  const changed = (): void => { sortPhaseItems(); options.changed() }

  const content: Factory<ContentBlock> = (value, actions) => {
    const root = el('div', { class: 'block-row stack' })
    const image = value?.type === 'image'
    root.append(el('div', { class: 'actions' },
      el('span', { class: 'hint grow' }, image ? '图片' : '文字'),
      button('↑', () => actions.move(-1)), button('↓', () => actions.move(1)), button('删除', actions.remove, 'danger')))
    if (image) {
      let file = value.file, caption = value.caption
      const pathField = field('图片路径或链接', file, next => { file = next; picker.show(next); changed() }, { required: true, placeholder: '选择本地图片或输入图片链接' })
      const picker = createImagePicker(options.assets, file, next => {
        file = next; pathField.querySelector('input')!.value = next; changed()
      })
      root.append(el('div', { class: 'row' },
        pathField,
        field('图片说明（可选）', caption, next => { caption = next; changed() }, { placeholder: '图片说明' })))
      root.append(picker.root)
      return { root, read: () => ({ type: 'image', file: file, caption: caption }), destroy: picker.destroy }
    }
    const id = value?.type === 'text' ? value.id : crypto.randomUUID()
    const host = el('div', { class: 'content-value' })
    root.append(el('div', { class: 'hint' }, '正文 · Enter 另起一段 · Shift + Enter 同段换行'), host)
    const handle = createBodyEditor(host, value?.type === 'text' ? value.doc : plainTextDocument([]), options.changed)
    bodies.set(id, handle)
    return {
      root,
      read: () => ({ type: 'text', id, doc: handle.getDocument() }),
      destroy() { bodies.delete(id); handle.destroy() },
    }
  }

  const section: Factory<StrategySection> = (value, actions) => {
    let type = value?.type ?? 'mechanic', title = value?.title ?? ''
    const root = el('div', { class: 'card section-box stack', 'data-section-type': type })
    const selectId = `field-${crypto.randomUUID()}`
    const select = el('select', { id: selectId })
    SECTION_TYPES.forEach(type => select.append(el('option', { value: type }, SECTION_RULES[type].label)))
    select.value = type
    const titleField = field(sectionTitleLabel(type), title, next => { title = next; changed() }, { required: SECTION_RULES[type].titleRequired, placeholder: SECTION_PRESENTATION[type].placeholder })
    // These refs are owned by this component, never discovered from a page layout.
    const titleLabel = titleField.querySelector('label')!
    const titleInput = titleField.querySelector('input')!
    select.addEventListener('change', () => {
      type = SECTION_TYPES.find(type => type === select.value) ?? 'mechanic'
      root.dataset.sectionType = type
      titleLabel.replaceChildren(sectionTitleLabel(type))
      if (SECTION_RULES[type].titleRequired) titleLabel.append(el('span', { class: 'required' }, '*'))
      titleInput.setAttribute('aria-required', String(SECTION_RULES[type].titleRequired))
      titleInput.placeholder = SECTION_PRESENTATION[type].placeholder
      changed()
    })
    const host = el('div', { class: 'stack' })
    const children = createList(host, content, changed)
    root.append(el('div', { class: 'row' }, el('div', { class: 'grow' }, el('label', { for: selectId }, '区块类型'), select), titleField),
      el('div', { class: 'actions' }, button('上移', () => actions.move(-1)), button('下移', () => actions.move(1)), button('删除区块', actions.remove, 'danger')),
      host, el('div', { class: 'actions' }, button('＋ 添加文字', () => children.add()), button('＋ 添加图片', () => children.add({ type: 'image', file: '', caption: '' }))))
    children.replace(value?.content ?? [])
    return { root, read: () => ({ type, title: title, content: children.read() }), destroy: children.destroy }
  }

  const mechanic: Factory<StrategyMechanic> = (value, actions) => {
    let name = value?.name ?? ''
    const root = el('div', { class: 'mech-box stack' })
    const sectionHost = el('div', { class: 'stack' }), subHost = el('div', { class: 'stack mt-2' })
    const sections = createList(sectionHost, section, changed)
    const subs = createList(subHost, mechanic, changed)
    const disclosure = el('details', { class: 'disclosure', open: Boolean(value?.sub_mechanics.length) }, el('summary', {}, '子机制列表'), subHost)
    root.append(el('div', { class: 'row' },
      field('机制名称', name, next => { name = next; changed() }, { required: true, placeholder: '无之膨胀' })),
      el('div', { class: 'actions' }, button('删除机制', actions.remove, 'danger')),
      el('div', { class: 'hint' }, '内容区块（按顺序渲染）'), sectionHost,
      el('div', { class: 'actions' }, button('＋ 添加区块', () => sections.add()), button('＋ 子机制', () => { disclosure.open = true; subs.add() })), disclosure)
    sections.replace(value?.sections ?? [])
    subs.replace(value?.sub_mechanics ?? [])
    return { root, read: () => ({ name: name, sections: sections.read(), sub_mechanics: subs.read() }), destroy() { sections.destroy(); subs.destroy() } }
  }

  const phase: Factory<StrategyPhase> = (value, actions) => {
    let name = value?.name ?? ''
    const root = el('div', { class: 'card stack' })
    const host = el('div', { class: 'stack' }), children = createList(host, mechanic, changed)
    root.append(el('div', { class: 'head' }, el('div', {}, el('span', { class: 'phase-tag' }, 'Phase'), el('b', {}, '阶段')), button('删除阶段', actions.remove, 'danger')),
      el('div', {}, field('阶段名称', name, next => { name = next; changed() }, { required: true, placeholder: 'p1、p1-前半或p1.5-转场' })),
      host, el('div', { class: 'actions' }, button('＋ 添加机制', () => children.add())))
    children.replace(value?.mechanics ?? [])
    return { root, read: () => ({ name: name, mechanics: children.read() }), destroy: children.destroy }
  }
  const reference: Factory<StrategyReference> = (value, actions) => {
    let label = value?.label ?? '', url = value?.url ?? ''
    const root = el('div', { class: 'row' },
      field('标题', label, next => { label = next; changed() }, { placeholder: '标题' }),
      field('链接', url, next => { url = next; changed() }, { placeholder: 'https://链接' }), button('删除', actions.remove, 'danger'))
    return { root, read: () => ({ label: label, url: url }), destroy() { } }
  }
  const macro: Factory<StrategyMacro> = (value, actions) => {
    let name = value?.name ?? '', code = value?.code ?? ''
    const root = el('div', { class: 'card stack' },
      el('div', { class: 'row' }, field('名称', name, next => { name = next; changed() }, { placeholder: '站位方案' }), button('删除宏', actions.remove, 'danger')),
      field('代码（多行，如 /p 开头的宏）', code, next => { code = next; changed() }, { multiline: true, placeholder: '/p 第一行\n/p 第二行' }))
    return { root, read: () => ({ name: name, code }), destroy() { } }
  }
  const references = createList(options.references, reference, changed)
  const macros = createList(options.macros, macro, changed)
  const phases = createList(options.phases, phase, changed)
  sortPhaseItems = () => phases.sort((a, b) => comparePhaseNames(a.name, b.name))
  return {
    addReference: () => references.add(), addMacro: () => macros.add(), addPhase: () => phases.add(),
    findBody: (id: string) => bodies.get(id),
    read: (): Pick<StrategyStructure, 'references' | 'macros' | 'phases'> => ({
      references: references.read().filter(value => value.label || value.url),
      macros: macros.read().filter(value => value.name || value.code),
      phases: phases.read().filter(value => value.name || value.mechanics.length),
    }),
    replace(value: StrategyStructure) { references.replace(value.references); macros.replace(value.macros); phases.replace(value.phases) },
    destroy() { references.destroy(); macros.destroy(); phases.destroy() },
  }
}
