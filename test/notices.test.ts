import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';

import { main } from '../src/cli';
import { resolveConfig } from '../src/config';
import { findLicenseDocuments } from '../src/license-detection';
import { renderNotices, type NoticeOutput } from '../src/notices';
import type { ResolvedConfig } from '../src/types';

const FIXTURE_PROJECT = path.join(
  __dirname,
  '..',
  '..',
  'test',
  'fixtures',
  'project'
);

function configure(
  notices: Partial<ResolvedConfig['notices']> = {}
): ResolvedConfig {
  const base = resolveConfig({ start: FIXTURE_PROJECT });
  return { ...base, notices: { ...base.notices, ...notices } };
}

function fileOf(output: NoticeOutput, relativePath: string) {
  return output.files.find(file => file.relativePath === relativePath);
}

function packagePath(name: string): string {
  return path.join(FIXTURE_PROJECT, 'node_modules', name);
}

describe('findLicenseDocuments', () => {
  /**
   * Packages spell these files in every casing. A fixed, case sensitive list silently misses
   * the ones that do not match it, and the package then looks unlicensed.
   */
  it('finds a lower case license file', () => {
    assert.deepEqual(findLicenseDocuments(packagePath('lowercase-license')), [
      { fileName: 'license', kind: 'license' },
    ]);
  });

  it('finds a license file with a markdown extension', () => {
    assert.deepEqual(
      findLicenseDocuments(packagePath('uppercase-license-md')),
      [{ fileName: 'LICENSE.md', kind: 'license' }]
    );
  });

  it('finds the license and the notice file of a package', () => {
    assert.deepEqual(findLicenseDocuments(packagePath('notice-shipping')), [
      { fileName: 'LICENSE', kind: 'license' },
      { fileName: 'NOTICE', kind: 'notice' },
    ]);
  });

  it('does not mistake data files for license documents', () => {
    assert.deepEqual(findLicenseDocuments(packagePath('data-file-decoy')), []);
  });

  it('returns nothing for a package without any license document', () => {
    assert.deepEqual(findLicenseDocuments(packagePath('no-metadata')), []);
  });
});

describe('renderNotices, license identifiers only', () => {
  it('lists every dependency but not the project itself', () => {
    const { markdown } = renderNotices(configure({ texts: 'none' }));
    assert.match(
      markdown,
      /^ - \*\*\[plain-mit\]\(https:\/\/github\.com\/example\/plain-mit\)\*\*$/m
    );
    assert.match(markdown, /^ {4}- licenses: MIT$/m);
    assert.doesNotMatch(markdown, /fixture-project/);
  });

  it('falls back to a plain entry when a package declares no repository', () => {
    const { markdown } = renderNotices(configure({ texts: 'none' }));
    assert.match(markdown, /^ - \*\*no-metadata\*\*$/m);
    assert.match(markdown, /^ {4}- licenses: UNKNOWN$/m);
  });

  it('writes no files and references no texts', () => {
    const output = renderNotices(configure({ texts: 'none' }));
    assert.equal(output.files.length, 0);
    assert.doesNotMatch(output.markdown, /text:/);
  });
});

describe('renderNotices, license texts in a folder', () => {
  /**
   * MIT requires its permission notice to be included in all copies and BSD requires the
   * copyright notice to be reproduced, so the copy has to be the original file unchanged.
   */
  it('copies the license file byte for byte', () => {
    const output = renderNotices(configure({ texts: 'folder' }));
    const copied = fileOf(output, 'third-party-licenses/plain-mit/LICENSE');
    assert.ok(copied !== undefined, 'the license file was not copied');
    assert.deepEqual(
      copied.content,
      fs.readFileSync(path.join(packagePath('plain-mit'), 'LICENSE'))
    );

    const lowerCased = fileOf(
      output,
      'third-party-licenses/lowercase-license/license'
    );
    assert.ok(
      lowerCased !== undefined,
      'the lower case license was not copied'
    );
    assert.deepEqual(
      lowerCased.content,
      fs.readFileSync(path.join(packagePath('lowercase-license'), 'license'))
    );
  });

  it('copies the notice file next to the license file', () => {
    const output = renderNotices(configure({ texts: 'folder' }));
    const license = fileOf(
      output,
      'third-party-licenses/notice-shipping/LICENSE'
    );
    const notice = fileOf(
      output,
      'third-party-licenses/notice-shipping/NOTICE'
    );
    assert.ok(license !== undefined, 'the license file was not copied');
    assert.ok(notice !== undefined, 'the notice file was not copied');
    assert.deepEqual(
      notice.content,
      fs.readFileSync(path.join(packagePath('notice-shipping'), 'NOTICE'))
    );
    assert.match(
      output.markdown,
      /^ {4}- notice text: third-party-licenses\/notice-shipping\/NOTICE$/m
    );
  });

  it('replaces the scope separator in the directory name', () => {
    const output = renderNotices(
      configure({ texts: 'folder', production: false })
    );
    assert.ok(
      output.files.every(file => !file.relativePath.includes('@scope/widget')),
      'the scope separator must not create a directory level'
    );
  });

  it('marks a package that ships no license text instead of inventing one', () => {
    const output = renderNotices(configure({ texts: 'folder' }));
    assert.match(output.markdown, /^ {4}- text: not shipped by the package$/m);
    assert.ok(
      output.files.every(file => !file.relativePath.includes('no-metadata')),
      'no text may be written for a package that ships none'
    );
  });

  it('honours a configured texts directory', () => {
    const output = renderNotices(
      configure({ texts: 'folder', textsDir: 'licenses' })
    );
    assert.ok(
      output.files.every(file => file.relativePath.startsWith('licenses/')),
      'the configured directory was not used'
    );
  });

  /** Development tooling is never redistributed, so it carries no attribution obligation. */
  it('collects texts for production dependencies only', () => {
    const output = renderNotices(
      configure({ texts: 'folder', production: false })
    );
    assert.match(output.markdown, /^ - \*\*dev-only\*\*$/m);
    assert.ok(
      output.files.every(file => !file.relativePath.includes('dev-only')),
      'a development dependency must not contribute a license text'
    );
    assert.ok(
      output.files.some(file => file.relativePath.includes('plain-mit')),
      'a production dependency must contribute its license text'
    );
  });
});

describe('renderNotices, license texts inline', () => {
  it('inlines the license text below the index', () => {
    const { markdown, files } = renderNotices(configure({ texts: 'inline' }));
    assert.equal(files.length, 0);
    assert.match(markdown, /^# License texts$/m);
    assert.match(markdown, /^## lowercase-license$/m);
    assert.match(markdown, /Copyright \(c\) 2026 Lowercase Example/);
  });

  it('does not let a fence inside a license text end the block', () => {
    const { markdown } = renderNotices(configure({ texts: 'inline' }));
    const section = markdown.slice(markdown.indexOf('## fenced-license'));
    assert.match(section, /^````text$/m);
    assert.match(section, /const value = 1;/);
  });
});

describe('notice scope from the command line', () => {
  /** Without this the notice file silently covers the whole development tree. */
  it('applies --production and --exclude-private to the notices', () => {
    const config = resolveConfig({
      start: FIXTURE_PROJECT,
      production: true,
      excludePrivatePackages: true,
    });
    assert.equal(config.notices.production, true);
    assert.equal(config.notices.excludePrivatePackages, true);

    const { markdown } = renderNotices(config);
    assert.doesNotMatch(markdown, /^ - \*\*dev-only\*\*$/m);
    assert.match(markdown, /^ - \*\*\[plain-mit\]/m);
  });

  it('lets a notice specific setting win over the general flag', () => {
    const base = resolveConfig({ start: FIXTURE_PROJECT, production: true });
    const config: ResolvedConfig = {
      ...base,
      notices: { ...base.notices, production: false },
    };
    const { markdown } = renderNotices(config);
    assert.match(markdown, /^ - \*\*dev-only\*\*$/m);
  });
});

describe('dependency versions in the index', () => {
  /**
   * A notice file is an attribution document, not an inventory. Naming the versions would
   * make every dependency update rewrite it without changing what is attributed.
   */
  it('names the dependencies without their version by default', () => {
    const { markdown } = renderNotices(configure({ texts: 'none' }));
    assert.doesNotMatch(markdown, /plain-mit@1\.2\.3/);
    assert.doesNotMatch(markdown, /^ {4}- version:/m);
    assert.match(markdown, /^ - \*\*\[plain-mit\]/m);
  });

  it('names the versions when the project asks for them', () => {
    const { markdown } = renderNotices(
      configure({ texts: 'none', includeVersions: true, fields: ['version'] })
    );
    assert.match(markdown, /^ - \*\*\[plain-mit@1\.2\.3\]/m);
    assert.match(markdown, /^ {4}- version: 1\.2\.3$/m);
  });

  it('keeps the copied text paths free of versions', () => {
    const output = renderNotices(configure({ texts: 'folder' }));
    assert.ok(
      output.files.every(file => !/@\d/.test(file.relativePath)),
      'a version in the path would rewrite every text on an update'
    );
  });
});

describe('the notices command', () => {
  function withTemporaryProject<T>(run: (projectPath: string) => T): T {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'jeap-notices-'));
    try {
      fs.cpSync(FIXTURE_PROJECT, temporary, { recursive: true });
      return run(temporary);
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }

  it('writes the notice file and the license texts', () => {
    withTemporaryProject(projectPath => {
      const code = main([
        'notices',
        '--start',
        projectPath,
        '--out',
        'THIRD-PARTY-LICENSES.md',
        '--quiet',
      ]);
      assert.equal(code, 0);

      const notices = fs.readFileSync(
        path.join(projectPath, 'THIRD-PARTY-LICENSES.md'),
        'utf8'
      );
      assert.match(notices, /third-party-licenses\/plain-mit\//);
      assert.ok(
        fs.existsSync(
          path.join(
            projectPath,
            'third-party-licenses',
            'notice-shipping',
            'NOTICE'
          )
        ),
        'the notice file was not written'
      );
    });
  });

  /** A dependency that is gone must not leave its license text behind. */
  it('removes texts of dependencies that are no longer installed', () => {
    withTemporaryProject(projectPath => {
      main([
        'notices',
        '--start',
        projectPath,
        '--out',
        'THIRD-PARTY-LICENSES.md',
        '--quiet',
      ]);
      const staleDirectory = path.join(
        projectPath,
        'third-party-licenses',
        'removed-package'
      );
      fs.mkdirSync(staleDirectory, { recursive: true });
      fs.writeFileSync(path.join(staleDirectory, 'LICENSE'), 'stale');

      main([
        'notices',
        '--start',
        projectPath,
        '--out',
        'THIRD-PARTY-LICENSES.md',
        '--quiet',
      ]);
      assert.ok(
        !fs.existsSync(staleDirectory),
        'the stale license text was not removed'
      );
      assert.ok(
        fs.existsSync(
          path.join(projectPath, 'third-party-licenses', 'plain-mit')
        ),
        'the current license texts were not rewritten'
      );
    });
  });

  it('refuses a texts directory outside the project', () => {
    withTemporaryProject(projectPath => {
      const code = main([
        'notices',
        '--start',
        projectPath,
        '--out',
        'THIRD-PARTY-LICENSES.md',
        '--texts-dir',
        '../escaped',
        '--quiet',
      ]);
      assert.equal(code, 2);
      assert.ok(
        !fs.existsSync(path.join(projectPath, '..', 'escaped')),
        'nothing may be written outside the project'
      );
    });
  });

  it('refuses the folder layout without an output file', () => {
    assert.equal(main(['notices', '--start', FIXTURE_PROJECT]), 2);
  });

  it('rejects an unknown texts mode', () => {
    assert.equal(
      main(['notices', '--start', FIXTURE_PROJECT, '--texts', 'nope']),
      2
    );
  });
});
