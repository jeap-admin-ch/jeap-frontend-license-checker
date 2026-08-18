# Getting started

## Install

```bash
npm install --save-dev @jeap/jeap-frontend-license-checker
```

## Add the scripts

```json
{
  "scripts": {
    "check-licenses": "jeap-frontend-license-checker",
    "generate-license-file": "jeap-frontend-license-checker notices --out ../THIRD-PARTY-FRONTEND-LICENSES.md"
  }
}
```

In a Maven build the scripts are usually run by the `exec-maven-plugin` in the
`generate-resources` phase, exactly as before:

```xml
<execution>
  <id>check-frontend-licenses</id>
  <phase>generate-resources</phase>
  <goals>
    <goal>exec</goal>
  </goals>
  <configuration>
    <executable>npm</executable>
    <arguments>
      <argument>run</argument>
      <argument>check-licenses</argument>
    </arguments>
  </configuration>
</execution>
```

## Run it

```bash
npm run check-licenses
```

The first run usually passes without any configuration, as long as the project declares its
own license. The project itself is checked like any other package, so a `package.json` without
a `license` field is reported as `UNKNOWN`; add `"license": "Apache-2.0"` to it rather than
exempting the project from its own check.

What remains are the packages that publish no usable license metadata at all:

```text
Problems with the licenses of these dependencies:
  @quadrel-enterprise-ui/framework@20.35.0
    License:     UNKNOWN
    Repository:  https://github.com/BAZG-Quadrel/quadrel-framework
    Publisher:   unknown
    Url:         unknown

Licenses not ok: Allowed (1230) Exceptions (0) Problems (1)
```

## Declare the exceptions

Create `jeap-license-check.json` next to `package.json` and record why each of those packages is
accepted. Prefer a wildcard over an exact version, so a dependency update does not break the
build:

```json
{
  "exceptions": {
    "@quadrel-enterprise-ui/*": {
      "reason": "Runtime dependencies whose published npm packages omit SPDX license metadata."
    }
  }
}
```

```text
Accepted license exceptions:
  @quadrel-enterprise-ui/framework@20.35.0 (matched by @quadrel-enterprise-ui/*)
    License: UNKNOWN
    Reason:  Runtime dependencies whose published npm packages omit SPDX license metadata.

All licenses ok: Allowed (1230) Exceptions (4) Problems (0)
```

An exception is a documented decision, not a way to silence the check. Add one only for a
package whose license you have established by other means, and say in the reason what that
license is and where you found it.
