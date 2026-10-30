import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { build } from "esbuild";
import { oliviaError } from "../src/shared/oliviaContracts.mjs";
import { json, errorResponse } from "../netlify/functions/_lib/olivia/http.mjs";
import { OLIVIA_VOICE_UNAVAILABLE_MESSAGE } from "../src/shared/oliviaVoiceAvailability.mjs";

const source = await readFile(new URL("../netlify/functions/olivia.mjs", import.meta.url), "utf8");
function endpoint(authenticated = true, identity = {}) {
  const calls = [];
  const context = vm.createContext({
    Buffer, Response, URL, console: { error() {} }, json, errorResponse, oliviaError,
    oliviaSession: async () => { if (!authenticated) throw oliviaError("unauthenticated", "Iniciá sesión.", 401); return { uid: "fixture-admin", ...identity }; },
    createOliviaStore: () => { calls.push("store"); return {}; },
    resolveOliviaPricing: () => ({}),
    createOliviaEngine: () => new Proxy({}, { get: (_, operation) => async () => { calls.push(operation); return { operation }; } }),
  });
  vm.runInContext(source.replace(/^import .*;\r?\n/gm, "").replace("export default async function handler", "globalThis.handler = async function handler"), context);
  return { calls, request: body => context.handler(new Request("https://preview.test/.netlify/functions/olivia", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })) };
}

test("GPT-Live, Realtime y el medidor legacy quedan retirados para cualquier cuenta", async () => {
  for (const operation of ["realtime", "realtimeTool", "realtimeTranscript", "interruptVoice", "stopRealtime", "voiceCosts"]) {
    const h = endpoint();
    const response = await h.request({ operation, voiceMode: "realtime-mini", voiceProtocol: "live" });
    assert.equal(response.status, 410);
    assert.equal((await response.json()).code, "voice-mode-retired");
    assert.deepEqual(h.calls, []);
  }
});

test("deshabilitar voz conserva la autenticación y las rutas de chat, historial, configuración y confirmación", async () => {
  const denied = endpoint(false);
  assert.equal((await denied.request({ operation: "realtime" })).status, 401);
  assert.deepEqual(denied.calls, []);
  for (const [operation, expected] of [["state", "state"], ["chat", "chat"], ["history", "history"], ["configuration", "getConfiguration"], ["confirm", "confirm"]]) {
    const h = endpoint();
    const response = await h.request({ operation });
    assert.equal(response.status, 200);
    assert.deepEqual(h.calls, ["store", expected]);
  }
});

test("la voz nueva no se configura ni activa mediante parámetros enviados por el cliente", async () => {
  const h = endpoint(true, { email: "agsreserva@gmail.com" });
  const response = await h.request({ operation: "chat", inputMode: "natural-voice", voiceProtocol: "live", voiceMode: "realtime-mini" });
  assert.equal(response.status, 200);
  assert.deepEqual(h.calls, ["store", "chat"]);
});

test("el handler real de la interfaz anuncia la pausa sin pedir micrófono ni crear una conexión", async () => {
  const assistant = await readFile(new URL("../src/gestion/olivia/OliviaAssistant.jsx", import.meta.url), "utf8");
  const handler = assistant.match(/const startVoice = \(\) => \{[\s\S]*?\n  \};/)[0];
  let notice = "", elapsed = 0, sequence = 0;
  const timers = new Map();
  const advance = duration => { elapsed += duration; for (const [id, timer] of timers) if (timer.at <= elapsed) { timers.delete(id); timer.callback(); } };
  const context = vm.createContext({ snapshot: { voiceConversationAvailable: false }, OLIVIA_VOICE_UNAVAILABLE_MESSAGE, voiceNoticeTimer: { current: null }, clearTimeout: id => timers.delete(id), setTimeout: (callback, duration) => { const id = ++sequence; timers.set(id, { callback, at: elapsed + duration }); return id; }, setVoiceNotice: value => { notice = value; } });
  vm.runInContext(`${handler}\nstartVoice();`, context);
  assert.equal(notice, OLIVIA_VOICE_UNAVAILABLE_MESSAGE);
  advance(2999); assert.equal(notice, OLIVIA_VOICE_UNAVAILABLE_MESSAGE);
  advance(1); assert.equal(notice, "");
  vm.runInContext("startVoice();", context);
  advance(1500); vm.runInContext('startVoice();', context);
  advance(2999); assert.equal(notice, OLIVIA_VOICE_UNAVAILABLE_MESSAGE);
  advance(1); assert.equal(notice, "");
});

const composerBundle = await build({ entryPoints: ["src/gestion/olivia/OliviaComposer.jsx"], bundle: true, write: false, platform: "node", format: "esm", jsx: "automatic", plugins: [{ name: "voice-composer-render", setup(b) {
  b.onResolve({ filter: /^react$|^react\/jsx-runtime$|design-system$/ }, args => ({ path: args.path, namespace: "qa" }));
  b.onLoad({ filter: /.*/, namespace: "qa" }, ({ path }) => ({ contents: path === "react" ? "export const useEffect=()=>{};export const useRef=()=>({current:null});" : path === "react/jsx-runtime" ? "export const jsx=(type,props)=>({type,props});export const jsxs=jsx;" : "export const IconButton='IconButton';" }));
} }] });
const { default: Composer } = await import(`data:text/javascript;base64,${Buffer.from(composerBundle.outputFiles[0].text).toString("base64")}`);
const elements = node => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(elements) : [node, ...elements(node.props?.children)];

test("la conversación se oculta para otras cuentas y no ofrece un selector de modelos", () => {
  let clicks = 0;
  const tree = Composer({ textareaRef: { current: null }, draft: "", attachments: [], busy: true, disabled: true, startVoice: () => clicks++, voiceTrialAvailable: true });
  const nodes = elements(tree);
  const voice = nodes.find(n => n.props?.label === "Conversar con Olivia por voz");
  assert.equal(voice, undefined);
  assert.equal(clicks, 0);
  const enabled = elements(Composer({ textareaRef: { current: null }, draft: "", attachments: [], busy: false, disabled: false, voiceAvailable: true, startVoice: () => clicks++ }));
  const available = enabled.find(n => n.props?.label === "Conversar con Olivia por voz");
  assert.equal(available.props.disabled, false);
  available.props.onClick();
  assert.equal(clicks, 1);
  assert.equal(nodes.some(n => n.props?.["aria-label"] === "Modo de conversación por voz"), false);
});

test("el dictado y el envío de texto mantienen sus handlers disponibles", () => {
  let dictated = 0, sent = 0;
  const tree = Composer({ textareaRef: { current: null }, draft: "Consultá las ventas", attachments: [], busy: false, disabled: false, startRecording: () => dictated++, sendMessage: () => sent++ });
  const nodes = elements(tree);
  const dictation = nodes.find(n => n.props?.label === "Dictar un mensaje");
  const send = nodes.find(n => n.props?.label === "Enviar mensaje");
  assert.equal(dictation.props.disabled, false);
  assert.equal(send.props.disabled, false);
  dictation.props.onClick(); send.props.onClick();
  assert.deepEqual([dictated, sent], [1, 1]);
});
