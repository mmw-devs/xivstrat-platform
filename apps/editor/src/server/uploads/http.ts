import type { IncomingMessage, ServerResponse } from 'node:http'
import { UploadStore, UploadError, type UploadTask } from './store.ts'
import { MAX_BODY_BYTES, receiveMultipart } from './multipart.ts'

interface UploadDependencies {
  /** Trusted server-side identity adapter. Never copy an owner ID from request headers. */
  authenticate(request: IncomingMessage): Promise<string | null>
  timeoutMs?: number
  onError?: (code: string) => void
  startSubmission?: (id: string, owner: string) => void
}

function publicTask(task: UploadTask, store: UploadStore) {
  const job = store.submission(task.id, task.owner)
  return { id: task.id, state: task.state, bytes: task.state === 'ready' ? task.bytes : 0,
    updatedAt: new Date(task.updated).toISOString(), remoteSubmission: job?.status ?? 'not-started',
    ...(job?.code ? { code: job.code } : {}), ...(job?.result ? { result: job.result } : {}) }
}
function reply(response: ServerResponse, status: number, value: unknown): void {
  if (response.destroyed || response.headersSent) return
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'close' })
  response.end(JSON.stringify(value))
}

export function createUploadHandler(store: UploadStore, dependencies: UploadDependencies) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    let reservedId: string | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
      const match = /^\/api\/upload-tasks\/([^/]+)(\/submit)?$/.exec(pathname)
      if (!match) throw new UploadError(404, 'NOT_FOUND', '接口不存在')
      const owner = await dependencies.authenticate(request)
      if (!owner) throw new UploadError(401, 'UNAUTHORIZED', '未授权')
      const id = match[1]
      store.directory(id)
      if (match[2]) {
        if (request.method !== 'POST') throw new UploadError(405, 'METHOD_NOT_ALLOWED', '仅支持 POST')
        if (!dependencies.startSubmission) throw new UploadError(503, 'SUBMISSION_DISABLED', '图片远程投稿未启用')
        dependencies.startSubmission(id, owner)
        reply(response, 202, { ok: true, task: publicTask(store.get(id, owner)!, store) }); return
      }
      if (request.method === 'GET') {
        store.cleanup()
        const task = store.get(id, owner)
        if (!task) throw new UploadError(404, 'NOT_FOUND', '任务不存在')
        reply(response, 200, { ok: true, task: publicTask(task, store) }); return
      }
      if (request.method !== 'PUT') { response.setHeader('Allow', 'PUT, GET'); throw new UploadError(405, 'METHOD_NOT_ALLOWED', '仅支持 PUT 和 GET') }
      if (!/^multipart\/form-data(?:;|$)/i.test(request.headers['content-type'] ?? '')) throw new UploadError(415, 'UNSUPPORTED_MEDIA_TYPE', '请使用 multipart/form-data')
      const digest = request.headers['x-submission-digest']
      if (typeof digest !== 'string') throw new UploadError(400, 'MISSING_DIGEST', '缺少内容摘要')
      const length = request.headers['content-length']
      if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) throw new UploadError(413, 'UPLOAD_TOO_LARGE', '上传请求超过 21 MiB')
      const reservation = store.reserve(id, owner, digest)
      if (reservation.reused) { reply(response, 200, { ok: true, task: publicTask(reservation.task, store) }); return }
      reservedId = id
      const controller = new AbortController()
      timer = setTimeout(() => controller.abort(new UploadError(408, 'UPLOAD_TIMEOUT', '接收或验证超时，请重新上传')), dependencies.timeoutMs ?? 120_000)
      let files: string[]
      try { files = await receiveMultipart(request, store.directory(id), digest, controller.signal) }
      catch (error) { if (controller.signal.aborted) throw controller.signal.reason; throw error }
      const task = store.ready(id, owner, files)
      reservedId = undefined
      reply(response, 201, { ok: true, task: publicTask(task, store) })
    } catch (error) {
      if (reservedId) {
        try { store.release(reservedId) }
        catch { dependencies.onError?.('SPOOL_CLEANUP_FAILED') }
      }
      const failure = error instanceof UploadError ? error : new UploadError(500, 'UPLOAD_FAILED', '素材接收失败')
      dependencies.onError?.(failure.code)
      reply(response, failure.status, { ok: false, error: { code: failure.code, message: failure.message } })
    } finally { if (timer) clearTimeout(timer) }
  }
}
