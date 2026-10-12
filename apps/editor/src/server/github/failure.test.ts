import test from 'node:test'
import assert from 'node:assert/strict'
import { submissionFailureCode } from './failure.ts'
import { GitHubIntegrationError } from './types.ts'

test('nested transport failures take precedence over generic HTTP 500 without exposing raw diagnostics', () => {
  const error = new GitHubIntegrationError('GITHUB_INSTALLATION_AUTH_ERROR', 'private key secret',
    Object.assign(new Error('Client network socket disconnected before secure TLS connection was established'), { status: 500 }),
    { stage: 'D1.3', githubMessage: 'Authorization: secret' })
  assert.equal(submissionFailureCode(error), 'GITHUB_NETWORK_ERROR')
  assert.equal(submissionFailureCode({ cause: { code: 'ETIMEDOUT' } }), 'GITHUB_TIMEOUT')
  assert.equal(submissionFailureCode({ status: 403, message: 'API rate limit exceeded' }), 'GITHUB_RATE_LIMIT')
  for (const [status, code] of [[401, 'GITHUB_AUTH_ERROR'], [403, 'GITHUB_PERMISSION_ERROR'], [404, 'GITHUB_RESOURCE_UNAVAILABLE'], [422, 'GITHUB_REQUEST_REJECTED'], [429, 'GITHUB_RATE_LIMIT'], [503, 'GITHUB_SERVICE_ERROR']] as const) assert.equal(submissionFailureCode({ status }), code)
  assert.equal(submissionFailureCode(new Error('unknown secret')), 'GITHUB_REQUEST_FAILED')
})
