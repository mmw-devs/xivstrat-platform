import { createSubmissionController, submissionCanStart, type SubmissionController, type SubmissionUiState } from './submission'
import { el, type ElementLookup } from '../ui/dom'
import { validateStructure, type StrategyStructure } from '@xivstrat/content-schema'
import { hasManagedImages } from './image-references'
import { mountImageSubmission } from './image-submission-view'
import type { ImageAssets } from './image-assets'
export function mountSubmission(byId: ElementLookup, getStructure: () => StrategyStructure, signal: AbortSignal, onSubmitted?: (time: string) => void, assets?: ImageAssets): void {
  let submissionController: SubmissionController | undefined
  let images: ReturnType<typeof mountImageSubmission> | undefined
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
      if (state.publishTime) onSubmitted?.(state.publishTime)
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
    if (!submissionController || images?.isBusy() || !submissionCanStart(submissionController.getState())) return
    const structure = getStructure()
    const errors = validateStructure(structure)
    if (errors.length) { renderSubmissionState({ status: 'error', code: 'INVALID_SUBMISSION', message: '内容未通过校验', details: errors, retrySafe: true }); return }
    if (hasManagedImages(structure) && images) {
      byId('submission-status').textContent = ''
      void images.submit()
      return
    }
    if (images?.hasPending()) {
      byId('submission-status').textContent = '上一图片任务尚未结束，请先查询或继续该任务。'
      return
    }
    if (hasManagedImages(structure)) return
    void submissionController.submit(structure)
  }

  function initialize(): void {
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
    if (assets) images = mountImageSubmission(byId('submission-status'), assets, getStructure, signal, busy => {
      const button = byId<HTMLButtonElement>('btn-submit-review')
      button.disabled = busy || !submissionCanStart(submissionController!.getState())
      button.textContent = busy ? '正在处理图片任务…' : '提交审核'
      button.setAttribute('aria-busy', String(busy))
    })
  }


  initialize()
  byId('btn-submit-review').addEventListener('click', submitForReview, { signal })
}
