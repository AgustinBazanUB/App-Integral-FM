import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/manrope/latin-400.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/manrope/latin-700.css';
import "../../../src/styles.css";
import "../../../src/styles-v3.css";
import "../../../src/styles-responsive-mobile.css";
import "../../../src/styles/tokens.css";
import "../../../src/styles/theme.css";
import "../../../src/styles/management.css";
import "../../../src/styles/location-enhancements.css";
import "../../../src/styles/dashboard-filters.css";
import "../../../src/styles/seller-panel.css";
import "../../../src/styles/seller-stage2.css";
import "../../../src/styles/seller-stage2-mobile.css";
import "../../../src/styles/responsive.css";
import "../../../src/styles/performance-optimizations.css";
import "../../../src/styles/metrics-fixes.css";
import "../../../src/styles/seller-customers.css";
import "../../../src/styles/customer-import.css";
import "../../../src/styles/whatsapp-marketing.css";
import "../../../src/styles/inventory.css";
import "../../../src/styles/scrollbars.css";
import "../../../src/styles/seller-compact.css";
import "../../../src/styles/seller-pos.css";
import OliviaAssistant from '../../../src/gestion/olivia/OliviaAssistant';
import { FixtureModule } from './mocks';

// Synthetic WebAudio input/output only. No system microphone permission and no
// audible test noise; production mediaDevices are untouched outside this tab.
const NativeContext = window.AudioContext;
window.AudioContext = class {
  constructor() {
    const context = new NativeContext(), silent = context.createGain(); silent.gain.value = 0; silent.connect(context.destination);
    return new Proxy(context, { get(target, key) { if (key === 'destination') return silent; const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; } });
  }
};
Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
  if (new URLSearchParams(location.search).get('mic') === 'denied') throw new DOMException('Synthetic permission rejection', 'NotAllowedError');
  const context = new NativeContext(), tone = context.createOscillator(), gain = context.createGain(), destination = context.createMediaStreamDestination();
  tone.connect(gain); gain.connect(destination); gain.gain.setValueAtTime(0, context.currentTime); gain.gain.setValueAtTime(.12, context.currentTime + .2); gain.gain.setValueAtTime(0, context.currentTime + 1.2); tone.start(); await context.resume();
  const track = destination.stream.getTracks()[0], stop = track.stop.bind(track); track.stop = () => { stop(); tone.stop(); context.close(); };
  return destination.stream;
} });
document.body.style.cssText = 'margin:0;min-height:100vh;background:#e9edf3;padding:24px;font-family:Manrope,sans-serif';
createRoot(document.getElementById('root')).render(<div className="fm-management-body"><p>QA local · datos y audio sintéticos</p><FixtureModule /><OliviaAssistant /></div>);
