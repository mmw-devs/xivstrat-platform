import assert from 'node:assert/strict'
import test from 'node:test'

import type { StrategyStructure } from '@xivstrat/content-schema'

import type { SubmissionResult } from '../github/submission.ts'
import { GitHubIntegrationError } from '../github/types.ts'
import {
  handleSubmissionRequest,
  type SafeSubmissionErrorLog,
  type SubmissionCreator,
} from './http.ts'

const rawSubmission = {
  schemaVersion: 1,
  metadata: {
    id: 'http-test',
    name: 'HTTP Test',
    short_name: 'Test',
    type: 'other',
    title: 'HTTP Submission Test',
    description: 123,
    banner: 'banners/test.webp',
    publish_time: '2026-09-11',
    status: 'draft',
    video: '',
    team: 'XivStrat Test',
  },
  references: [],
  macros: [],
  phases: [{ id: 'p1', name: 'Phase 1', mechanics: [] }],
  untrusted: 'discard me',
}

const submissionResult: SubmissionResult = {
  submissionId: '00000000-0000-4000-8000-000000000001',
  strategyId: 'http-test',
  filePath: 'content/strategies/http-test.json',
  branch: 'content/00000000-0000-4000-8000-000000000001',
  commitSha: 'commit-sha',
  headSha: 'commit-sha',
  prNumber: 42,
  prUrl: 'https://github.com/mmw-devs/xivstrat-platform/pull/42',
  outcomes: {
    branchCreation: 'confirmed',
    fileWrite: 'confirmed',
    prCreation: 'confirmed',
  },
}

function request(body: string, method = 'POST'): Request {
  return new Request('http://localhost/api/submissions', {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body } : {}),
  })
}

function jsonRequest(body: unknown): Request {
  return request(JSON.stringify(body))
}

function dependencies(createSubmission: SubmissionCreator, isProduction = false) {
  return { createSubmission, isProduction }
}

test('non-POST methods return 405 without invoking createSubmission', async () => {
  let calls = 0
  const response = await handleSubmissionRequest(request('', 'GET'), dependencies(async () => {
    calls += 1
    return submissionResult
  }))

  assert.equal(response.status, 405)
  assert.equal(calls, 0)
  assert.equal(response.headers.get('Allow'), 'POST')
  assert.equal((await response.json()).error.code, 'METHOD_NOT_ALLOWED')
})

test('malformed JSON returns 400 without invoking createSubmission', async () => {
  let calls = 0
  const response = await handleSubmissionRequest(request('{broken'), dependencies(async () => {
    calls += 1
    return submissionResult
  }))

  assert.equal(response.status, 400)
  assert.equal(calls, 0)
  assert.equal((await response.json()).error.code, 'JSON_PARSE_ERROR')
})

test('normalization failures return 400 without invoking createSubmission', async () => {
  let calls = 0
  const response = await handleSubmissionRequest(jsonRequest({ schemaVersion: 99 }), dependencies(async () => {
    calls += 1
    return submissionResult
  }))

  assert.equal(response.status, 400)
  assert.equal(calls, 0)
  assert.equal((await response.json()).error.code, 'NORMALIZATION_ERROR')
})

test('validation failures return safe messages with 422 and do not submit', async () => {
  let calls = 0
  const response = await handleSubmissionRequest(jsonRequest({}), dependencies(async () => {
    calls += 1
    return submissionResult
  }))
  const body = await response.json()

  assert.equal(response.status, 422)
  assert.equal(calls, 0)
  assert.equal(body.error.code, 'INVALID_SUBMISSION')
  assert.ok(Array.isArray(body.error.details))
  assert.ok(body.error.details.includes('基本信息 > 编号：未填写'))
})

test('valid input is normalized before createSubmission and returns the safe result with 201', async () => {
  let submitted: StrategyStructure | undefined
  const response = await handleSubmissionRequest(jsonRequest(rawSubmission), dependencies(async (structure) => {
    submitted = structure
    const resultWithInternalField = { ...submissionResult, internalToken: 'must-not-leak' }
    return resultWithInternalField
  }))
  const body = await response.json()

  assert.equal(response.status, 201)
  assert.equal(body.ok, true)
  assert.deepEqual(body.submission, submissionResult)
  assert.doesNotMatch(JSON.stringify(body), /must-not-leak|internalToken/)
  assert.equal(submitted?.schemaVersion, 2)
  assert.equal(submitted?.metadata.description, '123')
  assert.equal(Object.hasOwn(submitted ?? {}, 'untrusted'), false)
})

test('GitHub errors return a generic response and do not leak internal data', async () => {
  const logs: Array<{ message: string; fields: SafeSubmissionErrorLog }> = []
  const secret = 'PRIVATE KEY AND Authorization: Bearer secret-token'
  const githubError = new GitHubIntegrationError(
    'GITHUB_APP_AUTH_ERROR',
    secret,
    new Error(secret),
    { stage: 'D1.1', githubMessage: secret, requestId: secret },
  )
  const response = await handleSubmissionRequest(jsonRequest(rawSubmission), {
    createSubmission: async () => { throw githubError },
    isProduction: false,
    logError: (message, fields) => logs.push({ message, fields }),
  })
  const serialized = JSON.stringify(await response.json())

  assert.equal(response.status, 503)
  assert.match(serialized, /SUBMISSION_UNAVAILABLE/)
  assert.doesNotMatch(serialized, /PRIVATE KEY|Authorization|secret-token|requestId/)
  assert.deepEqual(logs, [{ message: 'Submission request failed', fields: { code: 'GITHUB_APP_AUTH_ERROR' } }])
})

test('unknown write outcomes are preserved as not safe to retry', async () => {
  const error = new GitHubIntegrationError('PR_CREATE_ERROR', 'internal', undefined, undefined, {
    branch: 'content/submission-id',
    outcomes: {
      branchCreation: 'confirmed',
      fileWrite: 'confirmed',
      prCreation: 'unknown',
    },
    orphanBranchPossible: true,
  })
  const response = await handleSubmissionRequest(jsonRequest(rawSubmission), dependencies(async () => { throw error }))
  const body = await response.json()

  assert.equal(response.status, 502)
  assert.equal(body.error.code, 'SUBMISSION_OUTCOME_UNKNOWN')
  assert.equal(body.error.retrySafe, false)
  assert.doesNotMatch(JSON.stringify(body), /not-performed|internal/)
})

test('safe logs retain only recovery fields for an unknown outcome', async () => {
  const logs: SafeSubmissionErrorLog[] = []
  const error = new GitHubIntegrationError('FILE_CREATE_ERROR', 'raw body secret', undefined, undefined, {
    branch: 'content/submission-id',
    outcomes: {
      branchCreation: 'confirmed',
      fileWrite: 'unknown',
      prCreation: 'not-performed',
    },
    orphanBranchPossible: true,
  })
  await handleSubmissionRequest(jsonRequest(rawSubmission), {
    createSubmission: async () => { throw error },
    isProduction: false,
    logError: (_message, fields) => logs.push(fields),
  })

  assert.deepEqual(logs, [{
    code: 'FILE_CREATE_ERROR',
    branch: 'content/submission-id',
    branchCreation: 'confirmed',
    fileWrite: 'unknown',
    prCreation: 'not-performed',
    orphanBranchPossible: true,
  }])
  assert.doesNotMatch(JSON.stringify(logs), /raw body secret/)
})

test('production mode rejects the endpoint before createSubmission runs', async () => {
  let calls = 0
  const response = await handleSubmissionRequest(jsonRequest(rawSubmission), dependencies(async () => {
    calls += 1
    return submissionResult
  }, true))

  assert.equal(response.status, 503)
  assert.equal(calls, 0)
  assert.equal((await response.json()).error.code, 'SUBMISSION_API_DISABLED')
})

test('unexpected errors return a generic 500 without leaking their message', async () => {
  const response = await handleSubmissionRequest(jsonRequest(rawSubmission), dependencies(async () => {
    throw new Error('secret unexpected failure')
  }))
  const serialized = JSON.stringify(await response.json())

  assert.equal(response.status, 500)
  assert.match(serialized, /SUBMISSION_FAILED/)
  assert.doesNotMatch(serialized, /secret unexpected failure/)
})
