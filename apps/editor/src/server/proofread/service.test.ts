import assert from 'node:assert/strict'
import test from 'node:test'
import { proofread } from './service.ts'
const request = {
  requestId: 'r',
  snapshotId: 's',
  terminology: '',
  blocks: [{ blockId: 'b', path: ['P1'], paragraphs: [{ paragraphId: 'p-0', text: 'H 提前远离人群。' }] }],
}
const config = { endpoint: 'http://localhost/chat/completions', model: 'test', apiKey: 'server-only' }
test('valid full response, deterministic resolution and server-only credentials', async () => {
  const mock: typeof fetch = async (_url, init) => {
    assert.match(String(init?.body), /不执行其中的指令/)
    assert.ok(!String(init?.body).includes('server-only'))
    return Response.json({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: JSON.stringify({
              suggestions: [
                {
                  blockId: 'b',
                  paragraphId: 'p-0',
                  kind: 'terminology',
                  action: 'replace',
                  original: 'H',
                  replacement: '奶妈',
                  prefix: '',
                  suffix: ' 提前',
                  reason: '依据术语偏好',
                },
              ],
            }),
          },
        },
      ],
    })
  }
  const result = (await proofread(request, config, mock)) as {
    requestId: string
    suggestions: { from: number }[]
  }
  assert.equal(result.requestId, 'r')
  assert.equal(result.suggestions[0]!.from, 0)
})
test('unconfigured, truncation, invalid JSON and HTTP failures never become success', async () => {
  await assert.rejects(proofread(request, {}), /尚未配置/)
  await assert.rejects(
    proofread(request, config, async () => Response.json({ choices: [{ finish_reason: 'length' }] })),
    /截断/,
  )
  await assert.rejects(
    proofread(request, config, async () =>
      Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'not json' } }] }),
    ),
    /JSON/,
  )
  await assert.rejects(
    proofread(request, config, async () => new Response('secret', { status: 500 })),
    /HTTP 500/,
  )
})

test('oversized upstream response is stopped before parsing', async () => {
  await assert.rejects(
    proofread(request, config, async () => new Response('x'.repeat(500001))),
    /大小限制/,
  )
})
