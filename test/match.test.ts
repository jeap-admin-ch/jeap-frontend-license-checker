import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { findMatchingExceptionKey, splitPackageKey } from '../src/match';

describe('splitPackageKey', () => {
  it('splits an unscoped key', () => {
    assert.deepEqual(splitPackageKey('tslib@2.8.1'), {
      name: 'tslib',
      version: '2.8.1',
    });
  });

  it('splits a scoped key at the last separator', () => {
    assert.deepEqual(splitPackageKey('@scope/widget@20.35.0'), {
      name: '@scope/widget',
      version: '20.35.0',
    });
  });

  it('treats a key without a version as any version', () => {
    assert.deepEqual(splitPackageKey('@scope/widget'), {
      name: '@scope/widget',
      version: '*',
    });
  });
});

describe('findMatchingExceptionKey', () => {
  it('matches an exact version', () => {
    assert.equal(
      findMatchingExceptionKey('tslib@2.8.1', ['tslib@2.8.1']),
      'tslib@2.8.1'
    );
  });

  it('does not match a different version', () => {
    assert.equal(
      findMatchingExceptionKey('tslib@2.8.1', ['tslib@1.14.1']),
      undefined
    );
  });

  it('matches a version wildcard', () => {
    assert.equal(
      findMatchingExceptionKey('tslib@2.8.1', ['tslib@*']),
      'tslib@*'
    );
  });

  /**
   * The defect this tool exists for: a scoped package must be matched by its own wildcard,
   * so that a version bump of an exempted dependency does not break the build.
   */
  it('matches a version wildcard of a scoped package', () => {
    assert.equal(
      findMatchingExceptionKey('@scope/widget@20.35.0', ['@scope/widget@*']),
      '@scope/widget@*'
    );
  });

  it('matches any package of a scope through a scope wildcard', () => {
    assert.equal(
      findMatchingExceptionKey('@scope/widget@20.35.0', ['@scope/*']),
      '@scope/*'
    );
    assert.equal(
      findMatchingExceptionKey('@scope/other@1.0.0', ['@scope/*@*']),
      '@scope/*@*'
    );
  });

  it('does not let a scope wildcard leak into another scope', () => {
    assert.equal(
      findMatchingExceptionKey('@other/widget@1.0.0', ['@scope/*']),
      undefined
    );
  });

  it('prefers the most specific match', () => {
    assert.equal(
      findMatchingExceptionKey('@scope/widget@20.35.0', [
        '@scope/*',
        '@scope/widget@*',
        '@scope/widget@20.35.0',
      ]),
      '@scope/widget@20.35.0'
    );
    assert.equal(
      findMatchingExceptionKey('@scope/widget@20.35.0', [
        '@scope/*',
        '@scope/widget@*',
      ]),
      '@scope/widget@*'
    );
  });
});
