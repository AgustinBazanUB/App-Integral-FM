import { useEffect, useState } from 'react';
import { floatingPreferenceKey, readFloatingPreference, writeFloatingPreference } from './preferences.mjs';
const storage = () => { try { return window.localStorage; } catch { return null; } };

export function useFloatingOlivia(uid) {
  const [enabled, setEnabled] = useState(() => readFloatingPreference(storage(), uid));
  useEffect(() => {
    const sync = event => { if (event.detail?.uid === uid) setEnabled(Boolean(event.detail.enabled)); else if (!event.key || event.key === floatingPreferenceKey(uid)) setEnabled(readFloatingPreference(storage(), uid)); };
    sync({});
    window.addEventListener('storage', sync);
    window.addEventListener('flor-mia:olivia-preferences', sync);
    return () => { window.removeEventListener('storage', sync); window.removeEventListener('flor-mia:olivia-preferences', sync); };
  }, [uid]);
  return [enabled, value => { writeFloatingPreference(storage(), uid, value); setEnabled(value); window.dispatchEvent(new CustomEvent('flor-mia:olivia-preferences', { detail: { uid, enabled: value } })); }];
}

export default function OliviaPreferences({ uid }) {
  const [enabled, setEnabled] = useFloatingOlivia(uid);
  return <section className="fm-olivia-preferences" aria-label="Preferencias de Olivia"><label><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />Mostrar Olivia flotante al minimizar</label><small>Se guarda en este dispositivo. Minimizar conserva la voz; podés silenciarla o finalizarla en cualquier momento.</small></section>;
}
