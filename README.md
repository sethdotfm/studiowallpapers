# Studio Wallpapers

A single-page generator for dark, glowing glass-ribbon wallpapers and seamless video loops, rendered on the GPU with WebGL 2. It has no build step and no dependencies. Use Chrome or Edge; video export needs WebCodecs.

The interface is built with [Patchbay](https://github.com/sethdotfm/patchbay), vendored in `patchbay/` (version in `patchbay/VERSION`). To update it, copy `css/`, `fonts/`, `icons/` and `VERSION` from a Patchbay release into `patchbay/`. The UI text uses Segoe UI when it's installed and Patchbay's IBM Plex Sans otherwise; `--pb-font` in `index.html` sets this. The toolbar's Light mode button switches the interface theme; the wallpaper is unaffected.

```bash
python3 serve.py
```

Then open http://localhost:8931, or this machine's IP on port 8931 from another computer. `serve.py [port] [host]` defaults to 8931 on 0.0.0.0 and tells browsers not to cache, so edits show on a normal reload. Opening `index.html` directly also works.

## Controls

- Resolution is the size of one screen. Columns and rows set the display grid, so 1920 × 1080 with 4 columns and 2 rows gives a 4 × 2 wall.
- Bezel gap is the physical border between screens, in pixels. The art is drawn across the gap and then cut out, so ribbons line up across screens.
- Busyness sets the ribbon count. Fill sets how solid the glass core is. Spread fans the ribbons out from the point where they cross. Curl bends them. Chaos adds per-ribbon jitter; at 0 the ribbons stay evenly spaced. Twist turns each ribbon about its spine, so it narrows and flips to its darker back face.
- Edge hue shifts the colour of the far bevel away from the accent (positive goes toward yellow for green). Bloom adds a soft glow over the whole image. Pixel bits adds square trails along some ribbons. Grain adds film noise.
- Every slider has a number field you can type into. Label sizes and positions are in percent of the screen.
- The seed fixes the layout. N picks a new seed and S shuffles the shape sliders.
- The URL hash holds all settings, so a link reproduces the same image.

## Motion

The preview plays continuously. Every movement repeats exactly once per loop, so a loop of any length plays forever with no jump at the wrap.

- Loop is the length in seconds. Speed is how many times the main motions cycle per loop, in quarter steps.
- Swipe reveals each ribbon as a travelling window: left to right, right to left, alternating, or random per ribbon. Swipe length sets how much of the ribbon shows at once.
- Flow sends waves along the ribbons in the swipe direction. Drift slowly sways the ends and the bow. Breathe swells and thins the width. Wander adds uneven per-ribbon movement.
- Roll turns the twist and Bits flow moves the pixel bits (negative reverses). Shimmer slides the reflections, with Shimmer dir choosing left to right, right to left, the swipe direction, or random per ribbon. All are cycles per loop in quarter steps.
- A seamless loop needs every motion to finish whole cycles, so quarter-step rates may need 2 to 4 passes of the loop to line up. The page then shows the real repeat length, and video exports use it.
- The top-right corner shows the browser's frame rate and the render time per frame. In kiosk mode press F, or add `&meter=1` to the link, to show it.
- Shuffle motion (M) randomises these. Space or P plays or pauses; the scrubber picks a moment for stills.

## Video loop

MP4 per monitor encodes one file per screen; Span MP4 encodes the whole wall in one file with the bezels cut out. Codec is HEVC (H.265) or H.264; HEVC uses the Mac's hardware encoder, makes smaller files at the same quality, and on this Mac encodes spans up to at least 7680 × 2160. If the chosen codec can't encode a size, the export falls back to the other one and says so. The codec list marks a codec "not available here" when this browser can't encode one screen at the current size. Frames are rendered one at a time at exact loop positions straight from the GPU canvas, up to three screens encoding at once, so a 20 s loop at 30 fps is exactly 600 frames and repeats cleanly in any player set to loop. Hardware H.264 encoders cap the frame size (on this Mac 5760 × 1080 works and 7680 × 2160 doesn't), so use HEVC for big spans. Browsers only expose the video encoder on secure pages, so export from http://localhost:8931 on the machine running the server, or over https; a plain http network address can play and save stills but not encode video.

## Kiosk

Each screen has a kiosk link that plays that screen full window. Open one link per display PC and double-click for full screen. When the page runs from `serve.py`, the links use this machine's network address even if you opened it as localhost. All PCs take their position in the loop from the system clock, so the wall stays in step as long as their clocks are synced. Text labels travel in the link; uploaded images don't.

## Labels

The Labels panel puts an identifier on every screen. Turn on Text label, set Series (for example "UTILITY PC") and a Modifier of numbers or letters with a start value. Screens are numbered row by row, left to right, so a 3 × 2 grid gives UTILITY PC 1 to UTILITY PC 6. Drag the label in the screen 1 editor, or set font, size, weight, spacing, opacity, alignment and colour; every screen copies the layout. The default font is Open Sans, bundled as a variable font in `fonts/` (SIL Open Font License), so the weight slider renders every weight from 300 to 800. Segoe UI Variable gives the same on Windows 11 display PCs; plain Segoe UI and IBM Plex Sans only have the weights installed (Segoe UI on this Mac has Regular and Bold). The image layer takes a PNG or SVG and places it the same way. Label settings are saved in the browser, not in the URL.

## Export

Stills are taken at the scrubber position. "Download span PNG" writes one image the size of the whole grid with the bezels removed, for an OS "span" wallpaper mode. "One PNG per monitor" writes one file per screen, named by row and column.
