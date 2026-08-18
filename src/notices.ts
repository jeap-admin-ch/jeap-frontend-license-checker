/**
 * Generation of the third-party notice file listing every dependency and its license.
 *
 * Beyond the license identifiers, the notices carry the full license texts. MIT requires its
 * permission notice to be included in all copies, BSD requires the copyright notice to be
 * reproduced in binary redistributions, and Apache-2.0 requires a copy of the license and the
 * propagation of a dependency's NOTICE file. A frontend bundle contains the dependency code,
 * so those obligations apply to it and a link to the license is not enough.
 *
 * The texts are collected for the production dependency graph, because that is what is
 * redistributed; development tooling never reaches a user.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { displayLicense, UNKNOWN_LICENSE } from './check';
import type { ScanError } from './diagnostics';
import { findLicenseDocuments } from './license-detection';
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

/** A license or notice file copied next to the notice file. */
export interface NoticeFile {
  /** Path relative to the directory of the notice file. */
  relativePath: string;
  /** The file content, byte for byte as shipped by the package. */
  content: Buffer;
}

/** The rendered notices and the files that belong next to them. */
export interface NoticeOutput {
  markdown: string;
  files: NoticeFile[];
  /** Everything the scan could not examine, so a partial list is never taken for complete. */
  scanErrors: ScanError[];
}

/** One license or notice document of a package, with its content. */
interface CollectedDocument {
  fileName: string;
  kind: 'license' | 'notice';
  content: Buffer;
}

/**
 * The directory name a package's texts are copied into. The scope separator is replaced
 * because it would otherwise create a directory level that is easy to lose when the folder
 * is copied around.
 */
function textDirectoryName(scanned: ScannedPackage): string {
  return scanned.name.replace(/\//g, '__');
}

function collectDocuments(scanned: ScannedPackage): CollectedDocument[] {
  const collected: CollectedDocument[] = [];
  for (const document of findLicenseDocuments(scanned.path)) {
    try {
      collected.push({
        fileName: document.fileName,
        kind: document.kind,
        content: fs.readFileSync(path.join(scanned.path, document.fileName)),
      });
    } catch {
      // A file that disappeared between listing and reading is simply not copied; the
      // package is then reported as shipping no text.
    }
  }
  return collected;
}

/**
 * Wraps a license text in a fenced block whose fence is longer than any backtick run inside
 * the text, so that a text containing a fence of its own is not cut short.
 */
function fence(content: string): string {
  const longestRun = [...content.matchAll(/`+/g)].reduce(
    (longest, match) => Math.max(longest, match[0].length),
    0
  );
  const marker = '`'.repeat(Math.max(3, longestRun + 1));
  return `${marker}text\n${content.replace(/\n+$/, '')}\n${marker}`;
}

/** Collects the keys of the packages that are actually redistributed. */
function redistributedKeys(
  config: ResolvedConfig,
  indexed: ScannedPackage[],
  scanErrors: ScanError[]
): Set<string> {
  if (config.notices.production) {
    return new Set(indexed.map(scanned => scanned.key));
  }
  const production = scanPackages({
    start: config.start,
    production: true,
    excludePrivatePackages: config.notices.excludePrivatePackages,
  });
  scanErrors.push(...production.errors);
  return new Set(
    production.packages
      .filter(scanned => !scanned.isRoot)
      .map(scanned => scanned.key)
  );
}

/**
 * Renders the third-party notices of a project as Markdown: one entry per dependency, linked
 * to its repository, with the configured fields below it. The project itself is not a
 * third-party dependency and is left out.
 */
export function renderNotices(config: ResolvedConfig): NoticeOutput {
  const scan = scanPackages({
    start: config.start,
    production: config.notices.production,
    excludePrivatePackages: config.notices.excludePrivatePackages,
  });
  const packages = scan.packages.filter(scanned => !scanned.isRoot);
  const scanErrors = [...scan.errors];

  const redistributed = redistributedKeys(config, packages, scanErrors);
  const withTexts = config.notices.texts !== 'none';
  const lines: string[] = [];
  const files: NoticeFile[] = [];
  const inlined: string[] = [];

  for (const scanned of packages) {
    const title = config.notices.includeVersions ? scanned.key : scanned.name;
    lines.push(
      scanned.repository !== undefined
        ? ` - **[${title}](${scanned.repository})**`
        : ` - **${title}**`
    );

    for (const field of config.notices.fields) {
      if (field === 'version' && !config.notices.includeVersions) {
        continue;
      }
      const value = FIELD_VALUES[field]?.(scanned);
      if (value !== undefined && value !== '') {
        lines.push(`    - ${field}: ${value}`);
      } else if (field === 'licenses' || field === 'license') {
        lines.push(`    - ${field}: ${UNKNOWN_LICENSE}`);
      }
    }

    if (!withTexts || !redistributed.has(scanned.key)) {
      continue;
    }

    const documents = collectDocuments(scanned);
    if (documents.length === 0) {
      // Nothing is synthesised here: inserting the canonical text of the declared license
      // would attribute a copyright holder that the package itself does not name.
      lines.push('    - text: not shipped by the package');
      continue;
    }

    if (config.notices.texts === 'folder') {
      const directory = textDirectoryName(scanned);
      for (const document of documents) {
        const relativePath = `${config.notices.textsDir}/${directory}/${document.fileName}`;
        files.push({ relativePath, content: document.content });
        lines.push(`    - ${document.kind} text: ${relativePath}`);
      }
      continue;
    }

    lines.push('    - text: see below');
    inlined.push(
      `## ${config.notices.includeVersions ? scanned.key : scanned.name}`
    );
    if (scanned.repository !== undefined) {
      inlined.push('', `Repository: ${scanned.repository}`);
    }
    for (const document of documents) {
      inlined.push('', `### ${document.fileName}`, '');
      inlined.push(fence(document.content.toString('utf8')));
    }
    inlined.push('');
  }

  const markdown =
    inlined.length > 0
      ? `${lines.join('\n')}\n\n# License texts\n\n${inlined.join('\n')}\n`
      : `${lines.join('\n')}\n`;

  return { markdown, files, scanErrors };
}
