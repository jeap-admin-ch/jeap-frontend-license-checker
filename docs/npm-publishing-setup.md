# npm publishing setup

This document describes the one-time, maintainer-facing setup required to publish
`@jeap/jeap-frontend-license-checker` to the public npm registry. It covers what must be
configured **outside the repository**, on npmjs.com and in the GitHub repository settings.

The target state is the same as for the other jEAP npm packages: published publicly under the
npm [`@jeap` organization](https://www.npmjs.com/org/jeap), released by GitHub Actions using
**npm Trusted Publishing (OIDC)**, with **no long-lived npm token stored in CI**.

## One-time prerequisites (npmjs.com)

1. The npm **`jeap` organization** must exist, and the publishing maintainer must be a member
   with rights to publish to the `@jeap` scope. It already hosts the other jEAP packages.
2. The package is scoped and published publicly. This is declared in `package.json` via
   `"publishConfig": { "access": "public" }`, and the workflow also passes `--access public`.

## One-time prerequisites (GitHub)

1. Create a repository environment named `release`. The release job runs in it, which is what
   scopes the bootstrap secret to that job.
2. Configure the npm **trusted publisher** for this repository, the workflow file
   `build-and-release.yml` and the `release` environment.

## Bootstrapping the first release

Trusted publishing can only be configured for a package that already exists on npm. Until then:

1. Add a repository secret `NPM_TOKEN` in the `release` environment, holding an automation token
   with publish rights for the `@jeap` scope.
2. Merge the first version to `main`. The workflow's token publish step runs because the secret
   is present.
3. Configure the trusted publisher on npm as described above.
4. **Delete the `NPM_TOKEN` secret.** The workflow then automatically uses the OIDC publish step
   instead; no workflow edit is needed.

## Requirements already satisfied by the workflow

- `permissions: id-token: write` for the OIDC token, and `contents: write` to push the record tag
- runs on a GitHub-hosted runner
- upgrades npm before publishing, because trusted publishing needs npm >= 11.5.1 and
  Node.js >= 22.14.0
