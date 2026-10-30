import { UI_GUIDES, UI_GUIDE_VERSION, UI_ERROR_IDS, UI_TARGET_IDS } from '../../shared/oliviaUiGuides.mjs';
const visible = element => element && element.getClientRects().length > 0 && !element.closest('[inert], [hidden], [aria-hidden="true"]');
export function guideTarget(document, id) {
  const nodes = [...document.querySelectorAll(`[data-olivia="${id}"]`)].filter(visible);
  return nodes.length === 1 ? nodes[0] : null;
}
// No selector, text, code or DOM action supplied by a model reaches Driver.js.
export function createVisualGuide({ guide, document, driver, onProgress, onClose, observe = callback => new MutationObserver(callback) }) {
  if (!UI_GUIDES[guide.id] || guide.version !== UI_GUIDE_VERSION) throw new Error('La guía necesita actualizarse.');
  const steps = UI_GUIDES[guide.id].steps;
  let index = 0, paused = false, closed = false, active = null, instance = null, replacing = false, lastState = '', queued = false;
  const invalidFields = new Set();
  const stopHighlight = () => { replacing = true; instance?.destroy(); instance = null; active = null; replacing = false; };
  const emit = status => {
    const errors = [...document.querySelectorAll('[data-olivia-error]')].filter(visible).map(element => element.getAttribute('data-olivia-error')).filter(id => UI_ERROR_IDS.includes(id));
    const state = { guideId: guide.id, stepId: steps[index].id, status, errors: [...new Set([...errors, ...invalidFields])].slice(0, 6) };
    if (JSON.stringify(state) !== lastState) { lastState = JSON.stringify(state); onProgress({ ...state, index, total: steps.length, title: steps[index].title, description: steps[index].description }); }
  };
  const close = () => { if (closed) return; closed = true; observer.disconnect(); document.removeEventListener('invalid', invalid, true); document.removeEventListener('input', valid, true); stopHighlight(); onClose?.(); };
  const move = target => { if (target >= steps.length) return close(); index = Math.max(0, target); active = null; render(); };
  const render = () => {
    if (closed) return;
    if (paused) { emit('paused'); return; }
    const step = steps[index];
    if (step.advanceOn && guideTarget(document, step.advanceOn)) { index++; active = null; return render(); }
    const element = guideTarget(document, step.id);
    if (!element) { stopHighlight(); emit('waiting'); return; }
    emit('active');
    if (active === element) return;
    stopHighlight(); active = element;
    instance = driver({ animate: !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches, allowKeyboardControl: false,
      allowClose: true, overlayClickBehavior: 'none', smoothScroll: false, overlayOpacity: .25, popoverClass: 'fm-olivia-guide-popover',
      showButtons: ['previous', 'next', 'close'], disableButtons: index === 0 ? ['previous'] : [],
      nextBtnText: 'Siguiente', doneBtnText: index === steps.length - 1 ? 'Terminar guía' : 'Siguiente', prevBtnText: 'Anterior', closeBtnLabel: 'Cancelar guía',
      onNextClick: () => move(index + 1), onDoneClick: () => move(index + 1), onPrevClick: () => move(index - 1), onCloseClick: close,
      onDestroyed: () => { if (!replacing) close(); },
      onPopoverRender: popover => { popover.wrapper.setAttribute('data-olivia-guide-ui', 'true'); },
    });
    instance.highlight({ element, popover: { title: step.title, description: step.description, nextBtnText: index === steps.length - 1 ? 'Terminar guía' : 'Siguiente', showButtons: ['previous', 'next', 'close'] } });
  };
  const invalid = event => { const id = event.target?.getAttribute?.('data-olivia'); if (UI_TARGET_IDS.has(id)) { invalidFields.add(id); render(); } };
  const valid = event => { const id = event.target?.getAttribute?.('data-olivia'); if (invalidFields.has(id) && event.target.validity?.valid) { invalidFields.delete(id); render(); } };
  document.addEventListener('invalid', invalid, true); document.addEventListener('input', valid, true);
  const observer = observe(() => {
    if (queued || closed) return;
    queued = true;
    const update = () => { queued = false; render(); };
    // Wait for layout/React updates instead of chaining DOM mutations in an
    // unbounded microtask loop (notably while a form is replaced).
    if (globalThis.requestAnimationFrame) globalThis.requestAnimationFrame(update); else queueMicrotask(update);
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'inert', 'aria-hidden', 'data-olivia-error'] });
  render();
  return { getTarget: () => active, next: () => { paused = false; move(index + 1); }, previous: () => { paused = false; move(index - 1); }, retry: render,
    pause: () => { paused = true; stopHighlight(); emit('paused'); }, resume: () => { paused = false; render(); }, destroy: close };
}
