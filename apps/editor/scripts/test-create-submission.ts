// Manual write E2E. This creates a content/* branch, one test JSON commit, and an unmerged PR.
import { normalizeStructure, validateStructure } from '@xivstrat/content-schema'

import { createSubmission } from '../src/server/github/submission.ts'
import { GitHubIntegrationError } from '../src/server/github/types.ts'

const WRITE_CONFIRMATION = 'submission-e2e-test'
if (process.env.CONFIRM_GITHUB_WRITE_E2E !== WRITE_CONFIRMATION) {
  console.error(`Refusing GitHub write E2E. Set CONFIRM_GITHUB_WRITE_E2E=${WRITE_CONFIRMATION} explicitly.`)
  process.exit(1)
}

const structure = normalizeStructure({
  metadata: {
    id: 'submission-e2e-test',
    name: 'GitHub Submission E2E Test',
    short_name: 'E2E Test',
    type: 'other',
    title: 'GitHub Submission E2E Test',
    description: 'Test-only content created by the Phase D2 GitHub App E2E.',
    banner: 'banners/test/submission-e2e-test.webp',
    publish_time: '2026-08-29',
    status: 'draft',
    video: '',
    team: 'XivStrat Test',
  },
  references: [],
  macros: [],
  phases: [{ id: 'p1', name: 'Test Phase', mechanics: [] }],
})

const validationErrors = validateStructure(structure)
if (validationErrors.length > 0) {
  console.error('E2E fixture failed canonical validation:')
  validationErrors.forEach((message) => console.error(`- ${message}`))
  process.exitCode = 1
} else {
  try {
    const result = await createSubmission(structure)
    console.log(`Submission ID: ${result.submissionId}`)
    console.log(`Branch: ${result.branch}`)
    console.log(`File path: ${result.filePath}`)
    console.log(`Commit SHA: ${result.commitSha}`)
    console.log(`Head SHA: ${result.headSha}`)
    console.log(`PR number: ${result.prNumber}`)
    console.log(`PR URL: ${result.prUrl}`)
  } catch (error) {
    if (error instanceof GitHubIntegrationError) {
      console.error(`[${error.code}] ${error.message}`)
      if (error.submissionContext?.branch) console.error(`Branch: ${error.submissionContext.branch}`)
      if (error.submissionContext) {
        console.error(`Branch created: ${error.submissionContext.branchCreated}`)
        console.error(`File written: ${error.submissionContext.fileWritten}`)
        console.error(`Orphan branch possible: ${error.submissionContext.orphanBranchPossible}`)
      }
      if (error.diagnostic) {
        if (error.diagnostic.status !== undefined) console.error(`HTTP status: ${error.diagnostic.status}`)
        console.error(`GitHub message: ${error.diagnostic.githubMessage}`)
        if (error.diagnostic.method) console.error(`HTTP method: ${error.diagnostic.method}`)
        if (error.diagnostic.endpoint) console.error(`API endpoint: ${error.diagnostic.endpoint}`)
        if (error.diagnostic.requestId) console.error(`x-github-request-id: ${error.diagnostic.requestId}`)
      }
    } else {
      console.error('[GITHUB_SUBMISSION_ERROR] Unexpected submission failure')
    }
    process.exitCode = 1
  }
}
