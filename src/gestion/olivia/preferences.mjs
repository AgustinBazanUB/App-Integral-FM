export const floatingPreferenceKey = uid => `flor-mia-olivia-floating:${uid}`;
export function readFloatingPreference(storage, uid) {
  try { return storage?.getItem(floatingPreferenceKey(uid)) === 'true'; } catch { return false; }
}
export function writeFloatingPreference(storage, uid, value) {
  try { storage?.setItem(floatingPreferenceKey(uid), String(Boolean(value))); } catch { /* Session preference still works without storage. */ }
}
