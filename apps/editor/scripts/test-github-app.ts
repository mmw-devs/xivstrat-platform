// Manual, read-only GitHub App diagnostic. Never performs GitHub writes.
import {
  verifyAppIdentity,
  verifyInstallationIdentity,
  verifyInstallationRepositoryAccess,
  verifyTargetRepository,
} from '../src/server/github/app.ts'
import { loadGitHubConfig } from '../src/server/github/env.ts'
import { GitHubIntegrationError } from '../src/server/github/types.ts'

async function main(): Promise<void> {
  const config = loadGitHubConfig()
  const { app, identity } = await verifyAppIdentity(config)
  console.log('D1.1 App authentication: OK')
  console.log(`App id: ${identity.appId}`)
  console.log(`App slug/name: ${identity.slug} / ${identity.name}`)

  const installation = await verifyInstallationIdentity(app, config)
  console.log('D1.2 Installation identity: OK')
  console.log(`Installation id: ${installation.installationId}`)
  console.log(`Installation account: ${installation.accountLogin}`)
  console.log(`Repository selection: ${installation.repositorySelection}`)

  const access = await verifyInstallationRepositoryAccess(app, config)
  console.log('D1.3 Installation repository access: OK')
  console.log(`Accessible repository: ${access.repositoryFullName}`)

  const verification = await verifyTargetRepository(access.octokit, config, ({ attempt, maxAttempts, diagnostic }) => {
    console.error(`D1.4 attempt ${attempt}/${maxAttempts}`)
    if (diagnostic.status !== undefined) console.error(`status: ${diagnostic.status}`)
    console.error(`message: ${diagnostic.githubMessage}`)
    if (diagnostic.endpoint) console.error(`endpoint: ${diagnostic.endpoint}`)
  })

  console.log('D1.4 Repository access: OK')
  console.log(`Repository: ${verification.repoFullName}`)
  console.log(`Default branch: ${verification.defaultBranch}`)
  console.log(`Base branch: ${verification.baseBranch}`)
  console.log(`HEAD source: ${verification.headSource}`)
  console.log(`Git Ref attempts: ${verification.gitRefAttempts}`)
  console.log(`HEAD SHA: ${verification.headSha}`)
}

try {
  await main()
} catch (error) {
  if (error instanceof GitHubIntegrationError) {
    console.error(`[${error.code}] ${error.message}`)
    if (error.diagnostic) {
      console.error(`Stage: ${error.diagnostic.stage}`)
      if (error.diagnostic.status !== undefined) console.error(`HTTP status: ${error.diagnostic.status}`)
      console.error(`GitHub message: ${error.diagnostic.githubMessage}`)
      if (error.diagnostic.method) console.error(`HTTP method: ${error.diagnostic.method}`)
      if (error.diagnostic.endpoint) console.error(`API endpoint: ${error.diagnostic.endpoint}`)
      if (error.diagnostic.requestId) console.error(`x-github-request-id: ${error.diagnostic.requestId}`)
    }
  } else {
    console.error('[GITHUB_APP_AUTH_ERROR] Unexpected GitHub App verification failure')
  }
  process.exitCode = 1
}
