import { streamFrame } from "../../../../src/shared/oliviaStream.mjs";

// Keep the response active while reasoning or tools have no visible output.
export function chatStream(run, { setIntervalImpl = setInterval, clearIntervalImpl = clearInterval } = {}) {
  const abort = new AbortController();
  let heartbeat;
  return new ReadableStream({
    start(controller) {
      const emit = (event) => { if (!abort.signal.aborted) controller.enqueue(streamFrame(event)); };
      emit({ type: "phase", label: "Olivia está pensando la respuesta…" });
      heartbeat = setIntervalImpl(() => emit({ type: "heartbeat" }), 5000);
      Promise.resolve().then(() => run({ onEvent: emit, signal: abort.signal }))
        .then((result) => emit({ type: "completed", result }))
        .catch((error) => emit({ type: "failed", code: error.code || "assistant-error", message: error.status && error.status < 500 ? error.message : "La respuesta se interrumpió. El chat se conserva y podés recuperarlo." }))
        .finally(() => { clearIntervalImpl(heartbeat); if (!abort.signal.aborted) controller.close(); });
    },
    cancel() { clearIntervalImpl(heartbeat); abort.abort(); },
  });
}
