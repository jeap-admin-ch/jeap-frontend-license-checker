import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';

import { check } from '../src/check';
import { main } from '../src/cli';
import { resolveConfig } from '../src/config';
import type { ScanError, ScanErrorKind } from '../src/diagnostics';
import { renderNotices } from '../src/notices';
import { renderText } from '../src/report';
import { scanPackages } from '../src/scan';

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jeap-scan-'));

after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

/**
 * The failures below are provoked with the wrong file type rather than with `chmod`, so they
 * behave the same for a normal user and for root, which is what CI containers run as.
 */
interface ProjectLayout {
  manifest?: Record<string, unknown>;
  /** Installed packages, by name, each with the files it ships. */
  packages?: Record<string, Record<string, string> | null>;
  /** Paths, relative to the project, to create as an empty file instead of a directory. */
  filesInsteadOfDirectories?: string[];
  /** Paths, relative to the project, to create as a directory instead of a file. */
  directoriesInsteadOfFiles?: string[];
  /** Symlinks pointing at themselves, relative to the project. */
  selfSymlinks?: string[];
  /** Symlinks, relative to the project, to the given target path. */
  symlinks?: Record<string, string>;
}

function project(layout: ProjectLayout): string {
  const projectPath = fs.mkdtempSync(path.join(temporaryRoot, 'project-'));
  fs.writeFileSync(
    path.join(projectPath, 'package.json'),
    JSON.stringify(
      layout.manifest ?? { name: 'fixture', version: '1.0.0', license: 'MIT' }
    )
  );

  for (const [name, files] of Object.entries(layout.packages ?? {})) {
    const packagePath = path.join(projectPath, 'node_modules', name);
    fs.mkdirSync(packagePath, { recursive: true });
    if (files === null) {
      continue; // a directory below node_modules without any package.json
    }
    for (const [fileName, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(packagePath, fileName), content);
    }
  }

  for (const relative of layout.filesInsteadOfDirectories ?? []) {
    const target = path.join(projectPath, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.rmSync(target, { recursive: true, force: true });
    fs.writeFileSync(target, 'not a directory');
  }
  for (const relative of layout.directoriesInsteadOfFiles ?? []) {
    const target = path.join(projectPath, relative);
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true });
  }
  for (const [relative, target] of Object.entries(layout.symlinks ?? {})) {
    const link = path.join(projectPath, relative);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(path.join(projectPath, target), link);
  }
  for (const relative of layout.selfSymlinks ?? []) {
    const target = path.join(projectPath, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.symlinkSync(target, target);
  }

  return projectPath;
}

function packageManifest(
  name: string,
  extra: Record<string, unknown> = {}
): string {
  return JSON.stringify({ name, version: '1.0.0', license: 'MIT', ...extra });
}

function errorsOf(projectPath: string, production = false): ScanError[] {
  return scanPackages({
    start: projectPath,
    production,
    excludePrivatePackages: false,
  }).errors;
}

function kindsOf(errors: ScanError[]): ScanErrorKind[] {
  return errors.map(error => error.kind);
}

describe('a scan that cannot see everything', () => {
  it('reports an unreadable node_modules instead of finding nothing', () => {
    const projectPath = project({
      manifest: { name: 'fixture', version: '1.0.0', dependencies: { a: '1' } },
      filesInsteadOfDirectories: ['node_modules'],
    });
    const errors = errorsOf(projectPath);
    assert.deepEqual(kindsOf(errors), ['unreadable-directory']);
    assert.equal(errors[0]!.code, 'ENOTDIR');
    assert.match(errors[0]!.path, /node_modules$/);
  });

  it('reports an unreadable scope directory instead of skipping the whole scope', () => {
    const projectPath = project({
      packages: { plain: { 'package.json': packageManifest('plain') } },
      filesInsteadOfDirectories: ['node_modules/not-a-directory'],
      symlinks: { 'node_modules/@scope': 'node_modules/not-a-directory' },
    });
    const errors = errorsOf(projectPath);
    assert.deepEqual(kindsOf(errors), ['unreadable-directory']);
    assert.match(errors[0]!.message, /scope @scope/);
    assert.equal(errors[0]!.code, 'ENOTDIR');
  });

  it('reports an unreadable package manifest', () => {
    const projectPath = project({ packages: { broken: {} } });
    fs.mkdirSync(
      path.join(projectPath, 'node_modules', 'broken', 'package.json')
    );
    const errors = errorsOf(projectPath);
    assert.deepEqual(kindsOf(errors), ['unreadable-manifest']);
    assert.equal(errors[0]!.code, 'EISDIR');
  });

  it('reports an unparseable package manifest', () => {
    const projectPath = project({
      packages: { broken: { 'package.json': '{ not json' } },
    });
    const errors = errorsOf(projectPath);
    assert.deepEqual(kindsOf(errors), ['invalid-manifest']);
    assert.match(errors[0]!.message, /Cannot parse/);
  });

  /** Inventing a name or a 0.0.0 version would put a package into the report under an identity it does not have. */
  it('reports a manifest without a name or a version instead of inventing one', () => {
    const withoutName = project({
      packages: { anonymous: { 'package.json': '{"version":"1.0.0"}' } },
    });
    assert.match(errorsOf(withoutName)[0]!.message, /declares no name/);

    const withoutVersion = project({
      packages: { unversioned: { 'package.json': '{"name":"unversioned"}' } },
    });
    assert.match(errorsOf(withoutVersion)[0]!.message, /declares no version/);
  });

  it('reports a directory below node_modules that has no manifest', () => {
    const projectPath = project({ packages: { stray: null } });
    const errors = errorsOf(projectPath);
    assert.deepEqual(kindsOf(errors), ['unreadable-manifest']);
    assert.match(errors[0]!.message, /has no package.json/);
  });

  it('reports a package whose real path cannot be resolved', () => {
    const projectPath = project({
      packages: { plain: { 'package.json': packageManifest('plain') } },
      selfSymlinks: ['node_modules/looping'],
    });
    const errors = errorsOf(projectPath);
    assert.deepEqual(kindsOf(errors), ['unreadable-package']);
    assert.match(errors[0]!.message, /real path/);
  });

  it('reports an unreadable license file rather than a package that ships none', () => {
    const projectPath = project({
      manifest: {
        name: 'fixture',
        version: '1.0.0',
        dependencies: { nolicense: '1' },
      },
      packages: {
        nolicense: { 'package.json': '{"name":"nolicense","version":"1.0.0"}' },
      },
      directoriesInsteadOfFiles: ['node_modules/nolicense/LICENSE'],
    });
    const errors = errorsOf(projectPath);
    assert.deepEqual(kindsOf(errors), ['unreadable-license-file']);
  });

  /** ENOENT is an answer, not a failure: the package declares a file it does not ship. */
  it('does not report a license file that is simply not there', () => {
    const projectPath = project({
      packages: {
        declared: {
          'package.json': packageManifest('declared', {
            license: 'SEE LICENSE IN LICENSE',
          }),
        },
      },
    });
    assert.deepEqual(errorsOf(projectPath), []);
  });
});

describe('dependencies that were never examined', () => {
  it('reports a missing mandatory dependency with everything needed to fix it', () => {
    const projectPath = project({
      manifest: {
        name: 'fixture',
        version: '1.0.0',
        dependencies: { missing: '^1.0.0' },
      },
      packages: { other: { 'package.json': packageManifest('other') } },
    });
    const errors = errorsOf(projectPath, true);
    assert.deepEqual(kindsOf(errors), ['unresolved-dependency']);

    const error = errors[0]!;
    assert.equal(error.dependency, 'missing');
    assert.equal(error.requiredBy, 'fixture@1.0.0');
    assert.equal(error.requiredByPath, projectPath);
    assert.ok(
      error.searched!.some(location =>
        location.endsWith('node_modules/missing')
      ),
      'the searched locations must be named'
    );
    assert.match(error.hint!, /npm ci/);
  });

  /** A platform specific binary for another operating system is legitimately not installed. */
  it('does not report a missing optional dependency', () => {
    const projectPath = project({
      manifest: {
        name: 'fixture',
        version: '1.0.0',
        dependencies: { absent: '^1.0.0', plain: '^1.0.0' },
        optionalDependencies: { absent: '^1.0.0' },
      },
      packages: { plain: { 'package.json': packageManifest('plain') } },
    });
    assert.deepEqual(errorsOf(projectPath, true), []);
  });

  it('does not report a peer dependency that is not installed', () => {
    const projectPath = project({
      manifest: {
        name: 'fixture',
        version: '1.0.0',
        dependencies: { host: '^1.0.0' },
      },
      packages: {
        host: {
          'package.json': packageManifest('host', {
            peerDependencies: { absent: '^1.0.0' },
          }),
        },
      },
    });
    assert.deepEqual(errorsOf(projectPath, true), []);
  });

  it('reports uninstalled dependencies once instead of one error per dependency', () => {
    const projectPath = project({
      manifest: {
        name: 'fixture',
        version: '1.0.0',
        dependencies: { a: '1', b: '1', c: '1' },
      },
    });
    const errors = errorsOf(projectPath, true);
    assert.deepEqual(kindsOf(errors), ['dependencies-not-installed']);
    assert.match(errors[0]!.message, /are not installed/);
    assert.match(errors[0]!.hint!, /3 dependencies are declared/);
  });
});

describe('an incomplete scan fails the check', () => {
  function incompleteProject(): string {
    return project({
      manifest: { name: 'fixture', version: '1.0.0', license: 'MIT' },
      packages: { plain: { 'package.json': packageManifest('plain') } },
      filesInsteadOfDirectories: ['node_modules/plain/node_modules'],
    });
  }

  /** The regression this work exists for. */
  it('does not report all licenses ok when something could not be examined', () => {
    const result = check(resolveConfig({ start: incompleteProject() }));
    assert.equal(
      result.packages.every(item => item.verdict.kind !== 'problem'),
      true,
      'the packages that were examined are all fine'
    );
    assert.equal(result.scanErrors.length, 1);
    assert.equal(result.ok, false);
    assert.doesNotMatch(renderText(result), /All licenses ok/);
  });

  it('names the paths and the reason in the report', () => {
    const text = renderText(
      check(resolveConfig({ start: incompleteProject() }))
    );
    assert.match(text, /could not be scanned completely/);
    assert.match(text, /Kind: +unreadable-directory/);
    assert.match(text, /System error: +ENOTDIR/);
    assert.match(text, /What to do:/);
    assert.match(text, /Scan errors \(1\)/);
  });

  it('exits with 3, apart from a policy violation', () => {
    assert.equal(main(['--start', incompleteProject(), '--quiet']), 3);
  });

  it('still exits with 1 when the policy is violated as well', () => {
    const projectPath = project({
      packages: {
        forbidden: {
          'package.json': packageManifest('forbidden', { license: 'GPL-3.0' }),
        },
      },
      filesInsteadOfDirectories: ['node_modules/forbidden/node_modules'],
    });
    assert.equal(main(['--start', projectPath, '--quiet']), 1);
  });

  it('passes with --allow-incomplete-scan but still reports what was missed', () => {
    assert.equal(
      main(['--start', incompleteProject(), '--allow-incomplete-scan']),
      0
    );
  });

  it('writes no notices from an incomplete scan', () => {
    const projectPath = incompleteProject();
    const code = main([
      'notices',
      '--start',
      projectPath,
      '--out',
      'THIRD-PARTY-LICENSES.md',
      '--quiet',
    ]);
    assert.equal(code, 3);
    assert.equal(
      fs.existsSync(path.join(projectPath, 'THIRD-PARTY-LICENSES.md')),
      false,
      'a notice file from a partial scan would claim to be complete'
    );
  });

  it('carries the scan errors out of the notices as well', () => {
    const output = renderNotices(resolveConfig({ start: incompleteProject() }));
    assert.equal(output.scanErrors.length, 1);
  });
});

describe('a complete scan', () => {
  it('reports no errors for a healthy tree', () => {
    const projectPath = project({
      manifest: {
        name: 'fixture',
        version: '1.0.0',
        license: 'MIT',
        dependencies: { plain: '^1.0.0' },
      },
      packages: {
        plain: { 'package.json': packageManifest('plain'), LICENSE: 'MIT' },
      },
    });
    assert.deepEqual(errorsOf(projectPath), []);
    assert.deepEqual(errorsOf(projectPath, true), []);
    assert.equal(main(['--start', projectPath, '--quiet']), 0);
  });
});
