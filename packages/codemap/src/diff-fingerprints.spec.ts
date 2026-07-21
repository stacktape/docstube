import { codemapSchema, fingerprintSnapshotSchema, sha256Hex } from '@docstube/contracts';
import type { Codemap, FingerprintSnapshot } from '@docstube/contracts';
import { describe, expect, it } from 'vitest';
import { diffFingerprints } from './diff-fingerprints.ts';
import type { FingerprintedCodemap } from './diff-fingerprints.ts';

const hashOf = (seed: string): string => `fake:${sha256Hex(seed)}`;
const printOf = (seed: string): string => sha256Hex(`print:${seed}`);

type SymbolSpec = {
  name: string;
  hash: string;
  signature?: string;
  values?: Record<string, string>;
  body?: string;
  // Emit the codemap record (default true); fingerprint-only symbols model .d.ts signatures.
  record?: boolean;
  // Emit the fingerprint (default true); record-only symbols model packs without fingerprints.
  fingerprint?: boolean;
};

const sideFor = (symbols: SymbolSpec[], files: Record<string, string> = {}): FingerprintedCodemap => {
  const codemap: Codemap = codemapSchema.parse({
    schemaVersion: 1,
    commit: 'abc1234',
    symbols: symbols
      .filter((spec) => spec.record !== false)
      .map((spec, index) => ({
        hash: spec.hash,
        lang: 'fake',
        kind: 'function',
        name: spec.name,
        containerPath: ['src', 'mod'],
        file: 'src/mod.fake',
        span: [index + 1, index + 1],
        visibility: 'public',
        project: '.'
      }))
  });
  const fingerprints: FingerprintSnapshot = fingerprintSnapshotSchema.parse({
    schemaVersion: 1,
    commit: 'abc1234',
    symbols: symbols
      .filter((spec) => spec.fingerprint !== false)
      .map((spec) => ({
        symbolHash: spec.hash,
        ...(spec.signature === undefined ? {} : { signaturePrint: printOf(spec.signature) }),
        valuePrints: Object.fromEntries(
          Object.entries(spec.values ?? {}).map(([name, value]) => [name, printOf(value)])
        ),
        ...(spec.body === undefined ? {} : { bodyPrint: printOf(spec.body) })
      })),
    unparsedFiles: Object.entries(files).map(([file, content]) => ({ file, contentHash: sha256Hex(content) }))
  });
  return { codemap, fingerprints };
};

describe('diffFingerprints', () => {
  it('classifies a signature change per facet on an identity-paired symbol', () => {
    const before = sideFor([{ name: 'f', hash: hashOf('f1'), signature: 's1', body: 'b1' }]);
    const after = sideFor([{ name: 'f', hash: hashOf('f2'), signature: 's2', body: 'b1' }]);
    const diff = diffFingerprints(before, after);
    expect(diff.changed).toEqual([
      {
        beforeHash: hashOf('f1'),
        afterHash: hashOf('f2'),
        signatureChanged: true,
        changedValueNames: [],
        addedValueNames: [],
        removedValueNames: [],
        bodyChanged: false,
        bodyOnly: false
      }
    ]);
    expect(diff.addedSymbols).toEqual([]);
    expect(diff.removedSymbols).toEqual([]);
  });

  it('names exactly the changed, added, and removed values', () => {
    const before = sideFor([
      { name: 'cfg', hash: hashOf('c1'), signature: 's', values: { 'cfg.max': '3', 'cfg.gone': '1' } }
    ]);
    const after = sideFor([
      { name: 'cfg', hash: hashOf('c2'), signature: 's', values: { 'cfg.max': '5', 'cfg.new': '9' } }
    ]);
    const diff = diffFingerprints(before, after);
    expect(diff.changed[0]).toMatchObject({
      signatureChanged: false,
      changedValueNames: ['cfg.max'],
      addedValueNames: ['cfg.new'],
      removedValueNames: ['cfg.gone'],
      bodyOnly: false
    });
  });

  it('flags a body-only change as bodyOnly', () => {
    const before = sideFor([{ name: 'f', hash: hashOf('f1'), signature: 's', values: { 'f.x': '1' }, body: 'b1' }]);
    const after = sideFor([{ name: 'f', hash: hashOf('f2'), signature: 's', values: { 'f.x': '1' }, body: 'b2' }]);
    const diff = diffFingerprints(before, after);
    expect(diff.changed[0]).toMatchObject({ signatureChanged: false, bodyChanged: true, bodyOnly: true });
  });

  it('reports symbols without a counterpart as added/removed by hash', () => {
    const before = sideFor([{ name: 'old', hash: hashOf('old'), signature: 's' }]);
    const after = sideFor([{ name: 'new', hash: hashOf('new'), signature: 's' }]);
    const diff = diffFingerprints(before, after);
    expect(diff.addedSymbols).toEqual([hashOf('new')]);
    expect(diff.removedSymbols).toEqual([hashOf('old')]);
    expect(diff.changed).toEqual([]);
  });

  it('presumes every facet changed when a paired symbol has no fingerprints — never less safe', () => {
    const before = sideFor([{ name: 'f', hash: hashOf('f1'), fingerprint: false }]);
    const after = sideFor([{ name: 'f', hash: hashOf('f2'), fingerprint: false }]);
    const diff = diffFingerprints(before, after);
    expect(diff.changed[0]).toMatchObject({ signatureChanged: true, bodyChanged: true, bodyOnly: false });
  });

  it('pairs fingerprint-only symbols (e.g. .d.ts signatures) by identical hash', () => {
    const stable = { name: 'dts', hash: hashOf('dts-same'), signature: 's', record: false };
    const before = sideFor([stable, { name: 'gen', hash: hashOf('dts-old'), signature: 'o', record: false }]);
    const after = sideFor([stable, { name: 'gen', hash: hashOf('dts-new'), signature: 'n', record: false }]);
    const diff = diffFingerprints(before, after);
    expect(diff.unchangedCount).toBe(1);
    // Without a codemap identity there is nothing to pair a changed hash with: removed + added.
    expect(diff.addedSymbols).toEqual([hashOf('dts-new')]);
    expect(diff.removedSymbols).toEqual([hashOf('dts-old')]);
  });

  it('diffs whole-file fallback records by content hash', () => {
    const before = sideFor([], { 'package.json': 'v1', 'README.md': 'intro', 'legacy.cfg': 'x' });
    const after = sideFor([], { 'package.json': 'v2', 'README.md': 'intro', 'fresh.cfg': 'y' });
    const diff = diffFingerprints(before, after);
    expect(diff.files).toEqual({ added: ['fresh.cfg'], changed: ['package.json'], removed: ['legacy.cfg'] });
  });

  it('counts unchanged symbols instead of listing them', () => {
    const same = { name: 'f', hash: hashOf('same'), signature: 's' };
    const diff = diffFingerprints(sideFor([same]), sideFor([same]));
    expect(diff.unchangedCount).toBe(1);
    expect(diff.changed).toEqual([]);
  });
});
