import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http'

import { createSubmission } from '../src/server/github/submission.ts'
import { handleSubmissionRequest } from '../src/server/submissions/http.ts'

const host = '127.0.0.1'
const port = 4323
const endpoint = '/api/submissions'

function webHeaders(headers: IncomingHttpHeaders): Headers {
  const result = new Headers()
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) value.forEach((item) => result.append(name, item))
    else if (value !== undefined) result.set(name, value)
  }
  return result
}

async function webRequest(request: IncomingMessage): Promise<Request> {
  const method = request.method ?? 'GET'
  const chunks: Buffer[] = []
  if (method !== 'GET' && method !== 'HEAD') {
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
  }
  const body = chunks.length > 0 ? new Uint8Array(Buffer.concat(chunks)) : undefined
  return new Request(new URL(request.url ?? '/', `http://${host}:${port}`), {
    method,
    headers: webHeaders(request.headers),
    body,
  })
}

async function writeWebResponse(webResponse: Response, response: ServerResponse): Promise<void> {
  response.statusCode = webResponse.status
  webResponse.headers.forEach((value, name) => response.setHeader(name, value))
  response.end(Buffer.from(await webResponse.arrayBuffer()))
}

async function forward(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const pathname = new URL(request.url ?? '/', `http://${host}:${port}`).pathname
  if (pathname !== endpoint) {
    response.writeHead(404, { 'Cache-Control': 'no-store' })
    response.end()
    return
  }

  const result = await handleSubmissionRequest(await webRequest(request), {
    createSubmission,
    isProduction: false,
    logError: (message, fields) => console.error(message, fields),
  })
  console.log('Local submission request', { method: request.method, path: pathname, status: result.status })
  await writeWebResponse(result, response)
}

const server = createServer((request, response) => {
  void forward(request, response).catch(() => {
    console.error('Local submission bridge failed')
    if (!response.headersSent) response.writeHead(500, { 'Cache-Control': 'no-store' })
    response.end()
  })
})

server.listen(port, host, () => {
  console.log(`Local submission service: http://${host}:${port}${endpoint}`)
})
