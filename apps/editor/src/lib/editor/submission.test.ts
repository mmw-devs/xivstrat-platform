import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeStructure } from '@xivstrat/content-schema'

import { createSubmissionController, submissionCanStart, type SubmissionUiState } from './submission.ts'

const structure = normalizeStructure({
  metadata: {
    id: 'ui-test',
    name: 'UI Test',
    short_name: 'Test',
    type: 'other',
    title: 'Submission UI Test',
    description: 'Mock-only UI test.',
    banner: 'banners/test.webp',
    publish_time: '2026-09-12',
    status: 'draft',
    team: 'XivStrat Test',
  },
  phases: [{ id: 'p1', name: 'Phase 1', mechanics: [] }],
})

const updatedStructure = normalizeStructure({
  ...structure,
  metadata: { ...structure.metadata, title: 'Latest Submission UI Test' },
})

const successBody = {
  ok: true,
  submission: {
    submissionId: 'submission-id',
    strategyId: 'ui-test',
    filePath: 'content/strategies/ui-test.json',
    branch: 'content/submission-id',
    commitSha: 'commit-sha',
    headSha: 'commit-sha',
    prNumber: 12,
    prUrl: 'https://github.com/mmw-devs/xivstrat-platform/pull/12',
    outcomes: { branchCreation: 'confirmed', fileWrite: 'confirmed', prCreation: 'confirmed' },
  },
}

test('idle enters submitting and concurrent calls share one request', async () => {
  let resolveFetch!: (response: Response) => void
  let calls = 0
  const states: SubmissionUiState[] = []
  const controller = createSubmissionController({
    fetch: async () => {
      calls += 1
      return await new Promise<Response>((resolve) => { resolveFetch = resolve })
    },
    onStateChange: (state) => states.push(state),
  })

  assert.deepEqual(controller.getState(), { status: 'idle' })
  const first = controller.submit(structure)
  const second = controller.submit(structure)
  assert.equal(calls, 1)
  assert.equal(first, second)
  assert.deepEqual(states, [{ status: 'submitting' }])
  assert.equal(submissionCanStart(controller.getState()), false)

  resolveFetch(Response.json(successBody, { status: 201 }))
  await first
})

test('201 returns only the PR and submission fields needed by the UI', async () => {
  const controller = createSubmissionController({
    fetch: async () => Response.json(successBody, { status: 201 }),
  })

  assert.deepEqual(await controller.submit(structure), {
    status: 'success',
    prNumber: 12,
    prUrl: 'https://github.com/mmw-devs/xivstrat-platform/pull/12',
    submissionId: 'submission-id',
  })
})

test('request sends the canonical structure as application/json', async () => {
  let input: RequestInfo | URL | undefined
  let init: RequestInit | undefined
  const controller = createSubmissionController({
    fetch: async (nextInput, nextInit) => {
      input = nextInput
      init = nextInit
      return Response.json(successBody, { status: 201 })
    },
  })

  await controller.submit(structure)
  assert.equal(input, '/api/submissions')
  assert.equal(init?.method, 'POST')
  assert.deepEqual(init?.headers, { 'Content-Type': 'application/json' })
  assert.deepEqual(JSON.parse(String(init?.body)), structure)
})

test('INVALID_SUBMISSION displays validation details without using the server message', async () => {
  const controller = createSubmissionController({
    fetch: async () => Response.json({
      ok: false,
      error: {
        code: 'INVALID_SUBMISSION',
        message: 'raw server message',
        details: ['基本信息 > 编号：未填写', 42],
      },
    }, { status: 422 }),
  })

  assert.deepEqual(await controller.submit(structure), {
    status: 'error',
    code: 'INVALID_SUBMISSION',
    message: '内容未通过校验',
    details: ['基本信息 > 编号：未填写'],
    retrySafe: true,
  })
})

for (const [code, expected] of [
  ['SUBMISSION_API_DISABLED', '当前环境暂未开放提交功能'],
  ['SUBMISSION_FAILED', '提交失败，请稍后再试或联系维护者'],
] as const) {
  test(`${code} maps to its safe user message`, async () => {
    const controller = createSubmissionController({
      fetch: async () => Response.json({ ok: false, error: { code, message: 'internal' } }, { status: 503 }),
    })
    const state = await controller.submit(structure)
    assert.equal(state.status, 'error')
    if (state.status === 'error') assert.equal(state.message, expected)
  })
}

test('unknown outcome locks repeat submission and never becomes a normal retry', async () => {
  let calls = 0
  const controller = createSubmissionController({
    fetch: async () => {
      calls += 1
      return Response.json({
        ok: false,
        error: { code: 'SUBMISSION_OUTCOME_UNKNOWN', message: 'internal', retrySafe: false },
      }, { status: 502 })
    },
  })

  const state = await controller.submit(structure)
  assert.deepEqual(state, {
    status: 'error',
    code: 'SUBMISSION_OUTCOME_UNKNOWN',
    message: '无法确认本次提交是否成功，请不要立即重复提交，并联系维护者确认',
    details: [],
    retrySafe: false,
  })
  assert.equal(submissionCanStart(state), false)
  assert.equal(await controller.submit(structure), state)
  assert.equal(calls, 1)
})

test('retrySafe false locks any error response', async () => {
  const controller = createSubmissionController({
    fetch: async () => Response.json({
      ok: false,
      error: { code: 'SUBMISSION_FAILED', retrySafe: false },
    }, { status: 502 }),
  })

  const state = await controller.submit(structure)
  assert.equal(state.status, 'error')
  assert.equal(submissionCanStart(state), false)
})

test('fetch rejection maps to a safe network error', async () => {
  const controller = createSubmissionController({
    fetch: async () => { throw new Error('raw network failure') },
  })

  assert.deepEqual(await controller.submit(structure), {
    status: 'error',
    code: 'NETWORK_ERROR',
    message: '网络请求失败，请检查连接后稍后再试',
    details: [],
    retrySafe: true,
  })
})

for (const scenario of [
  {
    name: 'success',
    response: () => Response.json(successBody, { status: 201 }),
  },
  {
    name: 'normal error',
    response: () => Response.json({
      ok: false,
      error: { code: 'SUBMISSION_FAILED', message: 'internal' },
    }, { status: 502 }),
  },
  {
    name: 'network error',
    response: () => Promise.reject(new Error('raw network failure')),
  },
] as const) {
  test(`${scenario.name} clears the pending request and permits a later attempt with fresh structure`, async () => {
    const bodies: unknown[] = []
    const controller = createSubmissionController({
      fetch: async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)))
        return await scenario.response()
      },
    })

    await controller.submit(structure)
    assert.notEqual(controller.getState().status, 'submitting')
    assert.equal(submissionCanStart(controller.getState()), true)

    await controller.submit(updatedStructure)
    assert.equal(bodies.length, 2)
    assert.deepEqual(bodies[0], structure)
    assert.deepEqual(bodies[1], updatedStructure)
  })
}
