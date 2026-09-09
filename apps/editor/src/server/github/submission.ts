import { randomUUID } from 'node:crypto'

import { structureToJson, type StrategyStructure } from '@xivstrat/content-schema'

import { verifyAppIdentity, verifyInstallationIdentity, verifyInstallationRepositoryAccess, verifyTargetRepository } from './app.ts'
import { loadGitHubConfig, type GitHubConfig } from './env.ts'
import {
  GitHubIntegrationError,
  type GitHubDiagnosticStage,
  type GitHubIntegrationErrorCode,
  type OperationOutcome,
  type SubmissionOperationOutcomes,
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
  outcomes: SubmissionOperationOutcomes
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

const NOT_PERFORMED_OUTCOMES: SubmissionOperationOutcomes = {
  branchCreation: 'not-performed',
  fileWrite: 'not-performed',
  prCreation: 'not-performed',
}

function inputError(code: 'INVALID_STRATEGY_ID' | 'UNSAFE_TARGET_PATH', message: string): GitHubIntegrationError {
  return new GitHubIntegrationError(code, message, undefined, undefined, {
    outcomes: { ...NOT_PERFORMED_OUTCOMES },
    orphanBranchPossible: false,
  })
}

export function validateStrategyId(strategyId: string): string {
  if (!STRATEGY_ID_PATTERN.test(strategyId)) {
    throw inputError('INVALID_STRATEGY_ID', 'Strategy metadata.id must contain only lowercase letters, numbers, and hyphens')
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
    throw inputError('UNSAFE_TARGET_PATH', 'Submission target path is outside content/strategies')
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
  outcomes: SubmissionOperationOutcomes,
): GitHubIntegrationError {
  return new GitHubIntegrationError(code, message, error, safeGitHubApiDiagnostic(stage, error), {
    branch,
    outcomes,
    orphanBranchPossible: outcomes.branchCreation !== 'not-performed' && outcomes.prCreation !== 'confirmed',
  })
}

function failedWriteOutcome(error: unknown): OperationOutcome {
  const status = statusOf(error)
  return status && status >= 400 && status < 500 ? 'not-performed' : 'unknown'
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
  // Contract for future untrusted adapters:
  // unknown payload -> normalizeStructure(raw) -> validateStructure() -> zero errors -> createSubmission(validated).
  // Never cast an HTTP body directly to StrategyStructure and pass it here.
  return async function submit(structure: StrategyStructure): Promise<SubmissionResult> {
    const strategyId = validateStrategyId(structure.metadata.id)
    const filePath = strategyFilePath(strategyId)
    const content = Buffer.from(structureToJson(structure), 'utf8').toString('base64')
    const runtime = await runtimeFactory()
    const { config, octokit, baseHeadSha, submissionId } = runtime
    const branch = `content/${submissionId}`
    const outcomes: SubmissionOperationOutcomes = { ...NOT_PERFORMED_OUTCOMES }

    try {
      await octokit.request('POST /repos/{owner}/{repo}/git/refs', {
        owner: config.owner,
        repo: config.repo,
        ref: `refs/heads/${branch}`,
        sha: baseHeadSha,
      })
      outcomes.branchCreation = 'confirmed'
    } catch (error) {
      throw submissionError(
        'BRANCH_CREATE_ERROR',
        'Unable to confirm creation of the submission branch',
        error,
        'D2.branch-create',
        branch,
        { ...outcomes, branchCreation: failedWriteOutcome(error) },
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
          'FILE_READ_ERROR', 'Unable to inspect the target strategy file', error, 'D2.file-read', branch, { ...outcomes },
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
      outcomes.fileWrite = 'confirmed'
      const writtenCommitSha = write.data.commit.sha
      if (!writtenCommitSha) throw new Error('GitHub file write response did not include a commit SHA')
      commitSha = writtenCommitSha
    } catch (error) {
      const fileWrite = outcomes.fileWrite === 'confirmed' ? 'confirmed' : failedWriteOutcome(error)
      throw submissionError(
        existingSha ? 'FILE_UPDATE_ERROR' : 'FILE_CREATE_ERROR',
        existingSha
          ? `Unable to confirm the strategy file update; file write outcome is ${fileWrite}`
          : `Unable to confirm the strategy file creation; file write outcome is ${fileWrite}`,
        error,
        existingSha ? 'D2.file-update' : 'D2.file-create',
        branch,
        { ...outcomes, fileWrite },
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
      outcomes.prCreation = 'confirmed'
      return {
        submissionId,
        strategyId,
        filePath,
        branch,
        commitSha,
        headSha: commitSha,
        prNumber: pullRequest.data.number,
        prUrl: pullRequest.data.html_url,
        outcomes: { ...outcomes },
      }
    } catch (error) {
      const prCreation = failedWriteOutcome(error)
      throw submissionError(
        'PR_CREATE_ERROR',
        `Unable to confirm creation of the submission pull request; PR creation outcome is ${prCreation}`,
        error,
        'D2.pr-create',
        branch,
        { ...outcomes, prCreation },
      )
    }
  }
}

export const createSubmission = createSubmissionService()
