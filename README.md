# Studio Wallpapers

A single-page generator for dark, glowing ribbon wallpapers. Open `index.html` in a browser. It has no build step and no dependencies.

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
- The seed fixes the layout. Space picks a new seed and S shuffles every slider.
- The URL hash holds all settings, so a link reproduces the same image.

## Labels

The Labels panel puts an identifier on every screen. Turn on Text label, set Series (for example "UTILITY PC") and a Modifier of numbers or letters with a start value. Screens are numbered row by row, left to right, so a 3 × 2 grid gives UTILITY PC 1 to UTILITY PC 6. Drag the label in the screen 1 editor, or set size, weight, spacing, opacity, alignment and colour; every screen copies the layout. The image layer takes a PNG or SVG and places it the same way. Label settings are saved in the browser, not in the URL.

## Export

"Download span PNG" writes one image the size of the whole grid with the bezels removed, for an OS "span" wallpaper mode. "One PNG per monitor" writes one file per screen, named by row and column.
