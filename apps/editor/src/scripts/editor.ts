import { createLookup } from '../lib/ui/dom'
import { createMetadata } from '../lib/editor/metadata'
import { createAuthoring } from '../lib/editor/authoring'
import { createSnapshotCache } from '../lib/editor/snapshot'
import { createDemo } from '../lib/editor/demo'
import { mountImport } from '../lib/editor/import-view'
import { mountPreview } from '../lib/editor/preview-view'
import { mountSubmission } from '../lib/editor/submission-view'
import { mountLocalSave } from '../lib/editor/local-save'
import { createProofreadPanel, type ProofreadPanel } from '../lib/proofread/panel'
import { renderReading, type ReadingHighlight } from '../lib/proofread/reading'
import type { StrategyStructure } from '@xivstrat/content-schema'
import { createImageAssets } from '../lib/editor/image-assets'
import { createImagePicker } from '../lib/editor/image-picker'
import { mountImagePackage } from '../lib/editor/image-package-view'

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
  const assets = createImageAssets()

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
  const bannerInput = byId<HTMLInputElement>('inp-banner')
  const bannerPicker = createImagePicker(assets, bannerInput.value, path => {
    bannerInput.value = path; bannerInput.dispatchEvent(new Event('input'))
  })
  bannerInput.insertAdjacentElement('afterend', bannerPicker.root)
  bannerInput.addEventListener('input', () => bannerPicker.show(bannerInput.value), { signal })
  const authoring = createAuthoring({
    references: byId('refs'), macros: byId('macros'), phases: byId('phases'), changed, assets,
  })
  const collect = (): StrategyStructure => ({ metadata: metadata.read(), ...authoring.read() })
  const cache = createSnapshotCache(collect)
  const reading = (highlight?: ReadingHighlight): void => renderReading(byId('proofread-reading'), collect(), authoring.findBody, highlight)
  const goStep = (step: number): void => {
    if (![1, 2, 3, 4, 5, 6].includes(step)) return
    activeStep = step
    for (let i = 1; i <= 6; i++) byId(`step${i}`).classList.toggle('active', step === i)
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
    const resetStatus = structure.metadata.status !== 'draft'
    metadata.replace(structure.metadata)
    bannerPicker.show(structure.metadata.banner)
    authoring.replace(structure)
    goStep(5)
    byId('import-status').textContent = `导入成功！共 ${structure.phases.length} 个阶段。${resetStatus ? '原状态已转为 draft，作为草稿编辑。' : ''}`
  }
  const preview = mountPreview(byId, cache.get, () => replace(createDemo()), signal, assets.resolve)
  panel = createProofreadPanel(byId('proofread'), collect, authoring.findBody,
    (blockId, paragraph, from, to) => reading({ blockId, paragraph, from, to }))
  mountSubmission(byId, collect, signal, metadata.setOperationTime, assets)
  mountLocalSave(byId, collect, signal, metadata.setOperationTime)
  mountImagePackage(byId, collect, assets, signal)

  root.querySelectorAll<HTMLButtonElement>('[data-step]').forEach(button => button.addEventListener('click', () => goStep(Number(button.dataset.step)), { signal }))
  const on = (id: string, action: () => void): void => byId(id).addEventListener('click', action, { signal })
  for (let i = 1; i <= 4; i++) on(`btn-step-${i}-next`, () => goStep(i + 1))
  for (let i = 2; i <= 4; i++) on(`btn-step-${i}-back`, () => goStep(i - 1))
  on('btn-add-ref', authoring.addReference)
  on('btn-add-macro', authoring.addMacro)
  on('btn-add-phase', authoring.addPhase)
  mountImport(byId, replace, assets, signal)
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
      bannerPicker.destroy()
      bannerPicker.root.remove()
      assets.clear()
      instances.delete(root)
    }
  }
  instances.set(root, instance)
  return instance
}
