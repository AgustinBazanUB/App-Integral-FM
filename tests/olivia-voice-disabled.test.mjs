import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { build } from "esbuild";
import { oliviaError } from "../src/shared/oliviaContracts.mjs";
import { json, errorResponse } from "../netlify/functions/_lib/olivia/http.mjs";
import { OLIVIA_VOICE_CONVERSATION_ENABLED, OLIVIA_VOICE_UNAVAILABLE_CODE, OLIVIA_VOICE_UNAVAILABLE_MESSAGE } from "../src/shared/oliviaVoiceAvailability.mjs";

const source = await readFile(new URL("../netlify/functions/olivia.mjs", import.meta.url), "utf8");
function endpoint(authenticated = true) {
  const calls = [];
  const context = vm.createContext({
    Buffer, Response, URL, console: { error() {} }, json, errorResponse, oliviaError,
    OLIVIA_VOICE_CONVERSATION_ENABLED, OLIVIA_VOICE_UNAVAILABLE_CODE, OLIVIA_VOICE_UNAVAILABLE_MESSAGE,
    oliviaSession: async () => { if (!authenticated) throw oliviaError("unauthenticated", "Iniciá sesión.", 401); return { uid: "fixture-admin" }; },
    createOliviaStore: () => { calls.push("store"); return {}; },
    resolveOliviaPricing: () => ({}),
    createOliviaEngine: () => new Proxy({}, { get: (_, operation) => async () => { calls.push(operation); return { operation }; } }),
    createRealtime: () => { calls.push("realtime"); throw new Error("No debe iniciar voz"); },
    createLive: () => { calls.push("live"); throw new Error("No debe iniciar voz"); },
    stopRealtime: async () => { calls.push("stopRealtime"); return { stopped: true }; },
  });
  vm.runInContext(source.replace(/^import .*;\r?\n/gm, "").replace("export default async function handler", "globalThis.handler = async function handler"), context);
  return { calls, request: body => context.handler(new Request("https://preview.test/.netlify/functions/olivia", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })) };
}

test("la ruta pública bloquea voz normal, Mini y parámetros de activación antes de abrir servicios o reservar consumo", async () => {
  for (const fields of [{}, { voiceMode: "realtime-mini" }, { nativeTools: true, voiceProtocol: "live", enabled: true }]) {
    const h = endpoint();
    const response = await h.request({ operation: "realtime", ...fields });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { code: OLIVIA_VOICE_UNAVAILABLE_CODE, message: OLIVIA_VOICE_UNAVAILABLE_MESSAGE });
    assert.deepEqual(h.calls, []);
  }
});

test("deshabilitar voz conserva la autenticación y las rutas de chat, historial, configuración y confirmación", async () => {
  const denied = endpoint(false);
  assert.equal((await denied.request({ operation: "realtime" })).status, 401);
  assert.deepEqual(denied.calls, []);
  for (const [operation, expected] of [["state", "state"], ["chat", "chat"], ["history", "history"], ["configuration", "getConfiguration"], ["confirm", "confirm"], ["stopRealtime", "stopRealtime"]]) {
    const h = endpoint();
    const response = await h.request({ operation });
    assert.equal(response.status, 200);
    assert.deepEqual(h.calls, ["store", expected]);
  }
});

test("el handler real de la interfaz anuncia la pausa sin pedir micrófono ni crear una conexión", async () => {
  const assistant = await readFile(new URL("../src/gestion/olivia/OliviaAssistant.jsx", import.meta.url), "utf8");
  const handler = assistant.match(/const startVoice = \(mode = "default"\) => \{[\s\S]*?\n  \};/)[0];
  let notice = "", elapsed = 0, sequence = 0;
  const timers = new Map();
  const advance = duration => { elapsed += duration; for (const [id, timer] of timers) if (timer.at <= elapsed) { timers.delete(id); timer.callback(); } };
  const context = vm.createContext({ OLIVIA_VOICE_CONVERSATION_ENABLED, OLIVIA_VOICE_UNAVAILABLE_MESSAGE, voiceNoticeTimer: { current: null }, clearTimeout: id => timers.delete(id), setTimeout: (callback, duration) => { const id = ++sequence; timers.set(id, { callback, at: elapsed + duration }); return id; }, setVoiceNotice: value => { notice = value; } });
  vm.runInContext(`${handler}\nstartVoice();`, context);
  assert.equal(notice, OLIVIA_VOICE_UNAVAILABLE_MESSAGE);
  advance(2999); assert.equal(notice, OLIVIA_VOICE_UNAVAILABLE_MESSAGE);
  advance(1); assert.equal(notice, "");
  vm.runInContext('startVoice("realtime-mini");', context);
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

test("el botón de voz muestra el aviso incluso sin servicio o mientras responde; no ofrece el selector Mini", () => {
  let clicks = 0;
  const tree = Composer({ textareaRef: { current: null }, draft: "", attachments: [], busy: true, disabled: true, startVoice: () => clicks++, voiceTrialAvailable: true });
  const nodes = elements(tree);
  const voice = nodes.find(n => n.props?.label === "Conversar con Olivia por voz");
  assert.equal(voice.props.disabled, false);
  voice.props.onClick();
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
