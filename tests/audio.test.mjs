import test from "node:test";
import assert from "node:assert/strict";
import { describeAudio, encodeMonoWav, mixToMono, prepareRecording } from "../lib/audio.ts";

test("WAV contains a valid mono PCM header, sample rate, data length and signed samples", () => {
  const buffer = encodeMonoWav(new Float32Array([-1, -0.5, 0, 0.5, 1]), 16000);
  const view = new DataView(buffer);
  const text = (start, length) => new TextDecoder().decode(new Uint8Array(buffer, start, length));
  assert.equal(text(0, 4), "RIFF"); assert.equal(text(8, 4), "WAVE"); assert.equal(text(36, 4), "data");
  assert.equal(view.getUint16(20, true), 1); assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 16000); assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(4, true), buffer.byteLength - 8); assert.equal(view.getUint32(40, true), 10);
  assert.equal(view.getInt16(44, true), -32768); assert.equal(view.getInt16(48, true), 0); assert.equal(view.getInt16(52, true), 32767);
});
test("stereo is mixed to mono and amplitude is clamped without integer overflow", () => {
  const mono = mixToMono([new Float32Array([1, 0.5, -1]), new Float32Array([0, 0.5, -1])]);
  assert.deepEqual([...mono], [0.5, 0.5, -1]);
  const view = new DataView(encodeMonoWav(new Float32Array([2, -2, NaN]), 16000));
  assert.deepEqual([44, 46, 48].map((offset) => view.getInt16(offset, true)), [32767, -32768, 0]);
  assert.throws(() => mixToMono([new Float32Array(1), new Float32Array(2)]));
  assert.throws(() => encodeMonoWav(new Float32Array(), 16000));
});
test("duration and volume describe captured samples without pretending to assess speech clarity", () => {
  const details = describeAudio(new Float32Array(16000).fill(0.25), 16000);
  assert.equal(details.duration, 1); assert.equal(details.peak, 0.25); assert.equal(details.rms, 0.25);
});
test("completed browser audio is decoded before WAV output and unusable captures stop locally", async () => {
  const original = globalThis.OfflineAudioContext;
  let frameCount = 16000;
  let fail = false;
  globalThis.OfflineAudioContext = class {
    constructor(channels, frames, rate) { assert.equal(channels, 1); assert.equal(rate, 16000); }
    async decodeAudioData(bytes) {
      assert.equal(bytes.byteLength, 4);
      if (fail) throw new Error("invalid compressed file");
      return { numberOfChannels: 1, sampleRate: 16000, getChannelData: () => new Float32Array(frameCount) };
    }
  };
  try {
    const result = await prepareRecording(new Blob([new Uint8Array(4)], { type: "audio/webm" }));
    assert.equal(result.audio.type, "audio/wav"); assert.equal(result.audio.size, 32044); assert.equal(result.details.duration, 1);
    frameCount = 1;
    await assert.rejects(() => prepareRecording(new Blob([new Uint8Array(4)])), /at least one second/);
    frameCount = 30 * 16000;
    await assert.rejects(() => prepareRecording(new Blob([new Uint8Array(4)])), /under 20 seconds/);
    fail = true;
    await assert.rejects(() => prepareRecording(new Blob([new Uint8Array(4)])), /could not read/);
  } finally { if (original) globalThis.OfflineAudioContext = original; else delete globalThis.OfflineAudioContext; }
});
