# Publishing and versioning

## Versioning

- The package follows [Semantic Versioning](https://semver.org/).
- A change to the built-in policy that makes a previously passing project fail is a **major**
  change: it breaks builds. Adding an accepted license is a **minor** change.
- All notable changes are documented in [CHANGELOG.md](../CHANGELOG.md).
- Keep `publiccode.yml` in sync: `softwareVersion` must match the package version and
  `releaseDate` must be the release date.
- Release tags use the format `vX.Y.Z` and are created by CI.

## How a release happens

There is a single workflow, `.github/workflows/build-and-release.yml`. On a push to `main` it
runs the checks and then the `release` job:

- **Release on merge to `main`.** When the version in `package.json` has not been released yet
  (no matching `v<version>` tag), the `release` job publishes it. A merge without a version bump
  is a no-op, because the tag already exists.
- The job runs in the protected `release` environment.
- The publish step uses npm trusted publishing (OIDC) in the steady state, so no long-lived npm
  token is stored in CI.
- After a successful publish it pushes a `vX.Y.Z` tag as a record of the release. The tag is a
  marker and idempotency guard, not a release trigger, so the default `GITHUB_TOKEN` is enough.

Do not publish manually in normal operation.

## Release checklist

```text
1. Update package.json (version)
2. Update CHANGELOG.md
3. Update publiccode.yml (softwareVersion, releaseDate)
4. Update the docs if needed
5. Run npm ci && npm run lint && npm run test && npm run build
6. Run npm run notices and commit the result if it changed
7. Verify the package contents (npm run pack:dry-run)
8. Merge the version bump to main
9. The release job publishes and pushes the vX.Y.Z tag
```
