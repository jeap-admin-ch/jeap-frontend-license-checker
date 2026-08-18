import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveConfig } from '../src/config';
import {
  JEAP_DENIED_LICENSES,
  JEAP_RECOMMENDED_LICENSES,
} from '../src/default-policy';
import { evaluateExpression, type LicensePolicy } from '../src/spdx';

function policyOf(
  overrides: Parameters<typeof resolveConfig>[0] = {}
): LicensePolicy {
  const config = resolveConfig(overrides);
  return {
    allow: new Set(config.allowLicenses),
    deny: new Set(config.denyLicenses),
  };
}

const jeapPolicy = policyOf();

describe('the built-in policy', () => {
  for (const identifier of JEAP_RECOMMENDED_LICENSES) {
    it(`accepts ${identifier}`, () => {
      assert.equal(evaluateExpression(identifier, jeapPolicy).allowed, true);
    });
  }

  for (const identifier of JEAP_DENIED_LICENSES) {
    it(`rejects ${identifier}`, () => {
      assert.equal(evaluateExpression(identifier, jeapPolicy).allowed, false);
    });
  }

  it('rejects a free-form claim that is not an SPDX identifier', () => {
    for (const value of [
      'Public Domain',
      'UNKNOWN',
      'UNLICENSED',
      'Custom: http://localhost',
      'SEE LICENSE IN LICENSE',
    ]) {
      assert.equal(
        evaluateExpression(value, jeapPolicy).allowed,
        false,
        `${value} must not pass the policy`
      );
    }
  });

  it('rejects a copyleft license that is not dual licensed', () => {
    for (const value of ['GPL-3.0-only', 'AGPL-3.0-or-later', 'SSPL-1.0']) {
      assert.equal(evaluateExpression(value, jeapPolicy).allowed, false);
    }
  });
});

/**
 * The expressions below are the ones actually declared by dependencies of the jEAP
 * frontends, so the policy is exercised against reality rather than invented input.
 */
describe('license expressions seen in the jEAP frontends', () => {
  const cases: Array<[string, boolean, string[]]> = [
    ['MIT', true, []],
    ['ISC', true, []],
    ['Apache-2.0', true, []],
    ['0BSD', true, []],
    ['BlueOak-1.0.0', true, []],
    ['CC-BY-4.0', true, []],
    ['MIT-0', true, []],
    ['Python-2.0', true, []],
    ['(MIT OR CC0-1.0)', true, []],
    ['(MIT AND CC-BY-3.0)', true, []],
    ['(MIT AND Zlib)', true, []],
    ['(BSD-2-Clause OR MIT OR Apache-2.0)', true, []],
    ['(AFL-2.1 OR BSD-3-Clause)', true, []],
    ['(BSD-3-Clause OR GPL-2.0)', true, ['GPL-2.0']],
    ['(MIT OR GPL-3.0-or-later)', true, ['GPL-3.0-or-later']],
    ['Apache-2.0 WITH LLVM-exception', true, []],
    ['(GPL-2.0 AND MIT)', false, []],
    ['EPL-2.0', false, []],
  ];

  for (const [expression, allowed, declined] of cases) {
    it(`${allowed ? 'accepts' : 'rejects'} ${expression}`, () => {
      const evaluation = evaluateExpression(expression, jeapPolicy);
      assert.equal(evaluation.allowed, allowed);
      if (allowed) {
        assert.deepEqual(evaluation.rejected, declined);
      }
    });
  }
});

describe('project overrides of the policy', () => {
  it('accepts a license added by the project', () => {
    const policy = policyOf({ start: process.cwd() });
    assert.equal(evaluateExpression('EPL-2.0', policy).allowed, false);

    const widened: LicensePolicy = {
      allow: new Set([...policy.allow, 'EPL-2.0']),
      deny: policy.deny,
    };
    assert.equal(evaluateExpression('EPL-2.0', widened).allowed, true);
  });

  it('lets a denied license win over an allowed one', () => {
    const tightened: LicensePolicy = {
      allow: new Set(['MIT', 'CC-BY-4.0']),
      deny: new Set(['CC-BY-4.0']),
    };
    assert.equal(evaluateExpression('CC-BY-4.0', tightened).allowed, false);
    assert.equal(
      evaluateExpression('(MIT OR CC-BY-4.0)', tightened).allowed,
      true
    );
  });

  it('starts from an empty policy when the project extends nothing', () => {
    const empty: LicensePolicy = { allow: new Set(), deny: new Set() };
    assert.equal(evaluateExpression('MIT', empty).allowed, false);
  });
});
