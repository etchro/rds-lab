# RDS Lab

A browser tool for making **random dot stereograms** (red/cyan anaglyphs) and running simple depth-perception experiments with them. Plain HTML, CSS, and JavaScript, with no build step and no dependencies.

You need red/cyan 3D glasses: **red lens over the left eye, cyan lens over the right eye.**

## Features

- **Generator:** choose a hidden shape (built-in shapes, letters, or your own image), then set the disparity, dot size, density, and background offset. You can view each recipe step (mask, dot pattern, left eye, right eye, combined) and download it as a PNG.
- **Experiment:** runs randomized fullscreen trials with fresh random dots on every trial. Includes no-shape catch trials and a no-glasses control condition. There are two presets: shape identification, and a 10-level disparity threshold run (40–1000″).
- **Results:** runs are saved in your browser (localStorage) and show accuracy, a per-level table, an estimated threshold, and a chart. You can export everything as CSV.
- **Screen setup:** enter your screen size and viewing distance so pixel shifts can be converted to arcseconds. It also detects macOS display scaling and browser zoom.

> **Set your screen first.** Browsers can't report a screen's physical size, so the app guesses the resolution and shows a warning until you pick a preset or enter your screen's diagonal and native resolution in Screen setup. Stereograms display correctly either way; only the arcsecond values depend on it.

## How it works

The recipe lives in [`js/rds.js`](js/rds.js), with comments for each step:

1. Fill a field with random black dots.
2. Copy the field for the second eye and shift every dot horizontally by a small background offset. This spreads color fringes across the whole image, so the shape can't be seen without glasses.
3. Inside the shape mask, shift the dots further. This extra shift is the disparity. Then fill the uncovered gap with new random dots.
4. Print the left-eye layer in cyan and the right-eye layer in red. Each lens hides one layer, so each eye sees only its own image, and the brain fuses the horizontal offset into depth.

Every stimulus uses a seeded RNG, so the same seed and settings always produce the same image.

## Run locally

ES modules don't load from `file://`, so serve the folder with any static server:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Deploy to GitHub Pages

Push this repo to GitHub, then go to **Settings → Pages → Build and deployment**. Choose **Deploy from a branch**, select `main` and `/ (root)`, and save.

## Tips for viewing

- Keep browser zoom at 100%.
- Sit about 50 cm from the screen, and use a laptop or monitor rather than a phone.
- Turn the brightness up.
- Test with one eye closed: the shape should disappear.

## License

[MIT](LICENSE)
