import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from '../../router';
import { useAuth } from '../AuthContext';
import { useOliviaContext, useOliviaVisibility } from './ScreenContext';
import { getUiGuide, UI_GUIDE_VERSION } from '../../shared/oliviaUiGuides.mjs';
import { safeNavigation } from './client.mjs';
import { createVisualGuide } from './visualGuide.mjs';
import './guide.css';

export default function OliviaGuideHost() {
  const { profile, user } = useAuth(), location = useLocation(), navigate = useNavigate(), context = useOliviaContext();
  const { guideRequest, setGuideRequest, guideCommand, setGuideContext, assistantOpen, setAssistantOpen } = useOliviaVisibility();
  const [progress, setProgress] = useState(null), [notice, setNotice] = useState('');
  const runtime = useRef(null), targetPath = useRef(''), contextRef = useRef(context), generation = useRef(0);
  contextRef.current = context;
  useEffect(() => {
    if (!guideRequest) return;
    let alive = true;
    const epoch = ++generation.current, guide = getUiGuide(profile, guideRequest.guideId, contextRef.current);
    if (!guide || guideRequest.version !== UI_GUIDE_VERSION) { setNotice('La guía no está disponible con tus permisos actuales.'); setGuideRequest(null); return; }
    const path = safeNavigation(guide.path, window.location.origin);
    if (!path) { setGuideRequest(null); return; }
    targetPath.current = new URL(path, window.location.origin).pathname;
    const returnFocus = document.activeElement;
    const onKey = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); runtime.current?.destroy(); }
      if (event.key !== 'Tab' || !runtime.current) return;
      // Driver has its own popover-only Tab trap. Include the active form and
      // guide toolbar here without changing the application's modal system.
      const target = runtime.current.getTarget(), dialog = target?.closest('[role="dialog"]') || document.querySelector('[role="dialog"][aria-modal="true"]');
      const selector = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
      const roots = dialog ? [dialog] : target ? [target] : [];
      const candidates = [...roots.flatMap(root => [...(root.matches(selector) ? [root] : []), ...root.querySelectorAll(selector)]), ...document.querySelectorAll('[data-olivia-guide-ui="true"] button:not(:disabled)')];
      const nodes = [...new Set(candidates)].filter(node => node.getClientRects().length && !node.closest('[inert], [hidden]'));
      if (!nodes.length) return;
      const at = nodes.indexOf(document.activeElement), index = at < 0 ? event.shiftKey ? nodes.length - 1 : 0 : (at + (event.shiftKey ? -1 : 1) + nodes.length) % nodes.length;
      event.preventDefault(); event.stopImmediatePropagation(); nodes[index].focus();
    };
    document.addEventListener('keydown', onKey, true);
    setNotice(''); navigate(path);
    Promise.all([import('driver.js'), import('driver.js/dist/driver.css')]).then(([{ driver }]) => {
      if (!alive || generation.current !== epoch) return;
      runtime.current = createVisualGuide({ guide, document, driver,
        onProgress: next => { if (!alive) return; setProgress(next); setGuideContext({ guideId: next.guideId, stepId: next.stepId, status: next.status, errors: next.errors }); },
        onClose: () => { if (!alive) return; setProgress(null); setGuideContext(null); setGuideRequest(null); window.requestAnimationFrame(() => { const fallback = document.querySelector('[role="dialog"][aria-modal="true"] input, [role="dialog"][aria-modal="true"] button') || document.getElementById('main-content'); if (returnFocus?.isConnected && returnFocus !== document.body && returnFocus !== document.documentElement && !returnFocus.closest('[inert]')) returnFocus.focus?.(); else fallback?.focus(); }); },
      });
    }).catch(() => { if (alive) { setNotice('No pude cargar los resaltados. La explicación sigue disponible en el chat.'); setGuideRequest(null); } });
    return () => { alive = false; document.removeEventListener('keydown', onKey, true); runtime.current?.destroy(); runtime.current = null; setGuideContext(null); setProgress(null); };
  }, [guideRequest, profile, user?.uid, navigate, setGuideRequest, setGuideContext]);
  useEffect(() => {
    if (!runtime.current) return;
    const base = targetPath.current;
    if (!(location.pathname === base || location.pathname.startsWith(base + '/') || base.startsWith(location.pathname + '/'))) runtime.current.pause();
  }, [location.pathname]);
  useEffect(() => { if (assistantOpen) runtime.current?.pause(); }, [assistantOpen]);
  useEffect(() => {
    if (!guideCommand || guideCommand.guideId !== guideRequest?.guideId) return;
    const action = { next: 'next', previous: 'previous', cancel: 'destroy', pause: 'pause', resume: 'resume' }[guideCommand.action];
    if (action) runtime.current?.[action]();
  }, [guideCommand, guideRequest]);
  const resume = () => { if (targetPath.current) navigate(targetPath.current); runtime.current?.resume(); };
  return createPortal(<>
    {progress && <section className="fm-olivia-guide-toolbar" data-olivia-guide-ui="true" aria-label="Guía visual de Olivia">
      <div role="status"><strong>{progress.index + 1}/{progress.total} · {progress.title}</strong><p>{progress.status === 'waiting' ? 'Abrí el formulario o control indicado para continuar. Si todavía está cargando, podés reintentar.' : progress.status === 'paused' ? 'La guía está pausada.' : progress.description}</p>{progress.errors.length > 0 && <p>El formulario indica un error. Revisá los datos antes de guardar; podés pedirle a Olivia que explique este paso.</p>}</div>
      <div><button type="button" onClick={() => runtime.current?.retry()}>Reintentar</button><button type="button" onClick={() => progress.status === 'paused' ? resume() : runtime.current?.pause()}>{progress.status === 'paused' ? 'Retomar' : 'Pausar'}</button><button type="button" onClick={() => { runtime.current?.pause(); setAssistantOpen(true); window.dispatchEvent(new Event('olivia:open-chat')); }}>Preguntarle a Olivia</button><button type="button" onClick={() => runtime.current?.destroy()}>Cancelar guía</button></div>
    </section>}
    {notice && <div className="fm-olivia-guide-toolbar" role="status">{notice}<button type="button" onClick={() => setNotice('')}>Cerrar</button></div>}
  </>, document.body);
}
