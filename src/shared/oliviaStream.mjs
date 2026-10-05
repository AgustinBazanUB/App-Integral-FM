// SSE decoder shared by the browser and provider, including split UTF-8 and CRLF.
export async function readEventStream(stream, onEvent, { signal, maxFrameBytes = 2_000_000 } = {}) {
  if (!stream) throw new Error("No se recibió el flujo de respuesta.");
  const reader = stream.getReader(), decoder = new TextDecoder();
  let buffer = "";
  const abort = () => reader.cancel().catch(() => {});
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException("Solicitud cancelada", "AbortError");
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (buffer.length > maxFrameBytes) throw new Error("El evento supera el límite permitido.");
      let match;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
        if (data && data !== "[DONE]") await onEvent(JSON.parse(data));
      }
      if (done) break;
    }
    if (signal?.aborted) throw new DOMException("Solicitud cancelada", "AbortError");
    if (buffer.trim()) throw new Error("La respuesta se interrumpió antes de completar el evento.");
  } finally { signal?.removeEventListener("abort", abort); reader.releaseLock(); }
}

export const streamFrame = (event) => new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
