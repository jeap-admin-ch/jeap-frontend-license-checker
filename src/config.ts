/**
 * Loading and resolution of the project configuration.
 *
 * The configuration is read from `jeap-license-check.json` next to the project's
 * package.json, or from a `jeapLicenseCheck` key inside package.json itself. Every setting
 * is optional: a project without configuration is checked against the built-in policy.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  JEAP_DENIED_LICENSES,
  JEAP_RECOMMENDED_LICENSES,
} from './default-policy';
import type { LicenseException, NoticesConfig, ResolvedConfig } from './types';

/** The configuration file format. */
export interface FileConfig {
  /** Base policy to start from. `'jeap:recommended'` (the default) or `null` for none. */
  extends?: 'jeap:recommended' | null;
  allowLicenses?: string[];
  denyLicenses?: string[];
  exceptions?: Record<string, LicenseException | string>;
  production?: boolean;
  excludePrivatePackages?: boolean;
  failOnUnusedExceptions?: boolean;
  allowDualLicenseChoice?: boolean;
  notices?: {
    out?: string;
    fields?: string[];
    production?: boolean;
    excludePrivatePackages?: boolean;
  };
}

/** Settings that command line flags may override. */
export interface ConfigOverrides {
  start?: string;
  configPath?: string;
  production?: boolean;
  excludePrivatePackages?: boolean;
  failOnUnusedExceptions?: boolean;
  noticesOut?: string;
}

export const CONFIG_FILE_NAME = 'jeap-license-check.json';
export const PACKAGE_JSON_CONFIG_KEY = 'jeapLicenseCheck';

const DEFAULT_NOTICE_FIELDS = ['name', 'version', 'licenses', 'repository'];

function parseJsonFile(filePath: string): unknown {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Cannot read ${filePath}: ${(error as Error).message}`);
  }
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Cannot parse ${filePath}: ${(error as Error).message}`);
  }
}

function asFileConfig(value: unknown, source: string): FileConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${source} must contain a JSON object`);
  }
  return value as FileConfig;
}

/** Locates and reads the configuration, returning the defaults when there is none. */
function loadFileConfig(
  start: string,
  explicitPath: string | undefined
): { config: FileConfig; configPath: string | undefined } {
  if (explicitPath !== undefined) {
    const resolved = path.resolve(explicitPath);
    return {
      config: asFileConfig(parseJsonFile(resolved), resolved),
      configPath: resolved,
    };
  }

  const configFilePath = path.join(start, CONFIG_FILE_NAME);
  if (fs.existsSync(configFilePath)) {
    return {
      config: asFileConfig(parseJsonFile(configFilePath), configFilePath),
      configPath: configFilePath,
    };
  }

  const packageJsonPath = path.join(start, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    const manifest = parseJsonFile(packageJsonPath) as Record<string, unknown>;
    const embedded = manifest[PACKAGE_JSON_CONFIG_KEY];
    if (embedded !== undefined) {
      return {
        config: asFileConfig(
          embedded,
          `"${PACKAGE_JSON_CONFIG_KEY}" in ${packageJsonPath}`
        ),
        configPath: packageJsonPath,
      };
    }
  }

  return { config: {}, configPath: undefined };
}

/** Normalises exceptions, accepting a plain string as a shorthand for the reason. */
function normalizeExceptions(
  exceptions: Record<string, LicenseException | string> | undefined
): Record<string, LicenseException> {
  const normalized: Record<string, LicenseException> = {};
  for (const [key, value] of Object.entries(exceptions ?? {})) {
    if (typeof value === 'string') {
      normalized[key] = { reason: value };
    } else if (
      value !== null &&
      typeof value === 'object' &&
      typeof value.reason === 'string'
    ) {
      normalized[key] = { reason: value.reason };
    } else {
      throw new Error(
        `The exception "${key}" must be a reason string or an object with a "reason" property`
      );
    }
  }
  return normalized;
}

function resolveNotices(
  config: FileConfig,
  overrides: ConfigOverrides
): NoticesConfig {
  const notices = config.notices ?? {};
  return {
    out: overrides.noticesOut ?? notices.out,
    fields: notices.fields ?? DEFAULT_NOTICE_FIELDS,
    production: notices.production ?? config.production ?? false,
    excludePrivatePackages:
      notices.excludePrivatePackages ?? config.excludePrivatePackages ?? false,
  };
}

/** Resolves the effective configuration from file settings and command line overrides. */
export function resolveConfig(overrides: ConfigOverrides = {}): ResolvedConfig {
  const start = path.resolve(overrides.start ?? process.cwd());
  const { config, configPath } = loadFileConfig(start, overrides.configPath);

  const base = config.extends === null ? [] : [...JEAP_RECOMMENDED_LICENSES];
  const baseDenied = config.extends === null ? [] : [...JEAP_DENIED_LICENSES];

  return {
    start,
    configPath,
    allowLicenses: [...new Set([...base, ...(config.allowLicenses ?? [])])],
    denyLicenses: [...new Set([...baseDenied, ...(config.denyLicenses ?? [])])],
    exceptions: normalizeExceptions(config.exceptions),
    production: overrides.production ?? config.production ?? false,
    excludePrivatePackages:
      overrides.excludePrivatePackages ??
      config.excludePrivatePackages ??
      false,
    failOnUnusedExceptions:
      overrides.failOnUnusedExceptions ?? config.failOnUnusedExceptions ?? true,
    allowDualLicenseChoice: config.allowDualLicenseChoice ?? true,
    notices: resolveNotices(config, overrides),
  };
}
