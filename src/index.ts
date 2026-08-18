/**
 * Public API of the jEAP frontend license checker.
 */
export { check, displayLicense, UNKNOWN_LICENSE } from './check';
export {
  CONFIG_FILE_NAME,
  PACKAGE_JSON_CONFIG_KEY,
  resolveConfig,
} from './config';
export type { ConfigOverrides, FileConfig } from './config';
export {
  JEAP_DENIED_LICENSES,
  JEAP_RECOMMENDED_LICENSES,
} from './default-policy';
export {
  detectLicense,
  licenseFromLicenseFile,
  licenseFromManifest,
} from './license-detection';
export { findMatchingExceptionKey, splitPackageKey } from './match';
export { NOTICE_FIELDS, renderNotices } from './notices';
export { renderJson, renderText } from './report';
export { scanPackages } from './scan';
export type { ScanOptions } from './scan';
export { collectIdentifiers, evaluateExpression } from './spdx';
export type { LicensePolicy, SpdxEvaluation } from './spdx';
export type {
  CheckResult,
  CheckedPackage,
  LicenseException,
  LicenseSource,
  NoticesConfig,
  ResolvedConfig,
  ScannedPackage,
  Verdict,
} from './types';
