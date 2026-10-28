import { generateRDS } from './rds.js';
import { SHAPES, buildMask, shapeLabel } from './shapes.js';
import { PRESETS, loadCalib, saveCalib, describe, pxToArcsec, arcsecToPx } from './calib.js';
import { $, $$, load, save, deviceCanvas, paint, downloadCanvas, fmtArc, el } from './util.js';
import { initExperiment, refreshExperiment } from './experiment.js';
import { initResults, renderResults } from './results.js';

// ---------------------------------------------------------------- state ----
export const calib = loadCalib();

const GEN_KEY = 'rds.gen';
const gen = load(GEN_KEY, {
  shape: 'star', text: 'A', invert: false, sizeFrac: 0.55, rotation: 0, offsetX: 0, offsetY: 0,
  disparity: 12, direction: 'near', bgOffset: 8,
  dotSize: 4, density: 0.3, width: 1600, height: 1000, seed: 12345,
});
let genImage = null; // uploaded custom image (not persisted)
let view = 'combined';
let current = null; // latest generated stereogram

// ----------------------------------------------------------------- tabs ----
$$('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
function showTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $$('.tabpane').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
  if (name === 'results') renderResults();
  if (name === 'experiment') refreshExperiment();
  try { sessionStorage.setItem('rds.tab', name); } catch {}
}

// ---------------------------------------------------------- calibration ----
export function refreshCalib() {
  const d = describe(calib);
  $('#calibChip').textContent =
    `1 px ≈ ${d.arcPerDevice.toFixed(1)}″ at ${calib.distance} cm · ${PRESETS[calib.preset]?.label ?? 'Custom'}`;
  $('#warnings').replaceChildren(...d.warnings.map((w) => el('div', { class: 'warn' }, w)));
  $('#s-table').replaceChildren(
    ...[
      ['Physical pixel size', `${(d.pxCm * 10).toFixed(4)} mm`],
      ['1 physical pixel', `${d.arcPerPhys.toFixed(1)} arcsec`],
      ['Browser pixel ratio', d.dpr.toFixed(2)],
      ['Framebuffer width', `${d.fbW} device px (screen looks like ${screen.width}×${screen.height})`],
      ['Physical px per canvas px', d.physPerDevice.toFixed(3)],
      ['1 canvas px (what the app shifts)', `${d.arcPerDevice.toFixed(1)} arcsec`],
      ['Range 100–1000″', `≈ ${arcsecToPx(100, calib).toFixed(1)} – ${arcsecToPx(1000, calib).toFixed(1)} px`],
    ].map(([k, v]) => el('tr', {}, el('td', {}, k), el('td', {}, v)))
  );
}

function initSetup() {
  const sel = $('#s-preset');
  for (const [k, p] of Object.entries(PRESETS)) sel.append(el('option', { value: k }, p.label));
  const sync = () => {
    sel.value = calib.preset;
    $('#s-dist').value = calib.distance;
    $('#s-diag').value = calib.diag;
    $('#s-w').value = calib.w;
    $('#s-h').value = calib.h;
  };
  sync();
  sel.addEventListener('change', () => {
    calib.preset = sel.value;
    calib.confirmed = true;
    const p = PRESETS[sel.value];
    if (p.diag) Object.assign(calib, { diag: p.diag, w: p.w, h: p.h });
    sync(); commit();
  });
  for (const [id, key] of [['#s-dist', 'distance'], ['#s-diag', 'diag'], ['#s-w', 'w'], ['#s-h', 'h']]) {
    $(id).addEventListener('change', (e) => {
      calib[key] = +e.target.value;
      if (key !== 'distance') { calib.preset = 'custom'; sel.value = 'custom'; calib.confirmed = true; }
      commit();
    });
  }
  function commit() {
    saveCalib(calib);
    refreshCalib();
    renderGenerator();
    refreshExperiment();
  }
  window.addEventListener('resize', refreshCalib);
}

// ------------------------------------------------------------ generator ----
function initGenerator() {
  const shapeSel = $('#g-shape');
  for (const [k, s] of Object.entries(SHAPES)) shapeSel.append(el('option', { value: k }, s.label));
  shapeSel.append(el('option', { value: 'text' }, 'Letter / text'));
  shapeSel.append(el('option', { value: 'image' }, 'Upload image…'));

  // [input id, state key, output id, formatter]
  const bindings = [
    ['#g-shape', 'shape'], ['#g-text', 'text'], ['#g-dir', 'direction'],
    ['#g-size', 'sizeFrac', '#o-size', (v) => `${Math.round(v * 100)}%`],
    ['#g-rot', 'rotation', '#o-rot', (v) => `${v}°`],
    ['#g-ox', 'offsetX', '#o-ox', (v) => `${Math.round(v * 100)}%`],
    ['#g-oy', 'offsetY', '#o-oy', (v) => `${Math.round(v * 100)}%`],
    ['#g-disp', 'disparity', '#o-disp', (v) => `${v} px = ${fmtArc(pxToArcsec(v, calib))}`],
    ['#g-bg', 'bgOffset', '#o-bg', (v) => `${v} px`],
    ['#g-dot', 'dotSize', '#o-dot', (v) => `${v} px`],
    ['#g-den', 'density', '#o-den', (v) => `${Math.round(v * 100)}%`],
    ['#g-w', 'width'], ['#g-h', 'height'], ['#g-seed', 'seed'],
  ];
  const numeric = new Set(['sizeFrac', 'rotation', 'offsetX', 'offsetY', 'disparity', 'bgOffset', 'dotSize', 'density', 'width', 'height', 'seed']);

  const outputs = () => {
    for (const [, key, out, fmt] of bindings) if (out) $(out).textContent = fmt(gen[key]);
    $('#g-disp-arc').value = Math.round(pxToArcsec(gen.disparity, calib));
    $$('.only-text').forEach((e) => (e.hidden = gen.shape !== 'text'));
    $$('.only-image').forEach((e) => (e.hidden = gen.shape !== 'image'));
  };

  for (const [id, key] of bindings) {
    const input = $(id);
    input.value = gen[key];
    const ev = input.type === 'range' || input.type === 'text' ? 'input' : 'change';
    input.addEventListener(ev, () => {
      gen[key] = numeric.has(key) ? +input.value : input.value;
      outputs();
      scheduleRender();
    });
  }
  $('#g-invert').checked = gen.invert;
  $('#g-invert').addEventListener('change', (e) => { gen.invert = e.target.checked; scheduleRender(); });
  $('#g-image').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const img = new Image();
    img.onload = () => { genImage = img; scheduleRender(); };
    img.src = URL.createObjectURL(f);
  });
  $('#g-disp-arc').addEventListener('change', (e) => {
    gen.disparity = Math.max(0, Math.round(arcsecToPx(+e.target.value, calib)));
    $('#g-disp').value = gen.disparity;
    outputs(); scheduleRender();
  });
  $('#g-reseed').addEventListener('click', () => {
    gen.seed = Math.floor(Math.random() * 1e9);
    $('#g-seed').value = gen.seed;
    scheduleRender();
  });
  $('#g-fit').addEventListener('click', () => {
    const dpr = window.devicePixelRatio || 1;
    gen.width = Math.floor((screen.width * dpr * 0.9) / 10) * 10;
    gen.height = Math.floor((screen.height * dpr * 0.8) / 10) * 10;
    $('#g-w').value = gen.width;
    $('#g-h').value = gen.height;
    scheduleRender();
  });

  $$('#viewSeg button').forEach((b) => b.addEventListener('click', () => {
    view = b.dataset.view;
    $$('#viewSeg button').forEach((x) => x.classList.toggle('active', x === b));
    showView();
  }));
  $('#g-full').addEventListener('click', () => current && openViewer(current));
  $('#g-dl').addEventListener('click', () => {
    if (!current) return;
    const kind = view === 'recipe' ? 'combined' : view;
    downloadCanvas(paint(deviceCanvas(current.width, current.height), current, kind), `${fileStem()}_${kind}.png`);
  });
  $('#g-dl-all').addEventListener('click', () => {
    if (!current) return;
    RECIPE.forEach(([kind], i) => setTimeout(() => {
      downloadCanvas(paint(deviceCanvas(current.width, current.height), current, kind), `${fileStem()}_${i + 1}_${kind}.png`);
    }, i * 300));
  });

  outputs();
  renderGenerator();
}

const RECIPE = [
  ['mask', '1 · Shape mask', 'White = dots that move'],
  ['pattern', '2 · Random dot pattern', 'One pattern, uniform dots'],
  ['left', '3 · Left-eye image (cyan)', 'Unchanged copy · seen through red lens'],
  ['right', '4 · Right-eye image (red)', 'Shape dots shifted, gap refilled'],
  ['combined', '5 · Final RDS (overlay)', 'Red lens left, cyan lens right'],
];

const fileStem = () => {
  const name = gen.shape === 'text' ? `letter-${gen.text}` : gen.shape;
  return `rds_${name}_${gen.disparity}px_seed${gen.seed}`;
};

let pending = 0;
function scheduleRender() {
  cancelAnimationFrame(pending);
  pending = requestAnimationFrame(renderGenerator);
}

export function renderGenerator() {
  save(GEN_KEY, gen);
  const w = Math.max(100, Math.round(gen.width)), h = Math.max(100, Math.round(gen.height));
  const mask = buildMask(w, h, { ...gen, image: genImage });
  current = generateRDS({
    width: w, height: h, dotSize: gen.dotSize, density: gen.density,
    disparity: gen.direction === 'far' ? -gen.disparity : gen.disparity,
    bgOffset: gen.bgOffset, mask, seed: gen.seed,
  });
  current.label = shapeLabel(gen);
  const arc = pxToArcsec(gen.disparity, calib);
  $('#stageInfo').textContent =
    `${current.label} · ${w}×${h} px · dots ${gen.dotSize} px @ ${Math.round(gen.density * 100)}% · ` +
    `shape shift ${gen.disparity} px (${fmtArc(arc)}) ${gen.direction} · background offset ${gen.bgOffset} px`;
  showView();
}

function showView() {
  if (!current) return;
  const stage = $('#stageView');
  if (view === 'recipe') {
    stage.replaceChildren(el('div', { class: 'recipe' }, RECIPE.map(([kind, title, sub]) => {
      const c = paint(deviceCanvas(current.width, current.height), current, kind);
      c.style.width = c.style.height = '';
      return el('figure', {}, c, el('figcaption', {}, el('span', {}, el('b', {}, title), el('br'), sub),
        el('button', { class: 'btn small', onclick: () => downloadCanvas(c, `${fileStem()}_${kind}.png`) }, 'PNG')));
    })));
    return;
  }
  const c = paint(deviceCanvas(current.width, current.height), current, view);
  const fits = current.width / (window.devicePixelRatio || 1) <= stage.clientWidth - 24;
  if (!fits) c.classList.add('scaled');
  const note = el('p', { class: 'hint' }, fits
    ? 'Shown at 1:1 device pixels.'
    : 'Preview scaled down to fit. Use "View 1:1 fullscreen" for the true-size stimulus.');
  const debugNote = view === 'debug' ? el('p', { class: 'hint' }, 'Debug: shape region tinted. Never show this to a participant.') : null;
  stage.replaceChildren(c, note, debugNote);
}

// Fullscreen 1:1 viewer for the generator.
function openViewer(rds) {
  const ov = $('#overlay');
  const c = paint(deviceCanvas(rds.width, rds.height), rds, 'combined');
  $('#ovStage').replaceChildren(c);
  $('#ovBar').replaceChildren(el('div', { class: 'q' }, 'Red lens LEFT · cyan lens RIGHT · 1:1 pixels · Esc or click to close'));
  ov.hidden = false;
  ov.requestFullscreen?.().catch(() => {});
  const close = () => {
    ov.hidden = true;
    if (document.fullscreenElement) document.exitFullscreen();
    ov.removeEventListener('click', close);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => e.key === 'Escape' && close();
  ov.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.addEventListener('fullscreenchange', function f() {
    if (!document.fullscreenElement) { close(); document.removeEventListener('fullscreenchange', f); }
  });
}

// ----------------------------------------------------------------- boot ----
initSetup();
refreshCalib();
initGenerator();
initExperiment({ calib });
initResults({ calib });
try { const t = sessionStorage.getItem('rds.tab'); if (t) showTab(t); } catch {}
