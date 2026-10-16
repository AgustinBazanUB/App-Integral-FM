import test from "node:test";
import assert from "node:assert/strict";
import { createCourierGps } from "../src/gestion/shipping/courierGps.mjs";

function harness(implementation = async () => ({ saved: true })) {
  const states = [], requests = [], cleared = [];
  let success, failure, tick, time = Date.parse("2026-10-16T20:00:00Z"), sequence = 0, currentRequests = 0;
  const request = async (body, options) => { requests.push(body); return implementation(body, options); };
  const gps = createCourierGps({ request, onChange: state => states.push(state), clock: () => time, makeId: () => `session-${++sequence}`,
    geolocation: { watchPosition: (yes, no) => { success = yes; failure = no; return sequence; }, clearWatch: id => cleared.push(id), getCurrentPosition: () => { currentRequests++; } },
    every: callback => { tick = callback; return sequence; }, cancelEvery: () => { tick = null; } });
  return { gps, states, requests, cleared, state: () => states.at(-1), advance: () => { time += 20000; tick?.(); }, currentRequests: () => currentRequests,
    locate: () => success({ coords: { latitude: -34.6, longitude: -58.4, accuracy: 12 }, timestamp: time }), fail: code => failure({ code }) };
}

test("courier GPS confirms sharing only after server acknowledgement and refreshes a stationary device", async () => {
  let acknowledge;
  const h = harness(body => body.mode === "position" ? new Promise(resolve => { acknowledge = resolve; }) : Promise.resolve({}));
  await h.gps.start(); assert.equal(h.state().phase, "waiting");
  const publishing = h.locate(); assert.equal(h.state().phase, "sending");
  assert(!h.states.some(state => state.phase === "sharing"));
  acknowledge({ saved: true }); await publishing;
  assert.equal(h.state().phase, "sharing"); assert.equal(h.state().accuracy, 12); assert(h.state().confirmedAt);
  h.advance(); assert.equal(h.currentRequests(), 1);
  const next = h.locate(); acknowledge({ saved: true }); await next;
  const positions = h.requests.filter(body => body.mode === "position");
  assert.equal(positions.length, 2); assert.notEqual(positions[0].point.observedAt, positions[1].point.observedAt);
  await h.gps.stop(); assert.equal(h.state().active, false); assert.equal(h.requests.at(-1).mode, "gps_stop"); assert.equal(h.cleared.length, 1);
});

test("courier GPS discards late success after stop, including when a request was already in flight", async () => {
  let acknowledge;
  const h = harness(body => body.mode === "position" ? new Promise(resolve => { acknowledge = resolve; }) : Promise.resolve({}));
  await h.gps.start(); const publishing = h.locate();
  await h.gps.stop(); acknowledge({ saved: true }); await publishing;
  assert.equal(h.state().phase, "stopped"); assert(!h.states.some(state => state.phase === "sharing"));
  await h.locate(); assert.equal(h.requests.filter(body => body.mode === "position").length, 1);
});

test("courier GPS explains denied permission and clears watches without reporting success", async () => {
  const h = harness(); await h.gps.start(); h.fail(1);
  assert.equal(h.state().phase, "error"); assert.equal(h.state().active, false); assert.match(h.state().message, /Permiso.*denegado/);
  assert.equal(h.cleared.length, 1); assert.equal(h.requests.at(-1).mode, "gps_stop");
  await h.gps.start(); assert.equal(h.state().phase, "waiting"); await h.gps.stop();
});

test("courier GPS does not confirm failed uploads and retries with a real fresh measurement", async () => {
  let offline = true;
  const h = harness(async body => { if (body.mode === "position" && offline) throw new Error("offline"); return { saved: true }; });
  await h.gps.start(); await h.locate(); assert.equal(h.state().phase, "error"); assert.equal(h.state().active, true);
  offline = false; h.advance(); await h.locate(); assert.equal(h.state().phase, "sharing");
  await h.gps.stop();
});

test("courier GPS requires a secure compatible browser and closes revoked access", async () => {
  const states = [];
  const unsupported = createCourierGps({ secure: false, request: async () => assert.fail("must not send"), onChange: state => states.push(state) });
  await unsupported.start(); assert.equal(states.at(-1).phase, "error");
  const h = harness(async body => { if (body.mode === "position") throw Object.assign(new Error("Acceso revocado"), { status: 403 }); return {}; });
  await h.gps.start(); await h.locate(); assert.equal(h.state().active, false); assert.equal(h.state().phase, "error"); assert.match(h.state().message, /revocado/);
});

test("courier GPS does not display sharing when the server omits its saved acknowledgement", async () => {
  const h = harness(async () => ({}));
  await h.gps.start(); await h.locate();
  assert.equal(h.state().phase, "error"); assert(!h.states.some(state => state.phase === "sharing"));
  await h.gps.stop();
});
