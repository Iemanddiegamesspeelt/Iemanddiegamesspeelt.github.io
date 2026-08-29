import { encode } from '@msgpack/msgpack';
import type { CanonicalReplayV1, ReplayEvent } from '../types';
import {
  ReplayBinaryWriter,
  assessInputFormat,
  checkedFrame,
  controlButton,
  effectiveDuration,
  inputEvents,
  jsonBytes,
  makeExporter,
  replayRate,
  safeBaseName,
  zbotTimingPair,
} from './export-utils';

const VERSION = '1.0.0';
const U32_MAX = 0xffff_ffffn;
const I32_MAX = 0x7fff_ffffn;
const SLC_FRAME_MAX = 0x0fff_ffffn;

function artifact(replay: CanonicalReplayV1, extension: string, mediaType: string, bytes: Uint8Array) {
  return { bytes, filename: `${safeBaseName(replay)}${extension}`, extension, mediaType };
}

function assessment(
  replay: CanonicalReplayV1,
  code: string,
  label: string,
  options: Partial<Parameters<typeof assessInputFormat>[1]> = {},
) {
  return assessInputFormat(replay, {
    code,
    label,
    controls: 'jump',
    rate: 'f32',
    maxFrame: U32_MAX,
    ...options,
  });
}

function gdrObject(replay: CanonicalReplayV1) {
  const rate = replayRate(replay);
  const levelId = replay.level.id?.value && /^\d+$/.test(replay.level.id.value)
    ? Number(replay.level.id.value)
    : 0;
  const gameVersion = Number(replay.recording.geometryDashVersion?.value ?? 0);
  return {
    gameVersion: Number.isFinite(gameVersion) ? gameVersion : 0,
    description: '',
    version: 1,
    duration: Number(effectiveDuration(replay)) / rate,
    author: '',
    seed: 0,
    coins: 0,
    ldm: false,
    bot: { name: 'MacroHub', version: VERSION },
    level: { id: Number.isSafeInteger(levelId) && levelId >= 0 ? levelId : 0, name: replay.level.name?.value ?? '' },
    inputs: inputEvents(replay).map((event) => ({
      frame: checkedFrame(event),
      btn: controlButton(event),
      '2p': event.player === 2,
      down: event.state === 'press',
    })),
    framerate: rate,
  };
}

const assessGdr = (replay: CanonicalReplayV1) => assessment(replay, 'GDR', 'GDR', {
  controls: 'all', rate: 'number', maxFrame: U32_MAX, storesDuration: true, storesLevel: true,
});

export const gdrExporter = makeExporter(VERSION, assessGdr, async (replay) => (
  artifact(replay, '.gdr', 'application/octet-stream', encode(gdrObject(replay)))
));

export const gdrJsonExporter = makeExporter(VERSION, assessGdr, async (replay) => (
  artifact(replay, '.gdr.json', 'application/json', jsonBytes(gdrObject(replay)))
));

export const mhrJsonExporter = makeExporter(
  VERSION,
  (replay) => assessment(replay, 'MHR_JSON', 'MHR JSON', { rate: 'number', maxFrame: U32_MAX }),
  async (replay) => artifact(replay, '.mhr.json', 'application/json', jsonBytes({
    _: 'MacroHub',
    events: inputEvents(replay).map((event) => ({
      frame: checkedFrame(event),
      down: event.state === 'press',
      ...(event.player === 2 ? { p2: true } : {}),
    })),
    meta: { fps: replayRate(replay) },
  })),
);

const MHR_FOOTER = [0xfa, 0x67, 0x55, 0x5a, 0x8d, 0x95, 0x94, 0x07, 0xc9, 0x8c, 0xba, 0x7f, 0x75, 0x9c, 0xef, 0x3c] as const;
export const mhrBinaryExporter = makeExporter(
  VERSION,
  (replay) => assessment(replay, 'MHR', 'MHR', { rate: 'integer-i32', maxFrame: I32_MAX }),
  async (replay) => {
    const events = inputEvents(replay);
    const writer = new ReplayBinaryWriter();
    writer.writeBytes([0x48, 0x41, 0x43, 0x4b, 0x50, 0x52, 0x4f, 0x07]);
    writer.writeI32LE(4);
    writer.writeI32LE(replayRate(replay));
    writer.writeBytes(new Uint8Array(8));
    writer.writeU32LE(32);
    writer.writeU32LE(events.length);
    for (const event of events) {
      writer.writeU16LE(1);
      writer.writeU8(event.state === 'press' ? 1 : 0);
      writer.writeU8(event.player === 2 ? 1 : 0);
      writer.writeI32LE(checkedFrame(event, I32_MAX));
      writer.writeBytes(new Uint8Array(24));
    }
    writer.writeBytes(MHR_FOOTER);
    return artifact(replay, '.mhr', 'application/octet-stream', writer.finish());
  },
);

export const echoExporter = makeExporter(
  VERSION,
  (replay) => assessment(replay, 'ECHO', 'ECHO', { rate: 'f32', maxFrame: U32_MAX }),
  async (replay) => {
    const writer = new ReplayBinaryWriter();
    writer.writeBytes([0x4d, 0x45, 0x54, 0x41]);
    writer.writeBytes(new Uint8Array(20));
    writer.writeF32LE(replayRate(replay));
    writer.writeBytes(new Uint8Array(20));
    for (const event of inputEvents(replay)) {
      writer.writeU32LE(checkedFrame(event));
      writer.writeU8(event.state === 'press' ? 1 : 0);
      writer.writeU8(event.player === 2 ? 1 : 0);
    }
    return artifact(replay, '.echo', 'application/octet-stream', writer.finish());
  },
);

function textArtifact(replay: CanonicalReplayV1, extension: string, text: string) {
  return artifact(replay, extension, 'text/plain; charset=utf-8', new TextEncoder().encode(text));
}

export const xbotExporter = makeExporter(
  VERSION,
  (replay) => assessment(replay, 'XBOT', 'XBOT', { rate: 'integer-i32', maxFrame: U32_MAX }),
  async (replay) => textArtifact(replay, '.xbot', `${replayRate(replay)}\nframes\n${inputEvents(replay).map((event) => `${(event.player === 2 ? 2 : 0) | (event.state === 'press' ? 1 : 0)} ${checkedFrame(event)}`).join('\n')}\n`),
);

export const xdbotExporter = makeExporter(
  VERSION,
  (replay) => assessment(replay, 'XD', 'XD', { controls: 'all', rate: 'number', maxFrame: U32_MAX }),
  async (replay) => textArtifact(replay, '.xd', `${replayRate(replay)}\n${inputEvents(replay).map((event) => `${checkedFrame(event)}|${event.state === 'press' ? 1 : 0}|${controlButton(event)}|${event.player === 1 ? 1 : 0}|0`).join('\n')}\n`),
);

function writeSimpleFrameTable(
  replay: CanonicalReplayV1,
  header: (writer: ReplayBinaryWriter) => void,
  writeEvent: (writer: ReplayBinaryWriter, event: ReturnType<typeof inputEvents>[number]) => void,
) {
  const writer = new ReplayBinaryWriter();
  header(writer);
  for (const event of inputEvents(replay)) writeEvent(writer, event);
  return writer.finish();
}

export const rushExporter = makeExporter(
  VERSION,
  (replay) => assessment(replay, 'RSH', 'RSH', { rate: 'integer-i16', maxFrame: I32_MAX }),
  async (replay) => artifact(replay, '.rsh', 'application/octet-stream', writeSimpleFrameTable(
    replay,
    (writer) => writer.writeI16LE(replayRate(replay)),
    (writer, event) => { writer.writeI32LE(checkedFrame(event, I32_MAX)); writer.writeU8((event.state === 'press' ? 1 : 0) | (event.player === 2 ? 2 : 0)); },
  )),
);

export const kdbotExporter = makeExporter(
  VERSION,
  (replay) => assessment(replay, 'KD', 'KD', { rate: 'f32', maxFrame: I32_MAX }),
  async (replay) => artifact(replay, '.kd', 'application/octet-stream', writeSimpleFrameTable(
    replay,
    (writer) => writer.writeF32LE(replayRate(replay)),
    (writer, event) => { writer.writeI32LE(checkedFrame(event, I32_MAX)); writer.writeU8(event.state === 'press' ? 1 : 0); writer.writeU8(event.player === 2 ? 1 : 0); },
  )),
);

export const zbotExporter = makeExporter(
  VERSION,
  (replay) => assessment(replay, 'ZBF', 'ZBF', { rate: 'zbot', maxFrame: I32_MAX }),
  async (replay) => {
    const timing = zbotTimingPair(replayRate(replay));
    if (!timing) throw new Error('ZBF cannot represent this replay rate');
    return artifact(replay, '.zbf', 'application/octet-stream', writeSimpleFrameTable(
      replay,
      (writer) => { writer.writeF32LE(timing.delta); writer.writeF32LE(timing.speedhack); },
      (writer, event) => {
        writer.writeI32LE(checkedFrame(event, I32_MAX));
        writer.writeU8(event.state === 'press' ? 0x31 : 0x30);
        writer.writeU8(event.player === 1 ? 0x31 : 0x30);
      },
    ));
  },
);

export const fembotExporter = makeExporter(
  VERSION,
  (replay) => assessment(replay, 'FREPLAY', 'FREPLAY', { rate: 'f32', maxFrame: U32_MAX }),
  async (replay) => artifact(replay, '.freplay', 'application/octet-stream', writeSimpleFrameTable(
    replay,
    (writer) => { writer.writeBytes([0x46, 0x42, 0x52, 0x50]); writer.writeF32LE(replayRate(replay)); },
    (writer, event) => {
      writer.writeU8((event.state === 'press' ? 1 : 0) | (event.player === 2 ? 2 : 0));
      writer.writeU32LE(checkedFrame(event));
      writer.writeBytes(new Uint8Array(60));
    },
  )),
);

export const replayBotExporter = makeExporter(
  VERSION,
  (replay) => assessment(replay, 'RPLY', 'RPLY v2', { rate: 'f32', maxFrame: U32_MAX }),
  async (replay) => artifact(replay, '.replay', 'application/octet-stream', writeSimpleFrameTable(
    replay,
    (writer) => { writer.writeBytes([0x52, 0x50, 0x4c, 0x59, 2, 1]); writer.writeF32LE(replayRate(replay)); },
    (writer, event) => { writer.writeU32LE(checkedFrame(event)); writer.writeU8((event.state === 'press' ? 1 : 0) | (event.player === 2 ? 2 : 0)); },
  )),
);

function amethystRank(event: ReplayEvent): number {
  if (event.kind !== 'input') return 0;
  return (event.player === 2 ? 2 : 0) + (event.state === 'release' ? 1 : 0);
}

export const amethystExporter = makeExporter(
  VERSION,
  (replay) => assessment(replay, 'THYST', 'THYST', { rate: 'fixed-240', maxFrame: U32_MAX, orderRank: amethystRank }),
  async (replay) => {
    const groups = [
      inputEvents(replay).filter((event) => event.player === 1 && event.state === 'press'),
      inputEvents(replay).filter((event) => event.player === 1 && event.state === 'release'),
      inputEvents(replay).filter((event) => event.player === 2 && event.state === 'press'),
      inputEvents(replay).filter((event) => event.player === 2 && event.state === 'release'),
    ];
    const lines = groups.flatMap((group) => [String(group.length), ...group.map((event) => String(Number(BigInt(event.tick)) / 240))]);
    return textArtifact(replay, '.thyst', `${lines.join('\n')}\n`);
  },
);

export const tasbotJsonExporter = makeExporter(
  VERSION,
  (replay) => assessment(replay, 'TASBOT_JSON', 'TASBOT JSON', { rate: 'number', maxFrame: U32_MAX }),
  async (replay) => artifact(replay, '.json', 'application/json', jsonBytes({
    fps: replayRate(replay),
    macro: inputEvents(replay).map((event) => ({
      frame: checkedFrame(event),
      player_1: { click: event.player === 1 ? (event.state === 'press' ? 1 : 2) : 0, x_position: 0 },
      player_2: { click: event.player === 2 ? (event.state === 'press' ? 1 : 2) : 0, x_position: 0 },
    })),
  })),
);

export const ybotExporter = makeExporter(
  VERSION,
  (replay) => assessment(replay, 'YBOT', 'YBOT', { controls: 'all', rate: 'f32', maxFrame: U32_MAX, storesDuration: true }),
  async (replay) => {
    const events = inputEvents(replay);
    const writer = new ReplayBinaryWriter();
    writer.writeBytes([0x79, 0x62, 0x6f, 0x74]);
    writer.writeU32LE(0);
    writer.writeU32LE(36);
    writer.writeU32LE(0);
    writer.writeI64LE(0n);
    writer.writeU64LE(BigInt(events.filter((event) => event.state === 'press').length));
    writer.writeU64LE(effectiveDuration(replay));
    writer.writeF32LE(replayRate(replay));
    writer.writeU64LE(BigInt(events.length));
    let last = 0n;
    for (const event of events) {
      const frame = BigInt(event.tick);
      const flags = (event.player === 1 ? 1 : 0)
        | (event.state === 'press' ? 2 : 0)
        | ((controlButton(event) ?? 0) << 2);
      writer.writeVarUint(((frame - last) << 4n) | BigInt(flags));
      last = frame;
    }
    return artifact(replay, '.ybot', 'application/octet-stream', writer.finish());
  },
);

export const omegaBot2Exporter = makeExporter(
  VERSION,
  (replay) => assessment(replay, 'OMEGABOT2', 'REPLAY v2', { rate: 'f32', maxFrame: U32_MAX }),
  async (replay) => {
    const events = inputEvents(replay);
    const writer = new ReplayBinaryWriter();
    writer.writeF32LE(replayRate(replay));
    writer.writeF32LE(replayRate(replay));
    writer.writeU32LE(1);
    writer.writeU64LE(0n);
    writer.writeU64LE(BigInt(events.length));
    for (const event of events) {
      writer.writeU32LE(1);
      writer.writeU32LE(checkedFrame(event));
      writer.writeU32LE(event.player === 1
        ? (event.state === 'press' ? 2 : 3)
        : (event.state === 'press' ? 4 : 5));
    }
    return artifact(replay, '.replay', 'application/octet-stream', writer.finish());
  },
);

export const slcExporter = makeExporter(
  VERSION,
  (replay) => assessment(replay, 'SLC', 'SLC', { controls: 'all', rate: 'number', maxFrame: SLC_FRAME_MAX }),
  async (replay) => {
    const events = inputEvents(replay);
    const writer = new ReplayBinaryWriter();
    writer.writeF64LE(replayRate(replay));
    writer.writeU32LE(events.length);
    for (const event of events) {
      const packed = (checkedFrame(event, SLC_FRAME_MAX) << 4)
        | ((event.player === 2 ? 1 : 0) << 3)
        | ((controlButton(event) ?? 0) << 1)
        | (event.state === 'press' ? 1 : 0);
      writer.writeU32LE(packed);
    }
    return artifact(replay, '.slc', 'application/octet-stream', writer.finish());
  },
);

export const tcmExporter = makeExporter(
  VERSION,
  (replay) => assessment(replay, 'TCM', 'TCM', { controls: 'all', rate: 'f32', maxFrame: U32_MAX }),
  async (replay) => {
    const events = inputEvents(replay);
    const writer = new ReplayBinaryWriter();
    writer.writeBytes([0x9f, 0x88, 0x89, 0x84, 0x9f, 0x3b, 0x1d, 0xd8, 0xcc, 0xa1, 0x86, 0x8a, 0x88, 0x99, 0x84, 0x00]);
    writer.writeBytes([1, 0, 0, 0]);
    writer.writeF32LE(replayRate(replay));
    writer.writeU64LE(0n);
    writer.writeBytes(new Uint8Array(48));
    writer.writeVarUint(events.length);
    for (const event of events) {
      writer.writeVarUint(BigInt(event.tick));
      writer.writeU8(((controlButton(event) ?? 1) - 1)
        | (event.player === 2 ? 0x40 : 0)
        | (event.state === 'press' ? 0x80 : 0));
    }
    writer.writeU8(0xcc);
    return artifact(replay, '.tcm', 'application/octet-stream', writer.finish());
  },
);

export const cmlExporter = makeExporter(
  VERSION,
  (replay) => assessment(replay, 'CML', 'CML', { controls: 'all', rate: 'f32', maxFrame: BigInt(Number.MAX_SAFE_INTEGER) }),
  async (replay) => {
    const events = inputEvents(replay);
    const writer = new ReplayBinaryWriter();
    writer.writeBytes([0x43, 0x4d, 0x4c, 0x00]);
    writer.writeVarUint(1);
    writer.writeLengthPrefixedString('');
    writer.writeLengthPrefixedString('');
    writer.writeF32LE(replay.recording.completionPercent?.value ?? 0);
    writer.writeF32LE(0);
    writer.writeF32LE(1);
    writer.writeF32LE(replayRate(replay));
    writer.writeVarInt(0n);
    writer.writeVarInt(0n);
    writer.writeU8(0);
    writer.writeVarInt(effectiveDuration(replay));
    writer.writeLengthPrefixedString('MacroHub');
    writer.writeLengthPrefixedString(VERSION);
    writer.writeVarUint(0);
    writer.writeLengthPrefixedString(replay.level.name?.value ?? '');
    writer.writeVarUint(events.length);
    let previous = 0n;
    for (const event of events) {
      const frame = BigInt(event.tick);
      writer.writeVarInt(frame - previous);
      writer.writeU8(((controlButton(event) ?? 1) << 2)
        | (event.player === 2 ? 2 : 0)
        | (event.state === 'press' ? 1 : 0));
      previous = frame;
    }
    writer.writeVarUint(0);
    return artifact(replay, '.cml', 'application/octet-stream', writer.finish());
  },
);

export const gdmoExporter = makeExporter(
  VERSION,
  (replay) => assessment(replay, 'MACRO', 'MACRO', { controls: 'all', rate: 'fixed-240', maxFrame: U32_MAX }),
  async (replay) => {
    const events = inputEvents(replay);
    const writer = new ReplayBinaryWriter();
    writer.writeU32LE(events.length);
    for (const event of events) {
      writer.writeF64LE(Number(BigInt(event.tick)) / 240);
      writer.writeI32LE(controlButton(event) ?? 1);
      writer.writeU8(event.state === 'press' ? 1 : 0);
      writer.writeU8(event.player === 1 ? 1 : 0);
      writer.writeBytes([0, 0]);
    }
    writer.writeU32LE(0);
    return artifact(replay, '.macro', 'application/octet-stream', writer.finish());
  },
);
