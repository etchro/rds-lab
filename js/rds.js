// =============================================================================
// rds.js — the Random Dot Stereogram recipe.
//
// Each block is labelled with the recipe step (1–8) it implements.
//
// Conventions
//   • Every image is a Uint8Array of width*height, 1 = dot (or "inside shape"),
//     0 = empty. Units are DEVICE PIXELS (canvas pixels drawn 1:1 to the
//     screen), so a disparity of N means the dots move N screen pixels.
//   • Red lens = LEFT eye, cyan lens = RIGHT eye.
//       - Through the red lens, red ink looks like the white page and CYAN dots
//         look dark  →  the CYAN layer is the LEFT-eye image.
//       - Through the cyan lens, cyan ink disappears and RED dots look dark
//         →  the RED layer is the RIGHT-eye image.
//   • Positive disparity shifts the shape's red (right-eye) dots LEFT =
//     crossed disparity = the shape appears NEARER than the background.
//     Negative disparity shifts them right = uncrossed = FARTHER.
// =============================================================================

// Seeded random number generator (mulberry32). A seed makes every stereogram
// reproducible: same seed + same settings = identical image.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Random dot field: the image is divided into dotSize×dotSize cells and each
// cell is independently black with probability `density`. Same dot size,
// density and contrast everywhere, so no region stands out monocularly.
function dotField(width, height, dotSize, density, rand) {
  const cols = Math.ceil(width / dotSize);
  const rows = Math.ceil(height / dotSize);
  const cells = new Uint8Array(cols * rows);
  for (let i = 0; i < cells.length; i++) cells[i] = rand() < density ? 1 : 0;

  const img = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const rowBase = ((y / dotSize) | 0) * cols;
    for (let x = 0; x < width; x++) {
      img[y * width + x] = cells[rowBase + ((x / dotSize) | 0)];
    }
  }
  return img;
}

/**
 * Build one stereogram.
 *
 * @param {object}     o
 * @param {number}     o.width, o.height  image size in device pixels
 * @param {number}     o.dotSize          dot edge length in pixels
 * @param {number}     o.density          fraction of cells that hold a dot (0–1)
 * @param {number}     o.disparity        extra shape shift in pixels (+ near, − far)
 * @param {number}     o.bgOffset         whole-image red-layer offset in pixels
 * @param {Uint8Array} o.mask             shape mask, 1 = inside shape
 * @param {number}     o.seed             random seed
 * @returns {{width, height, mask, pattern, left, right}}
 */
export function generateRDS({ width, height, dotSize, density, disparity, bgOffset, mask, seed }) {
  const ds = Math.max(1, Math.round(dotSize));
  const s = Math.round(disparity); // shape shift (relative disparity)
  const b = Math.round(bgOffset); // background offset

  // We generate the dot field a little wider than the visible image (a margin
  // M on each side) so that shifting the red layer never pulls in an empty
  // strip at the edge. M is a whole number of dots so the grid lines up.
  const M = Math.ceil((Math.abs(s) + Math.abs(b) + ds) / ds) * ds;
  const EW = width + 2 * M;

  // ---------------------------------------------------------------------------
  // STEP 1 — Generate ONE random dot pattern.
  // Both eyes start from this same pattern. Two identical copies have zero
  // disparity relative to each other: the brain fuses them as one flat plane.
  // ---------------------------------------------------------------------------
  const P = dotField(EW, height, ds, density, mulberry32(seed));

  // A second, independent pattern used only to refill the gap in step 6.
  // Its statistics (dot size, density) are identical to P.
  const Q = dotField(EW, height, ds, density, mulberry32((seed ^ 0x9e3779b9) >>> 0));

  // ---------------------------------------------------------------------------
  // STEP 3 — Define the shape with a mask (white = dots to move).
  // The mask is snapped to the dot grid: a whole dot is "in the shape" if its
  // centre is. This way the shape is cut along dot edges and no half-dots
  // trace its outline in either single-eye image.
  // ---------------------------------------------------------------------------
  const cols = Math.ceil(width / ds);
  const rows = Math.ceil(height / ds);
  const cellMask = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const cy = Math.min(height - 1, r * ds + (ds >> 1));
    for (let c = 0; c < cols; c++) {
      const cx = Math.min(width - 1, c * ds + (ds >> 1));
      cellMask[r * cols + c] = mask[cy * width + cx];
    }
  }
  // Is extended-image pixel (xe, y) inside the shape?
  const inShape = (xe, y) => {
    const x = xe - M;
    if (x < 0 || x >= width) return 0;
    return cellMask[((y / ds) | 0) * cols + ((x / ds) | 0)];
  };

  // ---------------------------------------------------------------------------
  // STEP 4 — Keep the CYAN (left-eye) image unchanged: it is just P.
  //
  // STEPS 5–7 — Build the RED (right-eye) image. For every pixel x of the red
  // image we decide where its content comes from:
  //
  //   (5) If x lies where the shape lands after shifting by s pixels, copy
  //       the shape's dot from P at x + s. Effect: every dot inside the shape
  //       moves s pixels LEFT, rows untouched (purely horizontal shift; a
  //       vertical shift is not binocular disparity and breaks fusion).
  //   (7) The shifted patch REPLACES whatever dots were already at the
  //       destination, instead of piling on top of them (which would make
  //       that area visibly denser).
  //   (6) If x was inside the shape's ORIGINAL position but the shape has now
  //       moved away, that strip would be empty, so fill it with fresh random
  //       dots from Q. (These dots exist in only one eye, like the sliver of
  //       background that a real near object hides from one eye.)
  //   Otherwise x is background: copy P unchanged.
  //
  // Because every red pixel is assigned exactly once, density stays uniform:
  // the shape cannot be found by looking for a gap or a dense patch.
  // ---------------------------------------------------------------------------
  const R0 = new Uint8Array(EW * height);
  for (let y = 0; y < height; y++) {
    const row = y * EW;
    for (let xe = 0; xe < EW; xe++) {
      const src = xe + s;
      if (src >= 0 && src < EW && inShape(src, y)) {
        R0[row + xe] = P[row + src]; // step 5 + 7: shifted shape dots
      } else if (inShape(xe, y)) {
        R0[row + xe] = Q[row + xe]; // step 6: refill uncovered gap
      } else {
        R0[row + xe] = P[row + xe]; // background: unchanged copy
      }
    }
  }

  // ---------------------------------------------------------------------------
  // STEP 2 — Background offset: shift the ENTIRE red image b pixels.
  // The background now sits at disparity b and the shape at b + s, so the
  // shape is still s pixels in front of the background. Why bother? With
  // b = 0 every background dot overlaps its partner and prints black, while
  // shape dots print as separate red/cyan — the shape would be visible
  // WITHOUT glasses. With a background offset, red/cyan fringes appear
  // everywhere and the only cue left is disparity.
  // (Done last here because it is a plain whole-image shift; the result is the
  // same as doing it first.)
  //
  // Finally we crop the margins away to get the visible images.
  // ---------------------------------------------------------------------------
  const left = new Uint8Array(width * height);
  const right = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      left[y * width + x] = P[y * EW + x + M];
      right[y * width + x] = R0[y * EW + x + M + b];
    }
  }

  return { width, height, mask, pattern: left, left, right };
}

// =============================================================================
// Rendering — turns the 0/1 arrays into pixels.
// =============================================================================

// STEP 8 — Overlay the red and cyan layers on a white page.
// Pixel colour is computed per channel, like ink:
//   cyan dot (left eye)  removes RED light        → R = 0
//   red dot  (right eye) removes GREEN+BLUE light → G = B = 0
// So: cyan only = (0,255,255), red only = (255,0,0), both = black, neither = white.
export function paintAnaglyph(imageData, left, right) {
  const d = imageData.data;
  for (let i = 0, p = 0; i < left.length; i++, p += 4) {
    const gb = right[i] ? 0 : 255;
    d[p] = left[i] ? 0 : 255;
    d[p + 1] = gb;
    d[p + 2] = gb;
    d[p + 3] = 255;
  }
  return imageData;
}

// One layer in a single colour on white (used for the B/W pattern, the mask,
// and the separate red / cyan eye images in the recipe).
export function paintLayer(imageData, layer, rgb) {
  const d = imageData.data;
  for (let i = 0, p = 0; i < layer.length; i++, p += 4) {
    const on = layer[i];
    d[p] = on ? rgb[0] : 255;
    d[p + 1] = on ? rgb[1] : 255;
    d[p + 2] = on ? rgb[2] : 255;
    d[p + 3] = 255;
  }
  return imageData;
}

// The mask image: white shape on black.
export function paintMask(imageData, mask) {
  const d = imageData.data;
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    const v = mask[i] ? 255 : 0;
    d[p] = d[p + 1] = d[p + 2] = v;
    d[p + 3] = 255;
  }
  return imageData;
}

export const RED = [255, 0, 0];
export const CYAN = [0, 255, 255];
export const BLACK = [0, 0, 0];
