import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseRequest,
  rebaseSuggestions,
  resolveSuggestions,
  snapshotBlocks,
  type ModelSuggestion,
} from './contracts.ts'
import { normalizeStructure } from '@xivstrat/content-schema'
const blocks = [
  { blockId: 'b', path: ['P1'], paragraphs: [{ paragraphId: 'p-0', text: 'H 先分散，H 后集合。😀' }] },
]
const sample: ModelSuggestion = {
  blockId: 'b',
  paragraphId: 'p-0',
  kind: 'terminology',
  action: 'replace',
  original: 'H',
  replacement: '奶妈',
  prefix: '',
  suffix: ' 先',
  reason: '根据术语偏好',
}
test('exact matching rejects ambiguous original and locates UTF-16 ranges', () => {
  assert.equal(resolveSuggestions([{ ...sample, suffix: '' }], blocks)[0]!.applicable, false)
  assert.equal(resolveSuggestions([sample], blocks)[0]!.from, 0)
  assert.equal(
    resolveSuggestions([{ ...sample, original: '😀', suffix: '' }], blocks)[0]!.to,
    blocks[0]!.paragraphs[0]!.text.length,
  )
})
test('overlap and context changes invalidate; independent subsequent ranges shift', () => {
  const suggestions = resolveSuggestions(
    [sample, { ...sample, suffix: ' 后' }, { ...sample, original: 'H 先', suffix: '' }],
    blocks,
  )
  assert.equal(suggestions[2]!.applicable, false)
  const old = suggestions[1]!.from
  suggestions[0]!.status = 'accepted'
  rebaseSuggestions(suggestions, suggestions[0]!)
  assert.equal(suggestions[1]!.from, old + 1)
  assert.equal(suggestions[2]!.status, 'stale')
})
test('review-only, malformed output, missing block and over-budget request', () => {
  assert.equal(
    resolveSuggestions([{ ...sample, action: 'review', replacement: null }], blocks)[0]!.applicable,
    false,
  )
  assert.throws(() => resolveSuggestions([{ ...sample, blockId: 'missing' }], blocks))
  assert.throws(() => resolveSuggestions([{ ...sample, reason: null }], blocks))
  assert.throws(() =>
    parseRequest({
      requestId: 'r',
      snapshotId: 's',
      terminology: '',
      blocks: [{ ...blocks[0], paragraphs: [{ paragraphId: 'p-0', text: 'a'.repeat(60001) }] }],
    }),
  )
})
test('snapshot includes recursive body and context; excludes images, macros and metadata', () => {
  const s = normalizeStructure({
    macros: [{ code: 'secret' }],
    phases: [
      {
        name: '阶段',
        mechanics: [
          {
            name: '父',
            sub_mechanics: [
              {
                name: '子',
                sections: [
                  {
                    type: 'note',
                    content: [
                      { type: 'text', value: ['H1 不改'] },
                      { type: 'image', file: 'private' },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  })
  const result = snapshotBlocks(s)
  assert.equal(result.length, 1)
  assert.ok(result[0]!.path.includes('子'))
  assert.ok(!JSON.stringify(result).includes('private'))
  assert.ok(!JSON.stringify(result).includes('secret'))
})
