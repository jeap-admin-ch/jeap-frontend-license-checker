# Development

## Requirements

Node.js 20.11.0 or newer. The CI workflow pins the Node version it builds with and runs the
tests on Node 20, 22 and 24.

## Scripts

```bash
npm ci
npm run format        # Prettier --write (format:check verifies only)
npm run lint
npm run test          # compiles src and test, then runs node --test
npm run build         # compiles src into dist
npm run notices       # regenerates THIRD-PARTY-LICENSES.md with this tool itself
npm run pack:dry-run
npm run publish:dry-run
```

**Before every commit, run `npm run format` and `npm run lint`.** The "Lint and format" job runs
`npm run format:check` followed by `npm run lint` and fails on any deviation.

## Layout

```text
src/
  cli.ts                 Command line interface, argument parsing and exit codes
  index.ts               Public programmatic API
  check.ts               The policy check: scan, judge, collect
  config.ts              Configuration discovery, parsing and resolution
  default-policy.ts      The accepted and denied licenses shipped with the tool
  license-detection.ts   License of a package from its manifest or its license file
  match.ts               Package key and exception key matching
  notices.ts             Third-party notice file rendering
  report.ts              Text and JSON reports
  scan.ts                Walking node_modules
  spdx.ts                SPDX expression parsing and evaluation
test/
  fixtures/project/      A synthetic project with one package per interesting case
```

## Conventions

- No runtime dependencies. Anything the tool needs at run time is implemented here or comes from
  the Node standard library. Development dependencies are unrestricted.
- The `test/fixtures/project/node_modules` directory is committed on purpose: it is the input of
  the scanner tests, not an installed dependency tree.
- Every behaviour that a project could rely on has a test. New license detection rules need a
  fixture package.
- Keep code comments in English, and explain why rather than what.

## Releasing

See [publishing-and-versioning.md](publishing-and-versioning.md).
