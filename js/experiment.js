// Experiment runner (shape identification + disparity threshold).
// Builds a randomized trial list, shows each stereogram fullscreen at 1:1
// pixels, and records the participant's answers as the experimenter clicks or
// types them.
import { generateRDS } from './rds.js';
import { SHAPES, buildMask, shapeLabel } from './shapes.js';
import { describe, pxToArcsec, arcsecToPx } from './calib.js';
import { $, $$, load, save, deviceCanvas, paint, shuffle, fmtArc, el } from './util.js';
import { addSession } from './results.js';

const KEY = 'rds.exp';
let calib;
let cfg;

const PRESETS = {
  shapeid: { disps: '3, 6, 12, 18, 24', reps: 2, catch: 0 },
  threshold: null, // computed from the screen calibration (10 levels, 40–1000″)
};

function defaults() {
  const dpr = window.devicePixelRatio || 1;
  return {
    name: '', glasses: 'yes',
    shapes: ['circle', 'triangle', 'star', 'heart', 'cross'], letters: '',
    disps: '3, 6, 12, 18, 24', reps: 2, catch: 0, dir: 'near',
    w: Math.floor((screen.width * dpr * 0.85) / 10) * 10,
    h: Math.floor((screen.height * dpr * 0.72) / 10) * 10,
    jitter: false,
  };
}

// Dot size, density, background offset and shape size come from the Generator
// tab, so the stimuli match the RDS you dialled in there.
function dots() {
  const g = load('rds.gen', { dotSize: 4, density: 0.3, bgOffset: 8, sizeFrac: 0.55 });
  return { dotSize: g.dotSize, density: g.density, bgOffset: g.bgOffset, sizeFrac: g.sizeFrac };
}

// 10 roughly log-spaced whole-pixel levels covering 40–1000 arcsec on this screen.
function autoLevels() {
  const lo = Math.max(1, Math.round(arcsecToPx(40, calib)));
  const hi = Math.max(lo + 9, Math.round(arcsecToPx(1000, calib)));
  const out = new Set();
  for (let i = 0; i < 10; i++) out.add(Math.round(lo * (hi / lo) ** (i / 9)));
  // Fill any collisions at the low end with the next unused integers.
  let k = lo;
  while (out.size < 10) { if (!out.has(k)) out.add(k); k++; }
  return [...out].sort((a, b) => a - b).join(', ');
}

const parseLevels = (s) =>
  [...new Set(String(s).split(/[\s,;]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0).map(Math.round))].sort((a, b) => a - b);

function shapeSet() {
  const letters = cfg.letters.split(',').map((t) => t.trim()).filter(Boolean).map((t) => ({ shape: 'text', text: t.slice(0, 3) }));
  return [...cfg.shapes.filter((k) => SHAPES[k]).map((k) => ({ shape: k })), ...letters].map((s) => ({ ...s, label: shapeLabel(s) }));
}

export function initExperiment(ctx) {
  calib = ctx.calib;
  cfg = load(KEY, defaults());

  const box = $('#x-shapes');
  for (const [k, s] of Object.entries(SHAPES)) {
    const cb = el('input', { type: 'checkbox', value: k });
    cb.checked = cfg.shapes.includes(k);
    cb.addEventListener('change', () => {
      cfg.shapes = $$('input', box).filter((c) => c.checked).map((c) => c.value);
      commit();
    });
    box.append(el('label', {}, cb, s.label));
  }

  const fields = [
    ['#x-name', 'name'], ['#x-glasses', 'glasses'], ['#x-letters', 'letters'], ['#x-disps', 'disps'],
    ['#x-reps', 'reps', true], ['#x-catch', 'catch', true], ['#x-dir', 'dir'],
    ['#x-w', 'w', true], ['#x-h', 'h', true],
  ];
  for (const [id, key, num] of fields) {
    const input = $(id);
    input.value = cfg[key];
    input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => {
      cfg[key] = num ? +input.value : input.value;
      commit();
    });
  }
  $('#x-jitter').checked = cfg.jitter;
  $('#x-jitter').addEventListener('change', (e) => { cfg.jitter = e.target.checked; commit(); });

  const setField = (id, key, v) => { cfg[key] = v; $(id).value = v; };
  $('#x-autolevels').addEventListener('click', () => { setField('#x-disps', 'disps', autoLevels()); commit(); });
  $$('[data-preset]').forEach((b) => b.addEventListener('click', () => {
    const p = PRESETS[b.dataset.preset] ?? { disps: autoLevels(), reps: 3, catch: 3 };
    setField('#x-disps', 'disps', p.disps);
    setField('#x-reps', 'reps', p.reps);
    setField('#x-catch', 'catch', p.catch);
    commit();
  }));
  $('#x-start').addEventListener('click', start);
  refreshExperiment();
}

function commit() {
  save(KEY, cfg);
  refreshExperiment();
}

export function refreshExperiment() {
  if (!cfg) return;
  const levels = parseLevels(cfg.disps);
  $('#x-levels').replaceChildren(...levels.map((px) => el('span', {}, `${px} px = ${fmtArc(pxToArcsec(px, calib))}`)));
  const shapes = shapeSet();
  const n = levels.length * Math.max(1, cfg.reps) + Math.max(0, cfg.catch);
  const dpr = window.devicePixelRatio || 1;
  const tooBig = cfg.w / dpr > window.screen.width || cfg.h / dpr > window.screen.height - 110;
  const parts = [
    el('b', {}, `${n} trials`), ` · ${levels.length} disparity levels × ${cfg.reps} repeats`,
    cfg.catch ? ` + ${cfg.catch} catch` : '', ` · ${shapes.length} shapes (chance = ${shapes.length ? Math.round(100 / (shapes.length + 1)) : 0}% incl. "no shape")`,
  ];
  if (!shapes.length) parts.push(el('div', { class: 'warn' }, 'Pick at least one shape.'));
  if (tooBig) parts.push(el('div', { class: 'warn' }, `Stimulus (${cfg.w}×${cfg.h} px) is bigger than this screen at 1:1. Reduce width/height.`));
  const d = dots();
  $('#x-from-gen').textContent =
    `From Generator: dots ${d.dotSize} px @ ${Math.round(d.density * 100)}%, background offset ${d.bgOffset} px, shape size ${Math.round(d.sizeFrac * 100)}%.`;
  if (d.bgOffset < d.dotSize) parts.push(el('div', { class: 'warn' }, 'Background offset is smaller than the dot size: the shape may be visible without glasses (black overlapping dots outside it).'));
  $('#x-summary').replaceChildren(...parts);
}

// ------------------------------------------------------------------ run ----
function buildTrials() {
  const levels = parseLevels(cfg.disps);
  const shapes = shapeSet();
  let bag = [];
  const nextShape = () => { if (!bag.length) bag = shuffle([...shapes]); return bag.pop(); };
  const trials = [];
  for (const px of levels) for (let r = 0; r < Math.max(1, cfg.reps); r++) trials.push({ disparityPx: px, ...nextShape() });
  for (let i = 0; i < cfg.catch; i++) trials.push({ disparityPx: 0, shape: 'none', label: 'No shape' });
  return shuffle(trials);
}

function start() {
  const shapes = shapeSet();
  if (!shapes.length || !parseLevels(cfg.disps).length) return refreshExperiment();
  const trials = buildTrials();
  const d = describe(calib);
  const session = {
    id: `s${Date.now()}`,
    date: new Date().toISOString(),
    participant: cfg.name.trim() || 'Participant',
    glasses: cfg.glasses === 'yes',
    shapes: shapes.map((s) => s.label),
    params: { ...cfg, ...dots(), arcPerPx: d.arcPerDevice, distance: calib.distance, screen: `${calib.diag}" ${calib.w}×${calib.h}`, dpr: d.dpr },
    trials: [],
  };
  const options = [...shapes.map((s) => s.label), 'No shape'];

  const ov = $('#overlay');
  const stage = $('#ovStage');
  const bar = $('#ovBar');
  ov.hidden = false;
  ov.requestFullscreen?.().catch(() => {});

  let i = 0;
  let phase = 'intro';
  let response = null;
  let shownAt = 0;

  const progress = () => el('div', { class: 'ov-progress' }, `Trial ${Math.min(i + 1, trials.length)} / ${trials.length}`);

  function intro() {
    stage.replaceChildren(el('div', { class: 'ov-msg' },
      el('h2', {}, session.glasses ? 'Put on the red/cyan glasses' : 'No glasses for this run'),
      session.glasses ? el('p', {}, el('b', {}, 'Red lens over the LEFT eye, cyan lens over the RIGHT eye.')) : null,
      el('p', {}, 'Sit 50 cm from the screen. Each image is random dots. Say what shape you see, if any, and whether it pops out in depth.'),
      el('p', {}, `${trials.length} trials. Press Space to begin.`)));
    bar.replaceChildren(el('button', { class: 'btn primary big', onclick: next }, 'Begin'));
  }

  function next() {
    if (i >= trials.length) return finish();
    phase = 'blank';
    stage.replaceChildren(progress());
    bar.replaceChildren();
    // Brief blank so successive patterns don't blend.
    setTimeout(showTrial, 350);
  }

  function showTrial() {
    const t = trials[i];
    const seed = Math.floor(Math.random() * 2 ** 31);
    const rotation = cfg.jitter ? Math.round((Math.random() * 2 - 1) * 20) : 0;
    const w = cfg.w, h = cfg.h;
    const mask = t.shape === 'none'
      ? new Uint8Array(w * h)
      : buildMask(w, h, { ...t, sizeFrac: session.params.sizeFrac, rotation, offsetX: 0, offsetY: 0 });
    const rds = generateRDS({
      width: w, height: h, dotSize: session.params.dotSize, density: session.params.density,
      disparity: cfg.dir === 'far' ? -t.disparityPx : t.disparityPx,
      bgOffset: session.params.bgOffset, mask, seed,
    });
    t.seed = seed;
    t.rotation = rotation;
    stage.replaceChildren(paint(deviceCanvas(w, h), rds, 'combined'), progress());
    shownAt = performance.now();
    askShape();
  }

  function askShape() {
    phase = 'shape';
    bar.replaceChildren(
      el('div', { class: 'q' }, 'What shape do you see?'),
      ...options.map((label, k) => el('button', { class: 'btn', onclick: () => pickShape(label) },
        el('kbd', {}, k === options.length - 1 ? '0' : String(k + 1)), label)),
    );
  }

  function pickShape(label) {
    response = label;
    phase = 'pop';
    bar.replaceChildren(
      el('div', { class: 'q' }, `Answer: ${label}. Did it pop out in depth?`),
      el('button', { class: 'btn', onclick: () => record(true) }, el('kbd', {}, 'Y'), 'Yes, popped out'),
      el('button', { class: 'btn', onclick: () => record(false) }, el('kbd', {}, 'N'), 'No / flat'),
      el('button', { class: 'btn ghost small', onclick: askShape }, 'Back'),
    );
  }

  function record(popped) {
    const t = trials[i];
    session.trials.push({
      n: i + 1,
      glasses: session.glasses,
      disparityPx: t.disparityPx,
      arcsec: Math.round(pxToArcsec(t.disparityPx, calib) * 10) / 10,
      truth: t.label,
      response,
      correct: response === t.label,
      popped,
      rtMs: Math.round(performance.now() - shownAt),
      seed: t.seed,
      rotation: t.rotation,
    });
    i++;
    next();
  }

  function confirmQuit() {
    const prev = phase;
    phase = 'quit';
    bar.replaceChildren(
      el('div', { class: 'q' }, `Stop now? ${session.trials.length} completed trials will be saved.`),
      el('button', { class: 'btn primary', onclick: finish }, 'Stop & save'),
      el('button', { class: 'btn', onclick: () => { phase = prev; prev === 'pop' ? pickShape(response) : prev === 'intro' ? intro() : askShape(); } }, 'Keep going'),
    );
  }

  function finish() {
    phase = 'done';
    if (session.trials.length) addSession(session);
    const n = session.trials.length;
    const c = session.trials.filter((t) => t.correct).length;
    stage.replaceChildren(el('div', { class: 'ov-msg' },
      el('h2', {}, 'Run complete'),
      el('p', {}, n ? `${c} / ${n} correct (${Math.round((100 * c) / n)}%). Saved to Results.` : 'No trials recorded.')));
    bar.replaceChildren(
      el('button', { class: 'btn primary', onclick: () => { close(); $('.tab[data-tab=results]').click(); } }, 'View results'),
      el('button', { class: 'btn', onclick: close }, 'Close'),
    );
  }

  function close() {
    ov.hidden = true;
    document.removeEventListener('keydown', onKey);
    if (document.fullscreenElement) document.exitFullscreen();
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); if (phase === 'done') close(); else if (phase !== 'quit') confirmQuit(); return; }
    if (phase === 'intro' && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); next(); }
    else if (phase === 'shape' && /^[0-9]$/.test(e.key)) {
      const k = +e.key;
      if (k === 0) pickShape('No shape');
      else if (k <= options.length - 1) pickShape(options[k - 1]);
    } else if (phase === 'pop' && /^[yn]$/i.test(e.key)) record(e.key.toLowerCase() === 'y');
  }
  document.addEventListener('keydown', onKey);
  intro();
}
