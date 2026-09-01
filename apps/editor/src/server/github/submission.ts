import { randomUUID } from 'node:crypto'

import { structureToJson, type StrategyStructure } from '@xivstrat/content-schema'

import { verifyAppIdentity, verifyInstallationIdentity, verifyInstallationRepositoryAccess, verifyTargetRepository } from './app.ts'
import { loadGitHubConfig, type GitHubConfig } from './env.ts'
import {
  GitHubIntegrationError,
  type GitHubDiagnosticStage,
  type GitHubIntegrationErrorCode,
} from './types.ts'
import { safeGitHubApiDiagnostic, type InstallationOctokit } from './app.ts'

const STRATEGY_ID_PATTERN = /^[a-z0-9-]+$/
const TARGET_DIRECTORY = 'content/strategies/'

export interface SubmissionResult {
  submissionId: string
  strategyId: string
  filePath: string
  branch: string
  commitSha: string
  headSha: string
  prNumber: number
  prUrl: string
}

interface SubmissionGitHubClient {
  request: InstallationOctokit['request']
}

interface SubmissionRuntime {
  config: GitHubConfig
  octokit: SubmissionGitHubClient
  baseHeadSha: string
  submissionId: string
}

export type SubmissionRuntimeFactory = () => Promise<SubmissionRuntime>

export function validateStrategyId(strategyId: string): string {
  if (!STRATEGY_ID_PATTERN.test(strategyId)) {
    throw new GitHubIntegrationError(
      'INVALID_STRATEGY_ID',
      'Strategy metadata.id must contain only lowercase letters, numbers, and hyphens',
    )
  }
  return strategyId
}

export function assertSafeTargetPath(filePath: string): string {
  if (
    !filePath.startsWith(TARGET_DIRECTORY) ||
    filePath.includes('..') ||
    filePath.includes('\\') ||
    filePath.slice(TARGET_DIRECTORY.length).includes('/')
  ) {
    throw new GitHubIntegrationError('UNSAFE_TARGET_PATH', 'Submission target path is outside content/strategies')
  }
  return filePath
}

export function strategyFilePath(strategyId: string): string {
  return assertSafeTargetPath(`${TARGET_DIRECTORY}${validateStrategyId(strategyId)}.json`)
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) return undefined
  return typeof error.status === 'number' ? error.status : undefined
}

function submissionError(
  code: GitHubIntegrationErrorCode,
  message: string,
  error: unknown,
  stage: GitHubDiagnosticStage,
  branch: string,
  branchCreated: boolean,
  fileWritten: boolean,
): GitHubIntegrationError {
  return new GitHubIntegrationError(code, message, error, safeGitHubApiDiagnostic(stage, error), {
    branch,
    branchCreated,
    fileWritten,
    orphanBranchPossible: branchCreated,
  })
}

async function productionRuntime(): Promise<SubmissionRuntime> {
  const config = loadGitHubConfig()
  const { app } = await verifyAppIdentity(config)
  await verifyInstallationIdentity(app, config)
  const access = await verifyInstallationRepositoryAccess(app, config)
  const repository = await verifyTargetRepository(access.octokit, config)
  return { config, octokit: access.octokit, baseHeadSha: repository.headSha, submissionId: randomUUID() }
}

export function createSubmissionService(runtimeFactory: SubmissionRuntimeFactory = productionRuntime) {
  return async function submit(structure: StrategyStructure): Promise<SubmissionResult> {
    const strategyId = validateStrategyId(structure.metadata.id)
    const filePath = strategyFilePath(strategyId)
    const content = Buffer.from(structureToJson(structure), 'utf8').toString('base64')
    const runtime = await runtimeFactory()
    const { config, octokit, baseHeadSha, submissionId } = runtime
    const branch = `content/${submissionId}`
    let fileWritten = false

    try {
      await octokit.request('POST /repos/{owner}/{repo}/git/refs', {
        owner: config.owner,
        repo: config.repo,
        ref: `refs/heads/${branch}`,
        sha: baseHeadSha,
      })
    } catch (error) {
      throw submissionError(
        'BRANCH_CREATE_ERROR', 'Unable to create the submission branch', error, 'D2.branch-create', branch, false, false,
      )
    }

    let existingSha: string | undefined
    try {
      const existing = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
        owner: config.owner,
        repo: config.repo,
        path: filePath,
        ref: branch,
      })
      if (Array.isArray(existing.data) || !('sha' in existing.data)) {
        throw new Error('Target path is not a GitHub file')
      }
      existingSha = existing.data.sha
    } catch (error) {
      if (statusOf(error) !== 404) {
        throw submissionError(
          'FILE_READ_ERROR', 'Unable to inspect the target strategy file', error, 'D2.file-read', branch, true, false,
        )
      }
    }

    let commitSha: string
    try {
      const write = await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
        owner: config.owner,
        repo: config.repo,
        path: filePath,
        branch,
        message: `content: submit ${strategyId}`,
        content,
        ...(existingSha ? { sha: existingSha } : {}),
      })
      const writtenCommitSha = write.data.commit.sha
      if (!writtenCommitSha) throw new Error('GitHub file write response did not include a commit SHA')
      commitSha = writtenCommitSha
      fileWritten = true
    } catch (error) {
      throw submissionError(
        existingSha ? 'FILE_UPDATE_ERROR' : 'FILE_CREATE_ERROR',
        existingSha ? 'Unable to update the strategy file' : 'Unable to create the strategy file',
        error,
        existingSha ? 'D2.file-update' : 'D2.file-create',
        branch,
        true,
        false,
      )
    }

    try {
      const pullRequest = await octokit.request('POST /repos/{owner}/{repo}/pulls', {
        owner: config.owner,
        repo: config.repo,
        title: `content: submit ${strategyId}`,
        body: `Strategy ID: ${strategyId}\nFile: ${filePath}\nSubmission ID: ${submissionId}`,
        head: branch,
        base: config.baseBranch,
      })
      return {
        submissionId,
        strategyId,
        filePath,
        branch,
        commitSha,
        headSha: commitSha,
        prNumber: pullRequest.data.number,
        prUrl: pullRequest.data.html_url,
      }
    } catch (error) {
      throw submissionError(
        'PR_CREATE_ERROR', 'Unable to create the submission pull request', error, 'D2.pr-create', branch, true, fileWritten,
      )
    }
  }
}

export const createSubmission = createSubmissionService()
