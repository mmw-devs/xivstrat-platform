import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { UploadStore } from '../src/server/uploads/store.ts'
import { createUploadHandler } from '../src/server/uploads/http.ts'
import { createImageSubmissionWorker } from '../src/server/github/image-submission.ts'

// Controlled local bridge only. A future deployed adapter must verify real identity.
const host = '127.0.0.1', port = 4324
const store = new UploadStore(fileURLToPath(new URL('../../../.local-data/image-submissions/', import.meta.url)))
const worker = createImageSubmissionWorker(store)
const allowedOrigins = new Set(['http://127.0.0.1:4321', 'http://localhost:4321', 'http://127.0.0.1:4331'])
const handler = createUploadHandler(store, {
  ...(process.env.ENABLE_IMAGE_SUBMISSION === '1' ? { startSubmission: worker.start } : {}),
  async authenticate(request) {
    const address = request.socket.remoteAddress
    if (address !== '127.0.0.1' && address !== '::1') return null
    if (request.headers.origin && !allowedOrigins.has(request.headers.origin)) return null
    if (request.headers['sec-fetch-site'] === 'cross-site') return null
    return 'local-developer'
  },
  onError: code => console.error('Local upload task:', code),
})
const server = createServer((request, response) => { void handler(request, response) })
server.requestTimeout = 125_000
server.headersTimeout = 15_000
const sweep = setInterval(() => { try { store.cleanup() } catch { console.error('Local upload cleanup failed') } }, 60_000)
sweep.unref()
server.on('error', error => { clearInterval(sweep); store.close(); console.error(error.message); process.exitCode = 1 })
let closing = false
function close() {
  if (closing) return
  closing = true
  clearInterval(sweep)
  server.close(() => { void worker.idle().then(() => store.close()) })
}
process.once('SIGINT', close)
process.once('SIGTERM', close)
server.listen(port, host, () => console.log(`Local image upload service: http://${host}:${port}/api/upload-tasks/<uuid>`))
