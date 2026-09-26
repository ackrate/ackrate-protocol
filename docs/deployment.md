# Deployment

Feature pull requests deploy previews in the staging project. Validated changes merge to `main`, which deploys staging. Promote a reviewed release to `prod` to deploy production. Production promotion is explicit.

| Branch | Vercel project | Stable URL |
| --- | --- | --- |
| main | ackrate--ackrate-protocol--staging--54c60f4b | https://ackrate-ackrate-protocol-staging-54c60f4b.vercel.app |
| prod | ackrate--ackrate-protocol--e56a218 | https://ackrate-ackrate-protocol-e56a218.vercel.app |

GitHub Actions owns deployment; native Vercel Git integration must remain disabled. Both projects use Vercel's production tier for their stable alias, but have separate project IDs, tokens and application data. Never copy production database, wallet, session or storage credentials into staging.

Repository secrets: `VERCEL_ORG_ID`, `VERCEL_STAGING_PROJECT_ID`, `VERCEL_PRODUCTION_PROJECT_ID`, `VERCEL_STAGING_TOKEN`, `VERCEL_PRODUCTION_TOKEN`. Tokens are project-scoped with no expiration, kept only in GitHub secrets. CLI credentials are separate. Provisioning these secrets and successful workflows are required before claiming deployment is complete.

Merge only after independent and named reviews, passing CI and a successful preview for the exact revision. Native GitHub auto-merge requires a supported plan and required checks/branch protection. It is not enabled while those controls are unavailable. During rollout, the agent may merge a fully validated PR explicitly; prod promotion remains separate.
