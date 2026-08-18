/**
 * Discovery of the installed packages of a project.
 *
 * The scan walks `node_modules` directly instead of the lock file, so it sees exactly what
 * is installed, including nested duplicates and hoisted transitive dependencies. Symlinked
 * packages (workspaces, `npm link`) are followed once, guarded by their real path.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { detectLicense, type PackageManifest } from './license-detection';
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

function readManifest(packagePath: string): PackageManifest | undefined {
  try {
    const content = fs.readFileSync(
      path.join(packagePath, 'package.json'),
      'utf8'
    );
    const parsed: unknown = JSON.parse(content);
    if (parsed === null || typeof parsed !== 'object') {
      return undefined;
    }
    return parsed as PackageManifest;
  } catch {
    return undefined;
  }
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
  fallbackName: string,
  isRoot: boolean
): ScannedPackage {
  const name = typeof manifest.name === 'string' ? manifest.name : fallbackName;
  const version =
    typeof manifest.version === 'string' ? manifest.version : '0.0.0';
  const detected = detectLicense(manifest, packagePath);

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

/** Lists the package directories directly contained in a `node_modules` directory. */
function listPackageDirectories(nodeModulesPath: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(nodeModulesPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const directories: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }
    if (!entry.isDirectory() && !entry.isSymbolicLink()) {
      continue;
    }

    const entryPath = path.join(nodeModulesPath, entry.name);
    if (entry.name.startsWith('@')) {
      // A scope directory holds the actual packages one level deeper.
      let scopedEntries: fs.Dirent[];
      try {
        scopedEntries = fs.readdirSync(entryPath, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const scopedEntry of scopedEntries) {
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

/**
 * Resolves a dependency name from a starting directory the way Node does: the nearest
 * `node_modules` wins, then each parent directory is tried in turn.
 */
function resolveDependency(
  fromPath: string,
  dependencyName: string,
  rootPath: string
): string | undefined {
  let current = fromPath;
  for (;;) {
    const candidate = path.join(current, 'node_modules', dependencyName);
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current || !current.startsWith(rootPath)) {
      return undefined;
    }
    current = parent;
  }
}

function productionDependencyNames(
  manifest: PackageManifest,
  isRoot: boolean
): string[] {
  const names = new Set<string>(Object.keys(manifest.dependencies ?? {}));
  for (const name of Object.keys(manifest.optionalDependencies ?? {})) {
    names.add(name);
  }
  if (!isRoot) {
    // A dependency's peer dependencies are part of the shipped product as well, as long as
    // they are actually installed. Optional peers are skipped.
    for (const name of Object.keys(manifest.peerDependencies ?? {})) {
      if (manifest.peerDependenciesMeta?.[name]?.optional !== true) {
        names.add(name);
      }
    }
  }
  return [...names];
}

/** Walks the production dependency graph of the project. */
function scanProduction(
  start: string,
  rootManifest: PackageManifest
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

    let realPath: string;
    try {
      realPath = fs.realpathSync(current.packagePath);
    } catch {
      realPath = current.packagePath;
    }
    if (visited.has(realPath)) {
      continue;
    }
    visited.add(realPath);

    const scanned = toScannedPackage(
      current.manifest,
      current.packagePath,
      path.basename(current.packagePath),
      current.isRoot
    );
    found.set(scanned.key, scanned);

    for (const dependencyName of productionDependencyNames(
      current.manifest,
      current.isRoot
    )) {
      const dependencyPath = resolveDependency(
        current.packagePath,
        dependencyName,
        start
      );
      if (dependencyPath === undefined) {
        continue;
      }
      const manifest = readManifest(dependencyPath);
      if (manifest !== undefined) {
        queue.push({ packagePath: dependencyPath, manifest, isRoot: false });
      }
    }
  }

  return [...found.values()];
}

/** Walks every package installed below `node_modules`, including nested ones. */
function scanEverything(
  start: string,
  rootManifest: PackageManifest
): ScannedPackage[] {
  const found = new Map<string, ScannedPackage>();
  const visited = new Set<string>();

  const rootPackage = toScannedPackage(
    rootManifest,
    start,
    path.basename(start),
    true
  );
  found.set(rootPackage.key, rootPackage);

  const queue: string[] = [path.join(start, 'node_modules')];
  while (queue.length > 0) {
    const nodeModulesPath = queue.shift();
    if (nodeModulesPath === undefined) {
      break;
    }

    for (const packagePath of listPackageDirectories(nodeModulesPath)) {
      let realPath: string;
      try {
        realPath = fs.realpathSync(packagePath);
      } catch {
        continue;
      }
      if (visited.has(realPath)) {
        continue;
      }
      visited.add(realPath);

      const manifest = readManifest(packagePath);
      if (manifest === undefined) {
        continue;
      }

      const scanned = toScannedPackage(
        manifest,
        packagePath,
        path.basename(packagePath),
        false
      );
      if (!found.has(scanned.key)) {
        found.set(scanned.key, scanned);
      }

      queue.push(path.join(packagePath, 'node_modules'));
    }
  }

  return [...found.values()];
}

/** Scans the installed packages of a project. */
export function scanPackages(options: ScanOptions): ScannedPackage[] {
  const start = path.resolve(options.start);
  const rootManifest = readManifest(start);
  if (rootManifest === undefined) {
    throw new Error(`No readable package.json found in ${start}`);
  }

  const packages = options.production
    ? scanProduction(start, rootManifest)
    : scanEverything(start, rootManifest);

  const filtered = options.excludePrivatePackages
    ? packages.filter(scanned => !scanned.private)
    : packages;

  return filtered.sort((left, right) => left.key.localeCompare(right.key));
}
