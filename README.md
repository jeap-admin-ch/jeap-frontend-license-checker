# jEAP Frontend License Checker

License policy checker and third-party notice generator for jEAP frontend projects.

`jeap-frontend-license-checker` inspects the npm dependencies installed in a project, checks
their licenses against a license policy and fails the build when a dependency is not covered.
It also generates the third-party notice file that lists those dependencies and their licenses.

The accepted permissive licenses ship with the tool. A project without configuration is already
checked against the jEAP policy and only declares the exceptions it actually needs.

The tool has **no runtime dependencies**.

## Installation

```bash
npm install --save-dev @jeap/jeap-frontend-license-checker
```

Wire it into the project's scripts:

```json
{
  "scripts": {
    "check-licenses": "jeap-frontend-license-checker",
    "generate-license-file": "jeap-frontend-license-checker notices --out ../THIRD-PARTY-FRONTEND-LICENSES.md"
  }
}
```

## Usage

```bash
npx jeap-frontend-license-checker            # check the installed dependencies
npx jeap-frontend-license-checker notices    # write the third-party notices
```

The short alias `jeap-license-check` is installed as well.

```text
Options:
  --start <dir>             Project directory to inspect (default: the working directory)
  --config <file>           Configuration file to use instead of jeap-license-check.json
  --production              Only consider production dependencies
  --exclude-private         Skip packages marked as private
  --allow-unused-exceptions Do not fail on configured exceptions that are no longer needed
  --out <file>              Write the output to a file instead of stdout (notices)
  --json                    Print the check result as JSON
  --quiet                   Print nothing on success
  -h, --help                Show this help
  -v, --version             Show the version of this tool

Exit codes:
  0  the check passed
  1  the license policy was violated
  2  the invocation or the configuration is wrong
```

## Configuration

Everything is optional. Put the settings into `jeap-license-check.json` next to the project's
`package.json`, or into a `jeapLicenseCheck` key inside `package.json`:

```json
{
  "exceptions": {
    "@quadrel-enterprise-ui/*": {
      "reason": "Runtime dependencies whose published npm packages omit SPDX license metadata."
    }
  }
}
```

See [docs/configuration.md](docs/configuration.md) for every setting and
[docs/policy.md](docs/policy.md) for the licenses the built-in policy accepts.

## Why this tool

The tool it replaces resolved a wildcard exception by taking everything before the first `@` of
a package key. For a scoped package such as `@scope/package@1.2.3` that yields an empty package
name, so `@scope/package@*` never matched and every exempted scoped package had to be pinned to
an exact version — breaking the build on each dependency update. On top of that, the license
policy lived in each project, so a new transitive dependency with an already approved license
broke the build as well.

This tool splits a package key at its **last** `@`, ships the policy with the checker, and
evaluates SPDX expressions instead of requiring an exception per dual licensed package.

## Documentation

| Topic                                                          | Description                                                    |
| -------------------------------------------------------------- | -------------------------------------------------------------- |
| [Getting started](docs/getting-started.md)                     | Adding the checker to a project                                |
| [Configuration](docs/configuration.md)                         | Every configuration setting                                    |
| [Policy](docs/policy.md)                                       | The licenses the built-in policy accepts, and how to change it |
| [Migration](docs/migration.md)                                 | Replacing the previous license checker                         |
| [Development](docs/development.md)                             | Local development, scripts and CI                              |
| [Publishing and versioning](docs/publishing-and-versioning.md) | Release process                                                |
| [npm publishing setup](docs/npm-publishing-setup.md)           | One-time maintainer setup                                      |

## License

This project is licensed under the [Apache License 2.0](LICENSE).
