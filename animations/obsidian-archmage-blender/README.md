# The Obsidian Archmage: Blender / Cycles version

A photoreal pass at the 10-second clip: path-traced in Cycles, with simulated cloth for the robe and cape, volumetric fire, a real night-sky HDRI, and photoscanned stone, fabric and rock assets from Poly Haven (CC0).

## Run it on your own machine (uses your GPU)

1. Install Blender 4.5 LTS from <https://www.blender.org/download/>.
2. Download the assets (about 70 MB):

   ```bash
   python3 get_assets.py assets
   cp rune.png assets/
   ```

3. Build the scene. This also bakes the cloth simulation:

   ```bash
   blender -b -P archmage.py -- build "$PWD/assets" "$PWD/archmage.blend"
   ```

4. Render. `--hq` turns the volumetric fog back on when a GPU is found:

   ```bash
   mkdir -p frames
   blender -b archmage.blend -P archmage.py -- render 1 240 64 "$PWD/frames/f" --hq
   ```

5. Encode:

   ```bash
   ffmpeg -framerate 24 -i frames/f%04d.png -c:v libx264 -crf 17 -pix_fmt yuv420p archmage.mp4
   ```

The script picks the GPU automatically: OptiX or CUDA on NVIDIA, HIP on AMD, Metal on Apple Silicon, oneAPI on Intel Arc. If none is found, it renders on the CPU.
