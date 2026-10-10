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


def test_zoom_and_pan_reuse_rendered_areas(window, app, tmp_path):
    src = save_image(tmp_path / "big.png", np.random.default_rng(1).random((300, 400, 3)).astype(np.float32))
    window.panel.set_settings(Settings(scale=2, tile=0, device="cpu"))
    window.add_paths([str(src)])
    submitted = []
    real_submit = window.runner.submit
    window.runner.submit = lambda job: (submitted.append(job.signals.property("kind")), real_submit(job))[1]
    v = window.viewer

    window.run_preview()
    wait_idle(app, window)
    assert submitted == ["preview"] and len(v.patches) == 1

    # Zooming in and back out over the rendered area does no new AI work.
    v.set_zoom(v.zoom * 3)
    window.run_preview()
    v.fit()
    window.run_preview()
    wait_idle(app, window)
    assert submitted == ["preview"]

    # Moving to an area that has not been rendered does.
    v.set_zoom(4.0)
    v.center = v.center.__class__(780, 580)
    window.run_preview()
    wait_idle(app, window)
    assert submitted == ["preview", "preview"] and len(v.patches) == 2

    # A detail or sharpen change re-renders every previewed area in one job.
    window.panel.sharpen.setValue(0.5)
    window.run_preview(refinish=True)
    wait_idle(app, window)
    assert submitted[-1] == "preview" and len(submitted) == 3 and len(v.patches) == 2

    # The Preview button always renders.
    window.run_preview(force=True)
    wait_idle(app, window)
    assert len(submitted) == 4
