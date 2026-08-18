# Configuration

The configuration is read from `jeap-license-check.json` next to the project's `package.json`,
or from a `jeapLicenseCheck` key inside `package.json`. `--config <file>` overrides both. Every
setting is optional.

```json
{
  "extends": "jeap:recommended",
  "allowLicenses": ["EPL-2.0"],
  "denyLicenses": ["CC-BY-4.0"],
  "exceptions": {
    "@quadrel-enterprise-ui/*": { "reason": "No SPDX metadata published." },
    "some-package@1.2.3": {
      "reason": "MIT, see the LICENSE file in the repository."
    }
  },
  "production": false,
  "excludePrivatePackages": false,
  "failOnUnusedExceptions": true,
  "allowDualLicenseChoice": true,
  "notices": {
    "out": "../THIRD-PARTY-FRONTEND-LICENSES.md",
    "fields": ["name", "licenses", "repository"],
    "production": true,
    "excludePrivatePackages": true,
    "texts": "folder",
    "textsDir": "third-party-licenses",
    "includeVersions": false
  }
}
```

## Settings

| Setting                  | Default              | Description                                                                                                                                                |
| ------------------------ | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extends`                | `"jeap:recommended"` | Base policy. Set to `null` to start from an empty policy and list every accepted license yourself.                                                         |
| `allowLicenses`          | `[]`                 | Additional accepted license identifiers, added to the base policy.                                                                                         |
| `denyLicenses`           | `[]`                 | Identifiers that are never accepted, added to the base policy's denied list. A denied identifier is rejected even when it also appears in `allowLicenses`. |
| `exceptions`             | `{}`                 | Packages accepted despite the policy. See below.                                                                                                           |
| `production`             | `false`              | Only walk the production dependency graph, ignoring `devDependencies`.                                                                                     |
| `excludePrivatePackages` | `false`              | Skip packages whose `package.json` sets `"private": true`.                                                                                                 |
| `failOnUnusedExceptions` | `true`               | Fail when a configured exception no longer matches an installed package.                                                                                   |
| `allowDualLicenseChoice` | `true`               | Accept a package licensed under `(A OR B)` when one alternative is accepted. Set to `false` to require an explicit exception for such packages.            |
| `notices`                | see below            | Settings of the `notices` command.                                                                                                                         |

## Exceptions

An exception key is `<package>@<version>`. The version may be `*`, and the package name may be
a scope wildcard:

| Key                | Matches                             |
| ------------------ | ----------------------------------- |
| `tslib@2.8.1`      | exactly that version                |
| `tslib@*`          | any version of `tslib`              |
| `tslib`            | the same, short form                |
| `@scope/package@*` | any version of a scoped package     |
| `@scope/*`         | any package of a scope, any version |

The most specific match wins: an exact version before a version wildcard, a package name before
a scope wildcard.

The value is an object with a `reason`, or a plain string as a shorthand:

```json
{
  "exceptions": {
    "some-package@*": "MIT, see the LICENSE file in the repository."
  }
}
```

Prefer wildcards. An exception pinned to a version has to be updated on every dependency bump of
that package, which is exactly the maintenance the wildcards exist to avoid.

Exceptions that no longer match any installed package are reported and fail the check, so the
list does not accumulate entries for dependencies that are long gone. Set
`failOnUnusedExceptions` to `false`, or pass `--allow-unused-exceptions`, to only report them.

## Notice file

| Setting                          | Default                                                     | Description                                                                                                                  |
| -------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `notices.out`                    | none (stdout)                                               | File to write, relative to the project directory. `--out` overrides it.                                                      |
| `notices.fields`                 | `["name", "licenses", "repository"]`                        | Fields listed per dependency. Available: `name`, `version`, `licenses`, `license`, `repository`, `publisher`, `url`, `path`. |
| `notices.production`             | the `--production` flag, else `production`                  | Only list production dependencies.                                                                                           |
| `notices.excludePrivatePackages` | the `--exclude-private` flag, else `excludePrivatePackages` | Skip private packages.                                                                                                       |
| `notices.texts`                  | `"folder"`                                                  | Where the full license texts go: `"folder"`, `"inline"` or `"none"`. See [notices.md](notices.md).                           |
| `notices.textsDir`               | `"third-party-licenses"`                                    | Directory for the copied texts, relative to the notice file. Must stay below it.                                             |
| `notices.includeVersions`        | `false`                                                     | Name the dependencies with their version.                                                                                    |

The project itself is never listed; it is not a third-party dependency.

The license **texts** always cover the production dependency graph, whatever the index covers:
development tooling is not redistributed and carries no attribution obligation.

## Keeping the notice file quiet

The notice file is committed, so every line that changes for a reason other than a changed
license produces a commit that says nothing. Two defaults exist for that:

- **Versions are left out.** A notice file attributes copyright holders; it is not an
  inventory. With versions in it, every dependency bump rewrites it. Set
  `notices.includeVersions` to `true`, or pass `--include-versions`, if you want them anyway.
- **The copied texts are named after the package, not the release.** A path such as
  `third-party-licenses/@angular__core/LICENSE` only changes when the package's own license
  text changes.

What remains are the changes worth reviewing: a dependency appears or disappears, or its
license changes.

The `path` field is available but writes absolute paths of the machine that generated the
file. Leave it out of a committed artifact.
