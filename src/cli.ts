#!/usr/bin/env node
/**
 * Command line interface of the jEAP frontend license checker.
 *
 * Exit codes: 0 when the check passed, 1 when the license policy was violated, 2 when the
 * invocation or the configuration is wrong.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { check, hasPolicyFailure } from './check';
import { resolveConfig, type ConfigOverrides } from './config';
import { renderNotices } from './notices';
import { renderJson, renderScanErrors, renderText } from './report';
import type { LicenseTextsMode } from './types';

const USAGE = `Usage: jeap-frontend-license-checker [command] [options]

Commands:
  check                     Check the installed dependencies against the license policy (default)
  notices                   Write the third-party notices of the installed dependencies

Options:
  --start <dir>             Project directory to inspect (default: the working directory)
  --config <file>           Configuration file to use instead of jeap-license-check.json
  --production              Only consider production dependencies
  --exclude-private         Skip packages marked as private
  --allow-unused-exceptions Do not fail on configured exceptions that are no longer needed
  --allow-incomplete-scan   Report what could not be scanned, but do not fail on it. For
                            local debugging of a half-installed tree; never in a pipeline
  --out <file>              Write the output to a file instead of stdout (notices)
  --texts <mode>            License texts of the redistributed dependencies (notices):
                            folder (default), inline or none
  --texts-dir <dir>         Directory for the copied license texts, relative to the
                            notice file (default: third-party-licenses)
  --include-versions        Name the dependencies with their version (notices). Off by
                            default so a dependency update does not rewrite the file
  --json                    Print the check result as JSON
  --quiet                   Print nothing on success
  -h, --help                Show this help
  -v, --version             Show the version of this tool

Exit codes:
  0  the check passed
  1  the license policy was violated
  2  the invocation or the configuration is wrong
  3  the dependency tree could not be scanned completely
`;

interface ParsedArguments {
  command: 'check' | 'notices' | 'help' | 'version';
  overrides: ConfigOverrides;
  json: boolean;
  quiet: boolean;
  allowIncompleteScan: boolean;
}

class UsageError extends Error {}

function requireValue(name: string, value: string | undefined): string {
  if (value === undefined || value.startsWith('--')) {
    throw new UsageError(`The option ${name} requires a value`);
  }
  return value;
}

function parseArguments(argv: string[]): ParsedArguments {
  const parsed: ParsedArguments = {
    command: 'check',
    overrides: {},
    json: false,
    quiet: false,
    allowIncompleteScan: false,
  };

  let index = 0;
  const first = argv[0];
  if (first !== undefined && !first.startsWith('-')) {
    if (first !== 'check' && first !== 'notices') {
      throw new UsageError(`Unknown command "${first}"`);
    }
    parsed.command = first;
    index = 1;
  }

  for (; index < argv.length; index++) {
    const argument = argv[index];
    switch (argument) {
      case '-h':
      case '--help':
        parsed.command = 'help';
        return parsed;
      case '-v':
      case '--version':
        parsed.command = 'version';
        return parsed;
      case '--start':
        parsed.overrides.start = requireValue('--start', argv[++index]);
        break;
      case '--config':
        parsed.overrides.configPath = requireValue('--config', argv[++index]);
        break;
      case '--out':
        parsed.overrides.noticesOut = requireValue('--out', argv[++index]);
        break;
      case '--texts':
        parsed.overrides.noticesTexts = requireValue(
          '--texts',
          argv[++index]
        ) as LicenseTextsMode;
        break;
      case '--include-versions':
        parsed.overrides.noticesIncludeVersions = true;
        break;
      case '--texts-dir':
        parsed.overrides.noticesTextsDir = requireValue(
          '--texts-dir',
          argv[++index]
        );
        break;
      case '--production':
        parsed.overrides.production = true;
        break;
      case '--exclude-private':
        parsed.overrides.excludePrivatePackages = true;
        break;
      case '--allow-unused-exceptions':
        parsed.overrides.failOnUnusedExceptions = false;
        break;
      case '--allow-incomplete-scan':
        parsed.allowIncompleteScan = true;
        break;
      case '--json':
        parsed.json = true;
        break;
      case '--quiet':
        parsed.quiet = true;
        break;
      default:
        throw new UsageError(`Unknown option "${argument}"`);
    }
  }

  return parsed;
}

function readVersion(): string {
  try {
    const manifestPath = path.join(__dirname, '..', 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      version?: string;
    };
    return manifest.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function runCheck(parsed: ParsedArguments): number {
  const config = resolveConfig(parsed.overrides);
  const result = check(config);
  const incomplete = result.scanErrors.length > 0;
  const passed =
    result.ok ||
    (incomplete && parsed.allowIncompleteScan && !hasPolicyFailure(result));

  if (parsed.json) {
    process.stdout.write(`${renderJson(result)}\n`);
  } else if (!passed || incomplete || !parsed.quiet) {
    process.stdout.write(
      `${renderText(result, { toleratedScanErrors: parsed.allowIncompleteScan })}\n`
    );
  }

  if (passed) {
    return 0;
  }
  // An incomplete scan is reported apart from a policy violation: a tree that could not be
  // read and a dependency with a forbidden license call for entirely different responses.
  return hasPolicyFailure(result) ? 1 : 3;
}

/**
 * Resolves the directory the license texts are written to. It has to stay below the
 * directory of the notice file, because that directory is rebuilt on every run and a path
 * escaping it would delete something the tool does not own.
 */
function resolveTextsDirectory(
  noticeDirectory: string,
  textsDir: string
): string {
  const resolved = path.resolve(noticeDirectory, textsDir);
  const relative = path.relative(noticeDirectory, resolved);
  if (
    textsDir.trim() === '' ||
    relative === '' ||
    relative.startsWith('..') ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      `The license texts directory "${textsDir}" must be a directory below the notice file`
    );
  }
  return resolved;
}

/**
 * Marks the texts directory as belonging to this tool. The directory is rebuilt on every run,
 * so a directory that was not created here is never deleted.
 */
const TEXTS_DIRECTORY_MARKER = '.jeap-license-texts';

const TEXTS_DIRECTORY_MARKER_CONTENT = `This directory is generated by jeap-frontend-license-checker and is rebuilt on every run.
Do not edit its contents by hand; they are copies of the license and notice files of the
dependencies this project redistributes.
`;

/** Removes the texts of a previous run, but only from a directory this tool created. */
function clearTextsDirectory(textsDirectory: string): void {
  const stats = fs.statSync(textsDirectory, { throwIfNoEntry: false });
  if (stats === undefined) {
    return;
  }
  if (
    fs.statSync(path.join(textsDirectory, TEXTS_DIRECTORY_MARKER), {
      throwIfNoEntry: false,
    }) === undefined
  ) {
    throw new Error(
      `Refusing to replace ${textsDirectory}: it exists but was not created by this tool.\n` +
        `The directory is rebuilt on every run, so it must be one this tool owns. Choose another\n` +
        `directory with --texts-dir, or remove ${textsDirectory} yourself if it is no longer needed.`
    );
  }
  fs.rmSync(textsDirectory, { recursive: true, force: true });
}

function runNotices(parsed: ParsedArguments): number {
  const config = resolveConfig(parsed.overrides);
  const output = renderNotices(config);

  // A notice file built from a partial scan is a compliance record that claims to list every
  // dependency while some were never seen, so nothing is written.
  if (output.scanErrors.length > 0 && !parsed.allowIncompleteScan) {
    process.stderr.write(
      `${renderScanErrors(output.scanErrors)}\nNo third-party notices were written, because the dependency tree could not be scanned completely.\nPass --allow-incomplete-scan to write them anyway.\n`
    );
    return 3;
  }

  if (config.notices.out === undefined) {
    if (output.files.length > 0) {
      process.stderr.write(
        'The folder layout writes the license texts next to the notice file, so it needs --out.\n' +
          'Use --texts inline to get a single self-contained file on stdout.\n'
      );
      return 2;
    }
    process.stdout.write(output.markdown);
    return 0;
  }

  const outputPath = path.resolve(config.start, config.notices.out);
  const noticeDirectory = path.dirname(outputPath);
  fs.mkdirSync(noticeDirectory, { recursive: true });

  if (config.notices.texts === 'folder') {
    const textsDirectory = resolveTextsDirectory(
      noticeDirectory,
      config.notices.textsDir
    );
    clearTextsDirectory(textsDirectory);

    if (output.files.length > 0) {
      fs.mkdirSync(textsDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(textsDirectory, TEXTS_DIRECTORY_MARKER),
        TEXTS_DIRECTORY_MARKER_CONTENT,
        'utf8'
      );
    }

    for (const file of output.files) {
      const filePath = path.resolve(noticeDirectory, file.relativePath);
      // The path contains a third-party package name, so it is checked rather than trusted.
      const inside = path.relative(textsDirectory, filePath);
      if (inside === '' || inside.startsWith('..') || path.isAbsolute(inside)) {
        throw new Error(
          `Refusing to write ${filePath}: it is outside the license texts directory ${textsDirectory}`
        );
      }
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, file.content);
    }
  }

  fs.writeFileSync(outputPath, output.markdown, 'utf8');
  if (!parsed.quiet) {
    const written =
      output.files.length > 0
        ? ` and ${output.files.length} license texts to ${config.notices.textsDir}`
        : '';
    process.stdout.write(
      `Wrote third-party notices to ${outputPath}${written}\n`
    );
  }
  return 0;
}

export function main(argv: string[]): number {
  let parsed: ParsedArguments;
  try {
    parsed = parseArguments(argv);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n\n${USAGE}`);
    return 2;
  }

  if (parsed.command === 'help') {
    process.stdout.write(USAGE);
    return 0;
  }
  if (parsed.command === 'version') {
    process.stdout.write(`${readVersion()}\n`);
    return 0;
  }

  try {
    return parsed.command === 'notices' ? runNotices(parsed) : runCheck(parsed);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 2;
  }
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
