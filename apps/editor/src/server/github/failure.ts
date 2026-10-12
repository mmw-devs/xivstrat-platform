import { GitHubIntegrationError } from './types.ts'

/** Classify locally; never return raw messages, headers, URLs or exception objects. */
export function submissionFailureCode(error: unknown): string {
  let current: unknown = error
  let httpStatus: number | undefined
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    const item = current as { code?: unknown; message?: unknown; status?: unknown; cause?: unknown }
    const text = `${typeof item.code === 'string' ? item.code : ''} ${typeof item.message === 'string' ? item.message : ''}`
    if (/ETIMEDOUT|TIMEOUT|timed? out/i.test(text)) return 'GITHUB_TIMEOUT'
    if (/ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|network|socket|TLS|certificate/i.test(text)) return 'GITHUB_NETWORK_ERROR'
    if (/rate limit/i.test(text)) return 'GITHUB_RATE_LIMIT'
    if (typeof item.status === 'number') httpStatus = item.status
    current = item.cause
  }
  if (httpStatus === 401) return 'GITHUB_AUTH_ERROR'
  if (httpStatus === 403) return 'GITHUB_PERMISSION_ERROR'
  if (httpStatus === 429) return 'GITHUB_RATE_LIMIT'
  if (httpStatus === 404) return 'GITHUB_RESOURCE_UNAVAILABLE'
  if (httpStatus === 422) return 'GITHUB_REQUEST_REJECTED'
  if (httpStatus && httpStatus >= 500) return 'GITHUB_SERVICE_ERROR'
  return error instanceof GitHubIntegrationError ? error.code : 'GITHUB_REQUEST_FAILED'
}
