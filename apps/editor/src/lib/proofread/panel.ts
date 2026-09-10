import {
  parseRequest,
  rebaseSuggestions,
  resolveSuggestions,
  snapshotBlocks,
  snapshotLabel,
  type Suggestion,
} from './contracts.ts'
import type { StrategyStructure } from '@xivstrat/content-schema'
import type { BodyEditorHandle } from '../richtext/editor'
export interface ProofreadPanel {
  changed(force?: boolean): void
  destroy(): void
}
export function createProofreadPanel(
  host: HTMLElement,
  collect: () => StrategyStructure,
  find: (id: string) => BodyEditorHandle | undefined,
  locateRange: (id: string, paragraph: number, from: number, to: number) => void,
): ProofreadPanel {
  const controls = document.createElement('div')
  controls.className = 'proofread-controls'
  const status = document.createElement('p')
  status.className = 'hint'
  status.setAttribute('role', 'status')
  const list = document.createElement('div')
  list.className = 'proofread-list'
  const terms = document.createElement('input')
  terms.placeholder = '术语偏好（可选），例如：治疗统称奶妈；保留 H1/H2'
  terms.setAttribute('aria-label', '校对术语偏好')
  terms.maxLength = 2000
  const button = (label: string, action: () => void, parent: HTMLElement = controls): HTMLButtonElement => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'btn sm'
    b.textContent = label
    b.addEventListener('click', action)
    parent.append(b)
    return b
  }
  let pending: AbortController | null = null
  let suggestions: Suggestion[] = []
  let baseline = ''
  let applying = false
  let expired = false
  const fingerprint = (): string => JSON.stringify([terms.value, snapshotBlocks(collect())])
  const render = (): void => {
    list.replaceChildren()
    for (const s of suggestions) {
      const card = document.createElement('article')
      card.className = 'proofread-suggestion'
      const block = snapshotBlocks(collect()).find((b) => b.blockId === s.blockId)
      const path = block ? snapshotLabel(block.path) : '正文已删除'
      for (const text of [
        path,
        `原文：${s.original}`,
        s.replacement === null ? '需要人工判断' : `建议：${s.replacement}`,
        `原因：${s.reason}`,
        s.note,
        s.status === 'pending' ? '' : { accepted: '已接受', ignored: '已忽略', stale: '已过期' }[s.status],
      ]) {
        if (text) {
          const p = document.createElement('p')
          p.textContent = text
          card.append(p)
        }
      }
      const actions = document.createElement('div')
      actions.className = 'proofread-controls'
      card.append(actions)
      const locate = button(
        '定位原文',
        () => {
          locateRange(s.blockId, Number(s.paragraphId.slice(2)), s.from, s.to)
        },
        actions,
      )
      locate.disabled = s.from < 0 || s.status === 'stale' || s.status === 'accepted'
      if (s.applicable) {
        const accept = button(
          '接受',
          () => {
            changed()
            if (s.status !== 'pending' || expired || s.replacement === null) return
            applying = true
            try {
              if (
                !find(s.blockId)?.replaceRange(
                  Number(s.paragraphId.slice(2)),
                  s.from,
                  s.to,
                  s.original,
                  s.replacement,
                )
              ) {
                s.applicable = false
                s.note = '原文已变或修改跨越多种格式，请手动处理'
              } else {
                s.status = 'accepted'
                rebaseSuggestions(suggestions, s)
                baseline = fingerprint()
                status.textContent = '已接受一条建议。其他建议仍基于本轮上下文，请逐条判断；正文块内可撤销。'
              }
            } finally {
              applying = false
              render()
            }
          },
          actions,
        )
        accept.disabled = s.status !== 'pending' || expired
      }
      const ignore = button(
        '忽略',
        () => {
          if (s.status === 'pending') s.status = 'ignored'
          render()
        },
        actions,
      )
      ignore.disabled = s.status !== 'pending'
      list.append(card)
    }
  }
  const changed = (force = false): void => {
    if (applying || !baseline || expired || (!force && fingerprint() === baseline)) return
    expired = true
    suggestions.forEach((s) => {
      if (s.status === 'pending') s.status = 'stale'
    })
    status.textContent = '正文、标题、结构或术语已变化，本轮建议已过期，请重新校对。'
    render()
  }
  const start = button('AI 校对全文', () => {
    void run()
  })
  const cancel = button('取消校对', () => {
    pending?.abort()
    pending = null
    start.disabled = false
    cancel.disabled = true
    status.textContent = '校对已取消，正文未修改。'
  })
  cancel.disabled = true
  async function run(): Promise<void> {
    pending?.abort()
    const controller = new AbortController()
    pending = controller
    suggestions = []
    expired = false
    baseline = fingerprint()
    render()
    start.disabled = true
    cancel.disabled = false
    status.textContent = '正在校对全文…'
    const timer = setTimeout(() => controller.abort(), 65000)
    try {
      const request = parseRequest({
        requestId: crypto.randomUUID(),
        snapshotId: crypto.randomUUID(),
        terminology: terms.value,
        blocks: snapshotBlocks(collect()),
      })
      if (!request.blocks.some((b) => b.paragraphs.some((p) => p.text.trim())))
        throw new Error('请先填写正文')
      const response = await fetch('/api/proofread', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      })
      if (response.status === 404) throw new Error('尚未部署校对服务，请配置 /api/proofread 后使用')
      const result = (await response.json()) as {
        requestId?: string
        snapshotId?: string
        suggestions?: unknown
        error?: string
      }
      if (pending !== controller) return
      if (!response.ok) throw new Error(result.error ?? '校对服务请求失败')
      if (result.requestId !== request.requestId || result.snapshotId !== request.snapshotId)
        throw new Error('校对响应与本次请求不匹配')
      suggestions = resolveSuggestions(result.suggestions, request.blocks)
      if (expired || fingerprint() !== baseline) {
        expired = false
        changed(true)
      } else {
        status.textContent = suggestions.length
          ? `校对完成：${suggestions.length} 条建议，请逐条判断。`
          : '本次未发现可明确提出的问题。'
        render()
      }
    } catch (error) {
      if (pending === controller)
        status.textContent = controller.signal.aborted
          ? '校对超时或已取消，正文未修改。'
          : `校对失败：${error instanceof Error ? error.message : '未知错误'}`
    } finally {
      clearTimeout(timer)
      if (pending === controller) {
        pending = null
        start.disabled = false
        cancel.disabled = true
      }
    }
  }
  terms.addEventListener('input', () => changed())
  const heading = document.createElement('h2')
  heading.className = 'sec'
  heading.textContent = '正文语言校对'
  host.append(heading, terms, controls, status, list)
  status.textContent = '检查病句、称呼一致性和指代；只提出建议，逐条接受后才修改正文。'
  return {
    changed,
    destroy: () => {
      pending?.abort()
      host.replaceChildren()
    },
  }
}
