# Third-party notices

`jeap-frontend-license-checker notices` writes the file that documents the dependencies a
project redistributes, together with their license texts.

## Why the texts, not only the identifiers

The obligation comes from the license texts themselves:

- **MIT** — "The above copyright notice and this permission notice **shall be included in all
  copies or substantial portions** of the Software."
- **BSD-2-Clause / BSD-3-Clause** — "Redistributions in binary form must **reproduce** the
  above copyright notice, this list of conditions and the following disclaimer."
- **Apache-2.0** — §4(a) recipients must receive a copy of the License; §4(d) the attribution
  notices of a dependency's `NOTICE` file must be propagated.

A frontend production bundle contains the dependency code, minified into the shipped
JavaScript, so the project redistributes those dependencies and these clauses apply to it. A
list of license identifiers, or a link to a license, does not satisfy "included" or
"reproduce" — and links rot.

## What is collected

- The texts cover the **production dependency graph** only. Development tooling never reaches
  a user, so it carries no attribution obligation. It still appears in the index when the
  index is not limited to production dependencies, just without a text.
- Every `LICENSE`, `LICENCE`, `COPYING` and `NOTICE` file a package ships is taken, matched
  case insensitively, and copied **byte for byte**. Nothing is reformatted, and nothing is
  deduplicated: each file carries its own copyright line.
- Nothing is invented. A package that ships no license file is marked
  `text: not shipped by the package`. Inserting the canonical text of its declared license
  would attribute a copyright holder that the package itself does not name. Such a package
  needs a decision, not a generated text.

## Layouts

`notices.texts` selects one of three layouts.

### `folder` (default)

The notice file stays a readable index and the original files are copied into
`third-party-licenses/` beside it, one directory per package with `/` replaced by `__`:

```text
THIRD-PARTY-LICENSES.md
third-party-licenses/
  @angular__core/LICENSE
  rxjs/LICENSE.txt
  some-package/LICENSE
  some-package/NOTICE
```

The directory is rebuilt on every run, so texts of dependencies that were removed do not
linger. For that reason it must be a directory below the notice file; a path escaping it is
refused.

### `inline`

One self-contained file: the index, then every license text below it in a fenced block. The
fence is always longer than any backtick run inside the text.

### `none`

License identifiers only, without any text. Use it where the artifact is an inventory rather
than something delivered to a user.

## Keeping the file quiet

The notice file is committed, and a committed file that is rewritten on every dependency bump
buries the changes that matter. Two defaults prevent that: dependencies are named without
their version, and the copied texts live under the package name rather than under a release.
The file then changes when a dependency appears or disappears, or when its license or license
text changes - and not otherwise. `notices.includeVersions` puts the versions back.

## Delivering the texts

Generating the files is not the same as shipping them. For an Angular application, add the
directory to the `assets` of the build target so it ends up in `dist/` and is served with the
application:

```json
{
  "assets": [
    {
      "glob": "**/*",
      "input": "third-party-licenses",
      "output": "third-party-licenses"
    }
  ]
}
```

Where the notice file lives outside the project directory — the usual
`--out ../THIRD-PARTY-FRONTEND-LICENSES.md` — the texts directory is created next to it, at
the repository root.
