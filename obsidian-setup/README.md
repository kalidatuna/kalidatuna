# Obsidian look pack: clean and minimal

A ready-to-copy setup for a clean, modern Obsidian: the **Minimal** theme by
[@kepano](https://github.com/kepano/obsidian-minimal) (MIT, v9.1.4) plus a small
`polish.css` snippet with rounded callouts, pill tags, soft code blocks and quiet scrollbars.

## What's in `vault-config/`

| Path | What it is |
| --- | --- |
| `themes/Minimal/` | The Minimal theme (`theme.css` + `manifest.json`) |
| `snippets/polish.css` | Custom refinements built on top of it |
| `appearance.json` | Turns the theme and snippet on, light/dark follows your OS |

## Install (2 minutes)

1. Quit Obsidian, or at least close the vault.
2. Copy the **contents** of `vault-config/` into `<your vault>/.obsidian/`.
   - If your vault already has `.obsidian/appearance.json`, don't overwrite it.
     Add just these two keys instead: `"cssTheme": "Minimal"` and `"enabledCssSnippets": ["polish"]`.
3. Reopen the vault. Check **Settings > Appearance** shows Minimal selected and `polish` toggled on.

You can also skip the file copy: **Settings > Appearance > Themes > Manage > search "Minimal" > Install and use**.
Then put `polish.css` in `<vault>/.obsidian/snippets/` and toggle it under *CSS snippets*.

## Plugins (install inside Obsidian, about 30 seconds)

These need compiled files, so install them from **Settings > Community plugins > Browse**:

1. **Style Settings** (by mgmeyers): exposes Minimal's colors, fonts, layout and callout options as a UI.
2. **Minimal Theme Settings** (by kepano): switch color schemes (Atom, Nord, Dracula, Rosé Pine, Things, Catppuccin and more), accent color, and fonts.
3. Optional: **Hider** (hide status bar, tabs or sidebar buttons for a cleaner window) and **Iconize** (folder and file icons).

Then open **Minimal Theme Settings** and pick a color scheme. Good starting points:
*Light: Default or Things. Dark: Default or Nord.*

## Tweaking

- Edit `snippets/polish.css` to taste. The variables at the top (`--radius-*`, `--file-line-width`)
  control corner roundness and reading width.
- Delete a rule block to turn that tweak off.

## License

Minimal is MIT licensed; its license is in `MINIMAL-LICENSE`.
