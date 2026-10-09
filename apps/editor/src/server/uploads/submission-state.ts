export interface SubmissionCheckpoint {
  status: 'running' | 'retryable' | 'unknown' | 'needs-attention' | 'submitted'
  code?: string
  owner: string
  repo: string
  baseBranch: string
  baseSha: string
  baseTree: string
  publishTime: string
  branch: string
  entries: Array<{ path: string; name: string; sha: string; uploaded: boolean }>
  treeSha?: string
  commitSha?: string
  branchAttempted?: boolean
  prAttempted?: boolean
  result?: { prNumber: number; prUrl: string; commitSha: string }
}
