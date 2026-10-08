// Extractive memory is bounded, labeled as untrusted, and never grants authority.
export function reduceConversationMemory(previous = {}, messages = []) {
  previous ||= {};
  const remembered = new Set(previous.messageIds || []), additions = messages.slice(0, -16).filter((message) => !remembered.has(message.id));
  const lines = [...(previous.lines || []), ...additions.map((message) => ({ id: message.id, role: message.role, text: String(message.content || "").replace(/\s+/g, " ").slice(0, 220) }))].slice(-16);
  return { version: 1, kind: "UNTRUSTED_EXTRACTIVE_MEMORY", lines, messageIds: lines.map((line) => line.id) };
}
