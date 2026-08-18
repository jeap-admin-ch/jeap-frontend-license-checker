import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  collectIdentifiers,
  evaluateExpression,
  type LicensePolicy,
} from '../src/spdx';

const policy: LicensePolicy = {
  allow: new Set(['MIT', 'Apache-2.0', 'BSD-3-Clause', 'CC0-1.0', 'Zlib']),
  deny: new Set(['GPL-2.0', 'GPL-3.0-or-later']),
};

describe('evaluateExpression', () => {
  it('accepts a plain allowed identifier', () => {
    assert.equal(evaluateExpression('MIT', policy).allowed, true);
  });

  it('rejects an identifier that is not allowed', () => {
    const evaluation = evaluateExpression('EPL-2.0', policy);
    assert.equal(evaluation.allowed, false);
    assert.deepEqual(evaluation.rejected, ['EPL-2.0']);
  });

  it('accepts an OR expression when one alternative is allowed', () => {
    const evaluation = evaluateExpression('(MIT OR CC0-1.0)', policy);
    assert.equal(evaluation.allowed, true);
    assert.deepEqual(evaluation.rejected, []);
  });

  it('reports the declined alternative of a dual licensed package', () => {
    const evaluation = evaluateExpression('(BSD-3-Clause OR GPL-2.0)', policy);
    assert.equal(evaluation.allowed, true);
    assert.deepEqual(evaluation.accepted, ['BSD-3-Clause']);
    assert.deepEqual(evaluation.rejected, ['GPL-2.0']);
  });

  it('requires every part of an AND expression', () => {
    assert.equal(evaluateExpression('(MIT AND Zlib)', policy).allowed, true);
    assert.equal(
      evaluateExpression('(MIT AND EPL-2.0)', policy).allowed,
      false
    );
  });

  it('honours operator precedence, AND binding tighter than OR', () => {
    assert.equal(
      evaluateExpression('EPL-2.0 AND MIT OR Apache-2.0', policy).allowed,
      true
    );
    assert.equal(evaluateExpression('MIT AND EPL-2.0', policy).allowed, false);
  });

  it('evaluates nested parentheses', () => {
    assert.equal(
      evaluateExpression('((MIT OR EPL-2.0) AND Zlib)', policy).allowed,
      true
    );
  });

  it('treats a denied identifier as not allowed even when it is also allowed', () => {
    const strict: LicensePolicy = {
      allow: new Set(['GPL-2.0']),
      deny: new Set(['GPL-2.0']),
    };
    assert.equal(evaluateExpression('GPL-2.0', strict).allowed, false);
  });

  it('matches the base license of a WITH exception', () => {
    assert.equal(
      evaluateExpression('Apache-2.0 WITH LLVM-exception', policy).allowed,
      true
    );
  });

  it('matches the base license of a + suffix', () => {
    assert.equal(evaluateExpression('MIT+', policy).allowed, true);
  });

  it('treats unparseable input as a single opaque identifier', () => {
    const evaluation = evaluateExpression('Custom: http://localhost', policy);
    assert.equal(evaluation.allowed, false);
    assert.deepEqual(evaluation.rejected, ['Custom: http://localhost']);
  });
});

describe('collectIdentifiers', () => {
  it('lists the distinct identifiers of an expression', () => {
    assert.deepEqual(collectIdentifiers('(MIT OR CC0-1.0) AND MIT'), [
      'MIT',
      'CC0-1.0',
    ]);
  });
});
