export type GitHubIntegrationErrorCode =
  | 'GITHUB_CONFIG_ERROR'
  | 'GITHUB_APP_AUTH_ERROR'
  | 'GITHUB_INSTALLATION_ERROR'
  | 'GITHUB_INSTALLATION_AUTH_ERROR'
  | 'GITHUB_REPOSITORY_ACCESS_ERROR'
  | 'INVALID_STRATEGY_ID'
  | 'UNSAFE_TARGET_PATH'
  | 'BRANCH_CREATE_ERROR'
  | 'FILE_READ_ERROR'
  | 'FILE_CREATE_ERROR'
  | 'FILE_UPDATE_ERROR'
  | 'PR_CREATE_ERROR'

export type GitHubDiagnosticStage =
  | 'D1.1'
  | 'D1.2'
  | 'D1.3'
  | 'D1.4'
  | 'D2.branch-create'
  | 'D2.file-read'
  | 'D2.file-create'
  | 'D2.file-update'
  | 'D2.pr-create'

export interface SafeGitHubApiDiagnostic {
  stage: GitHubDiagnosticStage
  status?: number
  githubMessage: string
  method?: string
  endpoint?: string
  requestId?: string
}

export type OperationOutcome = 'confirmed' | 'not-performed' | 'unknown'

export interface SubmissionOperationOutcomes {
  branchCreation: OperationOutcome
  fileWrite: OperationOutcome
  prCreation: OperationOutcome
}

export interface SubmissionFailureContext {
  branch?: string
  outcomes: SubmissionOperationOutcomes
  orphanBranchPossible: boolean
}

export class GitHubIntegrationError extends Error {
  readonly code: GitHubIntegrationErrorCode
  readonly diagnostic?: SafeGitHubApiDiagnostic
  readonly submissionContext?: SubmissionFailureContext
  override readonly cause?: unknown

  constructor(
    code: GitHubIntegrationErrorCode,
    message: string,
    cause?: unknown,
    diagnostic?: SafeGitHubApiDiagnostic,
    submissionContext?: SubmissionFailureContext,
  ) {
    super(message)
    this.name = 'GitHubIntegrationError'
    this.code = code
    this.cause = cause
    this.diagnostic = diagnostic
    this.submissionContext = submissionContext
  }
}
