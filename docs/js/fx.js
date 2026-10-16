// Effets de récompense : confettis, gain d'XP flottant, vibrations et sons (désactivables).
import { state } from './store.js';

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function vibrate(pattern) {
  if (state.settings.haptics === false) return;
  try { navigator.vibrate?.(pattern); } catch { /* non pris en charge */ }
}

let audio;
export function sound(kind) {
  if (!state.settings.sound) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    const notes = { good: [660, 880], bad: [220, 160], win: [523, 659, 784, 1046], tick: [880] }[kind] || [440];
    notes.forEach((f, i) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = kind === 'bad' ? 'sawtooth' : 'triangle';
      o.frequency.value = f;
      const t = audio.currentTime + i * 0.09;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + 0.18);
    });
  } catch { /* audio indisponible */ }
}

/** Petit « +12 XP » qui s'envole depuis un élément. */
export function floatText(anchor, text, cls = '') {
  if (!anchor || reduced()) return;
  const r = anchor.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = `float-xp ${cls}`;
  el.textContent = text;
  el.style.left = `${r.left + r.width / 2}px`;
  el.style.top = `${r.top + window.scrollY}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1100);
}

/** Pluie de confettis (canvas plein écran, ~1,6 s). */
export function confetti(amount = 120) {
  if (reduced()) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  const dpr = window.devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const colors = ['#e36414', '#0f4c5c', '#f2c14e', '#1f8a4c', '#4fb3c8', '#c0392b'];
  const parts = Array.from({ length: amount }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * innerWidth * 0.3,
    y: innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 12,
    vy: -Math.random() * 12 - 4,
    s: 5 + Math.random() * 6,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    c: colors[Math.floor(Math.random() * colors.length)],
  }));
  const start = performance.now();
  const frame = (t) => {
    const k = (t - start) / 1600;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.35;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - k);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      ctx.restore();
    }
    if (k < 1) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

/** Fenêtre de célébration (niveau atteint, badge…). */
export function celebrate({ icon, title, text }) {
  confetti();
  sound('win');
  vibrate([30, 40, 30]);
  const el = document.createElement('div');
  el.className = 'celebrate';
  el.setAttribute('role', 'alertdialog');
  el.setAttribute('aria-label', title);
  el.innerHTML = `<div class="celebrate-card"><div class="celebrate-icon">${icon}</div><strong>${title}</strong><p>${text}</p><button class="btn">Super !</button></div>`;
  const close = () => el.remove();
  el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('button')) close(); });
  document.body.appendChild(el);
  el.querySelector('button').focus();
  setTimeout(close, 6000);
}
