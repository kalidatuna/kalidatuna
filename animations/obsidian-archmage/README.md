# The Obsidian Archmage

A 10-second CGI clip (1280×720, 30 fps). An original masked sorcerer-king lights up a rune circle, gathers a storm of magic into an orb, and releases it.

- `archmage.mp4`: the rendered video
- `index.html`: the Three.js scene. Every frame is a pure function of time, `renderAt(t)`.
- `render.cjs`: renders the scene frame by frame with headless Chromium (Playwright)

## Re-render

```bash
npm install
python3 -m http.server 8765 --bind 127.0.0.1 &
node render.cjs frames 30
ffmpeg -framerate 30 -i frames/f%04d.png -c:v libx264 -crf 18 -pix_fmt yuv420p archmage.mp4
```

Open `http://127.0.0.1:8765/index.html` to watch it play live in a browser.
