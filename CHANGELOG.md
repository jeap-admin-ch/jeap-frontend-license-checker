# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.2] - 2026-08-19

### Fixed

- The README linked into `docs/policy.md` with an anchor. The jEAP documentation site
  copies a repository's `docs/` files up beside the README-derived landing page and
  rewrites `docs/<file>.md` links accordingly, but its rewrite does not match a link
  carrying a `#fragment`, so that one link survived unrewritten and broke the site build.
  The link now points at the page and names the section in the text.

## [1.0.1] - 2026-08-18

### Changed

- The notice file links each copied license text to the file in the repository instead of
  naming it as plain text. The path doubles as the link text, so the notices still name the
  file when they are read unrendered. A file name containing a space or a parenthesis is
  escaped in the link target.

### Fixed

- The `bin` entries no longer carry a `./` prefix, which npm rewrote on every publish and
  reported as an auto-correction.

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
- The notice file carries the full license texts of the production dependencies, together with
  any NOTICE file, copied byte for byte. MIT, BSD and Apache-2.0 require the notice to be
  included in what is redistributed, and a frontend bundle contains the dependency code.
  `notices.texts` selects the layout: `folder` (default) keeps the notice file an index beside
  a `third-party-licenses/` directory, `inline` produces one self-contained file, `none` lists
  the identifiers only. Texts are never synthesised: a package that ships none is marked.
- License and notice files are found case insensitively, so a package shipping a lower case
  `license` file is no longer reported as having no license.
- The notice file names dependencies without their version by default, and the copied texts are
  named after the package, so a committed notice file does not change on a dependency update.
- The check fails when the dependency tree could not be scanned completely, and reports each
  thing it could not examine with the path, the system error, the requiring package, the
  searched locations and what to do about it. A mandatory dependency that cannot be resolved,
  an unreadable `node_modules`, scope directory, package directory, manifest or license file,
  and a manifest that cannot be parsed or names no package all count; a path that is simply not
  there does not. Previously such cases were skipped quietly and the run could report success
  although packages were never examined. Exit code `3` keeps this apart from a policy
  violation, `notices` writes nothing from a partial scan, and `--allow-incomplete-scan`
  downgrades it for local debugging.
- An unknown entry in `notices.fields` is refused instead of silently producing no line.
- The license texts are written only inside the texts directory: a package name is sanitised
  and the resulting path is verified, so a package cannot write over a file of the project. A
  package installed in more than one version gets one directory per version. The directory is
  only rebuilt when this tool created it, which it records with a `.jeap-license-texts` marker.
- Unreadable license files are reported when the notices are generated, instead of the package
  being recorded as shipping no license text.
- Configuration values are validated: a license list that is not an array, an unknown `extends`
  and a flag that is not a boolean are refused rather than silently ignored, and a
  configuration file that exists but cannot be read fails the run instead of leaving the
  project with the plain built-in policy.
- A dependency is never resolved from outside the project directory.
- No runtime dependencies.
