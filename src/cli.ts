#!/usr/bin/env node
/**
 * Command line interface of the jEAP frontend license checker.
 *
 * Exit codes: 0 when the check passed, 1 when the license policy was violated, 2 when the
 * invocation or the configuration is wrong.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { check } from './check';
import { resolveConfig, type ConfigOverrides } from './config';
import { renderNotices } from './notices';
import { renderJson, renderText } from './report';
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
`;

interface ParsedArguments {
  command: 'check' | 'notices' | 'help' | 'version';
  overrides: ConfigOverrides;
  json: boolean;
  quiet: boolean;
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

  if (parsed.json) {
    process.stdout.write(`${renderJson(result)}\n`);
  } else if (!result.ok || !parsed.quiet) {
    process.stdout.write(`${renderText(result)}\n`);
  }

  return result.ok ? 0 : 1;
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

function runNotices(parsed: ParsedArguments): number {
  const config = resolveConfig(parsed.overrides);
  const output = renderNotices(config);

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
    // The directory is rebuilt from scratch, so that texts of dependencies that are gone do
    // not linger next to the ones that are current.
    const textsDirectory = resolveTextsDirectory(
      noticeDirectory,
      config.notices.textsDir
    );
    fs.rmSync(textsDirectory, { recursive: true, force: true });

    for (const file of output.files) {
      const filePath = path.resolve(noticeDirectory, file.relativePath);
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
