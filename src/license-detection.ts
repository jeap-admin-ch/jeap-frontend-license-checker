/**
 * Determination of the license of an installed package.
 *
 * The package manifest is the only authoritative source. When it carries no usable license
 * field, a small set of well-known license texts is recognised in the package's license
 * file, which keeps packages that ship their license only as a file from having to be
 * exempted by name. The origin of the information is reported, so a text match is never
 * mistaken for declared metadata.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { LicenseSource } from './types';

/** The license of a package and where it was found. */
export interface DetectedLicense {
  license: string | undefined;
  source: LicenseSource;
}

/** The subset of a package manifest this tool reads. */
export interface PackageManifest {
  name?: string;
  version?: string;
  private?: boolean;
  license?: unknown;
  licenses?: unknown;
  repository?: unknown;
  author?: unknown;
  homepage?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

/**
 * Normalises one license entry. npm has three historical shapes: a plain SPDX string, an
 * object with `type` and `url`, and an array of either.
 */
function normalizeLicenseEntry(entry: unknown): string | undefined {
  if (typeof entry === 'string') {
    const trimmed = entry.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (entry !== null && typeof entry === 'object') {
    const record = entry as { type?: unknown; url?: unknown };
    if (typeof record.type === 'string' && record.type.trim().length > 0) {
      return record.type.trim();
    }
    if (typeof record.url === 'string' && record.url.trim().length > 0) {
      // A license known only by its URL. Kept verbatim so it shows up as an unknown
      // license instead of silently disappearing.
      return `Custom: ${record.url.trim()}`;
    }
  }
  return undefined;
}

/** Reads the license declared in the package manifest, if any. */
export function licenseFromManifest(
  manifest: PackageManifest
): string | undefined {
  const single = normalizeLicenseEntry(manifest.license);
  if (single !== undefined) {
    return single;
  }

  const entries = Array.isArray(manifest.licenses)
    ? manifest.licenses
    : manifest.licenses === undefined
      ? []
      : [manifest.licenses];

  const normalized = entries
    .map(normalizeLicenseEntry)
    .filter((value): value is string => value !== undefined);

  if (normalized.length === 0) {
    return undefined;
  }
  if (normalized.length === 1) {
    return normalized[0];
  }
  // The legacy array form lists alternatives the user may choose from.
  return `(${normalized.join(' OR ')})`;
}

/**
 * File name extensions that never hold a license text, so that data files such as
 * `license-exceptions.json` are not mistaken for one.
 */
const NON_TEXT_EXTENSIONS = [
  '.json',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.map',
  '.yml',
  '.yaml',
];

const LICENSE_FILE_PATTERN = /^(licen[cs]e|copying)/i;
const NOTICE_FILE_PATTERN = /^notice/i;

/** A license or notice file shipped by a package. */
export interface LicenseDocument {
  /** File name as shipped by the package. */
  fileName: string;
  kind: 'license' | 'notice';
}

function isTextFile(fileName: string): boolean {
  const lowerCased = fileName.toLowerCase();
  return !NON_TEXT_EXTENSIONS.some(extension => lowerCased.endsWith(extension));
}

/**
 * Sorts the plain `LICENSE` / `COPYING` files before variants such as `LICENSE-MIT`, so
 * that license text detection always looks at the main file first and stays stable.
 */
function compareDocuments(left: string, right: string): number {
  const plain = (fileName: string): number =>
    /^(licen[cs]e|copying)(\.[^.]+)?$/i.test(fileName) ? 0 : 1;
  return plain(left) - plain(right) || left.localeCompare(right);
}

/**
 * Lists the license and notice files a package ships.
 *
 * The package directory is read and matched case insensitively rather than probed for a
 * fixed list of names: packages spell these files in every casing, and a fixed list silently
 * misses the ones that do not match it.
 */
export function findLicenseDocuments(packagePath: string): LicenseDocument[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(packagePath, { withFileTypes: true });
  } catch {
    return [];
  }

  const documents: LicenseDocument[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !isTextFile(entry.name)) {
      continue;
    }
    if (LICENSE_FILE_PATTERN.test(entry.name)) {
      documents.push({ fileName: entry.name, kind: 'license' });
    } else if (NOTICE_FILE_PATTERN.test(entry.name)) {
      documents.push({ fileName: entry.name, kind: 'notice' });
    }
  }

  return documents.sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) ||
      compareDocuments(left.fileName, right.fileName)
  );
}
/**
 * Recognisable license texts, most specific first. Each entry requires all of its markers
 * to be present, which keeps a permissive match from swallowing a stricter license that
 * quotes it.
 */
const LICENSE_TEXT_MARKERS: ReadonlyArray<{
  id: string;
  markers: string[];
  absent?: string[];
}> = [
  {
    id: 'AGPL-3.0',
    markers: ['gnu affero general public license', 'version 3'],
  },
  { id: 'GPL-3.0', markers: ['gnu general public license', 'version 3'] },
  { id: 'GPL-2.0', markers: ['gnu general public license', 'version 2'] },
  {
    id: 'LGPL-3.0',
    markers: ['gnu lesser general public license', 'version 3'],
  },
  {
    id: 'LGPL-2.1',
    markers: ['gnu lesser general public license', 'version 2.1'],
  },
  { id: 'MPL-2.0', markers: ['mozilla public license version 2.0'] },
  { id: 'Apache-2.0', markers: ['apache license', 'version 2.0'] },
  { id: 'BlueOak-1.0.0', markers: ['blue oak model license'] },
  {
    id: 'CC0-1.0',
    markers: ['creative commons legal code', 'cc0 1.0 universal'],
  },
  { id: 'CC-BY-4.0', markers: ['creative commons attribution 4.0'] },
  { id: 'CC-BY-3.0', markers: ['creative commons attribution 3.0'] },
  {
    id: 'Unlicense',
    markers: [
      'this is free and unencumbered software released into the public domain',
    ],
  },
  {
    // 0BSD is ISC without the requirement to reproduce the copyright notice.
    id: '0BSD',
    markers: [
      'permission to use, copy, modify, and/or distribute this software',
    ],
    absent: ['appear in all copies'],
  },
  {
    id: 'ISC',
    markers: [
      'permission to use, copy, modify, and/or distribute this software',
    ],
  },
  { id: 'MIT', markers: ['permission is hereby granted, free of charge'] },
  {
    id: 'BSD-3-Clause',
    markers: [
      'redistribution and use in source and binary forms',
      'neither the name',
    ],
  },
  {
    id: 'BSD-2-Clause',
    markers: ['redistribution and use in source and binary forms'],
  },
  {
    id: 'Zlib',
    markers: ["this software is provided 'as-is', without any express"],
  },
  { id: 'Python-2.0', markers: ['python software foundation license'] },
  { id: 'WTFPL', markers: ['do what the fuck you want to public license'] },
];

/** Recognises the license text of a single file. */
function licenseFromFile(filePath: string): string | undefined {
  let content: string;
  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile() || stats.size > 512 * 1024) {
      return undefined;
    }
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }

  const haystack = content.toLowerCase().replace(/\s+/g, ' ');
  for (const candidate of LICENSE_TEXT_MARKERS) {
    const present = candidate.markers.every(marker =>
      haystack.includes(marker)
    );
    const absent = (candidate.absent ?? []).every(
      marker => !haystack.includes(marker)
    );
    if (present && absent) {
      return candidate.id;
    }
  }
  return undefined;
}

/** Reads the license files of a package and recognises their license text. */
export function licenseFromLicenseFile(
  packagePath: string
): string | undefined {
  for (const document of findLicenseDocuments(packagePath)) {
    if (document.kind !== 'license') {
      continue;
    }
    const detected = licenseFromFile(path.join(packagePath, document.fileName));
    if (detected !== undefined) {
      return detected;
    }
  }
  return undefined;
}

/**
 * `SEE LICENSE IN <file>` is the npm idiom for "the license text is in this file". The
 * referenced file is read so such packages do not have to be exempted by name.
 */
const SEE_LICENSE_IN = /^SEE LICENSE IN\s+(.+)$/i;

/** Determines the license of an installed package. */
export function detectLicense(
  manifest: PackageManifest,
  packagePath: string
): DetectedLicense {
  const declared = licenseFromManifest(manifest);
  if (declared !== undefined) {
    const reference = SEE_LICENSE_IN.exec(declared);
    if (reference === null) {
      return { license: declared, source: 'manifest' };
    }
    const referenced = licenseFromFile(
      path.join(packagePath, reference[1]!.trim())
    );
    if (referenced !== undefined) {
      return { license: referenced, source: 'license-file' };
    }
  }

  const detected = licenseFromLicenseFile(packagePath);
  if (detected !== undefined) {
    return { license: detected, source: 'license-file' };
  }

  return { license: undefined, source: 'none' };
}
