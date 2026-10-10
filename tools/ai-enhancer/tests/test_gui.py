"""Headless GUI tests. Skipped when Qt cannot start (for example, missing system libraries)."""

import os

import numpy as np
import pytest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
QtWidgets = pytest.importorskip("PySide6.QtWidgets", exc_type=ImportError)

from enhancer.imageio import save_image  # noqa: E402
from enhancer.pipeline import Settings  # noqa: E402


@pytest.fixture(scope="module")
def app():
    return QtWidgets.QApplication.instance() or QtWidgets.QApplication([])


@pytest.fixture
def window(app, fake_pipeline, monkeypatch, tmp_path):
    from PySide6.QtCore import QSettings

    QSettings.setDefaultFormat(QSettings.Format.IniFormat)
    QSettings.setPath(QSettings.Format.IniFormat, QSettings.Scope.UserScope, str(tmp_path))
    from enhancer.gui import app as gui_app

    monkeypatch.setattr(gui_app, "Pipeline", lambda device: fake_pipeline)
    w = gui_app.MainWindow()
    w.resize(1200, 800)
    w.show()
    yield w
    w.runner.cancel_all()
    w.runner.pool.waitForDone(5000)
    w.close()


def wait_idle(app, w, timeout=10.0):
    import time

    end = time.time() + timeout
    while time.time() < end:
        app.processEvents()
        if w.runner.current is None and not w.runner._pending:
            app.processEvents()
            return
        time.sleep(0.01)
    raise TimeoutError


def test_settings_panel_roundtrip(window):
    s = Settings(model="high-fidelity", scale=3, recover_detail=0.25, sharpen=0.4, face_model="codeformer",
                 face_strength=0.6, face_fidelity=0.3, denoise_model="strong", denoise_strength=0.5, tile=512)
    window.panel.set_settings(s)
    got = window.panel.settings()
    assert got == Settings.from_dict(s.to_dict() | {"device": got.device})


def test_preview_and_export(window, app, tmp_path):
    src = save_image(tmp_path / "pic.png", np.random.default_rng(0).random((40, 50, 3)).astype(np.float32))
    window.panel.set_settings(Settings(scale=2, tile=0))
    window.add_paths([str(src)])
    assert window.current is not None and window.viewer.out_w == 100
    window.run_preview()
    wait_idle(app, window)
    assert window.viewer.patches, window.status.text()

    window.panel.folder.setText(str(tmp_path / "out"))
    window.panel.scale.setValue(4)
    window.export_all()
    wait_idle(app, window)
    item = window.items[0]
    assert item.output and item.output.exists(), item.status
    assert window.viewer.right is not None
