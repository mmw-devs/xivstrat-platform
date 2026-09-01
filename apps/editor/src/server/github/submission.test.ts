import assert from 'node:assert/strict'
import test from 'node:test'

import { structureToJson, type StrategyStructure } from '@xivstrat/content-schema'

import {
  assertSafeTargetPath,
  createSubmissionService,
  strategyFilePath,
  validateStrategyId,
} from './submission.ts'
import { GitHubIntegrationError } from './types.ts'

const structure: StrategyStructure = {
  metadata: {
    id: 'submission-test',
    name: 'Submission Test',
    short_name: 'Test',
    type: 'other',
    title: 'Submission Test Strategy',
    description: 'Mock-only submission test.',
    banner: 'banners/test.webp',
    publish_time: '2026-08-29',
    status: 'draft',
    video: '',
    team: 'XivStrat Test',
  },
  references: [],
  macros: [],
  phases: [{ id: 'p1', name: 'Phase 1', mechanics: [] }],
}

const config = {
  appId: 1,
  installationId: 2,
  privateKey: 'not-used-by-mock',
  owner: 'mmw-devs',
  repo: 'xivstrat-platform',
  baseBranch: 'main',
}

function expectCode(action: () => unknown, code: string): void {
  assert.throws(action, (error) => error instanceof GitHubIntegrationError && error.code === code)
}

test('validates strategy ids and derives the fixed target path', () => {
  assert.equal(validateStrategyId('submission-test'), 'submission-test')
  assert.equal(strategyFilePath('submission-test'), 'content/strategies/submission-test.json')
})

test('rejects traversal, slash, backslash, empty, and unsafe target paths', () => {
  for (const id of ['', '../escape', 'folder/name', 'folder\\name']) {
    expectCode(() => validateStrategyId(id), 'INVALID_STRATEGY_ID')
  }
  expectCode(() => assertSafeTargetPath('content/strategies/../escape.json'), 'UNSAFE_TARGET_PATH')
  expectCode(() => assertSafeTargetPath('other/submission-test.json'), 'UNSAFE_TARGET_PATH')
})

async function runSubmission(existingSha?: string, failPullRequest = false) {
  const calls: Array<{ route: string; parameters: Record<string, unknown> }> = []
  const request = async (route: string, parameters: Record<string, unknown>) => {
    calls.push({ route, parameters })
    if (route.startsWith('POST /repos/{owner}/{repo}/git/refs')) return { data: { ref: parameters.ref } }
    if (route.startsWith('GET /repos/{owner}/{repo}/contents/{path}')) {
      if (!existingSha) throw Object.assign(new Error('Not Found'), { status: 404 })
      return { data: { type: 'file', sha: existingSha } }
    }
    if (route.startsWith('PUT /repos/{owner}/{repo}/contents/{path}')) {
      return { data: { commit: { sha: 'commit-sha' } } }
    }
    if (route.startsWith('POST /repos/{owner}/{repo}/pulls')) {
      if (failPullRequest) throw Object.assign(new Error('PR failed'), { status: 500 })
      return { data: { number: 42, html_url: 'https://github.com/mmw-devs/xivstrat-platform/pull/42' } }
    }
    throw new Error(`Unexpected route: ${route}`)
  }
  const submit = createSubmissionService(async () => ({
    config,
    octokit: { request: request as never },
    baseHeadSha: 'base-sha',
    submissionId: '00000000-0000-4000-8000-000000000001',
  }))
  return { calls, result: await submit(structure) }
}

test('missing file creates a new file with canonical JSON on a fresh content branch and opens a PR to main', async () => {
  const { calls, result } = await runSubmission()
  const branch = calls.find((call) => call.route.startsWith('POST /repos/{owner}/{repo}/git/refs'))!
  const write = calls.find((call) => call.route.startsWith('PUT /repos/{owner}/{repo}/contents/{path}'))!
  const pull = calls.find((call) => call.route.startsWith('POST /repos/{owner}/{repo}/pulls'))!

  assert.equal(branch.parameters.ref, `refs/heads/${result.branch}`)
  assert.match(result.branch, /^content\//)
  assert.equal(write.parameters.path, 'content/strategies/submission-test.json')
  assert.equal(write.parameters.branch, result.branch)
  assert.equal('sha' in write.parameters, false)
  assert.equal(Buffer.from(String(write.parameters.content), 'base64').toString('utf8'), structureToJson(structure))
  assert.equal(pull.parameters.base, 'main')
  assert.equal(pull.parameters.head, result.branch)
  assert.equal(result.commitSha, 'commit-sha')
  assert.equal(result.headSha, 'commit-sha')
})

test('existing file updates using its SHA and canonical JSON', async () => {
  const { calls } = await runSubmission('existing-blob-sha')
  const write = calls.find((call) => call.route.startsWith('PUT /repos/{owner}/{repo}/contents/{path}'))!
  assert.equal(write.parameters.sha, 'existing-blob-sha')
  assert.equal(Buffer.from(String(write.parameters.content), 'base64').toString('utf8'), structureToJson(structure))
})

test('PR failure does not return success and reports orphan branch context', async () => {
  const submit = runSubmission(undefined, true)
  await assert.rejects(submit, (error) => {
    assert.ok(error instanceof GitHubIntegrationError)
    assert.equal(error.code, 'PR_CREATE_ERROR')
    assert.equal(error.submissionContext?.branchCreated, true)
    assert.equal(error.submissionContext?.fileWritten, true)
    assert.equal(error.submissionContext?.orphanBranchPossible, true)
    assert.match(error.submissionContext?.branch ?? '', /^content\//)
    return true
  })
})
