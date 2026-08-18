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

function runNotices(parsed: ParsedArguments): number {
  const config = resolveConfig(parsed.overrides);
  const notices = renderNotices(config);

  if (config.notices.out === undefined) {
    process.stdout.write(notices);
    return 0;
  }

  const outputPath = path.resolve(config.start, config.notices.out);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, notices, 'utf8');
  if (!parsed.quiet) {
    process.stdout.write(`Wrote third-party notices to ${outputPath}\n`);
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
