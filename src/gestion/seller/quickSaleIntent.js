const key = (profileId) => `flor-mia-quick-sale-pending:${profileId}`;

export function readQuickSaleIntent(profileId) {
  try { return JSON.parse(sessionStorage.getItem(key(profileId)) || "null"); }
  catch { return null; }
}

export function saveQuickSaleIntent(profileId, sale) {
  const intent = { requestId: crypto.randomUUID(), sale };
  // Persist before sending. If storage is unavailable, abort before any economic write.
  sessionStorage.setItem(key(profileId), JSON.stringify(intent));
  return intent;
}

export function clearQuickSaleIntent(profileId) {
  try { sessionStorage.removeItem(key(profileId)); } catch { /* A stored ID remains safe to replay. */ }
}
