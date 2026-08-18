/**
 * The policy check itself: scan the installed packages, judge each one, collect the result.
 */
import { findMatchingExceptionKey } from './match';
import { scanPackages } from './scan';
import { evaluateExpression, type LicensePolicy } from './spdx';
import type {
  CheckResult,
  CheckedPackage,
  ResolvedConfig,
  ScannedPackage,
  Verdict,
} from './types';

/** The license expression shown for a package whose license could not be determined. */
export const UNKNOWN_LICENSE = 'UNKNOWN';

/** The license expression of a package, as shown in the report. */
export function displayLicense(scanned: ScannedPackage): string {
  return scanned.license ?? UNKNOWN_LICENSE;
}

function judge(
  scanned: ScannedPackage,
  config: ResolvedConfig,
  policy: LicensePolicy,
  usedExceptionKeys: Set<string>
): Verdict {
  const exceptionKey = findMatchingExceptionKey(
    scanned.key,
    Object.keys(config.exceptions)
  );

  if (scanned.license !== undefined) {
    const evaluation = evaluateExpression(scanned.license, policy);
    if (evaluation.allowed && evaluation.rejected.length === 0) {
      return { kind: 'allowed' };
    }
    // A dual licensed package whose choice is documented by an exception is reported as
    // that exception, so documenting the decision does not turn the entry into an unused
    // exception.
    if (
      evaluation.allowed &&
      exceptionKey === undefined &&
      config.allowDualLicenseChoice
    ) {
      return {
        kind: 'dual-license-choice',
        accepted: evaluation.accepted,
        rejected: evaluation.rejected,
      };
    }
  }

  // Not acceptable on its own: an exception is the only way through.
  if (exceptionKey !== undefined) {
    usedExceptionKeys.add(exceptionKey);
    const exception = config.exceptions[exceptionKey];
    return {
      kind: 'exception',
      exceptionKey,
      reason: exception?.reason ?? 'No reason given',
    };
  }

  if (scanned.license === undefined) {
    return { kind: 'problem', cause: 'unknown' };
  }

  const identifiers = evaluateExpression(scanned.license, policy);
  const denied = identifiers.rejected.some(id =>
    config.denyLicenses.includes(id)
  );
  return { kind: 'problem', cause: denied ? 'denied' : 'not-allowed' };
}

/**
 * True when the packages that were examined violate the policy, as opposed to the scan not
 * having examined everything. The two are reported and exited differently, so the rule lives
 * here rather than being restated by each caller.
 */
export function hasPolicyFailure(result: CheckResult): boolean {
  const hasProblems = result.packages.some(
    item => item.verdict.kind === 'problem'
  );
  const hasUnusedExceptions =
    result.config.failOnUnusedExceptions &&
    result.unusedExceptionKeys.length > 0;
  return hasProblems || hasUnusedExceptions;
}

/** Runs the license policy check for a project. */
export function check(config: ResolvedConfig): CheckResult {
  const scan = scanPackages({
    start: config.start,
    production: config.production,
    excludePrivatePackages: config.excludePrivatePackages,
  });

  const policy: LicensePolicy = {
    allow: new Set(config.allowLicenses),
    deny: new Set(config.denyLicenses),
  };

  const usedExceptionKeys = new Set<string>();
  const licenseCounts: Record<string, number> = {};
  const packages: CheckedPackage[] = [];

  for (const item of scan.packages) {
    const license = displayLicense(item);
    licenseCounts[license] = (licenseCounts[license] ?? 0) + 1;
    packages.push({
      package: item,
      verdict: judge(item, config, policy, usedExceptionKeys),
    });
  }

  const unusedExceptionKeys = Object.keys(config.exceptions)
    .filter(key => !usedExceptionKeys.has(key))
    .sort();

  const result: CheckResult = {
    config,
    packages,
    scanErrors: scan.errors,
    licenseCounts,
    unusedExceptionKeys,
    ok: false,
  };

  // A package that was never examined must not be able to make the run pass, so an
  // incomplete scan fails regardless of what the packages that were examined say.
  result.ok = !hasPolicyFailure(result) && scan.errors.length === 0;
  return result;
}
