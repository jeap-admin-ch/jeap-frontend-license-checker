/**
 * Matching of package keys against configured exception keys.
 *
 * An exception key is `<package>@<version>`, where `<package>` may be a plain name, a
 * scoped name, or a scope wildcard, and `<version>` may be `*`:
 *
 * ```text
 * tslib@2.8.1                     a single version
 * tslib@*                         any version
 * tslib                           any version (short form)
 * @scope/package@*                any version of a scoped package
 * @scope/*                        any package of a scope, any version
 * @scope/*@*                      the same, written out
 * ```
 *
 * Splitting at the last `@` is what makes scoped packages work; splitting at the first one
 * yields an empty package name for every `@scope/...` key.
 */

/** A package key or exception key split into its name and version part. */
export interface SplitKey {
  name: string;
  version: string;
}

/** Splits `@scope/package@1.2.3` into its name and version part. */
export function splitPackageKey(key: string): SplitKey {
  const separatorIndex = key.lastIndexOf('@');
  if (separatorIndex <= 0) {
    // No version part at all, or a bare scope such as `@scope/package`.
    return { name: key, version: '*' };
  }
  return {
    name: key.slice(0, separatorIndex),
    version: key.slice(separatorIndex + 1),
  };
}

function matchesName(packageName: string, exceptionName: string): boolean {
  if (exceptionName === packageName) {
    return true;
  }
  // Scope wildcard: `@scope/*` matches every package published under that scope.
  if (exceptionName.endsWith('/*')) {
    return packageName.startsWith(exceptionName.slice(0, -1));
  }
  return false;
}

/**
 * Returns the exception key matching the given package key, preferring the most specific
 * match: an exact version before a version wildcard, and a package name before a scope
 * wildcard.
 */
export function findMatchingExceptionKey(
  packageKey: string,
  exceptionKeys: Iterable<string>
): string | undefined {
  const target = splitPackageKey(packageKey);
  let scopeWildcardMatch: string | undefined;
  let versionWildcardMatch: string | undefined;

  for (const exceptionKey of exceptionKeys) {
    const exception = splitPackageKey(exceptionKey);
    if (!matchesName(target.name, exception.name)) {
      continue;
    }

    const isScopeWildcard = exception.name !== target.name;
    if (exception.version === target.version && !isScopeWildcard) {
      return exceptionKey;
    }
    if (exception.version !== '*' && exception.version !== target.version) {
      continue;
    }
    if (isScopeWildcard) {
      scopeWildcardMatch ??= exceptionKey;
    } else {
      versionWildcardMatch ??= exceptionKey;
    }
  }

  return versionWildcardMatch ?? scopeWildcardMatch;
}
