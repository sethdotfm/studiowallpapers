# Studio Wallpapers

A single-page generator for dark, glowing ribbon wallpapers. Open `index.html` in a browser. It has no build step and no dependencies.

```bash
python3 -m http.server 8931
```

Then open http://localhost:8931. Opening the file directly also works.

## Controls

- Resolution is the size of one screen. Columns and rows set the display grid, so 1920 × 1080 with 4 columns and 2 rows gives a 4 × 2 wall.
- Bezel gap is the physical border between screens, in pixels. The art is drawn across the gap and then cut out, so ribbons line up across screens.
- Busyness sets the ribbon count. Fill makes the glass bodies more opaque. Spread fans the ribbons out from the point where they cross. Curl bends them. Chaos adds per-ribbon jitter; at 0 the ribbons stay evenly spaced.
- Glimmer adds star glints and fine sparkles where a ribbon edge faces the light (top left). Bloom adds a soft glow over the whole image. Pixel bits adds square trails along some ribbons. Grain adds film noise.
- The seed fixes the layout. Space picks a new seed and S shuffles every slider.
- The URL hash holds all settings, so a link reproduces the same image.

## Export

"Download span PNG" writes one image the size of the whole grid with the bezels removed, for an OS "span" wallpaper mode. "One PNG per monitor" writes one file per screen, named by row and column.
