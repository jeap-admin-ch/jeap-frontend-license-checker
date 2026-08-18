# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-08-18

### Added

- Initial release. `jeap-frontend-license-checker` checks the licenses of the installed npm
  dependencies of a frontend project against a license policy, and generates the third-party
  notice file for them.
- The accepted permissive licenses ship with the tool, so a project without configuration is
  already checked against the jEAP policy and only has to declare its own exceptions. Projects
  can widen the policy with `allowLicenses` and tighten it with `denyLicenses`. The policy
  accepts SPDX identifiers only; a package declaring a free-form value such as `Public Domain`
  needs an exception naming that package.
- Exception keys support version wildcards for scoped packages (`@scope/package@*`) and scope
  wildcards (`@scope/*`), so a dependency update of an exempted package does not break the build.
- SPDX license expressions are evaluated, including `AND`, `OR`, `WITH`, the `+` suffix and
  parentheses. A dual licensed package is accepted through its permissive alternative and
  reported separately, so the decision stays visible.
- The license of a package is read from its `package.json`; when the manifest carries no usable
  license, well-known license texts are recognised in the package's license file, including the
  file a `SEE LICENSE IN <file>` declaration points to.
- Exceptions that no longer match an installed package are reported and fail the check by
  default, so exception lists do not accumulate stale entries.
- No runtime dependencies.
