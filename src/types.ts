/**
 * Shared types of the jEAP frontend license checker.
 */

/** Where the license information of a package was taken from. */
export type LicenseSource = 'manifest' | 'license-file' | 'none';

/** A single installed package with the license information found for it. */
export interface ScannedPackage {
  /** `name@version`, the key used in reports and in exception keys. */
  key: string;
  name: string;
  version: string;
  /**
   * The SPDX license expression found for the package, or `undefined` when no license
   * information could be determined at all.
   */
  license: string | undefined;
  licenseSource: LicenseSource;
  repository?: string;
  publisher?: string;
  url?: string;
  private: boolean;
  /** Absolute path of the package directory. */
  path: string;
  /** True for the scanned project itself rather than one of its dependencies. */
  isRoot: boolean;
}

/** A configured exception for a package that the license policy does not accept. */
export interface LicenseException {
  reason: string;
}

/** The effective, fully resolved configuration of a check run. */
export interface ResolvedConfig {
  /** Directory of the project to check. */
  start: string;
  /** Path of the configuration file the settings were read from, if any. */
  configPath: string | undefined;
  allowLicenses: string[];
  denyLicenses: string[];
  exceptions: Record<string, LicenseException>;
  /** Only look at production dependencies, ignoring devDependencies. */
  production: boolean;
  /** Skip packages marked as private in their package.json. */
  excludePrivatePackages: boolean;
  /** Fail when a configured exception did not match any installed package. */
  failOnUnusedExceptions: boolean;
  /**
   * Accept a dual-licensed package when at least one alternative is allowed, even if the
   * other alternatives are not. Such packages are always listed separately in the report.
   */
  allowDualLicenseChoice: boolean;
  notices: NoticesConfig;
}

/** Settings of the third-party notice file generation. */
export interface NoticesConfig {
  out: string | undefined;
  fields: string[];
  production: boolean;
  excludePrivatePackages: boolean;
}

/** How a single package was judged against the policy. */
export type Verdict =
  | { kind: 'allowed' }
  | { kind: 'dual-license-choice'; accepted: string[]; rejected: string[] }
  | { kind: 'exception'; exceptionKey: string; reason: string }
  | { kind: 'problem'; cause: 'denied' | 'not-allowed' | 'unknown' };

/** A package together with the verdict the policy produced for it. */
export interface CheckedPackage {
  package: ScannedPackage;
  verdict: Verdict;
}

/** The complete result of a check run. */
export interface CheckResult {
  config: ResolvedConfig;
  packages: CheckedPackage[];
  /** Number of packages per license expression, for the overview section. */
  licenseCounts: Record<string, number>;
  unusedExceptionKeys: string[];
  ok: boolean;
}
