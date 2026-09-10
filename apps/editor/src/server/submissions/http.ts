import { normalizeStructure, validateStructure, type StrategyStructure } from '@xivstrat/content-schema'

import type { SubmissionResult } from '../github/submission.ts'
import { GitHubIntegrationError, type SubmissionFailureContext } from '../github/types.ts'

export type SubmissionCreator = (structure: StrategyStructure) => Promise<SubmissionResult>

export interface SubmissionHttpDependencies {
  createSubmission: SubmissionCreator
  isProduction: boolean
  logError?: (message: string, fields: SafeSubmissionErrorLog) => void
}

export interface SafeSubmissionErrorLog {
  code: string
  branch?: string
  branchCreation?: SubmissionFailureContext['outcomes']['branchCreation']
  fileWrite?: SubmissionFailureContext['outcomes']['fileWrite']
  prCreation?: SubmissionFailureContext['outcomes']['prCreation']
  orphanBranchPossible?: boolean
}

interface HttpErrorBody {
  ok: false
  error: {
    code: string
    message: string
    details?: string[]
    retrySafe?: false
  }
}

function json(body: unknown, status: number, headers?: HeadersInit): Response {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      ...headers,
    },
  })
}

function errorResponse(status: number, error: HttpErrorBody['error'], headers?: HeadersInit): Response {
  return json({ ok: false, error } satisfies HttpErrorBody, status, headers)
}

function safeSubmissionResult(result: SubmissionResult): SubmissionResult {
  return {
    submissionId: result.submissionId,
    strategyId: result.strategyId,
    filePath: result.filePath,
    branch: result.branch,
    commitSha: result.commitSha,
    headSha: result.headSha,
    prNumber: result.prNumber,
    prUrl: result.prUrl,
    outcomes: {
      branchCreation: result.outcomes.branchCreation,
      fileWrite: result.outcomes.fileWrite,
      prCreation: result.outcomes.prCreation,
    },
  }
}

function hasUnknownOutcome(context: SubmissionFailureContext | undefined): boolean {
  if (!context) return false
  return Object.values(context.outcomes).includes('unknown')
}

function safeLogFields(error: GitHubIntegrationError): SafeSubmissionErrorLog {
  const context = error.submissionContext
  return {
    code: error.code,
    ...(context?.branch ? { branch: context.branch } : {}),
    ...(context
      ? {
          branchCreation: context.outcomes.branchCreation,
          fileWrite: context.outcomes.fileWrite,
          prCreation: context.outcomes.prCreation,
          orphanBranchPossible: context.orphanBranchPossible,
        }
      : {}),
  }
}

function githubErrorResponse(error: GitHubIntegrationError): Response {
  if (error.code === 'INVALID_STRATEGY_ID' || error.code === 'UNSAFE_TARGET_PATH') {
    return errorResponse(422, {
      code: 'INVALID_SUBMISSION',
      message: '提交内容未通过验证',
    })
  }

  if (hasUnknownOutcome(error.submissionContext)) {
    return errorResponse(502, {
      code: 'SUBMISSION_OUTCOME_UNKNOWN',
      message: '无法确认提交结果，请勿立即重复提交并联系维护者',
      retrySafe: false,
    })
  }

  const unavailableCodes = new Set([
    'GITHUB_CONFIG_ERROR',
    'GITHUB_APP_AUTH_ERROR',
    'GITHUB_INSTALLATION_ERROR',
    'GITHUB_INSTALLATION_AUTH_ERROR',
    'GITHUB_REPOSITORY_ACCESS_ERROR',
  ])
  return errorResponse(unavailableCodes.has(error.code) ? 503 : 502, {
    code: unavailableCodes.has(error.code) ? 'SUBMISSION_UNAVAILABLE' : 'SUBMISSION_FAILED',
    message: '提交失败，请稍后重试或联系维护者',
  })
}

export async function handleSubmissionRequest(
  request: Request,
  dependencies: SubmissionHttpDependencies,
): Promise<Response> {
  if (request.method.toUpperCase() !== 'POST') {
    return errorResponse(405, {
      code: 'METHOD_NOT_ALLOWED',
      message: '仅支持 POST 请求',
    }, { Allow: 'POST' })
  }

  if (dependencies.isProduction) {
    return errorResponse(503, {
      code: 'SUBMISSION_API_DISABLED',
      message: '提交接口尚未在生产环境开放',
    })
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return errorResponse(400, {
      code: 'JSON_PARSE_ERROR',
      message: '请求正文不是有效的 JSON',
    })
  }

  let structure: StrategyStructure
  try {
    structure = normalizeStructure(raw)
  } catch {
    return errorResponse(400, {
      code: 'NORMALIZATION_ERROR',
      message: '提交内容无法规范化',
    })
  }

  const validationErrors = validateStructure(structure)
  if (validationErrors.length > 0) {
    return errorResponse(422, {
      code: 'INVALID_SUBMISSION',
      message: '提交内容未通过验证',
      details: validationErrors,
    })
  }

  try {
    const submission = await dependencies.createSubmission(structure)
    return json({ ok: true, submission: safeSubmissionResult(submission) }, 201)
  } catch (error) {
    if (error instanceof GitHubIntegrationError) {
      dependencies.logError?.('Submission request failed', safeLogFields(error))
      return githubErrorResponse(error)
    }
    dependencies.logError?.('Submission request failed', { code: 'UNEXPECTED_ERROR' })
    return errorResponse(500, {
      code: 'SUBMISSION_FAILED',
      message: '提交失败，请稍后重试或联系维护者',
    })
  }
}
