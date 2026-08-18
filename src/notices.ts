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
import { errorCode, ScanDiagnostics, type ScanError } from './diagnostics';
import {
  findLicenseDocuments,
  MAX_LICENSE_FILE_SIZE,
} from './license-detection';
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
 * The directory name a package's texts are copied into.
 *
 * The name comes from a third-party manifest, so it is treated as hostile input: a package
 * calling itself `..` would otherwise write its text outside the texts directory and over a
 * file of the project. Only characters that occur in npm package names survive, and a name
 * made of dots cannot climb out of the directory.
 */
function textDirectoryName(
  scanned: ScannedPackage,
  qualified: boolean
): string {
  const sanitize = (value: string): string =>
    value
      .replace(/\//g, '__')
      .replace(/[^A-Za-z0-9@._-]/g, '_')
      // A run of dots is what climbs out of a directory, and a leading one hides it.
      .replace(/\.{2,}/g, dots => '_'.repeat(dots.length))
      .replace(/^\./, '_');

  const name = sanitize(scanned.name);
  // Two installed versions of one package would otherwise share a directory, and the text
  // written last would be attributed to both.
  return qualified ? `${name}@${sanitize(scanned.version)}` : name;
}

/** Names that are installed in more than one version, whose texts must not share a directory. */
function ambiguousNames(packages: ScannedPackage[]): Set<string> {
  const versions = new Map<string, Set<string>>();
  for (const scanned of packages) {
    const known = versions.get(scanned.name) ?? new Set<string>();
    known.add(scanned.version);
    versions.set(scanned.name, known);
  }
  return new Set(
    [...versions.entries()]
      .filter(([, known]) => known.size > 1)
      .map(([name]) => name)
  );
}

function collectDocuments(
  scanned: ScannedPackage,
  diagnostics: ScanDiagnostics
): CollectedDocument[] {
  const collected: CollectedDocument[] = [];
  for (const document of findLicenseDocuments(scanned.path, diagnostics)) {
    const filePath = path.join(scanned.path, document.fileName);
    try {
      const stats = fs.statSync(filePath);
      if (stats.size > MAX_LICENSE_FILE_SIZE) {
        diagnostics.record({
          kind: 'unreadable-license-file',
          message: `The license file ${filePath} is ${stats.size} bytes and exceeds the limit of ${MAX_LICENSE_FILE_SIZE} bytes`,
          path: filePath,
          hint: `it was not copied, so the notices do not carry the license text of ${scanned.key}`,
        });
        continue;
      }
      collected.push({
        fileName: document.fileName,
        kind: document.kind,
        content: fs.readFileSync(filePath),
      });
    } catch (error) {
      // Reporting the package as shipping no license text would be a false statement in a
      // document that exists to reproduce exactly these texts.
      diagnostics.record({
        kind: 'unreadable-license-file',
        message: `Cannot read the license file ${filePath}`,
        path: filePath,
        code: errorCode(error),
        hint: `the notices cannot reproduce the license text of ${scanned.key}; check that the path is a readable file`,
      });
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

/**
 * Renders a copied license text as a Markdown link to the file in the repository. The path
 * doubles as the link text so that the notice file still names it when it is read unrendered.
 *
 * Only the characters that would break the link are escaped: a package may ship a file whose
 * name contains a space or a parenthesis, which would otherwise end the link target early.
 */
function textLink(relativePath: string): string {
  const target = relativePath
    .replace(/ /g, '%20')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
  return `[${relativePath}](${target})`;
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
  const diagnostics = new ScanDiagnostics();

  const redistributed = redistributedKeys(config, packages, scanErrors);
  const qualifiedNames = ambiguousNames(
    packages.filter(scanned => redistributed.has(scanned.key))
  );
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

    const errorsBefore = diagnostics.errors.length;
    const documents = collectDocuments(scanned, diagnostics);
    if (documents.length === 0) {
      // "Ships no text" is a statement about the package; when its files could not be read
      // the truthful statement is that the text is missing from these notices.
      lines.push(
        diagnostics.errors.length > errorsBefore
          ? '    - text: could not be read, see the reported scan errors'
          : // Nothing is synthesised here: inserting the canonical text of the declared
            // license would attribute a copyright holder the package does not name.
            '    - text: not shipped by the package'
      );
      continue;
    }

    if (config.notices.texts === 'folder') {
      const directory = textDirectoryName(
        scanned,
        qualifiedNames.has(scanned.name)
      );
      for (const document of documents) {
        const relativePath = `${config.notices.textsDir}/${directory}/${document.fileName}`;
        files.push({ relativePath, content: document.content });
        lines.push(`    - ${document.kind} text: ${textLink(relativePath)}`);
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

  return {
    markdown,
    files,
    scanErrors: [...scanErrors, ...diagnostics.errors],
  };
}
