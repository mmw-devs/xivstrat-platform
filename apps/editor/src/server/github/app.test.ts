import assert from 'node:assert/strict'
import test from 'node:test'

import type { App } from '@octokit/app'

import { verifyInstallationRepositoryAccess } from './app.ts'
import type { GitHubConfig } from './env.ts'

const config: GitHubConfig = {
  appId: 1,
  installationId: 2,
  privateKey: 'not-used-by-mock',
  owner: 'mmw-devs',
  repo: 'xivstrat-platform',
  baseBranch: 'main',
}

test('installation repository access paginates until a repository on a later page is found', async () => {
  const requestedPages: number[] = []
  const octokit = {
    request: async (_route: string, parameters: { page: number }) => {
      requestedPages.push(parameters.page)
      const repositories =
        parameters.page === 1
          ? Array.from({ length: 100 }, (_, index) => ({ full_name: `mmw-devs/repo-${index}` }))
          : [{ full_name: 'mmw-devs/xivstrat-platform' }]
      return { data: { repositories } }
    },
  }
  const app = { getInstallationOctokit: async () => octokit } as unknown as App

  const access = await verifyInstallationRepositoryAccess(app, config)

  assert.deepEqual(requestedPages, [1, 2])
  assert.equal(access.repositoryFullName, 'mmw-devs/xivstrat-platform')
  assert.equal(access.octokit, octokit)
})
