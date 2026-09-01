import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { GitHubIntegrationError } from './types.ts'

const DEFAULT_OWNER = 'mmw-devs'
const DEFAULT_REPO = 'xivstrat-platform'
const DEFAULT_BASE_BRANCH = 'main'

type GitHubEnvironment = Record<string, string | undefined>
type ReadPrivateKey = (path: string) => string

export interface GitHubConfig {
  appId: number
  installationId: number
  privateKey: string
  owner: string
  repo: string
  baseBranch: string
}

function configError(message: string, cause?: unknown): GitHubIntegrationError {
  return new GitHubIntegrationError('GITHUB_CONFIG_ERROR', message, cause)
}

function positiveInteger(value: string | undefined, variableName: string): number {
  const normalized = value?.trim() ?? ''
  if (!/^\d+$/.test(normalized)) throw configError(`${variableName} must be a positive integer`)
  const parsed = Number(normalized)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw configError(`${variableName} must be a positive integer`)
  return parsed
}

function normalizePrivateKey(value: string): string {
  return value.replace(/\\n/g, '\n').trim()
}

function validatePrivateKey(value: string): string {
  const privateKey = normalizePrivateKey(value)
  if (!privateKey) throw configError('GitHub App private key is empty')
  if (!/-----BEGIN (?:RSA )?PRIVATE KEY-----/.test(privateKey)) {
    throw configError('GitHub App private key is not a PEM private key')
  }
  return privateKey
}

function privateKeyFromEnvironment(environment: GitHubEnvironment, readPrivateKey: ReadPrivateKey): string {
  const privateKeyPath = environment.GITHUB_APP_PRIVATE_KEY_PATH?.trim()
  if (privateKeyPath) {
    try {
      return validatePrivateKey(readPrivateKey(resolve(privateKeyPath)))
    } catch (error) {
      if (error instanceof GitHubIntegrationError) throw error
      throw configError('Unable to read GITHUB_APP_PRIVATE_KEY_PATH', error)
    }
  }

  const privateKey = environment.GITHUB_APP_PRIVATE_KEY
  if (privateKey) return validatePrivateKey(privateKey)
  throw configError('Set GITHUB_APP_PRIVATE_KEY_PATH or GITHUB_APP_PRIVATE_KEY')
}

export function loadGitHubConfig(
  environment: GitHubEnvironment = process.env,
  readPrivateKey: ReadPrivateKey = (path) => readFileSync(path, 'utf8'),
): GitHubConfig {
  return {
    appId: positiveInteger(environment.GITHUB_APP_ID, 'GITHUB_APP_ID'),
    installationId: positiveInteger(environment.GITHUB_APP_INSTALLATION_ID, 'GITHUB_APP_INSTALLATION_ID'),
    privateKey: privateKeyFromEnvironment(environment, readPrivateKey),
    owner: environment.GITHUB_OWNER?.trim() || DEFAULT_OWNER,
    repo: environment.GITHUB_REPO?.trim() || DEFAULT_REPO,
    baseBranch: environment.GITHUB_BASE_BRANCH?.trim() || DEFAULT_BASE_BRANCH,
  }
}
