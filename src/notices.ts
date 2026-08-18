/**
 * Generation of the third-party notice file listing every dependency and its license.
 */
import { displayLicense, UNKNOWN_LICENSE } from './check';
import { scanPackages } from './scan';
import type { ResolvedConfig, ScannedPackage } from './types';

const FIELD_VALUES: Record<
  string,
  (scanned: ScannedPackage) => string | undefined
> = {
  name: scanned => scanned.name,
  version: scanned => scanned.version,
  licenses: scanned => displayLicense(scanned),
  license: scanned => displayLicense(scanned),
  repository: scanned => scanned.repository,
  publisher: scanned => scanned.publisher,
  url: scanned => scanned.url,
  path: scanned => scanned.path,
};

/** The field names that may be listed in the notice file. */
export const NOTICE_FIELDS = Object.keys(FIELD_VALUES);

/**
 * Renders the third-party notices of a project as Markdown: one entry per dependency,
 * linked to its repository, with the configured fields below it. The project itself is not
 * a third-party dependency and is left out.
 */
export function renderNotices(config: ResolvedConfig): string {
  const packages = scanPackages({
    start: config.start,
    production: config.notices.production,
    excludePrivatePackages: config.notices.excludePrivatePackages,
  }).filter(scanned => !scanned.isRoot);

  const lines: string[] = [];
  for (const scanned of packages) {
    lines.push(
      scanned.repository !== undefined
        ? ` - **[${scanned.key}](${scanned.repository})**`
        : ` - **${scanned.key}**`
    );

    for (const field of config.notices.fields) {
      const value = FIELD_VALUES[field]?.(scanned);
      if (value !== undefined && value !== '') {
        lines.push(`    - ${field}: ${value}`);
      } else if (field === 'licenses' || field === 'license') {
        lines.push(`    - ${field}: ${UNKNOWN_LICENSE}`);
      }
    }
  }

  return `${lines.join('\n')}\n`;
}
