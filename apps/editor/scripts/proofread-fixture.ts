import { createServer } from 'node:http'
// Local-only fixture. Never import this in production; no AI or external requests.
createServer(async (request, response) => {
  let body = ''
  for await (const chunk of request) body += String(chunk)
  const input = JSON.parse(body) as { messages: { content: string }[] }
  const snapshot = JSON.parse(input.messages[1]!.content) as {
    blocks: { blockId: string; paragraphs: { paragraphId: string; text: string }[] }[]
  }
  const suggestions = snapshot.blocks.flatMap((b) =>
    b.paragraphs.flatMap((p) =>
      p.text.includes('H 提前')
        ? [
            {
              blockId: b.blockId,
              paragraphId: p.paragraphId,
              kind: 'terminology',
              action: 'replace',
              original: 'H',
              replacement: '奶妈',
              prefix: '',
              suffix: ' 提前',
              reason: '固定测试样例：治疗称呼统一为奶妈，H1 保留',
            },
            {
              blockId: b.blockId,
              paragraphId: p.paragraphId,
              kind: 'grammar',
              action: 'replace',
              original: '人群',
              replacement: '队伍',
              prefix: '远离',
              suffix: '。',
              reason: '固定测试样例：验证第二条建议偏移',
            },
          ]
        : [],
    ),
  )
  response.writeHead(200, { 'Content-Type': 'application/json' })
  response.end(
    JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ suggestions }) } }],
    }),
  )
}).listen(4323, '127.0.0.1', () => console.log('TEST FIXTURE ONLY: http://127.0.0.1:4323'))
