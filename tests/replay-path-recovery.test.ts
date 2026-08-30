import assert from 'node:assert/strict';
import test from 'node:test';
import { encode } from '@msgpack/msgpack';
import { getFormat } from '../lib/replay/registry';
import { hasRecordedPath, recoverRecordedPath } from '../lib/replay/recover-path';

const source = {
  gameVersion: 2.2081, version: 1, framerate: 240,
  bot: { name: 'xdBot', version: 'v2.5-Nako' },
  level: { id: 4, name: 'Dry Out' },
  inputs: [{ frame: 3, btn: 1, '2p': false, down: true }],
  frameFixes: [
    { frame: 3, p1: { x: 2.596500873565674, y: 105 } },
    { frame: 4, p1: { x: 3.8, y: 108, r: 12 } },
  ],
};

async function legacyReplay() {
  const parsed = await getFormat('gdr')!.parser!.parse({ bytes: encode(source), filename: 'original.gdr' });
  return { ...parsed.replay, events: parsed.replay.events.filter((event) => event.kind !== 'player-state') };
}

test('recovers an older xdBot upload from its original binary GDR', async () => {
  const canonical = await legacyReplay();
  assert.equal(hasRecordedPath(canonical), false);
  const recovered = await recoverRecordedPath(canonical, async () => ({ bytes: encode(source), filename: 'original.gdr' }));
  const states = recovered.events.filter((event) => event.kind === 'player-state');
  assert.equal(states.length, 2);
  assert.equal(states[0].x, source.frameFixes[0].p1.x);
  assert.equal(states[1].rotation, 12);
  assert.deepEqual(recovered.events.filter((event) => event.kind === 'input'), canonical.events);
});

test('does not download the original when the canonical replay already has a path', async () => {
  const { replay } = await getFormat('gdr')!.parser!.parse({ bytes: encode(source), filename: 'original.gdr' });
  let requested = false;
  const result = await recoverRecordedPath(replay, async () => { requested = true; return null; });
  assert.equal(requested, false);
  assert.equal(result, replay);
});

test('keeps a macro usable when the original is missing, inaccessible, or malformed', async () => {
  const canonical = await legacyReplay();
  assert.equal(await recoverRecordedPath(canonical, async () => null), canonical);
  assert.equal(await recoverRecordedPath(canonical, async () => { throw new Error('Network unavailable'); }), canonical);
  assert.equal(await recoverRecordedPath(canonical, async () => ({ bytes: new Uint8Array([1, 2, 3]), filename: 'original.gdr' })), canonical);
});

test('does not invent a path for an input-only original', async () => {
  const canonical = await legacyReplay();
  const result = await recoverRecordedPath(canonical, async () => ({ bytes: encode({ ...source, frameFixes: [] }), filename: 'original.gdr' }));
  assert.equal(result, canonical);
  assert.equal(hasRecordedPath(result), false);
});
