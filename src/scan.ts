/**
 * Discovery of the installed packages of a project.
 *
 * The scan walks `node_modules` directly instead of the lock file, so it sees exactly what
 * is installed, including nested duplicates and hoisted transitive dependencies. Symlinked
 * packages (workspaces, `npm link`) are followed once, guarded by their real path.
 *
 * Nothing is skipped quietly. Whenever a directory, a manifest or a dependency cannot be
 * examined, the reason is recorded and the scan is marked incomplete, because a package that
 * was never looked at must not be able to pass the license check.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  errorCode,
  isMissing,
  ScanDiagnostics,
  type ScanError,
} from './diagnostics';
import { detectLicense, type PackageManifest } from './license-detection';
import { failed, found, missing, type Outcome } from './outcome';
import type { ScannedPackage } from './types';

/** Options of a scan. */
export interface ScanOptions {
  /** Directory of the project to scan. */
  start: string;
  /** Restrict the result to the project's production dependency graph. */
  production: boolean;
  /** Leave out packages marked as private. */
  excludePrivatePackages: boolean;
}

/** The packages a scan found, together with everything it could not examine. */
export interface ScanResult {
  packages: ScannedPackage[];
  errors: ScanError[];
}

const INSTALL_HINT =
  'run "npm ci" so that every declared dependency is installed before the licenses are checked';

/**
 * Reads a package manifest. A package is identified by its manifest, so a manifest that
 * cannot be read, cannot be parsed, or does not name the package is an error rather than a
 * package that gets left out.
 */
function readManifest(packagePath: string): Outcome<PackageManifest> {
  const manifestPath = path.join(packagePath, 'package.json');

  let content: string;
  try {
    content = fs.readFileSync(manifestPath, 'utf8');
  } catch (error) {
    if (isMissing(error)) {
      return missing();
    }
    return failed({
      kind: 'unreadable-manifest',
      message: `Cannot read the package manifest ${manifestPath}`,
      path: manifestPath,
      code: errorCode(error),
      hint: 'check the file permissions and that the path is a readable file; the package could not be identified, so its license is unknown',
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    return failed({
      kind: 'invalid-manifest',
      message: `Cannot parse the package manifest ${manifestPath}: ${(error as Error).message}`,
      path: manifestPath,
      hint: 'the installed package is damaged; reinstall it with "npm ci"',
    });
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return failed({
      kind: 'invalid-manifest',
      message: `The package manifest ${manifestPath} does not contain a JSON object`,
      path: manifestPath,
      hint: 'the installed package is damaged; reinstall it with "npm ci"',
    });
  }

  const manifest = parsed as PackageManifest;
  if (typeof manifest.name !== 'string' || manifest.name.trim() === '') {
    return failed({
      kind: 'invalid-manifest',
      message: `The package manifest ${manifestPath} declares no name`,
      path: manifestPath,
      hint: 'a package without a name cannot be attributed or exempted by name; reinstall it with "npm ci"',
    });
  }
  if (typeof manifest.version !== 'string' || manifest.version.trim() === '') {
    return failed({
      kind: 'invalid-manifest',
      message: `The package manifest ${manifestPath} declares no version`,
      path: manifestPath,
      hint: 'a package without a version cannot be identified in the report; reinstall it with "npm ci"',
    });
  }

  return found(manifest);
}

function normalizeRepository(repository: unknown): string | undefined {
  const raw =
    typeof repository === 'string'
      ? repository
      : repository !== null && typeof repository === 'object'
        ? (repository as { url?: unknown }).url
        : undefined;

  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return undefined;
  }

  return raw
    .trim()
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^ssh:\/\/git@/, 'https://')
    .replace(/^git@([^:]+):/, 'https://$1/');
}

function normalizePublisher(author: unknown): string | undefined {
  if (typeof author === 'string') {
    return author.trim().length > 0 ? author.trim() : undefined;
  }
  if (author !== null && typeof author === 'object') {
    const name = (author as { name?: unknown }).name;
    if (typeof name === 'string' && name.trim().length > 0) {
      return name.trim();
    }
  }
  return undefined;
}

function toScannedPackage(
  manifest: PackageManifest,
  packagePath: string,
  isRoot: boolean,
  diagnostics: ScanDiagnostics
): ScannedPackage {
  // readManifest guarantees both, so nothing has to be invented here.
  const name = manifest.name as string;
  const version = manifest.version as string;
  const detected = detectLicense(manifest, packagePath, diagnostics);

  const scanned: ScannedPackage = {
    key: `${name}@${version}`,
    name,
    version,
    license: detected.license,
    licenseSource: detected.source,
    private: manifest.private === true,
    path: packagePath,
    isRoot,
  };

  const repository = normalizeRepository(manifest.repository);
  if (repository !== undefined) {
    scanned.repository = repository;
  }
  const publisher = normalizePublisher(manifest.author);
  if (publisher !== undefined) {
    scanned.publisher = publisher;
  }
  if (
    typeof manifest.homepage === 'string' &&
    manifest.homepage.trim().length > 0
  ) {
    scanned.url = manifest.homepage.trim();
  }

  return scanned;
}

/** Reads a directory, telling an absent directory apart from an unreadable one. */
function readDirectory(directoryPath: string): Outcome<fs.Dirent[]> {
  try {
    return found(fs.readdirSync(directoryPath, { withFileTypes: true }));
  } catch (error) {
    if (isMissing(error)) {
      return missing();
    }
    return failed({
      kind: 'unreadable-directory',
      message: `Cannot list the installed packages in ${directoryPath}`,
      path: directoryPath,
      code: errorCode(error),
      hint: 'every package below this directory was left unchecked; check that the path is a readable directory',
    });
  }
}

/**
 * Lists the package directories directly contained in a `node_modules` directory. An
 * unreadable `node_modules` or scope directory hides every package inside it, so it is
 * recorded instead of being treated as empty.
 */
function listPackageDirectories(
  nodeModulesPath: string,
  diagnostics: ScanDiagnostics
): string[] {
  const entries = readDirectory(nodeModulesPath);
  if (entries.status === 'missing') {
    return [];
  }
  if (entries.status === 'failed') {
    diagnostics.record(entries.error);
    return [];
  }

  const directories: string[] = [];
  for (const entry of entries.value) {
    if (entry.name.startsWith('.')) {
      continue;
    }
    if (!entry.isDirectory() && !entry.isSymbolicLink()) {
      continue;
    }

    const entryPath = path.join(nodeModulesPath, entry.name);
    if (entry.name.startsWith('@')) {
      // A scope directory holds the actual packages one level deeper.
      const scopedEntries = readDirectory(entryPath);
      if (scopedEntries.status === 'failed') {
        diagnostics.record({
          ...scopedEntries.error,
          message: `Cannot list the packages of the scope ${entry.name} in ${entryPath}`,
          hint: `every package of the scope ${entry.name} was left unchecked; check that the path is a readable directory`,
        });
        continue;
      }
      if (scopedEntries.status === 'missing') {
        continue;
      }
      for (const scopedEntry of scopedEntries.value) {
        if (scopedEntry.name.startsWith('.')) {
          continue;
        }
        if (scopedEntry.isDirectory() || scopedEntry.isSymbolicLink()) {
          directories.push(path.join(entryPath, scopedEntry.name));
        }
      }
      continue;
    }

    directories.push(entryPath);
  }

  return directories;
}

/** Resolves the real path of a package, so that a symlink is only followed once. */
function realPathOf(packagePath: string): Outcome<string> {
  try {
    return found(fs.realpathSync(packagePath));
  } catch (error) {
    return failed({
      kind: 'unreadable-package',
      message: `Cannot resolve the real path of the installed package ${packagePath}`,
      path: packagePath,
      code: errorCode(error),
      hint: 'the package was left unchecked; a broken symlink usually causes this, reinstall with "npm ci"',
    });
  }
}

/**
 * Resolves a dependency name from a starting directory the way Node does: the nearest
 * `node_modules` wins, then each parent directory is tried in turn.
 *
 * `fs.existsSync` is deliberately not used, because it answers `false` both for a path that
 * is not there and for one that cannot be read.
 */
function resolveDependency(
  fromPath: string,
  dependencyName: string,
  rootPath: string
): { outcome: Outcome<string>; searched: string[] } {
  const searched: string[] = [];
  let current = fromPath;

  for (;;) {
    // Checked before the candidate is built, so no directory outside the project is probed
    // and a dependency is never resolved from outside it.
    const inside =
      current === rootPath || current.startsWith(rootPath + path.sep);
    if (!inside) {
      return { outcome: missing(), searched };
    }

    const candidate = path.join(current, 'node_modules', dependencyName);
    searched.push(candidate);

    try {
      const stats = fs.statSync(path.join(candidate, 'package.json'), {
        throwIfNoEntry: false,
      });
      if (stats !== undefined && stats.isFile()) {
        return { outcome: found(candidate), searched };
      }
    } catch (error) {
      return {
        outcome: failed({
          kind: 'unreadable-directory',
          message: `Cannot look for the dependency "${dependencyName}" in ${candidate}`,
          path: candidate,
          dependency: dependencyName,
          code: errorCode(error),
          hint: 'check that the path is readable; the dependency could not be checked',
        }),
        searched,
      };
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return { outcome: missing(), searched };
    }
    current = parent;
  }
}

/** A dependency of a package, and whether the package cannot work without it. */
interface DeclaredDependency {
  name: string;
  /**
   * A mandatory dependency is part of what the project ships and must be checked. Optional
   * dependencies and peer dependencies may legitimately not be installed - a platform
   * specific binary for another operating system, or a peer the application provides itself -
   * and are then simply not part of the tree.
   */
  mandatory: boolean;
}

function productionDependencies(
  manifest: PackageManifest,
  isRoot: boolean
): DeclaredDependency[] {
  const optional = new Set(Object.keys(manifest.optionalDependencies ?? {}));
  const declared = new Map<string, DeclaredDependency>();

  for (const name of Object.keys(manifest.dependencies ?? {})) {
    declared.set(name, { name, mandatory: !optional.has(name) });
  }
  for (const name of optional) {
    declared.set(name, { name, mandatory: false });
  }
  if (!isRoot) {
    for (const name of Object.keys(manifest.peerDependencies ?? {})) {
      if (
        manifest.peerDependenciesMeta?.[name]?.optional !== true &&
        !declared.has(name)
      ) {
        declared.set(name, { name, mandatory: false });
      }
    }
  }

  return [...declared.values()];
}

/** Walks the production dependency graph of the project. */
function scanProduction(
  start: string,
  rootManifest: PackageManifest,
  diagnostics: ScanDiagnostics
): ScannedPackage[] {
  const found = new Map<string, ScannedPackage>();
  const visited = new Set<string>();
  const queue: Array<{
    packagePath: string;
    manifest: PackageManifest;
    isRoot: boolean;
  }> = [{ packagePath: start, manifest: rootManifest, isRoot: true }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      break;
    }

    const realPath = realPathOf(current.packagePath);
    if (realPath.status !== 'found') {
      if (realPath.status === 'failed') {
        diagnostics.record(realPath.error);
      }
      continue;
    }
    if (visited.has(realPath.value)) {
      continue;
    }
    visited.add(realPath.value);

    const scanned = toScannedPackage(
      current.manifest,
      current.packagePath,
      current.isRoot,
      diagnostics
    );
    found.set(scanned.key, scanned);

    for (const dependency of productionDependencies(
      current.manifest,
      current.isRoot
    )) {
      const { outcome, searched } = resolveDependency(
        current.packagePath,
        dependency.name,
        start
      );

      if (outcome.status === 'failed') {
        diagnostics.record({
          ...outcome.error,
          requiredBy: scanned.key,
          requiredByPath: current.packagePath,
        });
        continue;
      }

      if (outcome.status === 'missing') {
        if (dependency.mandatory) {
          diagnostics.record({
            kind: 'unresolved-dependency',
            message: `Cannot find the dependency "${dependency.name}" required by ${scanned.key}`,
            path: current.packagePath,
            dependency: dependency.name,
            requiredBy: scanned.key,
            requiredByPath: current.packagePath,
            searched,
            hint: `"${dependency.name}" is a mandatory dependency, so it is part of what the project ships and its license must be checked; ${INSTALL_HINT}`,
          });
        }
        continue;
      }

      const manifest = readManifest(outcome.value);
      if (manifest.status === 'failed') {
        diagnostics.record({
          ...manifest.error,
          dependency: dependency.name,
          requiredBy: scanned.key,
          requiredByPath: current.packagePath,
        });
        continue;
      }
      if (manifest.status === 'missing') {
        diagnostics.record({
          kind: 'unreadable-manifest',
          message: `The installed dependency "${dependency.name}" required by ${scanned.key} has no package.json`,
          path: outcome.value,
          dependency: dependency.name,
          requiredBy: scanned.key,
          requiredByPath: current.packagePath,
          hint: `the directory ${outcome.value} exists but does not contain a package.json, so the package could not be identified; ${INSTALL_HINT}`,
        });
        continue;
      }

      queue.push({
        packagePath: outcome.value,
        manifest: manifest.value,
        isRoot: false,
      });
    }
  }

  return [...found.values()];
}

/** Walks every package installed below `node_modules`, including nested ones. */
function scanEverything(
  start: string,
  rootManifest: PackageManifest,
  diagnostics: ScanDiagnostics
): ScannedPackage[] {
  const collected = new Map<string, ScannedPackage>();
  const visited = new Set<string>();

  const rootPackage = toScannedPackage(rootManifest, start, true, diagnostics);
  collected.set(rootPackage.key, rootPackage);

  const queue: string[] = [path.join(start, 'node_modules')];
  while (queue.length > 0) {
    const nodeModulesPath = queue.shift();
    if (nodeModulesPath === undefined) {
      break;
    }

    for (const packagePath of listPackageDirectories(
      nodeModulesPath,
      diagnostics
    )) {
      const realPath = realPathOf(packagePath);
      if (realPath.status !== 'found') {
        if (realPath.status === 'failed') {
          diagnostics.record(realPath.error);
        }
        continue;
      }
      if (visited.has(realPath.value)) {
        continue;
      }
      visited.add(realPath.value);

      const manifest = readManifest(packagePath);
      if (manifest.status === 'failed') {
        diagnostics.record(manifest.error);
        continue;
      }
      if (manifest.status === 'missing') {
        diagnostics.record({
          kind: 'unreadable-manifest',
          message: `The installed package directory ${packagePath} has no package.json`,
          path: packagePath,
          hint: `the directory exists below node_modules but does not contain a package.json, so it could not be identified; ${INSTALL_HINT}`,
        });
        continue;
      }

      const scanned = toScannedPackage(
        manifest.value,
        packagePath,
        false,
        diagnostics
      );
      if (!collected.has(scanned.key)) {
        collected.set(scanned.key, scanned);
      }

      queue.push(path.join(packagePath, 'node_modules'));
    }
  }

  return [...collected.values()];
}

/**
 * Reports the common case of a project whose dependencies were never installed as one clear
 * error, instead of one unresolved dependency after another.
 */
function dependenciesInstalled(
  start: string,
  rootManifest: PackageManifest,
  diagnostics: ScanDiagnostics
): boolean {
  const declaredCount =
    Object.keys(rootManifest.dependencies ?? {}).length +
    Object.keys(rootManifest.devDependencies ?? {}).length +
    Object.keys(rootManifest.optionalDependencies ?? {}).length;
  if (declaredCount === 0) {
    return true;
  }

  const nodeModulesPath = path.join(start, 'node_modules');
  let stats: fs.Stats | undefined;
  try {
    stats = fs.statSync(nodeModulesPath, { throwIfNoEntry: false });
  } catch (error) {
    diagnostics.record({
      kind: 'unreadable-directory',
      message: `Cannot read the node_modules directory ${nodeModulesPath}`,
      path: nodeModulesPath,
      code: errorCode(error),
      hint: 'no dependency could be checked; check that the path is a readable directory',
    });
    return false;
  }

  if (stats === undefined) {
    diagnostics.record({
      kind: 'dependencies-not-installed',
      message: `The dependencies of ${rootManifest.name} are not installed: ${nodeModulesPath} does not exist`,
      path: nodeModulesPath,
      hint: `${declaredCount} dependencies are declared but none is installed, so nothing could be checked; ${INSTALL_HINT}`,
    });
    return false;
  }

  return true;
}

/** Scans the installed packages of a project. */
export function scanPackages(options: ScanOptions): ScanResult {
  const start = path.resolve(options.start);
  const diagnostics = new ScanDiagnostics();

  const rootManifest = readManifest(start);
  if (rootManifest.status === 'missing') {
    throw new Error(`No package.json found in ${start}`);
  }
  if (rootManifest.status === 'failed') {
    throw new Error(rootManifest.error.message);
  }

  const packages = dependenciesInstalled(start, rootManifest.value, diagnostics)
    ? options.production
      ? scanProduction(start, rootManifest.value, diagnostics)
      : scanEverything(start, rootManifest.value, diagnostics)
    : [toScannedPackage(rootManifest.value, start, true, diagnostics)];

  const filtered = options.excludePrivatePackages
    ? packages.filter(scanned => !scanned.private)
    : packages;

  return {
    packages: filtered.sort((left, right) => left.key.localeCompare(right.key)),
    errors: [...diagnostics.errors],
  };
}
