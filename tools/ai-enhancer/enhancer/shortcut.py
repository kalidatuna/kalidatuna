"""Create desktop and app-menu shortcuts that start the app with its icon."""

from __future__ import annotations

import os
import plistlib
import shutil
import subprocess
import sys
from pathlib import Path

APP_NAME = "Swanaz"
APP_ID = "swanaz"
ASSETS = Path(__file__).resolve().parent / "assets"
ICON_PNG = ASSETS / "swanaz.png"
ICON_ICO = ASSETS / "swanaz.ico"


def launch_command(gui: bool = True) -> list[str]:
    """Command that starts the app with the Python environment it is installed in."""
    python = Path(sys.executable)
    if gui and os.name == "nt":
        pythonw = python.with_name("pythonw.exe")
        if pythonw.exists():
            python = pythonw  # no console window
    return [str(python), "-m", __package__]


def desktop_dir() -> Path:
    if os.name == "nt":
        try:
            out = subprocess.run(
                ["powershell", "-NoProfile", "-Command", "[Environment]::GetFolderPath('Desktop')"],
                capture_output=True, text=True, timeout=30,
            ).stdout.strip()
            if out:
                return Path(out)  # also right when the desktop is synced to OneDrive
        except (OSError, subprocess.SubprocessError):
            pass
    elif sys.platform.startswith("linux") and shutil.which("xdg-user-dir"):
        out = subprocess.run(["xdg-user-dir", "DESKTOP"], capture_output=True, text=True).stdout.strip()
        if out and out != str(Path.home()):
            return Path(out)
    return Path.home() / "Desktop"


def _linux() -> list[Path]:
    cmd = " ".join(f'"{c}"' for c in launch_command())
    entry = "\n".join([
        "[Desktop Entry]",
        "Type=Application",
        f"Name={APP_NAME}",
        "Comment=AI upscaler for photos and videos",
        f"Exec={cmd} %F",
        f"Icon={ICON_PNG}",
        "Terminal=false",
        "Categories=AudioVideo;Video;",
        f"StartupWMClass={APP_ID}",
        "",
    ])
    made = []
    apps = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / "applications"
    targets = [apps / f"{APP_ID}.desktop"]
    desk = desktop_dir()
    if desk.is_dir():
        targets.append(desk / f"{APP_ID}.desktop")
    for path in targets:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(entry)
        path.chmod(0o755)
        made.append(path)
        if path.parent == desk and shutil.which("gio"):
            # GNOME only starts desktop launchers that are marked as trusted.
            subprocess.run(["gio", "set", str(path), "metadata::trusted", "true"], capture_output=True)
    if shutil.which("update-desktop-database"):
        subprocess.run(["update-desktop-database", str(apps)], capture_output=True)
    return made


def _windows() -> list[Path]:
    cmd = launch_command()
    made = []
    start_menu = Path(os.environ.get("APPDATA", Path.home())) / "Microsoft" / "Windows" / "Start Menu" / "Programs"
    for folder in (desktop_dir(), start_menu):
        link = folder / f"{APP_NAME}.lnk"
        script = (
            "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:SWZ_LINK);"
            "$s.TargetPath = $env:SWZ_TARGET; $s.Arguments = $env:SWZ_ARGS;"
            "$s.WorkingDirectory = $env:SWZ_DIR; $s.IconLocation = $env:SWZ_ICON;"
            "$s.Description = 'AI upscaler for photos and videos'; $s.Save()"
        )
        env = dict(os.environ, SWZ_LINK=str(link), SWZ_TARGET=cmd[0], SWZ_ARGS=" ".join(cmd[1:]),
                   SWZ_DIR=str(Path.home()), SWZ_ICON=str(ICON_ICO))
        folder.mkdir(parents=True, exist_ok=True)
        r = subprocess.run(["powershell", "-NoProfile", "-Command", script], env=env, capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(f"Could not create {link}: {r.stderr.strip()}")
        made.append(link)
    return made


def _macos() -> list[Path]:
    app = Path.home() / "Applications" / f"{APP_NAME}.app"
    macos = app / "Contents" / "MacOS"
    res = app / "Contents" / "Resources"
    macos.mkdir(parents=True, exist_ok=True)
    res.mkdir(parents=True, exist_ok=True)
    launcher = macos / APP_NAME
    launcher.write_text("#!/bin/sh\nexec " + " ".join(f'"{c}"' for c in launch_command()) + ' "$@"\n')
    launcher.chmod(0o755)
    try:
        from PIL import Image

        Image.open(ICON_PNG).save(res / "swanaz.icns")
    except Exception:
        pass
    (app / "Contents" / "Info.plist").write_bytes(plistlib.dumps({
        "CFBundleName": APP_NAME, "CFBundleDisplayName": APP_NAME, "CFBundleIdentifier": f"io.github.kalidatuna.{APP_ID}",
        "CFBundleExecutable": APP_NAME, "CFBundleIconFile": "swanaz.icns", "CFBundlePackageType": "APPL",
        "NSHighResolutionCapable": True,
    }))
    made = [app]
    alias = desktop_dir() / APP_NAME
    if alias.parent.is_dir() and not alias.exists():
        alias.symlink_to(app)
        made.append(alias)
    return made


def create_shortcuts() -> list[Path]:
    """Create the shortcuts for this system. Returns the files created."""
    if os.name == "nt":
        return _windows()
    if sys.platform == "darwin":
        return _macos()
    return _linux()
