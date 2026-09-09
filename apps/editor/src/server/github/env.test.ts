import assert from 'node:assert/strict'
import test from 'node:test'

import { loadGitHubConfig } from './env.ts'
import { GitHubIntegrationError } from './types.ts'

const PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\ntest-key\n-----END PRIVATE KEY-----'

test('loads identifiers, defaults, and private key from a path', () => {
  let readPath = ''
  const config = loadGitHubConfig(
    {
      GITHUB_APP_ID: '123',
      GITHUB_APP_INSTALLATION_ID: '456',
      GITHUB_APP_PRIVATE_KEY_PATH: './private-key.pem',
      GITHUB_APP_PRIVATE_KEY: 'must-not-be-used',
    },
    (path) => {
      readPath = path
      return PRIVATE_KEY
    },
  )

  assert.equal(config.appId, 123)
  assert.equal(config.installationId, 456)
  assert.equal(config.privateKey, PRIVATE_KEY)
  assert.match(readPath, /private-key\.pem$/)
  assert.equal(config.owner, 'mmw-devs')
  assert.equal(config.repo, 'xivstrat-platform')
  assert.equal(config.baseBranch, 'main')
})

test('falls back to an environment private key and expands escaped newlines', () => {
  const config = loadGitHubConfig({
    GITHUB_APP_ID: '123',
    GITHUB_APP_INSTALLATION_ID: '456',
    GITHUB_APP_PRIVATE_KEY: PRIVATE_KEY.replace(/\n/g, '\\n'),
  })

  assert.equal(config.privateKey, PRIVATE_KEY)
})

test('rejects missing and invalid configuration without exposing secrets', () => {
  assert.throws(
    () => loadGitHubConfig({}),
    (error) => error instanceof GitHubIntegrationError && error.code === 'GITHUB_CONFIG_ERROR',
  )
  assert.throws(
    () =>
      loadGitHubConfig({
        GITHUB_APP_ID: 'not-a-number',
        GITHUB_APP_INSTALLATION_ID: '456',
        GITHUB_APP_PRIVATE_KEY: PRIVATE_KEY,
      }),
    (error) => error instanceof GitHubIntegrationError && error.code === 'GITHUB_CONFIG_ERROR',
  )
})

test('does not fall back to the environment key when the configured path cannot be read', () => {
  assert.throws(
    () =>
      loadGitHubConfig(
        {
          GITHUB_APP_ID: '123',
          GITHUB_APP_INSTALLATION_ID: '456',
          GITHUB_APP_PRIVATE_KEY_PATH: './missing.pem',
          GITHUB_APP_PRIVATE_KEY: PRIVATE_KEY,
        },
        () => {
          throw new Error('missing')
        },
      ),
    (error) => error instanceof GitHubIntegrationError && error.code === 'GITHUB_CONFIG_ERROR',
  )
})
