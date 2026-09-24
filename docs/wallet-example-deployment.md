# Wallet example deployment

The deployable frontend in this SDK monorepo is `apps/wallet-chat`. SDK packages and contracts are not separate Vercel projects.

| Setting | Value |
|---|---|
| Project | `ackrate--ackrate-protocol--e56a218` |
| Project ID | `prj_myRZITQG6xbLE94BkPMti2rtei5H` |
| Team ID | `team_QCXRpUEFhyjHGcqFv8NNhd2l` |
| Root | `apps/wallet-chat` |
| Runtime / package manager | Node 22 / npm |
| Install | `npm ci` |
| Build | `cd ../.. && npm run build -w @ackrate/stellar && npm run build -w @ackrate/core && npm run build -w @ackrate/wallet-chat` |
| Output | Default Next.js output |
| Stable project domain | `ackrate-ackrate-protocol-e56a218.vercel.app` |
| Routing | Same-repository PRs → preview; `main` and `prod` → production |

[GitHub Actions](../.github/workflows/vercel.yml) pulls the appropriate Vercel environment, builds, then deploys prebuilt output. The project has no native Git link; the frontend configuration also disables native Git deployments. Keep `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` in repository secrets. Never document their secret values.

On September 24, the preview failed to retrieve project settings. The repository secrets were refreshed against the verified existing project, and its stale retired-scope build command was corrected to `@ackrate` workspaces. No domains were reassigned. The project has no configured application environment variables; a deployed preview alone does not establish funded wallet readiness.

The consumer demo is a separate repository and deployment. Its staging-domain routing and persistent CLI runner requirements are documented there; deploying this wallet example does not resolve them.
