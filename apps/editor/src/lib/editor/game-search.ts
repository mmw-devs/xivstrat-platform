import { el, errorMessage, isRecord, type ElementLookup } from '../ui/dom'
import { stringField } from './asset-storage'
import type { BodyEditorHandle } from '../richtext/editor'
interface XivSearchResult { RowId?: number | string; Fields?: Record<string, unknown> }
export function mountGameSearch(byId: ElementLookup, getInsertionTarget: () => { body?: BodyEditorHandle; input?: HTMLInputElement | HTMLTextAreaElement }, addXivIconToLibrary: (name: string, icon: string) => void, signal: AbortSignal): void {
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
                class: 'asset-icon',
              })
              : el('span', { class: 'asset-placeholder' }, '🗒'),
            el(
              'span',
              { class: 'asset-name' },
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
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const position = start + caretOffset
    input.focus()
    input.setSelectionRange(position, position)
  }

  function insertXivName(name: string): void {
    const { body: lastBodyEditor, input: lastInput } = getInsertionTarget()
    if (lastBodyEditor) { lastBodyEditor.insertText(name); return }
    if (!lastInput) {
      alert('请先点击一个输入框，再点「插入名字」')
      return
    }
    insertAtCaret(lastInput, name)
  }

  function copyXivIcon(icon: string): void {
    if (navigator.clipboard) {
      void navigator.clipboard
        .writeText(icon)
        .then(() => alert(`已复制图标地址：${icon}`))
        .catch(() => alert(icon))
    } else alert(icon)
  }
  byId('btn-xiv-search').addEventListener('click', () => { void searchXiv() }, { signal })
  byId('btn-xiv-save-key').addEventListener('click', saveXivKey, { signal })
  loadXivKey()
}
