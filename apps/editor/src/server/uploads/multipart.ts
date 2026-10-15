import Busboy from 'busboy'
import sharp from 'sharp'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { IncomingMessage } from 'node:http'
import { normalizeStructure, structureToJson, validateStructure } from '@xivstrat/content-schema'
import { imageReferences } from '../../lib/editor/image-references.ts'
import { MIB, UploadError } from './store.ts'

export const MAX_BODY_BYTES = 21 * MIB
export const MAX_CONTENT_BYTES = 20 * MIB
const fail = (message: string) => new UploadError(422, 'INVALID_PACKAGE', message)

/** Digest of canonical JSON (includes every image hash in its references). */
export function snapshotDigest(json: string): string { return createHash('sha256').update(json).digest('hex') }

export async function receiveMultipart(request: IncomingMessage, directory: string, expectedDigest: string, signal: AbortSignal): Promise<string[]> {
  let parser: ReturnType<typeof Busboy>
  try {
    parser = Busboy({ headers: request.headers, preservePath: true, limits: {
      fieldSize: MIB, fields: 1, fileSize: 3 * MIB, files: 30, parts: 31,
    } })
  } catch { throw new UploadError(400, 'INVALID_MULTIPART', 'multipart 边界无效') }
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  let failure: Error | undefined
  const reject = (error: Error) => { failure ??= error; controller.abort(error) }
  let json: string | undefined
  let bodyBytes = 0, contentBytes = 0
  const names = new Set<string>()
  const writes: Promise<void>[] = []
  const guard = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    bodyBytes += chunk.length
    callback(bodyBytes > MAX_BODY_BYTES ? new UploadError(413, 'UPLOAD_TOO_LARGE', '上传请求超过 21 MiB') : null, chunk)
  } })
  parser.on('field', (name, value, info) => {
    if (name !== 'strategy' || json !== undefined || info.valueTruncated || info.nameTruncated) { reject(fail('必须且只能包含一个完整的 strategy JSON 字段')); return }
    json = value; contentBytes += Buffer.byteLength(value)
    if (contentBytes > MAX_CONTENT_BYTES) reject(new UploadError(413, 'UPLOAD_TOO_LARGE', '攻略内容超过 20 MiB'))
  })
  for (const event of ['fieldsLimit', 'filesLimit', 'partsLimit'] as const) parser.on(event, () => reject(fail('multipart 字段或图片数量超限')))
  parser.on('file', (field, stream, info) => {
    stream.on('error', () => { /* Pipeline owns errors for accepted files. */ })
    const name = info.filename
    if (field !== 'images' || !/^[a-f0-9]{64}\.webp$/.test(name) || names.has(name)) {
      stream.resume(); reject(fail('图片名称非法或重复')); return
    }
    names.add(name)
    const hash = createHash('sha256')
    const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      contentBytes += chunk.length
      hash.update(chunk)
      callback(contentBytes > MAX_CONTENT_BYTES ? new UploadError(413, 'UPLOAD_TOO_LARGE', '攻略内容超过 20 MiB') : null, chunk)
    } })
    stream.on('limit', () => reject(new UploadError(413, 'IMAGE_TOO_LARGE', '单张图片超过 3 MiB')))
    // Every promise is caught immediately, and all handles settle before cleanup.
    writes.push(pipeline(stream, meter, createWriteStream(join(directory, name), { flags: 'wx' }), { signal: controller.signal })
      .then(() => { if (hash.digest('hex') !== name.slice(0, -5)) throw fail('图片内容与哈希名称不符') })
      .catch(error => { reject(error instanceof Error ? error : fail('图片写入失败')) }))
  })
  const interrupted = () => reject(fail('上传连接中断'))
  request.on('aborted', interrupted)
  request.on('error', interrupted)
  try {
    try {
      const receiving = pipeline(guard, parser, { signal: controller.signal })
      request.pipe(guard)
      await receiving
    }
    catch (error) { failure ??= error instanceof Error ? error : fail('上传中断') }
    await Promise.all(writes)
    if (failure) throw failure
    signal.throwIfAborted()
    if (json === undefined) throw fail('缺少 strategy JSON')
    let canonical: string
    let refs: string[]
    try {
      const structure = normalizeStructure(JSON.parse(json))
      const errors = validateStructure(structure)
      if (errors.length) throw fail(errors.join('; '))
      canonical = structureToJson(structure)
      refs = imageReferences(structure)
    } catch (error) { throw error instanceof UploadError ? error : fail('攻略 JSON 无效') }
    if (Buffer.byteLength(canonical) > MIB) throw fail('规范化后的 JSON 超过 1 MiB')
    if (snapshotDigest(canonical) !== expectedDigest) throw new UploadError(409, 'DIGEST_MISMATCH', '内容与任务摘要不一致')
    if (refs.length > 30) throw fail('每篇最多 30 张图片')
    const local = refs.filter(path => !/^https?:\/\//i.test(path))
    if (local.some(path => !/^assets\/images\/[a-f0-9]{64}\.webp$/.test(path) || !names.has(path.slice(14)))) throw fail('图片路径不受支持或缺少对应文件')
    if (names.size !== local.length) throw fail('包含未被引用的图片')
    for (const name of names) {
      signal.throwIfAborted()
      // Bounded to 3 MiB; buffer input prevents libvips file caching from holding
      // Windows spool handles open after validation and blocking cleanup.
      const image = sharp(await readFile(join(directory, name)), { limitInputPixels: 25_000_000, failOn: 'warning', animated: true })
      const metadata = await image.metadata()
      if (metadata.format !== 'webp' || (metadata.pages ?? 1) !== 1) throw fail('仅支持静态 WebP 图片')
      // Force decoding to reject truncated payloads, without buffering a raw 100 MB image.
      const decoder = image.clone().resize(1, 1).raw()
      const cancel = () => { decoder.destroy(new Error('Upload validation timed out')) }
      signal.addEventListener('abort', cancel, { once: true })
      try { await decoder.toBuffer() } finally { signal.removeEventListener('abort', cancel) }
    }
    signal.throwIfAborted()
    await writeFile(join(directory, 'strategy.json'), canonical, { flag: 'wx', flush: true })
    return ['strategy.json', ...names]
  } catch (error) {
    if (error instanceof UploadError || signal.aborted) throw error
    throw fail('上传中断或图片无法解码')
  } finally {
    request.unpipe(guard)
    request.removeListener('aborted', interrupted)
    request.removeListener('error', interrupted)
    if (!request.complete) request.pause()
    signal.removeEventListener('abort', abort)
  }
}
