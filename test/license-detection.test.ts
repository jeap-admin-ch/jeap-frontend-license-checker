import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';

import {
  detectLicense,
  licenseFromLicenseFile,
  licenseFromManifest,
  type PackageManifest,
} from '../src/license-detection';

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jeap-licenses-'));

after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

/** Writes a package directory with the given files and returns its path. */
function packageWith(files: Record<string, string>): string {
  const packagePath = fs.mkdtempSync(path.join(temporaryRoot, 'package-'));
  for (const [fileName, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(packagePath, fileName), content);
  }
  return packagePath;
}

const TEXTS: Record<string, string> = {
  MIT: `MIT License

Copyright (c) 2026 Example

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction.`,

  ISC: `ISC License

Copyright (c) 2026 Example

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.`,

  '0BSD': `BSD Zero Clause License

Copyright (c) 2026 Example

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted.`,

  'Apache-2.0': `                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   Licensed under the Apache License, Version 2.0 (the "License");`,

  'BSD-3-Clause': `Copyright (c) 2026 Example

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software.`,

  'BSD-2-Clause': `Copyright (c) 2026 Example

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice.
2. Redistributions in binary form must reproduce the above copyright notice.`,

  'BlueOak-1.0.0': `# Blue Oak Model License

Version 1.0.0

## Purpose

This license gives everyone as much permission to work with this software as possible.`,

  'MPL-2.0': `Mozilla Public License Version 2.0
==================================

1. Definitions`,

  'GPL-3.0': `                    GNU GENERAL PUBLIC LICENSE
                       Version 3, 29 June 2007`,

  'GPL-2.0': `                    GNU GENERAL PUBLIC LICENSE
                       Version 2, June 1991`,

  'LGPL-3.0': `                   GNU LESSER GENERAL PUBLIC LICENSE
                       Version 3, 29 June 2007`,

  'AGPL-3.0': `                    GNU AFFERO GENERAL PUBLIC LICENSE
                       Version 3, 19 November 2007`,

  'CC0-1.0': `Creative Commons Legal Code

CC0 1.0 Universal`,

  'CC-BY-4.0': `Creative Commons Attribution 4.0 International Public License`,

  Unlicense: `This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or distribute this
software.`,

  WTFPL: `        DO WHAT THE FUCK YOU WANT TO PUBLIC LICENSE
                    Version 2, December 2004`,
};

describe('license text detection', () => {
  for (const [identifier, text] of Object.entries(TEXTS)) {
    it(`recognises ${identifier} from a license file`, () => {
      assert.equal(
        licenseFromLicenseFile(packageWith({ LICENSE: text })),
        identifier
      );
    });
  }

  /**
   * The two differ only in the requirement to reproduce the copyright notice, so the
   * distinction has to come from that sentence and not from the rest of the text.
   */
  it('separates ISC from 0BSD by the copyright notice requirement', () => {
    assert.equal(
      licenseFromLicenseFile(packageWith({ LICENSE: TEXTS['ISC']! })),
      'ISC'
    );
    assert.equal(
      licenseFromLicenseFile(packageWith({ LICENSE: TEXTS['0BSD']! })),
      '0BSD'
    );
  });

  it('separates the BSD variants by the non-endorsement clause', () => {
    assert.equal(
      licenseFromLicenseFile(packageWith({ LICENSE: TEXTS['BSD-3-Clause']! })),
      'BSD-3-Clause'
    );
    assert.equal(
      licenseFromLicenseFile(packageWith({ LICENSE: TEXTS['BSD-2-Clause']! })),
      'BSD-2-Clause'
    );
  });

  it('finds the text under any of the usual file names', () => {
    for (const fileName of [
      'LICENSE',
      'license',
      'License',
      'LICENSE.md',
      'LICENSE.txt',
      'license.md',
      'LICENCE',
      'COPYING',
      'LICENSE-MIT.txt',
    ]) {
      assert.equal(
        licenseFromLicenseFile(packageWith({ [fileName]: TEXTS['MIT']! })),
        'MIT',
        `${fileName} was not read`
      );
    }
  });

  it('prefers the main license file over a variant', () => {
    const packagePath = packageWith({
      'LICENSE-MIT': TEXTS['MIT']!,
      LICENSE: TEXTS['Apache-2.0']!,
    });
    assert.equal(licenseFromLicenseFile(packagePath), 'Apache-2.0');
  });

  it('returns nothing for an unrecognised text', () => {
    assert.equal(
      licenseFromLicenseFile(packageWith({ LICENSE: 'All rights reserved.' })),
      undefined
    );
  });
});

describe('license from the package manifest', () => {
  const cases: Array<[string, PackageManifest, string | undefined]> = [
    ['a plain SPDX string', { license: 'MIT' }, 'MIT'],
    [
      'an SPDX expression',
      { license: '(MIT OR Apache-2.0)' },
      '(MIT OR Apache-2.0)',
    ],
    [
      'the legacy object form',
      { license: { type: 'ISC', url: 'http://x' } },
      'ISC',
    ],
    [
      'a URL only',
      { license: { url: 'http://localhost' } },
      'Custom: http://localhost',
    ],
    [
      'the legacy array form',
      { licenses: [{ type: 'MIT' }, { type: 'GPL-2.0' }] },
      '(MIT OR GPL-2.0)',
    ],
    ['a single entry array', { licenses: ['MIT'] }, 'MIT'],
    ['no license at all', {}, undefined],
    ['an empty string', { license: '   ' }, undefined],
  ];

  for (const [description, manifest, expected] of cases) {
    it(`reads ${description}`, () => {
      assert.equal(licenseFromManifest(manifest), expected);
    });
  }
});

describe('detectLicense', () => {
  it('prefers the declared license over the license file', () => {
    const packagePath = packageWith({ LICENSE: TEXTS['Apache-2.0']! });
    assert.deepEqual(detectLicense({ license: 'MIT' }, packagePath), {
      license: 'MIT',
      source: 'manifest',
    });
  });

  it('falls back to the license file when the manifest declares nothing', () => {
    const packagePath = packageWith({ LICENSE: TEXTS['MIT']! });
    assert.deepEqual(detectLicense({}, packagePath), {
      license: 'MIT',
      source: 'license-file',
    });
  });

  it('follows a SEE LICENSE IN reference', () => {
    const packagePath = packageWith({ 'LICENSE.txt': TEXTS['ISC']! });
    assert.deepEqual(
      detectLicense({ license: 'SEE LICENSE IN LICENSE.txt' }, packagePath),
      { license: 'ISC', source: 'license-file' }
    );
  });

  /** A package may point at a file it does not ship; that is missing information, not a license. */
  it('reports nothing when the referenced file is missing', () => {
    const packagePath = packageWith({});
    assert.deepEqual(
      detectLicense({ license: 'SEE LICENSE IN LICENSE' }, packagePath),
      {
        license: undefined,
        source: 'none',
      }
    );
  });

  it('keeps UNLICENSED as declared rather than guessing from a file', () => {
    const packagePath = packageWith({ LICENSE: TEXTS['MIT']! });
    assert.deepEqual(detectLicense({ license: 'UNLICENSED' }, packagePath), {
      license: 'UNLICENSED',
      source: 'manifest',
    });
  });

  it('reports nothing for a package without manifest license and without a file', () => {
    assert.deepEqual(detectLicense({}, packageWith({})), {
      license: undefined,
      source: 'none',
    });
  });
});
