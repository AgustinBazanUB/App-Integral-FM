import test from "node:test";
import assert from "node:assert/strict";
import { VoiceAcknowledgement } from "../src/gestion/olivia/voiceAcknowledgement.mjs";
test("native timer defaults retain the browser global receiver", () => {
  const set = globalThis.setTimeout, clear = globalThis.clearTimeout;
  try {
    globalThis.setTimeout = function () { assert.equal(this, globalThis); return 123; };
    globalThis.clearTimeout = function () { assert.equal(this, globalThis); };
    const ack = new VoiceAcknowledgement({ load: async () => new Response(), play: async () => {} });
    ack.start(); ack.cancel();
  } finally { globalThis.setTimeout = set; globalThis.clearTimeout = clear; }
});

test("a session reuses one synthesis and cancels acknowledgements when the real answer arrives", async () => {
  let callback, loads = 0, plays = 0, signal;
  const ack = new VoiceAcknowledgement({ load: async () => { loads++; return new Response(new Uint8Array([0, 1, 2, 3])); }, play: async (_response, options) => { plays++; signal = options.signal; }, setTimer: fn => { callback = fn; return 1; }, clearTimer: () => {} });
  await ack.warm(); ack.start(); await callback();
  assert.equal(plays, 1);
  ack.cancel(); assert.equal(signal.aborted, false); // already completed
  ack.start(); ack.cancel(); await callback();
  assert.equal(plays, 1);
  ack.start(); await callback(); assert.equal(plays, 2); assert.equal(loads, 1);
  ack.dispose();
});
test("a late synthesis or failed preload cannot speak over the final answer", async () => {
  let callback, resolve, plays = 0;
  const ack = new VoiceAcknowledgement({ load: () => new Promise(done => { resolve = done; }), play: async () => { plays++; }, setTimer: fn => { callback = fn; }, clearTimer: () => {} });
  const warm = ack.warm(); await Promise.resolve(); ack.start(); const pending = callback(); ack.cancel();
  resolve(new Response(new Uint8Array([0, 0]))); await warm; await pending;
  assert.equal(plays, 0);
  const failed = new VoiceAcknowledgement({ load: async () => { throw new Error("offline"); }, play: async () => { plays++; }, setTimer: fn => { callback = fn; }, clearTimer: () => {} });
  failed.start(); await callback(); assert.equal(plays, 0);
});
test("speech or the final answer aborts an acknowledgement that is already playing", async () => {
  let callback, finish, playbackSignal;
  const ack = new VoiceAcknowledgement({ load: async () => new Response(new Uint8Array([0, 1])), play: async (_response, { signal }) => { playbackSignal = signal; await new Promise(resolve => { finish = resolve; }); }, setTimer: fn => { callback = fn; }, clearTimer: () => {} });
  await ack.warm(); ack.start(); const playback = callback(); await Promise.resolve();
  ack.cancel(); assert.equal(playbackSignal.aborted, true); finish(); await playback;
});
