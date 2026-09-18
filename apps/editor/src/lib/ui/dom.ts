type AttributeValue = string | number | boolean | ((event: Event) => void) | undefined
type DomChild = Node | string | number | null | undefined | false
export type ElementLookup = <T extends HTMLElement>(id: string) => T
export function createLookup(root: HTMLElement): ElementLookup {
  return <T extends HTMLElement>(id: string): T => {
    const element = root.querySelector<T>(`#${CSS.escape(id)}`)
    if (!element) throw new Error(`编辑器缺少 #${id}`)
    return element
  }
}
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, AttributeValue> = {}, ...children: DomChild[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined) continue
    if (name.startsWith('on') && typeof value === 'function') element.addEventListener(name.slice(2), value)
    else if (name === 'value' && 'value' in element) (element as HTMLInputElement).value = String(value)
    else if (typeof value === 'boolean') { if (value) element.setAttribute(name, '') }
    else element.setAttribute(name, String(value))
  }
  if (['input', 'select', 'textarea'].includes(tag)) element.classList.add('field-input')
  if (tag === 'label') element.classList.add('field-label')
  if (tag === 'button' && !element.hasAttribute('type')) element.setAttribute('type', 'button')
  for (const child of children) if (child != null && child !== false) element.append(child instanceof Node ? child : document.createTextNode(String(child)))
  return element
}
export function button(label: string, action: () => void, variant = ''): HTMLButtonElement {
  return el('button', { class: `btn sm ${variant}`, onclick: action }, label)
}
export function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
