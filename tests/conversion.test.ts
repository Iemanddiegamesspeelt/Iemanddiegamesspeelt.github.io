import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessConversion,
  assessUniversalConversion,
  convertReplay,
  convertUniversalReplay,
  detectReplayFormat,
  listAvailableExports,
} from '../lib/replay/conversion';
import { gdr2Exporter, gdr2Parser } from '../lib/replay/formats/gdr2';
import { macroHubJsonParser } from '../lib/replay/formats/macrohub-json';
import { formatRegistry } from '../lib/replay/registry';
import { validateCanonicalReplay } from '../lib/replay/schema';

// CC0 replay fixture from the Eclipse community macro repository.
const ECLIPSE_STEREO_MADNESS = 'R0RSAgANU292ZW5va0hhY2tlcgBCqHd3AEBuAAAAAAAAAAAAAApFY2xpcHNlQm90AQEOU3RlcmVvIE1hZG5lc3MAAJgBA7SlAegIlEzDBVSZBUiBBeIDxwcyiQEyzwMypwIomQJAzwJAxwKsB7UCOscCQOcFQKEBOqUDOq0BOrsCOqcCzAa9G44B5wF6ZyxvMvUDrAGhB6AB2wGaAZUJmgG7C8YDrQTFAcABowHYAhWGAVtm2wRG0wI0pwY0bVSTAkhzWpsCRpsCOtkCTpMCPucBOocDLm3uA9sEOucEQOcCNPMBjgWVATj1AWylAXR1QPMDTp0CdJMDSIcBRntSiQFSiQFM9QJMdVLvAVKnAVphWo0BaMcCpgGlA2BVLE/mBuEB9AJ7sgOvAZgB+wFozQaaAw==';
const fixture = Uint8Array.from(Buffer.from(ECLIPSE_STEREO_MADNESS, 'base64'));

async function parsedFixture() {
  return (await gdr2Parser.parse({ bytes: fixture, filename: 'Stereo Madness.gdr2' })).replay;
}

test('detects and parses an Eclipse GDR2 v2 replay', async () => {
  const detection = await detectReplayFormat({ bytes: fixture, filename: 'Stereo Madness.gdr2' });
  assert.equal(detection.format?.id, 'gdr2');
  assert.equal(detection.confidence, 'exact');

  const replay = await parsedFixture();
  assert.equal(replay.level.id?.value, '1');
  assert.equal(replay.level.name?.value, 'Stereo Madness');
  assert.equal(replay.clock.ticksPerSecond.numerator, '240');
  assert.equal(replay.durationTicks, '20216');
  assert.equal(replay.events.length, 152);
});

test('round-trips the real GDR2 fixture byte for byte', async () => {
  const replay = await parsedFixture();
  const artifact = await gdr2Exporter.export(replay);
  assert.deepEqual(artifact.bytes, fixture);
});

test('converts GDR2 through the compressed MacroHub representation', async () => {
  const replay = await parsedFixture();
  const converted = await convertReplay(replay, 'macrohub-json');
  assert.equal(converted.assessment.decision, 'allowed');
  assert.equal(converted.artifact.extension, '.macrohub');
  assert.deepEqual([...converted.artifact.bytes.slice(0, 2)], [0x1f, 0x8b]);
  assert.ok(converted.artifact.bytes.byteLength < new TextEncoder().encode(JSON.stringify(replay)).byteLength);
  const reparsed = await macroHubJsonParser.parse({
    bytes: converted.artifact.bytes,
    filename: converted.artifact.filename,
    mediaType: converted.artifact.mediaType,
  });
  assert.deepEqual(reparsed.replay, replay);
});

test('still imports legacy uncompressed MacroHub JSON files', async () => {
  const replay = await parsedFixture();
  const legacyBytes = new TextEncoder().encode(`${JSON.stringify(replay)}\n`);
  const reparsed = await macroHubJsonParser.parse({
    bytes: legacyBytes,
    filename: 'legacy.macrohub.json',
    mediaType: 'application/vnd.macrohub.replay+json',
  });
  assert.deepEqual(reparsed.replay, replay);
});

test('converts the real fixture through every registered exporter', async () => {
  const replay = await parsedFixture();
  const available = listAvailableExports(replay).map(({ format }) => format.id).sort();
  const exporters = formatRegistry.filter((format) => format.exporter).map((format) => format.id).sort();
  assert.deepEqual(available, exporters);
  for (const target of listAvailableExports(replay)) {
    assert.equal(target.assessment.decision, 'allowed');
    const acknowledgedIssueCodes = target.assessment.decision === 'allowed'
      ? target.assessment.issues.filter((issue) => issue.requiresAcknowledgement).map((issue) => issue.code)
      : [];
    const converted = await convertReplay(replay, target.format.id, { acknowledgedIssueCodes });
    assert.ok(converted.artifact.bytes.byteLength > 0, `${target.format.displayName} output was empty`);
  }
});

test('requires acknowledgement when optional metadata is removed', async () => {
  const replay = await parsedFixture();
  const changed = validateCanonicalReplay({
    ...replay,
    extensions: { ...replay.extensions, 'example/required': { value: true } },
  });
  const assessment = assessConversion(changed, 'gdr2');
  assert.equal(assessment.decision, 'allowed');
  assert.ok(assessment.issues.some((issue) => issue.code === 'GDR2_EXTRA_METADATA_REMOVED' && issue.requiresAcknowledgement));
});

test('blocks conversion when required extension events would be lost', async () => {
  const replay = await parsedFixture();
  const changed = validateCanonicalReplay({
    ...replay,
    events: [...replay.events, {
      tick: replay.durationTicks,
      order: 999_999,
      kind: 'extension',
      namespace: 'example',
      eventType: 'required-state',
      critical: true,
      payload: { value: true },
    }],
  });
  const assessment = assessConversion(changed, 'gdr2');
  assert.equal(assessment.decision, 'blocked');
  assert.ok(assessment.issues.some((issue) => issue.code === 'GDR2_CRITICAL_EXTENSION'));
});

test('universal downloads convert input macros with source-specific corrections to every exporter', async () => {
  const replay = await parsedFixture();
  const extraTick = replay.durationTicks ?? replay.events.at(-1)?.tick ?? '0';
  const changed = validateCanonicalReplay({
    ...replay,
    events: [...replay.events, {
      tick: extraTick,
      order: 999_998,
      kind: 'player-state',
      player: 1,
      x: 12.5,
      y: 3,
    }, {
      tick: extraTick,
      order: 999_999,
      kind: 'extension',
      namespace: 'source-tool',
      eventType: 'correction-data',
      critical: true,
      payload: { value: true },
    }],
  });
  const exporters = formatRegistry.filter((format) => format.exporter);
  assert.ok(exporters.every((format) => assessUniversalConversion(changed, format.id).decision === 'allowed'));
  for (const format of exporters) {
    const converted = await convertUniversalReplay(changed, format.id);
    assert.ok(converted.artifact.bytes.byteLength > 0, `${format.displayName} output was empty`);
  }
});

test('blocks unknown tools unless the server resolves a live compatibility policy', async () => {
  const replay = await parsedFixture();
  assert.equal(assessConversion(replay, 'gdr2', 'new-tool').decision, 'blocked');
  const resolved = assessConversion(replay, 'gdr2', 'new-tool', {
    replayToolId: 'new-tool',
    verification: 'community-reported',
    notes: 'Version-specific compatibility.',
  });
  assert.equal(resolved.decision, 'allowed');
  assert.ok(resolved.issues.some((issue) => issue.code === 'COMPATIBILITY_NOT_VERIFIED'));
});

test('recognizes malformed catalogued files without pretending they parsed', async () => {
  const detection = await detectReplayFormat({ bytes: new Uint8Array([1, 2, 3]), filename: 'example.xd' });
  assert.equal(detection.format?.id, 'xdbot');
  assert.equal(detection.confidence, 'possible');
  assert.ok(detection.format?.parser);
  await assert.rejects(() => detection.format!.parser!.parse({ bytes: new Uint8Array([1, 2, 3]), filename: 'example.xd' }));
});

test('rejects non-JSON numeric extension values', async () => {
  const replay = await parsedFixture();
  assert.throws(() => validateCanonicalReplay({
    ...replay,
    extensions: { ...replay.extensions, 'example/value': Number.NaN },
  }));
});
