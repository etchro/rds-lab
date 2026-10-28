// Shape masks (recipe step 3). Each shape is drawn white-on-black onto an
// offscreen canvas, then read back as a 0/1 array. All shapes are centred on
// (0,0) and sized by radius r.

function poly(ctx, pts) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fill();
}

function regular(n, r, rot = -Math.PI / 2) {
  return Array.from({ length: n }, (_, i) => {
    const a = rot + (i * 2 * Math.PI) / n;
    return [r * Math.cos(a), r * Math.sin(a)];
  });
}

export const SHAPES = {
  circle: { label: 'Circle', draw: (c, r) => { c.beginPath(); c.arc(0, 0, r, 0, 2 * Math.PI); c.fill(); } },
  triangle: { label: 'Triangle', draw: (c, r) => poly(c, regular(3, r * 1.1).map(([x, y]) => [x, y + r * 0.15])) },
  star: {
    label: 'Star',
    draw: (c, r) => poly(c, Array.from({ length: 10 }, (_, i) => {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? r * 0.45 : r;
      return [rr * Math.cos(a), rr * Math.sin(a)];
    })),
  },
  heart: {
    label: 'Heart',
    draw: (c, r) => poly(c, Array.from({ length: 120 }, (_, i) => {
      const t = (i / 120) * 2 * Math.PI;
      const x = 16 * Math.sin(t) ** 3;
      const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      return [(x * r) / 17, (-y * r) / 17 - r * 0.05];
    })),
  },
  diamond: { label: 'Diamond', draw: (c, r) => poly(c, [[0, -r], [r * 0.62, 0], [0, r], [-r * 0.62, 0]]) },
  cross: {
    label: 'Cross',
    draw: (c, r) => {
      const w = r * 0.36;
      poly(c, [[-w, -r], [w, -r], [w, -w], [r, -w], [r, w], [w, w], [w, r], [-w, r], [-w, w], [-r, w], [-r, -w], [-w, -w]]);
    },
  },
  hexagon: { label: 'Hexagon', draw: (c, r) => poly(c, regular(6, r, 0)) },
  ring: {
    label: 'Ring',
    draw: (c, r) => {
      c.beginPath();
      c.arc(0, 0, r, 0, 2 * Math.PI);
      c.arc(0, 0, r * 0.55, 0, 2 * Math.PI, true);
      c.fill('evenodd');
    },
  },
  arrow: {
    label: 'Arrow',
    draw: (c, r) => poly(c, [[-r, -r * 0.25], [r * 0.1, -r * 0.25], [r * 0.1, -r * 0.7], [r, 0], [r * 0.1, r * 0.7], [r * 0.1, r * 0.25], [-r, r * 0.25]]),
  },
  crescent: {
    label: 'Crescent',
    draw: (c, r) => {
      c.beginPath(); c.arc(0, 0, r, 0, 2 * Math.PI); c.fill();
      c.save(); c.globalCompositeOperation = 'destination-out';
      c.beginPath(); c.arc(r * 0.45, -r * 0.15, r * 0.82, 0, 2 * Math.PI); c.fill();
      c.restore();
    },
  },
};

// Shape spec: { shape: key | 'text' | 'image', text, image, invert, sizeFrac, rotation, offsetX, offsetY }
// sizeFrac = shape diameter as a fraction of the shorter image side.
export function shapeLabel(spec) {
  if (spec.shape === 'text') return `Letter "${spec.text}"`;
  if (spec.shape === 'image') return 'Custom image';
  return SHAPES[spec.shape]?.label ?? spec.shape;
}

let scratch, layer;
export function buildMask(width, height, spec) {
  scratch ??= document.createElement('canvas');
  layer ??= document.createElement('canvas');
  scratch.width = layer.width = width;
  scratch.height = layer.height = height;

  // The shape is drawn white on a transparent layer (some shapes cut holes
  // with destination-out), then composited over a black background.
  const lc = layer.getContext('2d', { willReadFrequently: true });
  const r = (Math.min(width, height) * spec.sizeFrac) / 2;
  lc.translate(width / 2 + spec.offsetX * width, height / 2 + spec.offsetY * height);
  lc.rotate(((spec.rotation || 0) * Math.PI) / 180);
  lc.fillStyle = '#fff';
  if (spec.shape === 'image' && spec.image) {
    drawImageMask(lc, spec.image, r, spec.invert);
  } else if (spec.shape === 'text') {
    lc.font = `900 ${Math.round(r * 2.3)}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
    lc.textAlign = 'center';
    lc.textBaseline = 'middle';
    lc.fillText(spec.text || 'A', 0, r * 0.08);
  } else {
    (SHAPES[spec.shape] ?? SHAPES.circle).draw(lc, r);
  }

  const c = scratch.getContext('2d', { willReadFrequently: true });
  c.fillStyle = '#000';
  c.fillRect(0, 0, width, height);
  c.drawImage(layer, 0, 0);

  const px = c.getImageData(0, 0, width, height).data;
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = px[i * 4] > 127 ? 1 : 0;
  return mask;
}

// Custom image: dark, opaque pixels become the shape (tick "invert" for light-on-dark art).
function drawImageMask(c, img, r, invert) {
  const box = r * 2;
  const k = Math.min(box / img.width, box / img.height);
  const w = Math.round(img.width * k), h = Math.round(img.height * k);
  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  const t = tmp.getContext('2d', { willReadFrequently: true });
  t.drawImage(img, 0, 0, w, h);
  const id = t.getImageData(0, 0, w, h);
  const d = id.data;
  for (let p = 0; p < d.length; p += 4) {
    const lum = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
    let on = d[p + 3] > 127 && lum < 128;
    if (invert) on = d[p + 3] > 127 && lum >= 128;
    d[p] = d[p + 1] = d[p + 2] = on ? 255 : 0;
    d[p + 3] = on ? 255 : 0;
  }
  t.putImageData(id, 0, 0);
  c.drawImage(tmp, -w / 2, -h / 2);
}
