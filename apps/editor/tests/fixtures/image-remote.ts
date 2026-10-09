import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { gitBlobSha } from '../../src/server/github/image-submission.ts'

const config = { appId: 1, installationId: 1, privateKey: 'unused', owner: 'test', repo: 'guides', baseBranch: 'main' }
type Entry = { path: string; sha: string }
type FakePr = { number: number; html_url: string; body: string; head: { ref: string; sha: string; repo: { full_name: string } }; base: { ref: string }; state?: string }
export function remote() {
  const calls: Array<{ route: string; args: Record<string, unknown> }> = []
  const blobs = new Map<string, Buffer>(), trees = new Map<string, Entry[]>(), commits = new Map<string, { tree: { sha: string }; parents: { sha: string }[] }>()
  const refs = new Map<string, string>(), prs: FakePr[] = []
  commits.set('base', { tree: { sha: 'base-tree' }, parents: [] })
  commits.set('new-base', { tree: { sha: 'new-base-tree' }, parents: [] })
  let failure: { suffix: string; after: boolean } | undefined
  let hidePr = false, hideRef = false, corruptContent = false
  const request = async (route: string, args: Record<string, unknown>) => {
    calls.push({ route, args })
    const fail = failure && route.endsWith(failure.suffix) && route.startsWith('POST') ? failure : undefined
    if (fail) failure = undefined
    if (fail && !fail.after) throw new Error('network disconnected before dispatch')
    let data: unknown
    const key = () => createHash('sha1').update(JSON.stringify(args)).digest('hex')
    if (route === 'POST /repos/{owner}/{repo}/git/blobs') {
      const bytes = Buffer.from(String(args.content), 'base64'), sha = gitBlobSha(bytes)
      blobs.set(sha, bytes); data = { sha }
    } else if (route === 'POST /repos/{owner}/{repo}/git/trees') {
      assert.equal(args.base_tree, 'base-tree')
      const sha = key(); trees.set(sha, args.tree as Entry[]); data = { sha }
    } else if (route === 'POST /repos/{owner}/{repo}/git/commits') {
      const sha = key(), commit = { tree: { sha: String(args.tree) }, parents: (args.parents as string[]).map(sha => ({ sha })) }
      commits.set(sha, commit); data = { sha, ...commit }
    } else if (route === 'GET /repos/{owner}/{repo}/git/commits/{commit_sha}') data = commits.get(String(args.commit_sha))
    else if (route === 'GET /repos/{owner}/{repo}/contents/{path}') {
      const commit = commits.get(String(args.ref))!
      const entry = trees.get(commit.tree.sha)!.find(entry => entry.path === args.path)!
      data = { type: 'file', sha: corruptContent ? 'wrong' : entry.sha }
    } else if (route === 'GET /repos/{owner}/{repo}/git/ref/{ref}') {
      const sha = hideRef ? undefined : refs.get(String(args.ref).replace(/^heads\//, ''))
      if (!sha) throw Object.assign(new Error('not found'), { status: 404 })
      data = { object: { sha } }
    } else if (route === 'POST /repos/{owner}/{repo}/git/refs') {
      const branch = String(args.ref).replace(/^refs\/heads\//, '')
      assert.ok(!refs.has(branch)); refs.set(branch, String(args.sha)); data = { object: { sha: args.sha } }
    } else if (route === 'GET /repos/{owner}/{repo}/pulls') {
      assert.equal(args.state, 'all')
      data = hidePr ? [] : prs
    } else if (route === 'POST /repos/{owner}/{repo}/pulls') {
      const pr = { number: prs.length + 1, html_url: 'https://github.com/test/guides/pull/1', body: String(args.body),
        head: { ref: String(args.head), sha: refs.get(String(args.head))!, repo: { full_name: 'test/guides' } }, base: { ref: String(args.base) } }
      prs.push(pr); data = pr
    } else throw new Error(`Unexpected route ${route}`)
    if (fail) throw new Error('response lost after remote write')
    return { data }
  }
  return { calls, blobs, trees, commits, refs, prs, request,
    fail(suffix: string, after = true) { failure = { suffix, after } },
    hidePr(value: boolean) { hidePr = value }, hideRef(value: boolean) { hideRef = value },
    corruptContent() { corruptContent = true },
    runtime(baseHeadSha = 'base') { return async () => ({ config, octokit: { request: request as never }, baseHeadSha, submissionId: 'ignored' }) },
  }
}
