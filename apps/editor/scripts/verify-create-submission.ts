// Manual, read-only verification for a previously created submission PR.
import { verifyAppIdentity, verifyInstallationIdentity, verifyInstallationRepositoryAccess } from '../src/server/github/app.ts'
import { loadGitHubConfig } from '../src/server/github/env.ts'

const prNumber = Number(process.env.E2E_PR_NUMBER)
const branch = process.env.E2E_BRANCH?.trim() ?? ''
const expectedCommitSha = process.env.E2E_COMMIT_SHA?.trim() ?? ''

if (!Number.isSafeInteger(prNumber) || prNumber <= 0 || !branch.startsWith('content/') || !expectedCommitSha) {
  throw new Error('Set safe E2E_PR_NUMBER, E2E_BRANCH, and E2E_COMMIT_SHA verification inputs')
}

const config = loadGitHubConfig()
const { app } = await verifyAppIdentity(config)
await verifyInstallationIdentity(app, config)
const { octokit } = await verifyInstallationRepositoryAccess(app, config)

const [pullRequest, files, branchRef, mainRef] = await Promise.all([
  octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
    owner: config.owner,
    repo: config.repo,
    pull_number: prNumber,
  }),
  octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/files', {
    owner: config.owner,
    repo: config.repo,
    pull_number: prNumber,
  }),
  octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
    owner: config.owner,
    repo: config.repo,
    ref: `heads/${branch}`,
  }),
  octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
    owner: config.owner,
    repo: config.repo,
    ref: `heads/${config.baseBranch}`,
  }),
])

console.log(`PR state: ${pullRequest.data.state}`)
console.log(`PR base: ${pullRequest.data.base.ref}`)
console.log(`PR head: ${pullRequest.data.head.ref}`)
console.log(`PR author: ${pullRequest.data.user?.login ?? 'unknown'}`)
console.log(`Changed files: ${files.data.length}`)
files.data.forEach((file) => console.log(`Changed file: ${file.filename} (${file.status})`))
console.log(`Branch HEAD SHA: ${branchRef.data.object.sha}`)
console.log(`Expected commit SHA matches: ${branchRef.data.object.sha === expectedCommitSha}`)
console.log(`Main HEAD SHA: ${mainRef.data.object.sha}`)
console.log(`Main differs from submission commit: ${mainRef.data.object.sha !== expectedCommitSha}`)
