import { paintAnaglyph, paintLayer, paintMask, RED, CYAN, BLACK } from './rds.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function load(key, fallback) {
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(key) || '{}') }; }
  catch { return { ...fallback }; }
}
export function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// A canvas whose pixels map 1:1 onto device pixels (CSS size = px / devicePixelRatio).
export function deviceCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const dpr = window.devicePixelRatio || 1;
  c.style.width = `${w / dpr}px`;
  c.style.height = `${h / dpr}px`;
  return c;
}

// Paint one of the recipe images into a canvas.
//   kind: 'combined' | 'left' | 'right' | 'pattern' | 'mask' | 'debug'
export function paint(canvas, rds, kind) {
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(rds.width, rds.height);
  if (kind === 'combined') paintAnaglyph(img, rds.left, rds.right);
  else if (kind === 'left') paintLayer(img, rds.left, CYAN);
  else if (kind === 'right') paintLayer(img, rds.right, RED);
  else if (kind === 'pattern') paintLayer(img, rds.pattern, BLACK);
  else if (kind === 'mask') paintMask(img, rds.mask);
  else if (kind === 'debug') {
    // Anaglyph with the mask tinted yellow — for checking only, NOT a stimulus.
    paintAnaglyph(img, rds.left, rds.right);
    const d = img.data;
    for (let i = 0; i < rds.mask.length; i++) {
      if (rds.mask[i]) { const p = i * 4; d[p + 2] = Math.min(d[p + 2], 120); }
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export function downloadCanvas(canvas, name) {
  canvas.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, 'image/png');
}

export function downloadText(text, name, type = 'text/csv') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function shuffle(arr, rand = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const fmtArc = (a) => `${Math.round(a)}″`;

export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k);
  return e;
}
