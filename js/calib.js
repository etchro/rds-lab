// Screen calibration: converts on-screen pixel shifts to visual angle.
//
//   physical pixel size  p  = (diagonal in cm) / (diagonal in pixels)
//   shift on screen      s  = d × p              (d = shift in pixels)
//   disparity (arcsec)      = 2·atan(s / 2D) · 180/π · 3600   (D = viewing distance)
//
// The canvas draws in DEVICE pixels. macOS "scaled" display modes render a
// larger framebuffer and squeeze it onto the panel, so one device pixel may be
// less than one physical pixel. We measure that ratio and fold it in.

export const PRESETS = {
  'mba13': { label: 'MacBook Air 13.6" (2560×1664)', diag: 13.6, w: 2560, h: 1664 },
  'mba15': { label: 'MacBook Air 15.3" (2880×1864)', diag: 15.3, w: 2880, h: 1864 },
  'mbp14': { label: 'MacBook Pro 14.2" (3024×1964)', diag: 14.2, w: 3024, h: 1964 },
  'mbp16': { label: 'MacBook Pro 16.2" (3456×2234)', diag: 16.2, w: 3456, h: 2234 },
  'custom': { label: 'Custom…' },
};

const KEY = 'rds.calib';
// Browsers don't report physical screen size, so until the user picks a screen
// we guess the resolution from the framebuffer and flag the diagonal as unknown.
function defaults() {
  const dpr = window.devicePixelRatio || 1;
  return {
    preset: 'custom', diag: 14, distance: 50, confirmed: false,
    w: Math.round(screen.width * dpr), h: Math.round(screen.height * dpr),
  };
}

export function loadCalib() {
  try {
    const saved = localStorage.getItem(KEY);
    return saved ? { ...defaults(), confirmed: true, ...JSON.parse(saved) } : defaults();
  } catch { return defaults(); }
}
export function saveCalib(c) {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch {}
}

export function arcsecFromCm(s, D) {
  return 2 * Math.atan(s / (2 * D)) * (180 / Math.PI) * 3600;
}

export function describe(c) {
  const dpr = window.devicePixelRatio || 1;
  const fbW = Math.round(screen.width * dpr); // framebuffer width in device px
  const physPerDevice = c.w / fbW; // physical px per device px (1 = exact)
  const pxCm = (c.diag * 2.54) / Math.hypot(c.w, c.h);
  const arcPerPhys = arcsecFromCm(pxCm, c.distance);
  const arcPerDevice = arcsecFromCm(pxCm * physPerDevice, c.distance);
  const warnings = [];
  if (!c.confirmed) {
    warnings.push(
      `Screen size not set. Open Screen setup and pick your screen, or enter its diagonal and native resolution. ` +
      `Stereograms work either way; only the arcsec values depend on this.`
    );
  }
  if (Math.abs(dpr - Math.round(dpr)) > 0.01) {
    warnings.push(`Browser zoom isn't 100% (pixel ratio ${dpr.toFixed(2)}). Press ⌘0 (Ctrl+0) to reset zoom.`);
  }
  if (Math.abs(physPerDevice - 1) > 0.02) {
    const half = `${Math.round(c.w / 2)}×${Math.round(c.h / 2)}`;
    warnings.push(
      `Display is scaled (looks like ${screen.width}×${screen.height}): 1 canvas px = ${physPerDevice.toFixed(2)} physical px, ` +
      `so dots get resampled. Arcsec values below already account for this, but for exact whole-pixel shifts set ` +
      `System Settings → Displays to the size that looks like ${half}.`
    );
  }
  return { dpr, fbW, physPerDevice, pxCm, arcPerPhys, arcPerDevice, warnings };
}

// Disparity in pixels → arcseconds on this screen.
export function pxToArcsec(px, c) {
  const d = describe(c);
  return Math.sign(px) * arcsecFromCm(Math.abs(px) * d.pxCm * d.physPerDevice, c.distance);
}
export function arcsecToPx(arc, c) {
  const d = describe(c);
  const s = 2 * c.distance * Math.tan((arc / 3600 / 2) * (Math.PI / 180));
  return s / (d.pxCm * d.physPerDevice);
}
