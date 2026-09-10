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
  schemaVersion: 2,
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

interface RunSubmissionOptions {
  existingSha?: string
  failAt?: 'branch' | 'file' | 'pr'
}

async function runSubmission(options: RunSubmissionOptions = {}) {
  const calls: Array<{ route: string; parameters: Record<string, unknown> }> = []
  const request = async (route: string, parameters: Record<string, unknown>) => {
    calls.push({ route, parameters })
    if (route.startsWith('POST /repos/{owner}/{repo}/git/refs')) {
      if (options.failAt === 'branch') throw new Error('socket closed')
      return { data: { ref: parameters.ref } }
    }
    if (route.startsWith('GET /repos/{owner}/{repo}/contents/{path}')) {
      if (!options.existingSha) throw Object.assign(new Error('Not Found'), { status: 404 })
      return { data: { type: 'file', sha: options.existingSha } }
    }
    if (route.startsWith('PUT /repos/{owner}/{repo}/contents/{path}')) {
      if (options.failAt === 'file') throw new Error('connection reset')
      return { data: { commit: { sha: 'commit-sha' } } }
    }
    if (route.startsWith('POST /repos/{owner}/{repo}/pulls')) {
      if (options.failAt === 'pr') throw new Error('other side closed')
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
  assert.deepEqual(result.outcomes, {
    branchCreation: 'confirmed',
    fileWrite: 'confirmed',
    prCreation: 'confirmed',
  })
})

test('existing file updates using its SHA and canonical JSON', async () => {
  const { calls } = await runSubmission({ existingSha: 'existing-blob-sha' })
  const write = calls.find((call) => call.route.startsWith('PUT /repos/{owner}/{repo}/contents/{path}'))!
  assert.equal(write.parameters.sha, 'existing-blob-sha')
  assert.equal(Buffer.from(String(write.parameters.content), 'base64').toString('utf8'), structureToJson(structure))
})

test('PUT network failure reports an unknown file outcome and does not attempt a PR', async () => {
  await assert.rejects(runSubmission({ failAt: 'file' }), (error) => {
    assert.ok(error instanceof GitHubIntegrationError)
    assert.equal(error.code, 'FILE_CREATE_ERROR')
    assert.deepEqual(error.submissionContext?.outcomes, {
      branchCreation: 'confirmed',
      fileWrite: 'unknown',
      prCreation: 'not-performed',
    })
    return true
  })
})

test('PR network failure reports an unknown PR outcome and does not return success', async () => {
  const submit = runSubmission({ failAt: 'pr' })
  await assert.rejects(submit, (error) => {
    assert.ok(error instanceof GitHubIntegrationError)
    assert.equal(error.code, 'PR_CREATE_ERROR')
    assert.deepEqual(error.submissionContext?.outcomes, {
      branchCreation: 'confirmed',
      fileWrite: 'confirmed',
      prCreation: 'unknown',
    })
    assert.equal(error.submissionContext?.orphanBranchPossible, true)
    assert.match(error.submissionContext?.branch ?? '', /^content\//)
    assert.match(error.message, /PR creation outcome is unknown/)
    return true
  })
})

test('branch network failure is unknown and later operations are not performed', async () => {
  await assert.rejects(runSubmission({ failAt: 'branch' }), (error) => {
    assert.ok(error instanceof GitHubIntegrationError)
    assert.equal(error.code, 'BRANCH_CREATE_ERROR')
    assert.deepEqual(error.submissionContext?.outcomes, {
      branchCreation: 'unknown',
      fileWrite: 'not-performed',
      prCreation: 'not-performed',
    })
    return true
  })
})

test('input validation failure marks every remote operation as not performed', async () => {
  const invalid = structuredClone(structure)
  invalid.metadata.id = '../escape'
  const submit = createSubmissionService(async () => {
    throw new Error('runtime must not be created for invalid input')
  })
  await assert.rejects(submit(invalid), (error) => {
    assert.ok(error instanceof GitHubIntegrationError)
    assert.equal(error.code, 'INVALID_STRATEGY_ID')
    assert.deepEqual(error.submissionContext?.outcomes, {
      branchCreation: 'not-performed',
      fileWrite: 'not-performed',
      prCreation: 'not-performed',
    })
    return true
  })
})
