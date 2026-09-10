import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeStructure, structureToJson } from '@xivstrat/content-schema'
import { parseRichText, plainTextDocument, richTextLines, renderRichText } from '@xivstrat/content-schema'
const legacy = {
  phases: [
    {
      mechanics: [
        {
          sections: [
            { type: 'note', content: [{ type: 'text', value: [' 奶妈先处理。 ', '', 'H1 保留。'] }] },
          ],
        },
      ],
    },
  ],
}
test('legacy migrates to stable v2 document; JSON round-trip preserves formatting', () => {
  const structure = normalizeStructure(legacy)
  const block = structure.phases[0]!.mechanics[0]!.sections[0]!.content[0]!
  assert.equal(block.type, 'text')
  if (block.type !== 'text') return
  block.doc.content[0]!.content![0] = {
    type: 'text',
    text: '奶妈',
    marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { color: '#f87171', fontSize: '20px' } }],
  }
  assert.deepEqual(normalizeStructure(JSON.parse(structureToJson(structure))), structure)
  assert.equal(structure.schemaVersion, 2)
  assert.equal('value' in block, false)
})
test('rejects unknown nodes, attributes and arbitrary styles', () => {
  for (const node of [
    { type: 'image', src: 'evil' },
    { type: 'text', text: 'x', marks: [{ type: 'link' }] },
    { type: 'text', text: 'x', marks: [{ type: 'textStyle', attrs: { color: 'red' } }] },
    { type: 'text', text: 'x', onclick: 'evil' },
  ]) {
    assert.throws(() => parseRichText({ type: 'doc', content: [{ type: 'paragraph', content: [node] }] }))
  }
  assert.throws(() => normalizeStructure({ schemaVersion: 99 }))
})
test('whitespace, empty paragraphs, emoji, hardBreak and HTML/Astro escaping', () => {
  const doc = plainTextDocument([' a  b ', '', '<script>{danger}</script>😀'])
  doc.content[0]!.content!.push({ type: 'hardBreak' }, { type: 'text', text: '末尾' })
  assert.deepEqual(richTextLines(parseRichText(doc)), [' a  b \n末尾', '', '<script>{danger}</script>😀'])
  const html = renderRichText(doc, true)
  assert.ok(html.includes('&lt;script&gt;&#123;danger&#125;'))
  assert.ok(html.includes('<br />'))
  assert.ok(!html.includes('<script>'))
})

test('all toolbar marks survive JSON and safe rendering; unsafe links are rejected', () => {
  const doc = parseRichText({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'H',
            marks: [
              { type: 'bold' },
              { type: 'italic' },
              { type: 'underline' },
              { type: 'strike' },
              { type: 'link', attrs: { href: 'https://example.com/?q="&x={test}' } },
              { type: 'textStyle', attrs: { color: '#f87171' } },
            ],
          },
        ],
      },
    ],
  })
  assert.deepEqual(parseRichText(JSON.parse(JSON.stringify(doc))), doc)
  const html = renderRichText(doc, true, { paragraph: 0, from: 0, to: 1 })
  for (const tag of ['strong', 'em', 'u', 's']) assert.ok(html.includes(`<${tag}>`))
  assert.ok(html.includes('&quot;&amp;x=&#123;test&#125;'))
  assert.ok(html.includes('<mark class="proofread-highlight">H</mark>'))
  assert.ok(html.includes('rel="noopener noreferrer"'))
  for (const href of [
    'javascript:alert(1)',
    'data:text/html,x',
    '//example.com',
    'https://user:pass@example.com',
    'https://example.com/ a',
  ]) {
    assert.throws(() =>
      parseRichText({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href } }] }],
          },
        ],
      }),
    )
  }
})

test('v2 duplicate body ids cannot corrupt proofreading targeting', () => {
  const structure = normalizeStructure(legacy)
  const section = structure.phases[0]!.mechanics[0]!.sections[0]!
  section.content.push(structuredClone(section.content[0]!))
  assert.throws(() => normalizeStructure(structure))
})
