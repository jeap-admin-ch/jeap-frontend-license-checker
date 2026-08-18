import assert from 'node:assert/strict';
import * as path from 'node:path';
import { describe, it } from 'node:test';

import { check } from '../src/check';
import { resolveConfig } from '../src/config';
import { renderNotices } from '../src/notices';
import { renderJson, renderText } from '../src/report';
import type { CheckResult, ResolvedConfig, Verdict } from '../src/types';

const FIXTURE_PROJECT = path.join(
  __dirname,
  '..',
  '..',
  'test',
  'fixtures',
  'project'
);

function configure(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return { ...resolveConfig({ start: FIXTURE_PROJECT }), ...overrides };
}

function verdictOf(result: CheckResult, key: string): Verdict {
  const found = result.packages.find(item => item.package.key === key);
  if (found === undefined) {
    throw new Error(`package ${key} was not scanned`);
  }
  return found.verdict;
}

describe('check', () => {
  it('accepts packages whose declared license is in the policy', () => {
    const result = check(configure());
    assert.equal(verdictOf(result, 'plain-mit@1.2.3').kind, 'allowed');
    assert.equal(verdictOf(result, 'and-licensed@2.0.0').kind, 'allowed');
  });

  it('scans nested node_modules directories', () => {
    const result = check(configure());
    assert.equal(verdictOf(result, 'nested-child@5.0.0').kind, 'allowed');
  });

  it('includes the project itself and accepts its declared license', () => {
    const result = check(configure());
    assert.equal(verdictOf(result, 'fixture-project@1.0.0').kind, 'allowed');
  });

  it('detects the license from the file referenced by SEE LICENSE IN', () => {
    const result = check(configure());
    const item = result.packages.find(
      entry => entry.package.key === 'license-file-only@8.0.0'
    );
    assert.equal(item?.package.license, 'MIT');
    assert.equal(item?.package.licenseSource, 'license-file');
    assert.equal(item?.verdict.kind, 'allowed');
  });

  it('reads the legacy licenses array as a choice between alternatives', () => {
    const result = check(configure());
    const item = result.packages.find(
      entry => entry.package.key === 'legacy-array@0.1.0'
    );
    assert.equal(item?.package.license, '(MIT OR GPL-2.0)');
  });

  /**
   * A free-form claim such as "Public Domain" is not an SPDX license: what it grants has to
   * be established per package, so it must not pass through the policy on its own.
   */
  it('reports a free-form public domain claim as a problem', () => {
    const result = check(configure());
    assert.deepEqual(verdictOf(result, 'public-domain-claim@0.0.1'), {
      kind: 'problem',
      cause: 'not-allowed',
    });
  });

  it('accepts a free-form public domain claim through an exception for that package', () => {
    const result = check(
      configure({
        exceptions: {
          'public-domain-claim@*': {
            reason: 'Public domain dedication by the author.',
          },
        },
      })
    );
    assert.equal(
      verdictOf(result, 'public-domain-claim@0.0.1').kind,
      'exception'
    );
  });

  it('reports a package without any license information as a problem', () => {
    const result = check(configure());
    assert.deepEqual(verdictOf(result, 'no-metadata@3.0.0'), {
      kind: 'problem',
      cause: 'unknown',
    });
  });

  it('accepts a dual licensed package by its permissive alternative and reports the choice', () => {
    const result = check(configure());
    const verdict = verdictOf(result, 'dual-copyleft@1.3.1');
    assert.equal(verdict.kind, 'dual-license-choice');
    assert.deepEqual(
      verdict.kind === 'dual-license-choice' ? verdict.rejected : [],
      ['GPL-2.0']
    );
    assert.equal(result.ok, false, 'the fixture still has genuine problems');
  });

  it('turns a dual licensed package into a problem when the choice must be explicit', () => {
    const result = check(configure({ allowDualLicenseChoice: false }));
    assert.deepEqual(verdictOf(result, 'dual-copyleft@1.3.1'), {
      kind: 'problem',
      cause: 'denied',
    });
  });

  /**
   * The regression this tool exists for: an exempted scoped package must stay exempted
   * after a version bump.
   */
  it('keeps a scoped package exempted across a version bump', () => {
    const result = check(
      configure({
        exceptions: {
          '@scope/widget@*': { reason: 'No SPDX metadata published.' },
        },
      })
    );
    assert.deepEqual(verdictOf(result, '@scope/widget@20.35.0'), {
      kind: 'exception',
      exceptionKey: '@scope/widget@*',
      reason: 'No SPDX metadata published.',
    });
  });

  it('reports exceptions that no longer match an installed package', () => {
    const result = check(
      configure({
        exceptions: {
          'no-metadata@*': { reason: 'Needed.' },
          'removed-package@1.0.0': { reason: 'Stale.' },
        },
      })
    );
    assert.deepEqual(result.unusedExceptionKeys, ['removed-package@1.0.0']);
    assert.equal(result.ok, false);
  });

  it('does not fail on unused exceptions when that is switched off', () => {
    const result = check(
      configure({
        exceptions: {
          'no-metadata@*': { reason: 'Needed.' },
          '@scope/widget@*': { reason: 'Needed.' },
          'dual-copyleft@*': { reason: 'Needed.' },
          'public-domain-claim@*': { reason: 'Needed.' },
          'removed-package@1.0.0': { reason: 'Stale.' },
        },
        failOnUnusedExceptions: false,
      })
    );
    assert.deepEqual(result.unusedExceptionKeys, ['removed-package@1.0.0']);
    assert.equal(result.ok, true);
  });

  it('passes when every problem is covered by an exception', () => {
    const result = check(
      configure({
        exceptions: {
          '@scope/*': { reason: 'Internal packages without SPDX metadata.' },
          'no-metadata@3.0.0': { reason: 'No metadata published.' },
          'dual-copyleft@*': {
            reason: 'Permissive alternative chosen deliberately.',
          },
          'legacy-array@*': {
            reason: 'Permissive alternative chosen deliberately.',
          },
          'public-domain-claim@*': {
            reason: 'Public domain dedication by the author.',
          },
        },
        allowDualLicenseChoice: false,
      })
    );
    assert.equal(result.ok, true);
  });

  it('leaves development dependencies out in production mode', () => {
    const all = check(configure());
    assert.ok(all.packages.some(item => item.package.name === 'dev-only'));

    const production = check(configure({ production: true }));
    assert.ok(
      !production.packages.some(item => item.package.name === 'dev-only')
    );
    assert.ok(
      production.packages.some(item => item.package.name === 'plain-mit')
    );
  });

  it('skips private packages when asked to', () => {
    const result = check(configure({ excludePrivatePackages: true }));
    assert.ok(
      !result.packages.some(item => item.package.name === 'fixture-project')
    );
  });

  it('counts every scanned package by its license', () => {
    const result = check(configure());
    assert.equal(result.licenseCounts['UNKNOWN'], 2);
    assert.equal(result.licenseCounts['MIT'], 3);
  });
});

describe('report', () => {
  it('renders the sections of a failing check', () => {
    const text = renderText(check(configure()));
    assert.match(text, /Dependency licenses in use:/);
    assert.match(text, /Accepted by choosing a permissive alternative/);
    assert.match(text, /Problems with the licenses of these dependencies:/);
    assert.match(text, /Licenses not ok/);
  });

  it('renders a machine readable result', () => {
    const parsed = JSON.parse(renderJson(check(configure()))) as {
      ok: boolean;
      packages: Array<{ key: string }>;
    };
    assert.equal(parsed.ok, false);
    assert.ok(parsed.packages.some(item => item.key === 'plain-mit@1.2.3'));
  });
});

describe('notices', () => {
  it('lists every dependency but not the project itself', () => {
    const notices = renderNotices(configure());
    assert.match(
      notices,
      /^ - \*\*\[plain-mit@1\.2\.3\]\(https:\/\/github\.com\/example\/plain-mit\)\*\*$/m
    );
    assert.match(notices, /^ {4}- licenses: MIT$/m);
    assert.doesNotMatch(notices, /fixture-project/);
  });

  it('falls back to a plain entry when a package declares no repository', () => {
    const notices = renderNotices(configure());
    assert.match(notices, /^ - \*\*no-metadata@3\.0\.0\*\*$/m);
    assert.match(notices, /^ {4}- licenses: UNKNOWN$/m);
  });
});
