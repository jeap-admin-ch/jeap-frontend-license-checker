# Migrating from the previous license checker

## Why

The license checker the jEAP frontends used so far derives the package name of an exception key
by taking everything before the first `@`. For a scoped package such as `@scope/package@1.2.3`
that yields an empty name, so a `@scope/package@*` exception never matches and every exempted
scoped package has to be pinned to an exact version. Each dependency update of such a package
then breaks the build.

Its license policy also lives in each project, as one exception per package rather than per
license, so a new transitive dependency with an already approved license breaks the build too.

## Steps

1. Replace the dependencies. Remove the previous license checker and the package used to
   generate the notice file from `devDependencies`, then install this tool:

   ```bash
   npm install --save-dev @jeap/jeap-frontend-license-checker
   ```

2. Point the scripts at the new tool:

   ```json
   {
     "scripts": {
       "check-licenses": "jeap-frontend-license-checker",
       "generate-license-file": "jeap-frontend-license-checker notices --out ../THIRD-PARTY-FRONTEND-LICENSES.md"
     }
   }
   ```

3. Delete `license-exceptions.json` and `custom-license-md-format.json`, then run
   `npm run check-licenses` and write a `jeap-license-check.json` for what is actually left.

   Most existing exceptions disappear: everything that was exempted only because its license was
   not in the old whitelist (`BlueOak-1.0.0`, `0BSD`, `CC-BY-4.0`, `MIT-0`, `Python-2.0`,
   `(MIT OR CC0-1.0)`, ...) is covered by the built-in policy, and the entry for the project
   itself is no longer needed because the project's own declared license is read.

   In the jEAP frontends this reduced 20 to 33 exceptions per project to the handful of packages
   that genuinely publish no license metadata.

4. Prefer a scope wildcard where several packages of the same publisher are affected:

   ```json
   {
     "exceptions": {
       "@quadrel-enterprise-ui/*": {
         "reason": "Runtime dependencies whose published npm packages omit SPDX license metadata."
       }
     }
   }
   ```

## What changes in the output

- The project itself is no longer reported as `UNLICENSED`; its declared license is read from
  its own `package.json`.
- Licenses guessed from a license file are reported under their real identifier instead of the
  old `MIT*` / `BSD*` spelling, and the report says that they were detected from a file.
- A package whose license is only known by a URL is reported as `UNKNOWN` rather than as
  `Custom: <url>`, because a URL is not a license.
- Dual licensed packages are accepted through their permissive alternative and listed in their
  own section instead of needing an exception each.
- Exceptions that no longer match an installed package fail the check instead of being ignored.
- The notice file no longer contains a broken `(Repository)` link for packages that declare no
  repository.
