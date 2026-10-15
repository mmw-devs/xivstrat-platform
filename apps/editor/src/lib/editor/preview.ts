import { renderRichText, SECTION_RULES, type StrategyStructure, type ContentBlock, type StrategySection, type StrategyMechanic } from '@xivstrat/content-schema'
import { el } from '../ui/dom'
export function renderPreview(structure: StrategyStructure, target: HTMLElement, onLoadDemo: () => void, resolveImage: (path: string) => string | undefined = () => undefined): void {
  target.innerHTML = ''
  const banner = resolveImage(structure.metadata.banner) ?? (/^https?:\/\//i.test(structure.metadata.banner) ? structure.metadata.banner : undefined)
  if (banner) target.append(el('img', { src: banner, alt: '攻略封面', style: 'max-width:100%;height:auto' }))
  if (!structure.phases.length) {
    target.append(
      el(
        'div',
        { class: 'empty-state' },
        el('div', { class: 'es-title' }, '📭 还没有内容'),
        el('div', { class: 'hint' }, '去第③步添加“阶段”和“机制”，或先看看示例长什么样：'),
        el('button', { class: 'btn primary', onclick: onLoadDemo }, '🎲 载入示例'),
      ),
    )
    return
  }
  const showContent = (container: HTMLElement, content: ContentBlock[]): void => {
    content.forEach((item) => {
      if (item.type === 'image') {
        const url = resolveImage(item.file) ?? (/^https?:\/\//i.test(item.file) ? item.file : undefined)
        if (url) container.append(el('figure', {}, el('a', { href: url, target: '_blank', rel: 'noopener noreferrer' },
          el('img', { src: url, alt: item.caption || '攻略图片', loading: 'lazy', style: 'max-width:100%;height:auto' })),
          el('figcaption', {}, item.caption)))
        else container.append(el('span', { class: 'img-chip' }, `图片未加载：${item.file}`))
      }
      else {
        const text = el('div', {})
        text.innerHTML = renderRichText(item.doc)
        container.append(text)
      }
    })
  }
  const showSection = (container: HTMLElement, section: StrategySection): void => {
    const label = SECTION_RULES[section.type].label
    const box = el('div', { class: 'box', 'data-section-type': section.type })
    box.append(el('div', { class: 'ptag' }, `${label}${section.title ? ` · ${section.title}` : ''}`))
    showContent(box, section.content)
    container.append(box)
  }
  const showMechanic = (container: HTMLElement, mechanic: StrategyMechanic): void => {
    const box = el('div', { class: 'preview-mechanic' })
    const name = mechanic.name || '未命名机制'
    box.append(el('div', { class: 'sep' }, `◆ ${name}`))
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
    target.append(el('div', { class: 'p-title' }, `🕐 ${phase.name || '未命名阶段'}`))
    phase.mechanics.forEach((mechanic) => {
      showMechanic(target, mechanic)
    })
  })
}

