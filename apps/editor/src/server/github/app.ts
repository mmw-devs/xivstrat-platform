import { App } from '@octokit/app'

import type { GitHubConfig } from './env.ts'
import {
  GitHubIntegrationError,
  type GitHubDiagnosticStage,
  type SafeGitHubApiDiagnostic,
} from './types.ts'

export type InstallationOctokit = Awaited<ReturnType<App['getInstallationOctokit']>>

const silentLog = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

type UnknownRecord = Record<string, unknown>

function record(value: unknown): UnknownRecord | undefined {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : undefined
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function safeEndpoint(url: unknown): string | undefined {
  const raw = stringField(url)
  if (!raw) return undefined
  try {
    return new URL(raw, 'https://api.github.com').pathname
  } catch {
    return undefined
  }
}

export function safeGitHubApiDiagnostic(
  stage: GitHubDiagnosticStage,
  error: unknown,
): SafeGitHubApiDiagnostic {
  const source = record(error)
  const request = record(source?.request)
  const response = record(source?.response)
  const headers = record(response?.headers)
  const status = typeof source?.status === 'number' ? source.status : undefined

  return {
    stage,
    status,
    githubMessage: stringField(source?.message) ?? 'Unknown GitHub API error',
    method: stringField(request?.method),
    endpoint: safeEndpoint(request?.url),
    requestId: stringField(headers?.['x-github-request-id']),
  }
}

function createApp(config: GitHubConfig): App {
  return new App({ appId: config.appId, privateKey: config.privateKey, log: silentLog })
}

export interface AppIdentity {
  appId: number
  slug: string
  name: string
}

export async function verifyAppIdentity(config: GitHubConfig): Promise<{ app: App; identity: AppIdentity }> {
  const app = createApp(config)
  try {
    const response = await app.octokit.request('GET /app')
    if (!response.data) throw new Error('GitHub returned an empty App identity')
    if (response.data.id !== config.appId) throw new Error('Authenticated GitHub App id does not match GITHUB_APP_ID')
    if (response.data.slug !== 'xivstrat-publisher') {
      throw new Error('Authenticated GitHub App slug is not xivstrat-publisher')
    }
    return {
      app,
      identity: {
        appId: response.data.id,
        slug: response.data.slug,
        name: response.data.name ?? response.data.slug,
      },
    }
  } catch (error) {
    throw new GitHubIntegrationError(
      'GITHUB_APP_AUTH_ERROR',
      'Unable to authenticate the configured GitHub App',
      error,
      safeGitHubApiDiagnostic('D1.1', error),
    )
  }
}

export interface InstallationIdentity {
  installationId: number
  accountLogin: string
  repositorySelection: string
}

export async function verifyInstallationIdentity(
  app: App,
  config: GitHubConfig,
): Promise<InstallationIdentity> {
  try {
    const response = await app.octokit.request('GET /app/installations/{installation_id}', {
      installation_id: config.installationId,
    })
    if (response.data.id !== config.installationId) throw new Error('GitHub installation id does not match configuration')
    if (!response.data.account) throw new Error('GitHub installation has no account identity')
    const login = 'login' in response.data.account ? response.data.account.login : response.data.account.name
    if (login !== config.owner) throw new Error('GitHub installation account does not match configured owner')
    if (response.data.repository_selection !== 'selected') {
      throw new Error('GitHub installation repository selection is not selected')
    }
    return {
      installationId: response.data.id,
      accountLogin: login ?? '',
      repositorySelection: response.data.repository_selection,
    }
  } catch (error) {
    throw new GitHubIntegrationError(
      'GITHUB_INSTALLATION_ERROR',
      'Unable to read the configured GitHub App installation',
      error,
      safeGitHubApiDiagnostic('D1.2', error),
    )
  }
}

export interface InstallationRepositoryAccess {
  octokit: InstallationOctokit
  repositoryFullName: string
}

export async function verifyInstallationRepositoryAccess(
  app: App,
  config: GitHubConfig,
): Promise<InstallationRepositoryAccess> {
  let octokit: InstallationOctokit
  try {
    octokit = await app.getInstallationOctokit(config.installationId)
    const response = await octokit.request('GET /installation/repositories', { per_page: 100 })
    const repositoryFullName = `${config.owner}/${config.repo}`
    if (!response.data.repositories.some((repository) => repository.full_name === repositoryFullName)) {
      throw new GitHubIntegrationError(
        'GITHUB_REPOSITORY_ACCESS_ERROR',
        `Installation repository list does not contain ${repositoryFullName}`,
      )
    }
    return { octokit, repositoryFullName }
  } catch (error) {
    if (error instanceof GitHubIntegrationError) throw error
    throw new GitHubIntegrationError(
      'GITHUB_INSTALLATION_AUTH_ERROR',
      'Unable to authenticate as the GitHub App installation or list its repositories',
      error,
      safeGitHubApiDiagnostic('D1.3', error),
    )
  }
}

export interface TargetRepositoryVerification {
  repoFullName: string
  defaultBranch: string
  baseBranch: string
  headSha: string
  headSource: 'git-ref' | 'branch'
  gitRefAttempts: number
}

export interface GitRefAttemptFailure {
  attempt: number
  maxAttempts: number
  diagnostic: SafeGitHubApiDiagnostic
}

const GIT_REF_MAX_ATTEMPTS = 3

function isTransientGitHubError(error: unknown): boolean {
  const diagnostic = safeGitHubApiDiagnostic('D1.4', error)
  if (diagnostic.status && [500, 502, 503, 504].includes(diagnostic.status)) return true
  return /timeout|timed out|connection reset|socket|connection closed|other side closed|econnreset|etimedout/i.test(
    diagnostic.githubMessage,
  )
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export async function verifyTargetRepository(
  octokit: InstallationOctokit,
  config: GitHubConfig,
  onGitRefAttemptFailure?: (failure: GitRefAttemptFailure) => void,
): Promise<TargetRepositoryVerification> {
  let repository
  try {
    repository = await octokit.request('GET /repos/{owner}/{repo}', {
      owner: config.owner,
      repo: config.repo,
    })
  } catch (error) {
    throw new GitHubIntegrationError(
      'GITHUB_REPOSITORY_ACCESS_ERROR',
      'Unable to read the configured GitHub repository',
      error,
      safeGitHubApiDiagnostic('D1.4', error),
    )
  }

  for (let attempt = 1; attempt <= GIT_REF_MAX_ATTEMPTS; attempt += 1) {
    try {
      const head = await octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
        owner: config.owner,
        repo: config.repo,
        ref: `heads/${config.baseBranch}`,
      })
      return {
        repoFullName: repository.data.full_name,
        defaultBranch: repository.data.default_branch,
        baseBranch: config.baseBranch,
        headSha: head.data.object.sha,
        headSource: 'git-ref',
        gitRefAttempts: attempt,
      }
    } catch (error) {
      const diagnostic = safeGitHubApiDiagnostic('D1.4', error)
      onGitRefAttemptFailure?.({ attempt, maxAttempts: GIT_REF_MAX_ATTEMPTS, diagnostic })
      if (!isTransientGitHubError(error)) {
        throw new GitHubIntegrationError(
          'GITHUB_REPOSITORY_ACCESS_ERROR',
          'Unable to read the configured base branch; the error is not retryable',
          error,
          diagnostic,
        )
      }
      if (attempt === GIT_REF_MAX_ATTEMPTS) break
      await delay(attempt * 1_000)
    }
  }

  try {
    const branch = await octokit.request('GET /repos/{owner}/{repo}/branches/{branch}', {
      owner: config.owner,
      repo: config.repo,
      branch: config.baseBranch,
    })
    return {
      repoFullName: repository.data.full_name,
      defaultBranch: repository.data.default_branch,
      baseBranch: config.baseBranch,
      headSha: branch.data.commit.sha,
      headSource: 'branch',
      gitRefAttempts: GIT_REF_MAX_ATTEMPTS,
    }
  } catch (error) {
    throw new GitHubIntegrationError(
      'GITHUB_REPOSITORY_ACCESS_ERROR',
      'Git Ref retries failed and the branch fallback could not read the configured base branch',
      error,
      safeGitHubApiDiagnostic('D1.4', error),
    )
  }
}
