/**
 * The license policy shipped with the checker.
 *
 * These are the permissive licenses accepted for jEAP frontend projects. Keeping the list
 * in the tool means a policy change is a version bump of this package instead of an edit in
 * every project. Projects can add to it with `allowLicenses` and tighten it with
 * `denyLicenses`.
 */
export const JEAP_RECOMMENDED_LICENSES: readonly string[] = [
  '0BSD',
  'AFL-2.1',
  'Apache-2.0',
  'Artistic-2.0',
  'BlueOak-1.0.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BSD-4-Clause',
  'CC-BY-3.0',
  'CC-BY-4.0',
  'CC0-1.0',
  'ISC',
  'MIT',
  'MIT-0',
  'MPL-2.0',
  'PostgreSQL',
  'Python-2.0',
  'Unlicense',
  'UPL-1.0',
  'W3C',
  'WTFPL',
  'Zlib',
];

/**
 * Identifiers that are never accepted through the built-in policy. They are listed
 * explicitly so a dual-licensed package such as `(MIT OR GPL-3.0-or-later)` is reported as
 * a deliberate choice of the permissive alternative rather than passing unnoticed.
 */
export const JEAP_DENIED_LICENSES: readonly string[] = [
  'AGPL-1.0',
  'AGPL-1.0-only',
  'AGPL-1.0-or-later',
  'AGPL-3.0',
  'AGPL-3.0-only',
  'AGPL-3.0-or-later',
  'GPL-1.0',
  'GPL-1.0-only',
  'GPL-1.0-or-later',
  'GPL-2.0',
  'GPL-2.0-only',
  'GPL-2.0-or-later',
  'GPL-3.0',
  'GPL-3.0-only',
  'GPL-3.0-or-later',
  'LGPL-2.0',
  'LGPL-2.0-only',
  'LGPL-2.0-or-later',
  'LGPL-2.1',
  'LGPL-2.1-only',
  'LGPL-2.1-or-later',
  'LGPL-3.0',
  'LGPL-3.0-only',
  'LGPL-3.0-or-later',
  'SSPL-1.0',
];
