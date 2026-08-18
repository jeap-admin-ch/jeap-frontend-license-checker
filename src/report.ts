/**
 * Rendering of a check result, as readable text or as JSON for further processing.
 */
import { displayLicense } from './check';
import type { CheckResult, CheckedPackage } from './types';

const ANSI = {
  reset: '\u001b[0m',
  green: '\u001b[32m',
  blue: '\u001b[34m',
  yellow: '\u001b[33m',
  red: '\u001b[31m',
};

function colorsEnabled(): boolean {
  if (process.env['NO_COLOR'] !== undefined && process.env['NO_COLOR'] !== '') {
    return false;
  }
  if (
    process.env['FORCE_COLOR'] !== undefined &&
    process.env['FORCE_COLOR'] !== ''
  ) {
    return true;
  }
  return process.stdout.isTTY === true;
}

function paint(color: keyof typeof ANSI, text: string): string {
  return colorsEnabled() ? `${ANSI[color]}${text}${ANSI.reset}` : text;
}

function origin(item: CheckedPackage): string {
  return item.package.licenseSource === 'license-file'
    ? ' (detected from license file)'
    : '';
}

function byKey(left: CheckedPackage, right: CheckedPackage): number {
  return left.package.key.localeCompare(right.package.key);
}

/** Renders the check result as human readable text. */
export function renderText(result: CheckResult): string {
  const lines: string[] = [];
  const exceptions = result.packages
    .filter(item => item.verdict.kind === 'exception')
    .sort(byKey);
  const dualLicensed = result.packages
    .filter(item => item.verdict.kind === 'dual-license-choice')
    .sort(byKey);
  const problems = result.packages
    .filter(item => item.verdict.kind === 'problem')
    .sort(byKey);

  lines.push('Dependency licenses in use:');
  for (const license of Object.keys(result.licenseCounts).sort()) {
    lines.push(
      paint('green', `  ${license} (${result.licenseCounts[license]})`)
    );
  }

  if (dualLicensed.length > 0) {
    lines.push('');
    lines.push(
      'Accepted by choosing a permissive alternative of a dual licensed package:'
    );
    for (const item of dualLicensed) {
      const verdict = item.verdict;
      if (verdict.kind !== 'dual-license-choice') {
        continue;
      }
      lines.push(paint('yellow', `  ${item.package.key}`));
      lines.push(
        paint('yellow', `    License:  ${displayLicense(item.package)}`)
      );
      lines.push(
        paint('yellow', `    Chosen:   ${verdict.accepted.join(', ')}`)
      );
      lines.push(
        paint('yellow', `    Declined: ${verdict.rejected.join(', ')}`)
      );
    }
  }

  if (exceptions.length > 0) {
    lines.push('');
    lines.push('Accepted license exceptions:');
    for (const item of exceptions) {
      const verdict = item.verdict;
      if (verdict.kind !== 'exception') {
        continue;
      }
      lines.push(
        paint(
          'blue',
          `  ${item.package.key} (matched by ${verdict.exceptionKey})`
        )
      );
      lines.push(
        paint(
          'blue',
          `    License: ${displayLicense(item.package)}${origin(item)}`
        )
      );
      lines.push(paint('blue', `    Reason:  ${verdict.reason}`));
    }
  }

  if (result.unusedExceptionKeys.length > 0) {
    lines.push('');
    lines.push(
      result.config.failOnUnusedExceptions
        ? 'These configured exceptions are no longer needed and must be removed:'
        : 'These configured exceptions are no longer needed:'
    );
    for (const key of result.unusedExceptionKeys) {
      lines.push(
        paint(
          result.config.failOnUnusedExceptions ? 'red' : 'yellow',
          `  ${key}`
        )
      );
    }
  }

  if (problems.length > 0) {
    lines.push('');
    lines.push('Problems with the licenses of these dependencies:');
    for (const item of problems) {
      lines.push(paint('red', `  ${item.package.key}`));
      lines.push(
        paint(
          'red',
          `    License:     ${displayLicense(item.package)}${origin(item)}`
        )
      );
      lines.push(
        paint('red', `    Repository:  ${item.package.repository ?? 'unknown'}`)
      );
      lines.push(
        paint('red', `    Publisher:   ${item.package.publisher ?? 'unknown'}`)
      );
      lines.push(
        paint('red', `    Url:         ${item.package.url ?? 'unknown'}`)
      );
      lines.push('');
    }
  }

  const allowed = result.packages.filter(
    item => item.verdict.kind === 'allowed'
  ).length;
  const summary = [
    paint('green', `Allowed (${allowed})`),
    dualLicensed.length > 0
      ? paint('yellow', `Dual licensed (${dualLicensed.length})`)
      : undefined,
    paint('blue', `Exceptions (${exceptions.length})`),
    paint('red', `Problems (${problems.length})`),
  ]
    .filter((part): part is string => part !== undefined)
    .join(' ');

  lines.push('');
  lines.push(
    result.ok
      ? `${paint('green', 'All licenses ok')}: ${summary}`
      : `${paint('red', 'Licenses not ok')}: ${summary}`
  );

  return lines.join('\n');
}

/** Renders the check result as JSON. */
export function renderJson(result: CheckResult): string {
  return JSON.stringify(
    {
      ok: result.ok,
      licenseCounts: result.licenseCounts,
      unusedExceptions: result.unusedExceptionKeys,
      packages: result.packages.map(item => ({
        key: item.package.key,
        name: item.package.name,
        version: item.package.version,
        license: displayLicense(item.package),
        licenseSource: item.package.licenseSource,
        repository: item.package.repository ?? null,
        publisher: item.package.publisher ?? null,
        url: item.package.url ?? null,
        verdict: item.verdict,
      })),
    },
    null,
    2
  );
}
