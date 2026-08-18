# License policy

## How a package is judged

For every installed package the checker determines a license expression and evaluates it
against the policy:

1. The license declared in the package's `package.json` is used: `license` as a string, the
   legacy `license` object with `type` and `url`, or the legacy `licenses` array, which is read
   as a choice between alternatives.
2. When the manifest declares `SEE LICENSE IN <file>`, that file is read.
3. When the manifest carries no usable license at all, well-known license texts are recognised
   in the package's `LICENSE`, `LICENCE` or `COPYING` file. Such a result is marked as
   _detected from license file_ in the report.
4. Without any of these the package's license is `UNKNOWN` and it needs an exception.

The resulting SPDX expression is evaluated with `AND`, `OR`, `WITH`, the `+` suffix and
parentheses. `AND` requires every part to be accepted; `OR` requires one. An identifier in
`denyLicenses` is never accepted, even when it also appears in `allowLicenses`.

## Dual licensed packages

A package published under `(BSD-3-Clause OR GPL-2.0)` may be used under either license, so
choosing the permissive alternative is legitimate. Such a package is accepted, and reported in
its own section so the decision does not disappear:

```text
Accepted by choosing a permissive alternative of a dual licensed package:
  node-forge@1.3.1
    License:  (BSD-3-Clause OR GPL-2.0)
    Chosen:   BSD-3-Clause
    Declined: GPL-2.0
```

Set `allowDualLicenseChoice` to `false` to require an explicit exception for every such package
instead. Declaring an exception for a dual licensed package always takes precedence over the
automatic choice, so documenting the decision does not turn the entry into an unused exception.

## Accepted licenses

`extends: "jeap:recommended"` accepts:

`0BSD`, `AFL-2.1`, `Apache-2.0`, `Artistic-2.0`, `BlueOak-1.0.0`, `BSD-2-Clause`,
`BSD-3-Clause`, `BSD-4-Clause`, `CC-BY-3.0`, `CC-BY-4.0`, `CC0-1.0`, `ISC`, `MIT`, `MIT-0`,
`MPL-2.0`, `PostgreSQL`, `Python-2.0`, `Unlicense`, `UPL-1.0`, `W3C`, `WTFPL`, `Zlib`

Only SPDX identifiers are accepted. Free-form values such as `Public Domain` are deliberately
not in the policy: they are a claim, not a license text, and what they actually grant has to be
established per package. A package declaring one needs an exception naming the package, with a
reason recording where the claim was verified:

```json
{
  "exceptions": {
    "jsonify@*": {
      "reason": "Public domain dedication by the author, see the repository at https://github.com/ljharb/jsonify."
    }
  }
}
```

## Denied licenses

The same base policy never accepts the strong copyleft licenses:

`AGPL-1.0`, `AGPL-3.0`, `GPL-1.0`, `GPL-2.0`, `GPL-3.0`, `LGPL-2.0`, `LGPL-2.1`, `LGPL-3.0`,
`SSPL-1.0`, each also in its `-only` and `-or-later` spelling.

Listing them explicitly is what makes a dual licensed package show up as a deliberate choice of
the permissive alternative rather than passing unnoticed.

## Changing the policy

Widen it for a single project with `allowLicenses`, tighten it with `denyLicenses`. Start from
nothing with `"extends": null` and list every accepted license yourself.

A change that should apply to every jEAP frontend belongs in this tool, not in the projects: add
the identifier to `src/default-policy.ts` and release a new version.
