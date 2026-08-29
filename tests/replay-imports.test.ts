import assert from 'node:assert/strict';
import test from 'node:test';
import { encode } from '@msgpack/msgpack';
import { detectReplayFormat } from '../lib/replay/conversion';
import { formatRegistry, getFormat } from '../lib/replay/registry';
import { appLoginCompletePath, appSignInPath, platformSignInPath, safeRelativeReturnPath } from '../lib/auth/session';
import { validateUpload } from '../lib/security/upload';

class Bytes {
  data: number[] = [];
  raw(values: ArrayLike<number>) { this.data.push(...Array.from(values)); return this; }
  u8(value: number) { return this.raw([value]); }
  view(size: number, write: (view: DataView) => void) { const buffer = new ArrayBuffer(size); write(new DataView(buffer)); return this.raw(new Uint8Array(buffer)); }
  u16(value: number) { return this.view(2, (view) => view.setUint16(0, value, true)); }
  i16(value: number) { return this.view(2, (view) => view.setInt16(0, value, true)); }
  u32(value: number) { return this.view(4, (view) => view.setUint32(0, value, true)); }
  i32(value: number) { return this.view(4, (view) => view.setInt32(0, value, true)); }
  f32(value: number) { return this.view(4, (view) => view.setFloat32(0, value, true)); }
  f64(value: number) { return this.view(8, (view) => view.setFloat64(0, value, true)); }
  u64(value: bigint | number) { return this.view(8, (view) => view.setBigUint64(0, BigInt(value), true)); }
  i64(value: bigint | number) { return this.view(8, (view) => view.setBigInt64(0, BigInt(value), true)); }
  zeros(count: number) { return this.raw(new Uint8Array(count)); }
  ascii(value: string) { return this.raw(new TextEncoder().encode(value)); }
  leb(value: bigint | number) { let current = BigInt(value); do { let byte = Number(current & 0x7fn); current >>= 7n; if (current) byte |= 0x80; this.u8(byte); } while (current); return this; }
  string(value: string) { const encoded = new TextEncoder().encode(value); return this.leb(encoded.length).raw(encoded); }
  done() { return Uint8Array.from(this.data); }
}

function json(value: unknown) { return new TextEncoder().encode(JSON.stringify(value)); }

function gdrObject() {
  return {
    author: 'MacroHub test', description: '', duration: 1, gameVersion: 22074, version: 1, framerate: 240,
    seed: 0, coins: 0, ldm: false, bot: { name: 'FixtureBot', version: 1 }, level: { id: 1, name: 'Stereo Madness' },
    inputs: [{ frame: 5, btn: 1, '2p': false, down: true, correction: { xPos: 12.5, yPos: 3 } }],
  };
}

function mhr() {
  return new Bytes().ascii('HACKPRO').u8(7).i32(4).i32(240).zeros(8).u32(32).u32(1)
    .u16(1).u8(1).u8(0).i32(5).zeros(24)
    .raw([0xfa, 0x67, 0x55, 0x5a, 0x8d, 0x95, 0x94, 0x07, 0xc9, 0x8c, 0xba, 0x7f, 0x75, 0x9c, 0xef, 0x3c]).done();
}

function echo() {
  const bytes = new Bytes().ascii('META').zeros(20).f32(240).zeros(20).u32(5).u8(1).u8(0).done();
  assert.equal(bytes.length, 54);
  return bytes;
}

function zbf() { return new Bytes().f32(1 / 240).f32(1).i32(5).u8(0x31).u8(0x31).done(); }
function rush() { return new Bytes().i16(240).i32(5).u8(1).done(); }
function kd() { return new Bytes().f32(240).i32(5).u8(1).u8(0).done(); }
function fembot() { return new Bytes().ascii('FBRP').f32(240).u8(1).u32(5).zeros(60).done(); }
function replaybot() { return new Bytes().ascii('RPLY').u8(2).u8(1).f32(240).u32(5).u8(1).done(); }

function ybot() {
  return new Bytes().ascii('ybot').u32(0).u32(36).u32(0).i64(0).u64(1).u64(10).f32(240).u64(1).leb(87).done();
}

function omegaBot2() {
  return new Bytes().f32(240).f32(240).u32(1).u64(0).u64(1).u32(1).u32(5).u32(2).done();
}

function replayEngine4() {
  return new Bytes().ascii('RE4').f32(240).u64(1)
    .u64(5).f32(12.5).f32(3).f64(-1.25).u8(0)
    .u64(1).u64(5).u8(1).i32(1).u8(0).done();
}

function slc1() { return new Bytes().f64(240).u32(1).u32((5 << 4) | (1 << 1) | 1).done(); }

function slc2() {
  return new Bytes().ascii('SILL').f64(240).u64(64).u64(123).zeros(56).u64(1).u64(1)
    .u64(1).u64(0).u64(1).u8((5 << 5) | (1 << 2) | 1).ascii('EOM').done();
}

function slc3() {
  return new Bytes().ascii('SLC3RPLY').u16(64).f64(240).u64(123).u32(3).u32(22074).zeros(40)
    .u32(1).u64(11).u64(1).u16(0).u8((5 << 4) | (1 << 2) | 1).u8(0xcc).done();
}

const tcmMagic = [0x9f, 0x88, 0x89, 0x84, 0x9f, 0x3b, 0x1d, 0xd8, 0xcc, 0xa1, 0x86, 0x8a, 0x88, 0x99, 0x84, 0x00];
function tcm1() { return new Bytes().raw(tcmMagic).u8(1).u8(0).u8(0).u8(0).f32(240).zeros(56).leb(1).leb(5).u8(0x80).u8(0xcc).done(); }
function tcm2() { return new Bytes().raw(tcmMagic).u8(2).u8(0).u8(2).u8(0).f32(240).u64(0).zeros(48).leb(5).u8(5).done(); }

function gdmo() {
  return new Bytes().f32(240).u32(1).u32(0).u8(1).u8(0).zeros(2).u32(5).f64(0).f32(12.5).f32(3).done();
}

function cml1() {
  return new Bytes().ascii('CML\0').leb(1).string('author').string('description').f32(1).f32(1).f32(1).f32(240)
    .leb(0).leb(0).u8(0).leb(10).string('bot').string('1').leb(123).string('fixture')
    .leb(1).leb(10).u8(5).leb(0).done();
}

const fixtures: Array<{ id: string; filename: string; bytes: Uint8Array; expectedInputs?: number }> = [
  { id: 'gdr', filename: 'fixture.gdr', bytes: encode(gdrObject()), expectedInputs: 1 },
  { id: 'gdr-json', filename: 'fixture.gdr.json', bytes: json(gdrObject()), expectedInputs: 1 },
  { id: 'mhr', filename: 'fixture.mhr', bytes: mhr(), expectedInputs: 1 },
  { id: 'mhr-json', filename: 'fixture.mhr.json', bytes: json({ _: 'MHR', meta: { fps: 240 }, events: [{ frame: 5, down: true, p2: false }] }), expectedInputs: 1 },
  { id: 'echo', filename: 'fixture.echo', bytes: echo(), expectedInputs: 1 },
  { id: 'echo', filename: 'fixture.echo.json', bytes: json({ fps: 240, inputs: [{ frame: 5, holding: true }] }), expectedInputs: 1 },
  { id: 'tasbot-json', filename: 'fixture.json', bytes: json({ fps: 240, macro: [{ frame: 5, player_1: { click: 1 }, player_2: { click: 0 } }] }), expectedInputs: 1 },
  { id: 'zbot', filename: 'fixture.zbf', bytes: zbf(), expectedInputs: 1 },
  { id: 'rush', filename: 'fixture.rsh', bytes: rush(), expectedInputs: 1 },
  { id: 'kdbot', filename: 'fixture.kd', bytes: kd(), expectedInputs: 1 },
  { id: 'xbot', filename: 'fixture.xbot', bytes: new TextEncoder().encode('240\nframes\n1 5\n'), expectedInputs: 1 },
  { id: 'xdbot', filename: 'fixture.xd', bytes: new TextEncoder().encode('240\n5|1|1|1|0|12.5|3\n'), expectedInputs: 1 },
  { id: 'amethyst', filename: 'fixture.thyst', bytes: new TextEncoder().encode('1\n0.020833333333\n0\n0\n0\n'), expectedInputs: 1 },
  { id: 'fembot', filename: 'fixture.freplay', bytes: fembot(), expectedInputs: 1 },
  { id: 'replaybot', filename: 'fixture.replay', bytes: replaybot(), expectedInputs: 1 },
  { id: 'omegabot-replay', filename: 'fixture.replay', bytes: omegaBot2(), expectedInputs: 1 },
  { id: 'ybot', filename: 'fixture.ybot', bytes: ybot(), expectedInputs: 1 },
  { id: 'replayengine4', filename: 'fixture.re4', bytes: replayEngine4(), expectedInputs: 1 },
  { id: 'slc', filename: 'fixture.slc', bytes: slc1(), expectedInputs: 1 },
  { id: 'slc', filename: 'fixture.slc', bytes: slc2(), expectedInputs: 1 },
  { id: 'slc', filename: 'fixture.slc', bytes: slc3(), expectedInputs: 1 },
  { id: 'tcbot', filename: 'fixture.tcm', bytes: tcm1(), expectedInputs: 1 },
  { id: 'tcbot', filename: 'fixture.tcm', bytes: tcm2(), expectedInputs: 1 },
  { id: 'gdmo', filename: 'fixture.macro', bytes: gdmo(), expectedInputs: 1 },
  { id: 'cml', filename: 'fixture.cml', bytes: cml1(), expectedInputs: 1 },
];

test('every catalogued format is backed by a real parser', () => {
  assert.ok(formatRegistry.length >= 20);
  assert.ok(formatRegistry.every((format) => format.status === 'implemented' && format.parser));
  assert.equal(getFormat('json'), undefined);
});

test('detects and imports verified fixtures for every registered source family', async () => {
  for (const fixture of fixtures) {
    const detection = await detectReplayFormat({ bytes: fixture.bytes, filename: fixture.filename });
    assert.equal(detection.format?.id, fixture.id, `${fixture.filename} detected as ${detection.format?.id}: ${detection.reason}`);
    assert.equal(detection.confidence, 'exact', `${fixture.filename} was not exact`);
    const parsed = await detection.format!.parser!.parse({ bytes: fixture.bytes, filename: fixture.filename });
    const inputs = parsed.replay.events.filter((event) => event.kind === 'input');
    assert.equal(inputs.length, fixture.expectedInputs, `${fixture.filename} input count`);
    assert.ok(parsed.replay.source.sha256.length === 64);
  }
});

test('round-trips official RE4 records and no longer catalogs RE3', async () => {
  const bytes = replayEngine4();
  const format = getFormat('replayengine4');
  assert.ok(format?.parser && format.exporter);
  const parsed = await format.parser.parse({ bytes, filename: 'fixture.re4' });
  const state = parsed.replay.events.find((event) => event.kind === 'player-state');
  assert.deepEqual(state && { tick: state.tick, player: state.player, x: state.x, y: state.y }, {
    tick: '5', player: 1, x: 12.5, y: 3,
  });
  const physics = parsed.replay.events.find((event) => event.kind === 'extension' && event.namespace === 'replayengine4');
  assert.ok(physics?.kind === 'extension');
  assert.deepEqual(physics.payload, { player: 1, yAcceleration: -1.25 });
  assert.equal(format.exporter.assess(parsed.replay).decision, 'allowed');
  const exported = await format.exporter.export(parsed.replay);
  assert.deepEqual(exported.bytes, bytes);
  assert.equal(getFormat('replayengine3'), undefined);
});

test('imports GDR JSON frame fixes as player path corrections', async () => {
  const bytes = json({
    ...gdrObject(),
    frameFixes: [
      { frame: 408, p1: { x: 528.3875732421875, y: 435, r: 90 } },
      { frame: 409, p1: { x: 529.6858520507812, y: 437.4668884277344, r: 91.73076629638672 } },
    ],
  });
  const format = getFormat('gdr-json');
  assert.ok(format?.parser);
  const parsed = await format.parser.parse({ bytes, filename: 'long-level.gdr.json' });
  const states = parsed.replay.events.filter((event) => event.kind === 'player-state');
  assert.equal(states.length, 3);
  assert.ok(states.some((state) => state.tick === '408' && state.x === 528.3875732421875 && state.y === 435 && state.rotation === 90));
  assert.ok(!parsed.replay.events.some((event) => event.kind === 'extension' && event.eventType === 'replay-extension'));
});

test('rejects malformed extension-only files instead of inventing replay data', async () => {
  const detection = await detectReplayFormat({ bytes: Uint8Array.of(1, 2, 3), filename: 'broken.xd' });
  assert.equal(detection.format?.id, 'xdbot');
  assert.equal(detection.confidence, 'possible');
  await assert.rejects(() => detection.format!.parser!.parse({ bytes: Uint8Array.of(1, 2, 3), filename: 'broken.xd' }));
});

test('accepts a real GDR payload through the upload security gate', async () => {
  const bytes = encode(gdrObject());
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const validated = await validateUpload(new File([copy.buffer], 'verified.gdr', { type: 'application/octet-stream' }));
  assert.equal(validated.detectedFormatId, 'gdr');
  assert.equal(validated.filename, 'verified.gdr');
});

test('keeps app sign-in returns local and outside auth loops', () => {
  assert.equal(safeRelativeReturnPath('https://evil.example/path'), '/');
  assert.equal(safeRelativeReturnPath('//evil.example/path'), '/');
  assert.equal(safeRelativeReturnPath('/auth/session/start'), '/');
  assert.equal(safeRelativeReturnPath('/upload?from=home#drop'), '/upload?from=home#drop');
  assert.equal(appSignInPath('/upload'), '/auth/session/start?return_to=%2Fupload');
  const callback = appLoginCompletePath('/upload', 'state-123');
  assert.match(callback, /^\/auth\/session\/complete\?/);
  assert.equal(platformSignInPath(callback), `/signin-with-chatgpt?return_to=${encodeURIComponent(callback)}`);
  assert.equal(platformSignInPath('https://evil.example/callback'), '/signin-with-chatgpt?return_to=%2F');
});
