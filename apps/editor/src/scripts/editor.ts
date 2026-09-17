import { createLookup, errorMessage } from '../lib/ui/dom'
import { createMetadata } from '../lib/editor/metadata'
import { createAuthoring } from '../lib/editor/authoring'
import { createSnapshotCache } from '../lib/editor/snapshot'
import { createDemo } from '../lib/editor/demo'
import { parseTemplate } from '../lib/editor/import'
import { mountAssets } from '../lib/editor/assets'
import { mountPreview } from '../lib/editor/preview-view'
import { mountSubmission } from '../lib/editor/submission-view'
import { createProofreadPanel, type ProofreadPanel } from '../lib/proofread/panel'
import { renderReading, type ReadingHighlight } from '../lib/proofread/reading'
import type { BodyEditorHandle } from '../lib/richtext/editor'
import type { StrategyStructure } from '@xivstrat/content-schema'

const instances = new WeakMap<HTMLElement, { destroy(): void }>()

/** Composition root. Feature modules do not import this page controller. */
export function initEditor(root: HTMLElement) {
  const existing = instances.get(root)
  if (existing) return existing
  const byId = createLookup(root)
  const events = new AbortController()
  const { signal } = events
  let activeStep = 1
  let disposed = false
  let queued = false
  let historyChanged = false
  let panel: ProofreadPanel | undefined
  let lastBody: BodyEditorHandle | undefined
  let lastInput: HTMLInputElement | HTMLTextAreaElement | undefined

  const changed = (history = false): void => {
    if (disposed) return
    cache.invalidate()
    historyChanged ||= history
    if (queued) return
    queued = true
    queueMicrotask(() => {
      queued = false
      if (disposed) return
      panel?.changed(historyChanged)
      historyChanged = false
      if (activeStep === 4) reading()
      if (activeStep === 5) preview.render()
    })
  }
  const metadata = createMetadata(byId, changed, signal)
  const authoring = createAuthoring({
    references: byId('refs'), macros: byId('macros'), phases: byId('phases'), changed,
    focus(handle) { lastBody = handle; lastInput = undefined },
    released(handle) { if (lastBody === handle) lastBody = undefined },
  })
  const collect = (): StrategyStructure => ({ schemaVersion: 2, metadata: metadata.read(), ...authoring.read() })
  const cache = createSnapshotCache(collect)
  const reading = (highlight?: ReadingHighlight): void => renderReading(byId('proofread-reading'), collect(), authoring.findBody, highlight)
  const goStep = (step: number): void => {
    if (![1, 2, 3, 4, 5].includes(step)) return
    activeStep = step
    for (let i = 1; i <= 5; i++) byId(`step${i}`).classList.toggle('active', step === i)
    root.querySelectorAll<HTMLButtonElement>('[data-step]').forEach(button => {
      const active = Number(button.dataset.step) === step
      button.classList.toggle('active', active)
      if (active) button.setAttribute('aria-current', 'step')
      else button.removeAttribute('aria-current')
    })
    if (step === 4) reading()
    if (step === 5) preview.render()
  }
  const replace = (structure: StrategyStructure): void => {
    panel?.changed(true)
    metadata.replace(structure.metadata)
    authoring.replace(structure)
    goStep(5)
    byId('import-status').textContent = `导入成功！共 ${structure.phases.length} 个阶段。`
  }
  const preview = mountPreview(byId, cache.get, () => replace(createDemo()), signal)
  panel = createProofreadPanel(byId('proofread'), collect, authoring.findBody,
    (blockId, paragraph, from, to) => reading({ blockId, paragraph, from, to }))
  mountSubmission(byId, collect, signal)
  mountAssets(byId, () => ({ body: lastBody, input: lastInput?.isConnected ? lastInput : undefined }), signal)

  root.querySelectorAll<HTMLButtonElement>('[data-step]').forEach(button => button.addEventListener('click', () => goStep(Number(button.dataset.step)), { signal }))
  const on = (id: string, action: () => void): void => byId(id).addEventListener('click', action, { signal })
  for (let i = 1; i <= 4; i++) on(`btn-step-${i}-next`, () => goStep(i + 1))
  for (let i = 2; i <= 4; i++) on(`btn-step-${i}-back`, () => goStep(i - 1))
  on('btn-add-ref', authoring.addReference)
  on('btn-add-macro', authoring.addMacro)
  on('btn-add-phase', authoring.addPhase)
  on('btn-sync-time', () => {
    const date = new Date()
    const pad = (value: number): string => String(value).padStart(2, '0')
    const input = byId<HTMLInputElement>('inp-date')
    input.value = `${pad(date.getFullYear() % 100)}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  on('btn-import-template', () => {
    try {
      const structure = parseTemplate(byId<HTMLTextAreaElement>('importArea').value)
      if (!structure.phases.length) { byId('import-status').textContent = '没有解析到 phases，请检查 schema 数据结构'; return }
      replace(structure)
    } catch (error) { byId('import-status').textContent = `导入失败：请输入合法的 schema JSON（${errorMessage(error)}）` }
  })
  root.addEventListener('focusin', event => {
    const target = event.target
    // Auxiliary tools must not steal the remembered authoring insertion target.
    if ((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && target.closest('#step1, #step2, #step3')) {
      lastInput = target
      lastBody = undefined
    }
  }, { signal })
  authoring.addReference()
  authoring.addMacro()
  authoring.addPhase()
  const instance = {
    destroy() {
      if (disposed) return
      disposed = true
      events.abort()
      panel?.destroy()
      authoring.destroy()
      instances.delete(root)
    }
  }
  instances.set(root, instance)
  return instance
}
