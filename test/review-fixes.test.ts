import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';

import { check } from '../src/check';
import { main } from '../src/cli';
import { resolveConfig } from '../src/config';
import { MAX_LICENSE_FILE_SIZE } from '../src/license-detection';
import { renderNotices } from '../src/notices';
import { renderText } from '../src/report';
import { scanPackages } from '../src/scan';

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jeap-fixes-'));

after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

/** Builds a project whose `node_modules` holds the given packages. */
function project(
  packages: Record<string, Record<string, string>>,
  manifest: Record<string, unknown> = {}
): string {
  const projectPath = fs.mkdtempSync(path.join(temporaryRoot, 'project-'));
  fs.writeFileSync(
    path.join(projectPath, 'package.json'),
    JSON.stringify({
      name: 'host',
      version: '1.0.0',
      license: 'MIT',
      dependencies: Object.fromEntries(
        Object.keys(packages).map(name => [name, '1.0.0'])
      ),
      ...manifest,
    })
  );
  for (const [directory, files] of Object.entries(packages)) {
    const packagePath = path.join(projectPath, 'node_modules', directory);
    fs.mkdirSync(packagePath, { recursive: true });
    for (const [fileName, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(packagePath, fileName), content);
    }
  }
  return projectPath;
}

function manifestOf(name: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ name, version: '1.0.0', license: 'MIT', ...extra });
}

function noticesOf(projectPath: string) {
  return renderNotices(resolveConfig({ start: projectPath, production: true }));
}

describe('license texts are written only inside the texts directory', () => {
  /** The package name comes from third-party code, so it is treated as hostile input. */
  it('does not let a package called ".." escape the texts directory', () => {
    const projectPath = project({
      evil: { 'package.json': manifestOf('..'), LICENSE: 'EVIL' },
    });
    const output = noticesOf(projectPath);
    for (const file of output.files) {
      assert.ok(
        !file.relativePath.split('/').includes('..'),
        `the path ${file.relativePath} climbs out of the texts directory`
      );
    }
  });

  it('keeps a path separator in a package name from creating a directory level', () => {
    const projectPath = project({
      sneaky: {
        'package.json': manifestOf('a/../../b'),
        LICENSE: 'text',
      },
    });
    const output = noticesOf(projectPath);
    const written = output.files[0]!.relativePath;
    assert.ok(!written.includes('..'), written);
    assert.equal(written.split('/').length, 3, written);
    assert.equal(written, 'third-party-licenses/a__________b/LICENSE');
  });

  it('writes nothing outside the project when the notices are generated', () => {
    const projectPath = project({
      evil: { 'package.json': manifestOf('..'), LICENSE: 'EVIL' },
    });
    const guard = path.join(projectPath, '..', 'LICENSE');
    fs.writeFileSync(guard, 'ORIGINAL');

    assert.equal(
      main([
        'notices',
        '--start',
        projectPath,
        '--production',
        '--out',
        'THIRD-PARTY.md',
        '--quiet',
      ]),
      0
    );
    assert.equal(fs.readFileSync(guard, 'utf8'), 'ORIGINAL');
  });
});

describe('two installed versions of one package', () => {
  function twoVersions(): string {
    const projectPath = project({
      dup: { 'package.json': manifestOf('dup'), LICENSE: 'text of 1.0.0' },
      host: {
        'package.json': JSON.stringify({
          name: 'host-pkg',
          version: '1.0.0',
          license: 'MIT',
          dependencies: { dup: '2.0.0' },
        }),
      },
    });
    const nested = path.join(
      projectPath,
      'node_modules',
      'host',
      'node_modules',
      'dup'
    );
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(
      path.join(nested, 'package.json'),
      JSON.stringify({ name: 'dup', version: '2.0.0', license: 'MIT' })
    );
    fs.writeFileSync(path.join(nested, 'LICENSE'), 'text of 2.0.0');
    return projectPath;
  }

  /** Sharing a directory would attribute one version's copyright text to the other. */
  it('keeps their license texts apart', () => {
    const output = noticesOf(twoVersions());
    const paths = output.files
      .filter(file => file.relativePath.includes('dup'))
      .map(file => file.relativePath);
    assert.equal(new Set(paths).size, paths.length, paths.join(', '));
    assert.equal(paths.length, 2, paths.join(', '));

    const contents = output.files
      .filter(file => paths.includes(file.relativePath))
      .map(file => file.content.toString('utf8'));
    assert.ok(contents.includes('text of 1.0.0'));
    assert.ok(contents.includes('text of 2.0.0'));
  });

  it('leaves the path of a package installed once free of its version', () => {
    const output = noticesOf(twoVersions());
    const single = output.files.find(file =>
      file.relativePath.includes('host-pkg')
    );
    if (single !== undefined) {
      assert.ok(!/@\d/.test(single.relativePath), single.relativePath);
    }
  });
});

describe('the license texts directory belongs to the tool', () => {
  it('refuses to replace a directory it did not create', () => {
    const projectPath = project({
      plain: { 'package.json': manifestOf('plain'), LICENSE: 'text' },
    });
    const foreign = path.join(projectPath, 'third-party-licenses');
    fs.mkdirSync(foreign);
    fs.writeFileSync(path.join(foreign, 'keep-me.txt'), 'not ours');

    assert.equal(
      main([
        'notices',
        '--start',
        projectPath,
        '--production',
        '--out',
        'THIRD-PARTY.md',
        '--quiet',
      ]),
      2
    );
    assert.equal(
      fs.readFileSync(path.join(foreign, 'keep-me.txt'), 'utf8'),
      'not ours'
    );
  });

  it('rebuilds its own directory and marks it', () => {
    const projectPath = project({
      plain: { 'package.json': manifestOf('plain'), LICENSE: 'text' },
    });
    const run = (): number =>
      main([
        'notices',
        '--start',
        projectPath,
        '--production',
        '--out',
        'THIRD-PARTY.md',
        '--quiet',
      ]);

    assert.equal(run(), 0);
    const marker = path.join(
      projectPath,
      'third-party-licenses',
      '.jeap-license-texts'
    );
    assert.ok(fs.existsSync(marker), 'the directory must be marked as ours');

    const stale = path.join(projectPath, 'third-party-licenses', 'gone');
    fs.mkdirSync(stale);
    assert.equal(run(), 0);
    assert.equal(fs.existsSync(stale), false, 'stale texts must be removed');
    assert.ok(fs.existsSync(marker));
  });
});

describe('license texts that cannot be read', () => {
  it('is reported instead of claiming the package ships no text', () => {
    const projectPath = project({
      broken: { 'package.json': manifestOf('broken') },
    });
    fs.mkdirSync(path.join(projectPath, 'node_modules', 'broken', 'LICENSE'));

    const output = noticesOf(projectPath);
    assert.equal(output.scanErrors.length, 1);
    assert.equal(output.scanErrors[0]!.kind, 'unreadable-license-file');
    assert.doesNotMatch(output.markdown, /not shipped by the package/);
    assert.match(output.markdown, /- text: could not be read/);
  });

  it('is not copied when it is larger than the limit', () => {
    const projectPath = project({
      huge: {
        'package.json': manifestOf('huge'),
        LICENSE: 'x'.repeat(MAX_LICENSE_FILE_SIZE + 1),
      },
    });
    const output = noticesOf(projectPath);
    assert.equal(output.scanErrors[0]?.kind, 'unreadable-license-file');
    assert.equal(output.files.length, 0);
  });

  it('stops the notice file from being written', () => {
    const projectPath = project({
      broken: { 'package.json': manifestOf('broken') },
    });
    fs.mkdirSync(path.join(projectPath, 'node_modules', 'broken', 'LICENSE'));

    assert.equal(
      main([
        'notices',
        '--start',
        projectPath,
        '--production',
        '--out',
        'THIRD-PARTY.md',
        '--quiet',
      ]),
      3
    );
    assert.equal(
      fs.existsSync(path.join(projectPath, 'THIRD-PARTY.md')),
      false
    );
  });
});

describe('configuration values are refused when malformed', () => {
  function withConfig(config: unknown): string {
    const projectPath = project({});
    fs.writeFileSync(
      path.join(projectPath, 'jeap-license-check.json'),
      JSON.stringify(config)
    );
    return projectPath;
  }

  /** A string would spread into its characters and quietly produce a policy of nothing. */
  it('refuses a license list that is not an array', () => {
    assert.throws(
      () => resolveConfig({ start: withConfig({ allowLicenses: 'MIT' }) }),
      /must be an array of license identifiers/
    );
  });

  it('refuses an empty entry in a license list', () => {
    assert.throws(
      () =>
        resolveConfig({ start: withConfig({ denyLicenses: ['MIT', ' '] }) }),
      /must be an array of license identifiers/
    );
  });

  it('refuses a misspelled extends', () => {
    assert.throws(
      () =>
        resolveConfig({ start: withConfig({ extends: 'jeap-recommended' }) }),
      /must be "jeap:recommended" or null/
    );
    assert.doesNotThrow(() =>
      resolveConfig({ start: withConfig({ extends: null }) })
    );
  });

  it('refuses a flag that is not a boolean', () => {
    assert.throws(
      () => resolveConfig({ start: withConfig({ production: 'yes' }) }),
      /must be true or false/
    );
  });

  it('reports a configuration file that cannot be read', () => {
    const projectPath = project({});
    fs.mkdirSync(path.join(projectPath, 'jeap-license-check.json'));
    assert.throws(
      () => resolveConfig({ start: projectPath }),
      /Cannot (read|parse)/
    );
  });
});

describe('a dependency is never resolved from outside the project', () => {
  it('does not look above the project directory', () => {
    const outer = fs.mkdtempSync(path.join(temporaryRoot, 'outer-'));
    const outside = path.join(outer, 'node_modules', 'hoisted');
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(
      path.join(outside, 'package.json'),
      manifestOf('hoisted', { license: 'GPL-3.0' })
    );

    const projectPath = fs.mkdtempSync(path.join(outer, 'project-'));
    fs.writeFileSync(
      path.join(projectPath, 'package.json'),
      JSON.stringify({
        name: 'host',
        version: '1.0.0',
        license: 'MIT',
        dependencies: { hoisted: '1.0.0' },
      })
    );
    fs.mkdirSync(path.join(projectPath, 'node_modules'));

    const scan = scanPackages({
      start: projectPath,
      production: true,
      excludePrivatePackages: false,
    });
    assert.ok(
      !scan.packages.some(scanned => scanned.name === 'hoisted'),
      'a package outside the project must not be scanned'
    );
    assert.equal(scan.errors[0]?.kind, 'unresolved-dependency');
    for (const location of scan.errors[0]!.searched ?? []) {
      assert.ok(
        location.startsWith(projectPath),
        `${location} is outside the project`
      );
    }
  });
});

describe('the printed verdict agrees with the exit code', () => {
  it('says the licenses are ok when an incomplete scan is tolerated', () => {
    const projectPath = project({
      plain: { 'package.json': manifestOf('plain') },
    });
    fs.writeFileSync(
      path.join(projectPath, 'node_modules', 'plain', 'node_modules'),
      'not a directory'
    );

    const result = check(resolveConfig({ start: projectPath }));
    assert.equal(result.scanErrors.length, 1);

    const tolerated = renderText(result, { toleratedScanErrors: true });
    assert.match(tolerated, /All licenses ok/);
    assert.match(tolerated, /Passing anyway because --allow-incomplete-scan/);
    assert.match(renderText(result), /Licenses not ok/);
    assert.equal(main(['--start', projectPath, '--allow-incomplete-scan']), 0);
  });
});
