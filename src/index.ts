/**
 * Public API of the jEAP frontend license checker.
 */
export {
  check,
  displayLicense,
  hasPolicyFailure,
  UNKNOWN_LICENSE,
} from './check';
export { errorCode, isMissing, ScanDiagnostics } from './diagnostics';
export type { ScanError, ScanErrorKind } from './diagnostics';
export { failed, found, missing } from './outcome';
export type { Outcome } from './outcome';
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
  findLicenseDocuments,
  MAX_LICENSE_FILE_SIZE,
  licenseFromLicenseFile,
  licenseFromManifest,
} from './license-detection';
export type { LicenseDocument } from './license-detection';
export { findMatchingExceptionKey, splitPackageKey } from './match';
export { NOTICE_FIELDS, renderNotices } from './notices';
export type { NoticeFile, NoticeOutput } from './notices';
export { renderJson, renderScanErrors, renderText } from './report';
export type { RenderOptions } from './report';
export { scanPackages } from './scan';
export type { ScanOptions, ScanResult } from './scan';
export { collectIdentifiers, evaluateExpression } from './spdx';
export type { LicensePolicy, SpdxEvaluation } from './spdx';
export type {
  CheckResult,
  CheckedPackage,
  LicenseException,
  LicenseSource,
  LicenseTextsMode,
  NoticesConfig,
  ResolvedConfig,
  ScannedPackage,
  Verdict,
} from './types';
