// Results: stored sessions, accuracy summaries, threshold estimate, chart, CSV.
import { $, el, downloadText, fmtArc } from './util.js';

const KEY = 'rds.sessions';
let selected = null;

export function loadSessions() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
function saveSessions(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
}
export function addSession(s) {
  const list = loadSessions();
  list.push(s);
  saveSessions(list);
  selected = s.id;
}

export function initResults() {
  $('#r-csv-all').addEventListener('click', () => {
    const list = loadSessions();
    if (list.length) downloadText(toCSV(list), 'rds_all_sessions.csv');
  });
}

// Per-disparity summary for a set of trials.
function byLevel(trials) {
  const m = new Map();
  for (const t of trials) {
    const k = t.disparityPx;
    const r = m.get(k) ?? { px: k, arcsec: t.arcsec, n: 0, correct: 0, popped: 0, both: 0 };
    r.n++;
    r.correct += t.correct ? 1 : 0;
    r.popped += t.popped ? 1 : 0;
    r.both += t.correct && t.popped ? 1 : 0;
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => a.px - b.px);
}

// Threshold = smallest tested disparity where the participant both named the
// right shape AND reported depth on at least 2/3 of repeats.
function threshold(levels) {
  const hit = levels.find((l) => l.px > 0 && l.both / l.n >= 2 / 3);
  return hit ?? null;
}

const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const condName = (g) => (g ? 'With glasses' : 'No glasses');

export function renderResults() {
  const list = loadSessions();
  const host = $('#r-overview');
  if (!list.length) {
    host.replaceChildren(el('div', { class: 'empty' }, 'No runs yet. Start one from the Experiment tab.'));
    $('#r-detail').replaceChildren();
    return;
  }
  if (!list.some((s) => s.id === selected)) selected = list[list.length - 1].id;

  const rows = [...list].reverse().map((s) => {
    const shapeTrials = s.trials.filter((t) => t.disparityPx > 0);
    const c = s.trials.filter((t) => t.correct).length;
    const th = threshold(byLevel(shapeTrials));
    return el('tr', { class: `click ${s.id === selected ? 'sel' : ''}`, onclick: () => { selected = s.id; renderResults(); } },
      el('td', {}, new Date(s.date).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })),
      el('td', {}, s.participant),
      el('td', {}, condName(s.glasses)),
      el('td', {}, String(s.trials.length)),
      el('td', {}, `${pct(c, s.trials.length)}%`),
      el('td', {}, th ? `${th.px} px (${fmtArc(th.arcsec)})` : '—'));
  });
  host.replaceChildren(el('table', { class: 'data' },
    el('thead', {}, el('tr', {}, ...['When', 'Participant', 'Condition', 'Trials', 'Accuracy', 'Threshold'].map((h) => el('th', {}, h)))),
    el('tbody', {}, rows)));

  renderDetail(list.find((s) => s.id === selected), list);
}

function renderDetail(s, all) {
  const shapeTrials = s.trials.filter((t) => t.disparityPx > 0);
  const catchTrials = s.trials.filter((t) => t.disparityPx === 0);
  const levels = byLevel(shapeTrials);
  const th = threshold(levels);
  const c = s.trials.filter((t) => t.correct).length;
  const chance = Math.round(100 / ((s.shapes?.length ?? 1) + 1));

  const stat = (v, k) => el('div', { class: 'stat' }, el('div', { class: 'v' }, v), el('div', { class: 'k' }, k));
  const stats = el('div', { class: 'stats' },
    stat(`${pct(c, s.trials.length)}%`, `Accuracy (${c}/${s.trials.length}) · chance ≈ ${chance}%`),
    stat(`${pct(shapeTrials.filter((t) => t.popped).length, shapeTrials.length)}%`, 'Reported pop-out (shape trials)'),
    stat(th ? fmtArc(th.arcsec) : '—', th ? `Threshold · ${th.px} px · ${th.both}/${th.n} seen` : 'Threshold (no level ≥ 2/3)'),
    catchTrials.length ? stat(`${catchTrials.filter((t) => t.response !== 'No shape').length}/${catchTrials.length}`, 'False alarms on catch trials') : null);

  // Chart: % correct vs disparity, one series per condition, for this participant.
  const mine = all.filter((x) => x.participant === s.participant);
  const series = [true, false].map((g) => ({
    name: condName(g),
    color: g ? 'var(--series-1)' : 'var(--series-2)',
    levels: byLevel(mine.filter((x) => x.glasses === g).flatMap((x) => x.trials).filter((t) => t.disparityPx > 0)),
  })).filter((x) => x.levels.length);

  const levelTable = el('table', { class: 'data' },
    el('thead', {}, el('tr', {}, ...['Disparity (px)', 'Arcsec', 'Trials', 'Correct shape', 'Popped out', 'Both'].map((h) => el('th', {}, h)))),
    el('tbody', {}, levels.map((l) => el('tr', { class: th && l.px === th.px ? 'sel' : '' },
      el('td', {}, String(l.px)), el('td', {}, fmtArc(l.arcsec)), el('td', {}, String(l.n)),
      el('td', {}, `${l.correct}/${l.n}`), el('td', {}, `${l.popped}/${l.n}`), el('td', {}, `${l.both}/${l.n}`)))));

  const trialTable = el('table', { class: 'data' },
    el('thead', {}, el('tr', {}, ...['#', 'Glasses', 'Disparity', 'True shape', 'Response', 'Correct', 'Pops out'].map((h) => el('th', {}, h)))),
    el('tbody', {}, s.trials.map((t) => el('tr', {},
      el('td', {}, String(t.n)), el('td', {}, t.glasses ? 'Yes' : 'No'),
      el('td', {}, `${t.disparityPx} px (${fmtArc(t.arcsec)})`), el('td', {}, t.truth), el('td', {}, t.response),
      el('td', { class: t.correct ? 'ok' : 'no' }, t.correct ? '✓' : '✗'), el('td', {}, t.popped ? 'Yes' : 'No')))));

  $('#r-detail').replaceChildren(el('div', { class: 'detail' },
    el('div', { class: 'results-head' },
      el('h2', {}, `${s.participant} · ${condName(s.glasses)}`),
      el('div', { class: 'btnrow' },
        el('button', { class: 'btn', onclick: () => downloadText(toCSV([s]), `rds_${s.participant}_${s.glasses ? 'glasses' : 'noglasses'}.csv`) }, 'CSV'),
        el('button', { class: 'btn danger', onclick: () => {
          if (!confirm('Delete this run? This cannot be undone.')) return;
          saveSessions(loadSessions().filter((x) => x.id !== s.id));
          renderResults();
        } }, 'Delete'))),
    el('p', { class: 'muted' }, `${s.params.screen} · ${s.params.distance} cm · 1 px ≈ ${s.params.arcPerPx.toFixed(1)}″ · dots ${s.params.dotSize} px @ ${Math.round(s.params.density * 100)}% · bg offset ${s.params.bgOffset} px · shapes: ${s.shapes.join(', ')}`),
    stats,
    el('h3', {}, `% correct shape by disparity · ${s.participant}`),
    chart(series, chance),
    el('h3', {}, 'By disparity level (this run)'),
    levelTable,
    el('h3', { style: 'margin-top:18px' }, 'All trials'),
    trialTable));
}

// Small SVG line chart: x = disparity (arcsec, log), y = % correct.
function chart(series, chance) {
  const W = 720, H = 280, L = 44, R = 16, T = 12, B = 36;
  const xs = series.flatMap((s) => s.levels.map((l) => l.arcsec));
  if (!xs.length) return el('p', { class: 'muted' }, 'No shape trials yet.');
  const lo = Math.min(...xs) / 1.2, hi = Math.max(...xs) * 1.2;
  const x = (v) => L + ((Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * (W - L - R);
  const y = (p) => T + (1 - p / 100) * (H - T - B);
  const NS = 'http://www.w3.org/2000/svg';
  const s = (tag, attrs, text) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    return e;
  };
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Percent correct by disparity' });
  for (const p of [0, 25, 50, 75, 100]) {
    svg.append(s('line', { x1: L, x2: W - R, y1: y(p), y2: y(p), stroke: 'var(--line)', 'stroke-width': 1 }));
    svg.append(s('text', { x: L - 8, y: y(p) + 4, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--ink-2)' }, `${p}%`));
  }
  const ticks = [10, 20, 50, 100, 200, 500, 1000, 2000].filter((t) => t >= lo && t <= hi);
  for (const t of ticks) svg.append(s('text', { x: x(t), y: H - B + 18, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--ink-2)' }, `${t}″`));
  svg.append(s('text', { x: (L + W - R) / 2, y: H - 4, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--ink-2)' }, 'Disparity (arcsec, log scale)'));
  // chance line
  svg.append(s('line', { x1: L, x2: W - R, y1: y(chance), y2: y(chance), stroke: 'var(--ink-3)', 'stroke-dasharray': '4 4', 'stroke-width': 1 }));
  svg.append(s('text', { x: W - R, y: y(chance) - 5, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--ink-3)' }, 'chance'));

  const wrap = el('div', { class: 'chart' });
  const tip = el('div', { class: 'tip', hidden: true });
  for (const ser of series) {
    const pts = ser.levels.map((l) => [x(l.arcsec), y((100 * l.correct) / l.n), l]);
    svg.append(s('polyline', { points: pts.map(([a, b]) => `${a},${b}`).join(' '), fill: 'none', stroke: ser.color, 'stroke-width': 2, 'stroke-linejoin': 'round' }));
    for (const [a, b, l] of pts) {
      svg.append(s('circle', { cx: a, cy: b, r: 5, fill: ser.color, stroke: 'var(--surface)', 'stroke-width': 2 }));
      const hit = s('circle', { cx: a, cy: b, r: 14, fill: 'transparent' });
      hit.addEventListener('mouseenter', () => {
        tip.textContent = `${ser.name} · ${fmtArc(l.arcsec)} (${l.px} px) · ${l.correct}/${l.n} correct, ${l.popped}/${l.n} popped`;
        tip.style.left = `${(a / W) * 100}%`;
        tip.style.top = `${(b / H) * 100}%`;
        tip.hidden = false;
      });
      hit.addEventListener('mouseleave', () => (tip.hidden = true));
      svg.append(hit);
    }
    // direct label at the last point
    const [la, lb] = pts[pts.length - 1];
    svg.append(s('text', { x: Math.min(la, W - R - 4), y: lb - 10, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--ink)' }, ser.name));
  }
  const legend = el('div', { class: 'legend' }, series.map((ser) => el('span', {}, el('i', { style: `background:${ser.color}` }), ser.name)));
  wrap.append(legend, svg, tip);
  return wrap;
}

function toCSV(sessions) {
  const head = ['session', 'date', 'participant', 'glasses', 'trial', 'disparity_px', 'disparity_arcsec', 'true_shape', 'response', 'correct', 'popped_out', 'rt_ms', 'seed', 'screen', 'distance_cm', 'arcsec_per_px'];
  const q = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
  const lines = [head.join(',')];
  for (const s of sessions) for (const t of s.trials) {
    lines.push([s.id, s.date, s.participant, t.glasses ? 'yes' : 'no', t.n, t.disparityPx, t.arcsec, t.truth, t.response,
      t.correct ? 1 : 0, t.popped ? 1 : 0, t.rtMs, t.seed, s.params.screen, s.params.distance, s.params.arcPerPx.toFixed(2)].map(q).join(','));
  }
  return lines.join('\n');
}
