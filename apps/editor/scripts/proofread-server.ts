import { createServer } from 'node:http'
import { proofread } from '../src/server/proofread/service.ts'
const port = Number(process.env.PROOFREAD_PORT ?? 4322)
let active = 0
let lastStart = 0
const server = createServer(async (request, response) => {
  const send = (status: number, value: unknown): void => {
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    })
    response.end(JSON.stringify(value))
  }
  if (request.url !== '/api/proofread') {
    send(404, { error: '未找到接口' })
    return
  }
  if (request.method !== 'POST') {
    send(405, { error: '仅支持 POST' })
    return
  }
  // Bind to loopback. Public hosting must authenticate at the same-origin reverse proxy.
  const allowed = (
    process.env.PROOFREAD_ALLOWED_ORIGINS ?? 'http://localhost:4321,http://127.0.0.1:4321'
  ).split(',')
  if (request.headers.origin && !allowed.includes(request.headers.origin)) {
    send(403, { error: '请求来源不允许' })
    return
  }
  if (!request.headers['content-type']?.startsWith('application/json')) {
    send(415, { error: '请求需要 JSON' })
    return
  }
  if (active >= 2 || Date.now() - lastStart < 2000) {
    send(429, { error: '校对请求过于频繁，请稍后重试' })
    return
  }
  const controller = new AbortController()
  response.on('close', () => {
    if (!response.writableEnded) controller.abort()
  })
  active++
  lastStart = Date.now()
  try {
    const chunks: Buffer[] = []
    let bytes = 0
    for await (const chunk of request) {
      bytes += Buffer.byteLength(chunk)
      if (bytes > 300000) {
        send(413, { error: '全文超过请求大小限制，未进行校对' })
        return
      }
      chunks.push(Buffer.from(chunk))
    }
    let raw: unknown
    try {
      raw = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      send(400, { error: '请求不是合法 JSON' })
      return
    }
    if (!process.env.PROOFREAD_ENDPOINT || !process.env.PROOFREAD_MODEL) {
      send(503, { error: '尚未配置校对模型，请在服务端设置接口和模型' })
      return
    }
    const result = await proofread(
      raw,
      {
        endpoint: process.env.PROOFREAD_ENDPOINT,
        model: process.env.PROOFREAD_MODEL,
        apiKey: process.env.PROOFREAD_API_KEY,
      },
      fetch,
      controller.signal,
    )
    send(200, result)
  } catch (error) {
    const message = error instanceof Error ? error.message : '校对服务错误'
    // Never expose upstream response bodies, URLs or credentials.
    send(502, {
      error:
        /校对|模型|建议|正文|段落/.test(message) && message.length < 200
          ? message
          : '校对失败：网络、超时或响应格式异常',
    })
  } finally {
    active--
  }
})
server.requestTimeout = 70000
server.listen(port, '127.0.0.1', () =>
  console.log(`Proofread service: http://127.0.0.1:${port}/api/proofread`),
)
