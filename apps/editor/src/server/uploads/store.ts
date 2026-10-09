import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, rmSync, statSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import type { SubmissionCheckpoint } from './submission-state.ts'

export const MIB = 1024 * 1024
export const TASK_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
export class UploadError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code }
}
export interface UploadTask {
  id: string
  owner: string
  digest: string
  state: 'receiving' | 'ready' | 'reupload-required' | 'submitted'
  bytes: number
  updated: number
  files: string
}
export interface StoreOptions {
  maxBytes?: number
  slotBytes?: number
  maxActive?: number
  maxTasks?: number
  ttlMs?: number
  now?: () => number
}

/** One exclusive SQLite connection owns a spool directory. No shared-worker mode. */
export class UploadStore {
  private db: DatabaseSync
  private now: () => number
  private maxBytes: number
  private slotBytes: number
  private maxActive: number
  private maxTasks: number
  private ttlMs: number
  readonly spool: string
  private active = new Set<string>()

  constructor(directory: string, options: StoreOptions = {}) {
    const root = resolve(directory)
    mkdirSync(root, { recursive: true })
    this.spool = join(root, 'upload-tmp')
    mkdirSync(this.spool, { recursive: true })
    this.now = options.now ?? Date.now
    this.maxBytes = options.maxBytes ?? 256 * MIB
    this.slotBytes = options.slotBytes ?? 22 * MIB
    this.maxActive = options.maxActive ?? 2
    this.maxTasks = options.maxTasks ?? 10_000
    this.ttlMs = options.ttlMs ?? 60 * 60 * 1000
    for (const value of [this.maxBytes, this.slotBytes, this.maxActive, this.maxTasks, this.ttlMs]) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid upload capacity configuration')
    }
    this.db = new DatabaseSync(join(root, 'uploads.sqlite'))
    try {
      // Exclusive locking survives commits and is released by SQLite on process exit.
      this.db.exec('PRAGMA busy_timeout=0; PRAGMA locking_mode=EXCLUSIVE; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; BEGIN EXCLUSIVE; COMMIT;')
      this.db.exec(`CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, digest TEXT NOT NULL,
        state TEXT NOT NULL, bytes INTEGER NOT NULL, updated INTEGER NOT NULL, files TEXT NOT NULL
      )`)
      this.db.exec('CREATE TABLE IF NOT EXISTS submissions (id TEXT PRIMARY KEY, checkpoint TEXT NOT NULL)')
      for (const task of this.all()) {
        const job = this.submission(task.id, task.owner)
        if (job?.status === 'running') this.saveSubmission(task.id, task.owner, { ...job, status: 'unknown', code: 'PROCESS_INTERRUPTED' })
      }
      for (const task of this.all()) {
        if (task.state === 'submitted') { this.release(task.id); continue }
        if (task.state === 'receiving' || task.state === 'reupload-required') this.release(task.id)
        else {
          try {
            const names = JSON.parse(task.files) as string[]
            if (!names.length || names.some(name => !statSync(join(this.directory(task.id), name)).isFile())) this.release(task.id)
          } catch { this.release(task.id) }
        }
      }
      const known = new Set(this.all().map(task => task.id))
      for (const name of readdirSync(this.spool)) {
        if (TASK_ID.test(name) && !known.has(name)) rmSync(this.directory(name), { recursive: true, force: true })
      }
      this.cleanup()
    } catch (error) { this.db.close(); throw error }
  }

  private all(): UploadTask[] { return this.db.prepare('SELECT * FROM tasks').all() as unknown as UploadTask[] }
  directory(id: string): string {
    if (!TASK_ID.test(id)) throw new UploadError(400, 'INVALID_TASK_ID', '任务编号必须是小写 UUID v4')
    return join(this.spool, id)
  }
  get(id: string, owner: string): UploadTask | undefined {
    return this.db.prepare('SELECT * FROM tasks WHERE id=? AND owner=?').get(id, owner) as UploadTask | undefined
  }
  reserve(id: string, owner: string, digest: string): { task: UploadTask; reused: boolean } {
    this.directory(id)
    if (!owner || owner.length > 200 || !/^[a-f0-9]{64}$/.test(digest)) throw new UploadError(400, 'INVALID_IDENTITY', '任务身份或内容摘要无效')
    this.cleanup()
    const old = this.db.prepare('SELECT * FROM tasks WHERE id=?').get(id) as UploadTask | undefined
    if (old && old.owner !== owner) throw new UploadError(404, 'NOT_FOUND', '任务不存在')
    if (old && old.digest !== digest) throw new UploadError(409, 'SNAPSHOT_CHANGED', '同一任务编号不能更换内容')
    if (old?.state === 'ready' || old?.state === 'submitted') return { task: old, reused: true }
    if (this.active.has(id)) throw new UploadError(409, 'SUBMISSION_BUSY', '任务正在投稿，暂不能重传素材')
    if (old?.state === 'receiving') throw new UploadError(409, 'UPLOAD_IN_PROGRESS', '该任务正在接收')
    const tasks = this.all()
    const receiving = tasks.filter(task => task.state === 'receiving')
    if (receiving.length >= this.maxActive || receiving.some(task => task.owner === owner)) throw new UploadError(429, 'UPLOAD_BUSY', '上传并发已满，请稍后重试')
    if (!old && tasks.length >= this.maxTasks) throw new UploadError(503, 'TASK_CAPACITY', '任务记录额度已满')
    if (tasks.reduce((sum, task) => sum + task.bytes, 0) + this.slotBytes > this.maxBytes) throw new UploadError(507, 'SPOOL_FULL', '临时空间额度已满，请稍后重试')
    this.db.prepare(`INSERT INTO tasks VALUES (?, ?, ?, 'receiving', ?, ?, '[]')
      ON CONFLICT(id) DO UPDATE SET state='receiving', bytes=excluded.bytes, updated=excluded.updated, files='[]'`)
      .run(id, owner, digest, this.slotBytes, this.now())
    try { mkdirSync(this.directory(id), { recursive: true }) }
    catch (error) { this.release(id); throw error }
    return { task: this.get(id, owner)!, reused: false }
  }
  ready(id: string, owner: string, files: string[]): UploadTask {
    const task = this.get(id, owner)
    if (task?.state !== 'receiving') throw new Error('Task is not receiving')
    if (!files.includes('strategy.json') || files.some(name => !/^(strategy\.json|[a-f0-9]{64}\.webp)$/.test(name))) throw new Error('Invalid spool manifest')
    const bytes = files.reduce((sum, name) => sum + statSync(join(this.directory(id), name)).size, 0)
    if (bytes > task.bytes) throw new UploadError(413, 'UPLOAD_TOO_LARGE', '素材超出预留空间')
    this.db.prepare("UPDATE tasks SET state='ready',bytes=?,files=?,updated=? WHERE id=?").run(bytes, JSON.stringify(files), this.now(), id)
    return this.get(id, owner)!
  }
  release(id: string): void {
    // Never release accounting before removal succeeds; disk errors fail closed.
    rmSync(this.directory(id), { recursive: true, force: true })
    this.db.prepare("UPDATE tasks SET state=CASE WHEN state='submitted' THEN 'submitted' ELSE 'reupload-required' END, bytes=0, files='[]' WHERE id=?").run(id)
  }
  cleanup(): void {
    for (const task of this.all()) {
      // Live receivers own their deadline; cleanup must not remove their open files.
      if (!this.active.has(task.id) && task.state !== 'receiving' && task.bytes > 0 && (task.state === 'submitted' || task.updated + this.ttlMs <= this.now())) this.release(task.id)
    }
    this.db.prepare("DELETE FROM tasks WHERE state='reupload-required' AND bytes=0 AND updated < ? AND id NOT IN (SELECT id FROM submissions)").run(this.now() - 7 * 24 * 60 * 60 * 1000)
  }
  submission(id: string, owner: string): SubmissionCheckpoint | undefined {
    if (!this.get(id, owner)) return undefined
    const row = this.db.prepare('SELECT checkpoint FROM submissions WHERE id=?').get(id) as { checkpoint: string } | undefined
    return row ? JSON.parse(row.checkpoint) as SubmissionCheckpoint : undefined
  }
  saveSubmission(id: string, owner: string, checkpoint: SubmissionCheckpoint): void {
    if (!this.get(id, owner)) throw new UploadError(404, 'NOT_FOUND', '任务不存在')
    this.db.exec('BEGIN')
    try {
      this.db.prepare('INSERT INTO submissions VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET checkpoint=excluded.checkpoint').run(id, JSON.stringify(checkpoint))
      if (checkpoint.status === 'submitted') this.db.prepare("UPDATE tasks SET state='submitted' WHERE id=?").run(id)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  pin(id: string, owner: string): () => void {
    if (!this.get(id, owner)) throw new UploadError(404, 'NOT_FOUND', '任务不存在')
    if (this.active.size) throw new UploadError(429, 'SUBMISSION_BUSY', '已有投稿正在处理')
    this.active.add(id)
    return () => { this.active.delete(id) }
  }
  close(): void { this.db.close() }
}
