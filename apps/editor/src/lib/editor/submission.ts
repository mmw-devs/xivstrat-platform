import type { StrategyStructure } from '@xivstrat/content-schema'

export interface SubmissionSuccess {
  status: 'success'
  prNumber: number
  prUrl: string
  submissionId: string
}

export interface SubmissionFailure {
  status: 'error'
  code: string
  message: string
  details: string[]
  retrySafe: boolean
}

export type SubmissionUiState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | SubmissionSuccess
  | SubmissionFailure

export interface SubmissionController {
  getState(): SubmissionUiState
  submit(structure: StrategyStructure): Promise<SubmissionUiState>
}

export interface SubmissionControllerOptions {
  fetch: typeof fetch
  onStateChange?: (state: SubmissionUiState) => void
}

const ERROR_MESSAGES: Record<string, string> = {
  METHOD_NOT_ALLOWED: '提交接口调用方式错误',
  UNSUPPORTED_MEDIA_TYPE: '提交请求格式错误，请刷新页面后重试',
  JSON_PARSE_ERROR: '内容未通过校验',
  NORMALIZATION_ERROR: '内容未通过校验',
  INVALID_SUBMISSION: '内容未通过校验',
  SUBMISSION_API_DISABLED: '当前环境暂未开放提交功能',
  SUBMISSION_UNAVAILABLE: '提交服务暂不可用，请稍后再试',
  SUBMISSION_FAILED: '提交失败，请稍后再试或联系维护者',
  SUBMISSION_OUTCOME_UNKNOWN: '无法确认本次提交是否成功，请不要立即重复提交，并联系维护者确认',
  NETWORK_ERROR: '网络请求失败，请检查连接后稍后再试',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseSuccess(value: unknown): SubmissionSuccess | null {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.submission)) return null
  const { prNumber, prUrl, submissionId } = value.submission
  if (typeof prNumber !== 'number' || typeof prUrl !== 'string' || typeof submissionId !== 'string') return null
  return { status: 'success', prNumber, prUrl, submissionId }
}

function parseFailure(value: unknown): SubmissionFailure {
  const error = isRecord(value) && isRecord(value.error) ? value.error : {}
  const code = typeof error.code === 'string' && error.code in ERROR_MESSAGES ? error.code : 'SUBMISSION_FAILED'
  const details = code === 'INVALID_SUBMISSION' && Array.isArray(error.details)
    ? error.details.filter((detail): detail is string => typeof detail === 'string')
    : []
  const retrySafe = code !== 'SUBMISSION_OUTCOME_UNKNOWN' && error.retrySafe !== false
  return {
    status: 'error',
    code,
    message: ERROR_MESSAGES[code] ?? ERROR_MESSAGES.SUBMISSION_FAILED,
    details,
    retrySafe,
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

export function submissionCanStart(state: SubmissionUiState): boolean {
  return state.status !== 'submitting' && (state.status !== 'error' || state.retrySafe)
}

export function createSubmissionController(options: SubmissionControllerOptions): SubmissionController {
  let state: SubmissionUiState = { status: 'idle' }
  let pending: Promise<SubmissionUiState> | null = null

  const update = (next: SubmissionUiState): SubmissionUiState => {
    state = next
    options.onStateChange?.(state)
    return state
  }

  const run = async (structure: StrategyStructure): Promise<SubmissionUiState> => {
    try {
      const response = await options.fetch('/api/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(structure),
      })
      const body = await readJson(response)
      if (response.status === 201) {
        const success = parseSuccess(body)
        return update(success ?? parseFailure(null))
      }
      return update(parseFailure(body))
    } catch {
      return update({
        status: 'error',
        code: 'NETWORK_ERROR',
        message: ERROR_MESSAGES.NETWORK_ERROR,
        details: [],
        retrySafe: true,
      })
    } finally {
      pending = null
    }
  }

  return {
    getState: () => state,
    submit: (structure) => {
      if (pending) return pending
      if (!submissionCanStart(state)) return Promise.resolve(state)
      update({ status: 'submitting' })
      pending = run(structure)
      return pending
    },
  }
}
