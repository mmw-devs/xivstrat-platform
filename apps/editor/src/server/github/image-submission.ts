import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { normalizeStructure, stampOperation, structureToJson, validateStructure } from '@xivstrat/content-schema'
import { imageReferences } from '../../lib/editor/image-references.ts'
import { UploadStore, UploadError } from '../uploads/store.ts'
import type { SubmissionCheckpoint } from '../uploads/submission-state.ts'
import { productionRuntime, strategyFilePath, type SubmissionRuntimeFactory } from './submission.ts'

export function gitBlobSha(bytes: Buffer): string {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
}
class WorkflowError extends Error {
  readonly code: string
  constructor(code: string) { super(code); this.code = code }
}
function status(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : undefined
}

/** One explicitly started job; GET never causes network writes or recovery. */
export function createImageSubmissionWorker(store: UploadStore, runtimeFactory: SubmissionRuntimeFactory = productionRuntime) {
  const running = new Map<string, Promise<void>>()
  async function execute(id: string, owner: string): Promise<void> {
    let job = store.submission(id, owner) ?? {
      status: 'running', owner: '', repo: '', baseBranch: '', baseSha: '', baseTree: '',
      branch: `content/${id}`, publishTime: new Date().toISOString(), entries: [],
    } satisfies SubmissionCheckpoint
    const save = () => store.saveSubmission(id, owner, job)
    job.status = 'running'; delete job.code; save()
    try {
      const runtime = await runtimeFactory()
      const { config, octokit } = runtime
      const target = { owner: config.owner, repo: config.repo, request: { timeout: 30_000, retries: 0 } }
      if (job.baseSha && (job.owner !== config.owner || job.repo !== config.repo || job.baseBranch !== config.baseBranch)) throw new WorkflowError('TARGET_CHANGED')
      const task = store.get(id, owner)!
      const readSnapshot = async () => {
        if (store.get(id, owner)?.state !== 'ready') throw new WorkflowError('REUPLOAD_REQUIRED')
        const raw = await readFile(join(store.directory(id), 'strategy.json'), 'utf8')
        if (createHash('sha256').update(raw).digest('hex') !== task.digest) throw new WorkflowError('SNAPSHOT_CHANGED')
        const structure = normalizeStructure(JSON.parse(raw))
        if (validateStructure(structure).length) throw new WorkflowError('INVALID_SNAPSHOT')
        const refs = imageReferences(structure).filter(path => !/^https?:\/\//i.test(path))
        const names = JSON.parse(task.files) as string[]
        if (refs.some(path => !/^assets\/images\/[a-f0-9]{64}\.webp$/.test(path)) ||
          names.length !== refs.length + 1 || !names.includes('strategy.json') || refs.some(path => !names.includes(path.slice(14)))) throw new WorkflowError('INVALID_MANIFEST')
        const entries = [{ name: 'strategy.json', path: strategyFilePath(structure.metadata.name),
          data: Buffer.from(structureToJson(stampOperation(structure, new Date(job.publishTime)))) }]
        for (const ref of refs) {
          const data = await readFile(join(store.directory(id), ref.slice(14)))
          if (createHash('sha256').update(data).digest('hex') !== ref.slice(14, -5)) throw new WorkflowError('IMAGE_CHANGED')
          entries.push({ name: ref.slice(14), path: `content/${ref}`, data })
        }
        return entries
      }
      let snapshot: Awaited<ReturnType<typeof readSnapshot>> | undefined
      if (!job.baseSha) {
        snapshot = await readSnapshot()
        const base = await octokit.request('GET /repos/{owner}/{repo}/git/commits/{commit_sha}', { ...target, commit_sha: runtime.baseHeadSha })
        job = { ...job, owner: config.owner, repo: config.repo, baseBranch: config.baseBranch, baseSha: runtime.baseHeadSha, baseTree: base.data.tree.sha,
          entries: snapshot.map(entry => ({ path: entry.path, name: entry.name, sha: gitBlobSha(entry.data), uploaded: false })) }
        save()
      }
      if (job.entries.some(entry => !entry.uploaded)) {
        snapshot ??= await readSnapshot()
        // Recheck the complete manifest before any object upload on recovery.
        if (snapshot.length !== job.entries.length || snapshot.some(entry => !job.entries.some(saved => saved.path === entry.path && saved.sha === gitBlobSha(entry.data)))) throw new WorkflowError('SNAPSHOT_CHANGED')
        for (const entry of job.entries) {
          if (entry.uploaded) continue
          const data = snapshot.find(file => file.path === entry.path)!.data
          const blob = await octokit.request('POST /repos/{owner}/{repo}/git/blobs', {
            ...target, content: data.toString('base64'), encoding: 'base64', request: { timeout: 30_000, retries: 0 },
          })
          if (blob.data.sha !== entry.sha) throw new WorkflowError('BLOB_MISMATCH')
          entry.uploaded = true; save()
        }
      }
      if (!job.treeSha) {
        const tree = await octokit.request('POST /repos/{owner}/{repo}/git/trees', { ...target, base_tree: job.baseTree,
          tree: job.entries.map(entry => ({ path: entry.path, mode: '100644' as const, type: 'blob' as const, sha: entry.sha })),
          request: { timeout: 30_000, retries: 0 },
        })
        job.treeSha = tree.data.sha; save()
      }
      if (!job.commitSha) {
        const identity = { name: 'XivStrat Publisher', email: 'xivstrat-publisher@users.noreply.github.com', date: job.publishTime }
        const commit = await octokit.request('POST /repos/{owner}/{repo}/git/commits', { ...target, message: `content: image submission ${id}`,
          tree: job.treeSha, parents: [job.baseSha], author: identity, committer: identity, request: { timeout: 30_000, retries: 0 },
        })
        job.commitSha = commit.data.sha; save()
      }
      // Confirm immutable commit and every file before exposing a branch or deleting local bytes.
      const commit = await octokit.request('GET /repos/{owner}/{repo}/git/commits/{commit_sha}', { ...target, commit_sha: job.commitSha })
      if (commit.data.tree.sha !== job.treeSha || commit.data.parents.length !== 1 || commit.data.parents[0].sha !== job.baseSha) throw new WorkflowError('COMMIT_MISMATCH')
      for (const entry of job.entries) {
        const content = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', { ...target, path: entry.path, ref: job.commitSha })
        if (Array.isArray(content.data) || !('sha' in content.data) || content.data.sha !== entry.sha || content.data.type !== 'file') throw new WorkflowError('REMOTE_CONTENT_MISMATCH')
      }
      let refSha: string | undefined
      try {
        const ref = await octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', { ...target, ref: `heads/${job.branch}` })
        refSha = ref.data.object.sha
      } catch (error) { if (status(error) !== 404) throw error }
      if (refSha && refSha !== job.commitSha) throw new WorkflowError('BRANCH_CHANGED')
      // A merged/closed PR may have had its branch deleted. Once PR creation was
      // attempted, only lookup is allowed; never recreate that branch.
      if (!refSha && !(job.branchAttempted && job.prAttempted)) {
        if (job.branchAttempted) throw new WorkflowError('BRANCH_OUTCOME_UNKNOWN')
        job.branchAttempted = true; save()
        const ref = await octokit.request('POST /repos/{owner}/{repo}/git/refs', { ...target, ref: `refs/heads/${job.branch}`,
          sha: job.commitSha, request: { timeout: 30_000, retries: 0 },
        })
        if (ref.data.object.sha !== job.commitSha) throw new WorkflowError('BRANCH_CHANGED')
      }
      let found: { number: number; html_url: string } | undefined
      for (let page = 1; ; page++) {
        if (page > 10) throw new WorkflowError('PR_LOOKUP_LIMIT')
        const prs = await octokit.request('GET /repos/{owner}/{repo}/pulls', { ...target, head: `${job.owner}:${job.branch}`, state: 'all', per_page: 100, page })
        for (const pr of prs.data) {
          if (pr.head.ref !== job.branch) continue
          if (pr.head.sha !== job.commitSha || pr.base.ref !== job.baseBranch || pr.head.repo?.full_name.toLowerCase() !== `${job.owner}/${job.repo}`.toLowerCase() || !pr.body?.includes(`Submission ID: ${id}`)) throw new WorkflowError('PR_CHANGED')
          if (found) throw new WorkflowError('MULTIPLE_PRS')
          found = pr
        }
        if (prs.data.length < 100) break
      }
      if (!found) {
        if (job.prAttempted) throw new WorkflowError('PR_OUTCOME_UNKNOWN')
        job.prAttempted = true; save()
        const pr = await octokit.request('POST /repos/{owner}/{repo}/pulls', { ...target, base: job.baseBranch, head: job.branch,
          title: `content: image submission ${id}`, body: `Submission ID: ${id}\nSnapshot: ${task.digest}\nCommit: ${job.commitSha}`,
          request: { timeout: 30_000, retries: 0 },
        })
        if (pr.data.head.sha !== job.commitSha || pr.data.base.ref !== job.baseBranch || pr.data.head.ref !== job.branch) throw new WorkflowError('PR_CHANGED')
        found = pr.data
      }
      job.result = { prNumber: found.number, prUrl: found.html_url, commitSha: job.commitSha }
      job.status = 'submitted'; save()
      try { store.release(id) } catch { job.code = 'LOCAL_CLEANUP_PENDING'; save() }
    } catch (error) {
      job.code = error instanceof WorkflowError ? error.code : 'GITHUB_REQUEST_FAILED'
      job.status = error instanceof WorkflowError && !['REUPLOAD_REQUIRED', 'BRANCH_OUTCOME_UNKNOWN', 'PR_OUTCOME_UNKNOWN'].includes(error.code)
        ? 'needs-attention' : job.branchAttempted || job.prAttempted ? 'unknown' : 'retryable'
      save()
    }
  }
  return {
    start(id: string, owner: string): void {
      const task = store.get(id, owner)
      if (!task) throw new UploadError(404, 'NOT_FOUND', '任务不存在')
      if (running.has(id) || store.submission(id, owner)?.status === 'submitted') return
      if (task.state === 'receiving' || (!store.submission(id, owner) && task.state !== 'ready')) throw new UploadError(409, 'UPLOAD_NOT_READY', '请先完整上传素材')
      const unpin = store.pin(id, owner)
      const work = execute(id, owner).finally(() => { unpin(); running.delete(id) })
      // A DB failure must not become an unhandled rejection. Existing checkpoints remain recoverable.
      running.set(id, work.catch(() => {}))
    },
    async idle(): Promise<void> { await Promise.all(running.values()) },
  }
}
