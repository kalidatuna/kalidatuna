"""Main window."""

from __future__ import annotations

import json
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np
from PySide6.QtCore import QRect, QSettings, QSize, Qt, QTimer
from PySide6.QtGui import QAction, QColor, QIcon, QKeySequence, QPalette, QPixmap
from PySide6.QtWidgets import (
    QAbstractItemView, QApplication, QCheckBox, QComboBox, QDialog, QDialogButtonBox, QFileDialog, QHBoxLayout,
    QHeaderView, QLabel, QListWidget, QListWidgetItem, QMainWindow, QMessageBox, QProgressBar, QPushButton,
    QSplitter, QStyle, QTableWidget, QTableWidgetItem, QToolButton, QVBoxLayout, QWidget,
)

from .. import __version__, models
from ..batch import OutputOptions, collect_inputs, enhance_file
from ..compare import match, metrics
from ..imageio import IMAGE_EXTS, VIDEO_EXTS, LoadedImage, from_array, is_video, load_image
from ..pipeline import PREVIEW_CACHE_ITEMS, Pipeline, Settings
from .panels import SettingsPanel
from .viewer import CompareView, to_qimage
from .worker import Job, JobRunner

APP = "AI Enhancer"
SETTINGS_VERSION = "2"


@dataclass
class Item:
    path: Path
    image: LoadedImage | None = None
    reference: np.ndarray | None = None
    reference_path: Path | None = None
    output: Path | None = None
    status: str = "Ready"
    extra: dict = field(default_factory=dict)

    @property
    def video(self) -> bool:
        return is_video(self.path)


def device_name(device) -> str:
    if device.type == "cuda":
        import torch

        return f"GPU: {torch.cuda.get_device_name(device)}"
    if device.type == "mps":
        return "GPU: Apple"
    return "CPU only (slow)"


def dark_palette(app: QApplication):
    app.setStyle("Fusion")
    p = QPalette()
    base, alt, text = QColor(32, 32, 36), QColor(40, 40, 45), QColor(225, 225, 230)
    p.setColor(QPalette.ColorRole.Window, base)
    p.setColor(QPalette.ColorRole.WindowText, text)
    p.setColor(QPalette.ColorRole.Base, QColor(24, 24, 27))
    p.setColor(QPalette.ColorRole.AlternateBase, alt)
    p.setColor(QPalette.ColorRole.ToolTipBase, alt)
    p.setColor(QPalette.ColorRole.ToolTipText, text)
    p.setColor(QPalette.ColorRole.Text, text)
    p.setColor(QPalette.ColorRole.Button, alt)
    p.setColor(QPalette.ColorRole.ButtonText, text)
    p.setColor(QPalette.ColorRole.Highlight, QColor(52, 120, 246))
    p.setColor(QPalette.ColorRole.HighlightedText, QColor(255, 255, 255))
    p.setColor(QPalette.ColorRole.PlaceholderText, QColor(120, 120, 128))
    for role in (QPalette.ColorRole.Text, QPalette.ColorRole.ButtonText, QPalette.ColorRole.WindowText):
        p.setColor(QPalette.ColorGroup.Disabled, role, QColor(110, 110, 118))
    app.setPalette(p)
    app.setStyleSheet("""
        QGroupBox { font-weight: 600; border: 1px solid #3a3a40; border-radius: 6px; margin-top: 14px; padding-top: 6px; }
        QGroupBox::title { subcontrol-origin: margin; left: 8px; padding: 0 4px; }
        QLabel#hint { color: #9a9aa4; }
        QLabel#warning { color: #f0b429; }
        QPushButton#primary { background: #3478f6; color: white; font-weight: 600; padding: 7px 16px; border-radius: 5px; }
        QPushButton#primary:disabled { background: #2a3a5a; color: #8890a0; }
        QListWidget::item { padding: 4px; }
    """)


class MatchDialog(QDialog):
    """Lists the settings closest to a reference export and lets the user apply one."""

    def __init__(self, results, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Closest settings to the reference")
        self.resize(820, 420)
        self.results = results
        lay = QVBoxLayout(self)
        lay.addWidget(QLabel("Ranked by structural similarity (SSIM) to the reference on the same region. "
                             "Higher SSIM and PSNR, and lower colour difference, mean a closer match."))
        cols = ["SSIM", "PSNR", "Colour ΔE", "Sharpness", "Model", "Noise", "Recover", "Sharpen", "Faces"]
        self.table = QTableWidget(min(len(results), 25), len(cols))
        self.table.setHorizontalHeaderLabels(cols)
        self.table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SelectionMode.SingleSelection)
        self.table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.ResizeToContents)
        for r, res in enumerate(results[:25]):
            s, sc = res.settings, res.scores
            vals = [f"{sc['ssim']:.4f}", f"{sc['psnr']:.2f}", f"{sc['delta_e']:.2f}", f"{sc['sharpness_ratio']:.2f}",
                    models.UPSCALERS[s.model].label, f"{s.noise:g}" if models.UPSCALERS[s.model].denoise_blend else "-",
                    f"{s.recover_detail:g}", f"{s.sharpen:g}", s.face_model or "-"]
            for c, v in enumerate(vals):
                self.table.setItem(r, c, QTableWidgetItem(v))
        self.table.selectRow(0)
        self.table.doubleClicked.connect(self.accept)
        lay.addWidget(self.table)
        bb = QDialogButtonBox(QDialogButtonBox.StandardButton.Cancel)
        apply = bb.addButton("Apply selected", QDialogButtonBox.ButtonRole.AcceptRole)
        apply.setDefault(True)
        bb.accepted.connect(self.accept)
        bb.rejected.connect(self.reject)
        lay.addWidget(bb)

    def chosen(self):
        rows = self.table.selectionModel().selectedRows()
        return self.results[rows[0].row() if rows else 0]


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle(APP)
        self.setAcceptDrops(True)
        self.store = QSettings("ai-enhancer", "ai-enhancer")
        self.items: list[Item] = []
        self.current: Item | None = None
        self.runner = JobRunner()
        self.runner.busy_changed.connect(self._busy)
        self.pipelines: dict[str, Pipeline] = {}
        self.preview_cache: dict = {}
        self.preview_job: Job | None = None
        self.preview_inflight: tuple[str, list, bool] | None = None  # (settings signature, rects, refinish)
        self._reset_cover()
        self.done_rects: list[tuple[int, int, int, int]] = []  # previewed with the current AI settings
        self.export_jobs: list[Job] = []
        self._build()
        self._restore()

    # -- layout ----------------------------------------------------------

    def _build(self):
        style = self.style()
        # queue
        left = QWidget()
        ll = QVBoxLayout(left)
        ll.setContentsMargins(6, 6, 0, 6)
        bar = QHBoxLayout()
        for text, icon, slot in (("Add files", QStyle.StandardPixmap.SP_FileIcon, self.add_files),
                                 ("Add folder", QStyle.StandardPixmap.SP_DirIcon, self.add_folder),
                                 ("Remove", QStyle.StandardPixmap.SP_DialogDiscardButton, self.remove_selected)):
            b = QToolButton()
            b.setIcon(style.standardIcon(icon))
            b.setToolTip(text)
            b.clicked.connect(slot)
            bar.addWidget(b)
        bar.addStretch(1)
        ll.addLayout(bar)
        self.queue = QListWidget()
        self.queue.setIconSize(QSize(56, 56))
        self.queue.setSelectionMode(QAbstractItemView.SelectionMode.ExtendedSelection)
        self.queue.currentRowChanged.connect(self._select_row)
        ll.addWidget(self.queue)

        # viewer
        center = QWidget()
        cl = QVBoxLayout(center)
        cl.setContentsMargins(0, 6, 0, 6)
        self.viewer = CompareView()
        self.viewer.view_changed.connect(self._view_changed)
        cl.addWidget(self.viewer, 1)
        tools = QHBoxLayout()
        self.mode = QComboBox()
        for key, label in (("split", "Split view"), ("side", "Side by side"), ("before", "Before only"),
                           ("after", "After only")):
            self.mode.addItem(label, key)
        self.mode.currentIndexChanged.connect(lambda: (self.viewer.set_mode(self.mode.currentData()), self.viewer.fit()))
        tools.addWidget(self.mode)
        self.left_src = QComboBox()
        self.left_src.addItem("Compare with original", "original")
        self.left_src.addItem("Compare with reference", "reference")
        self.left_src.currentIndexChanged.connect(self._left_source_changed)
        tools.addWidget(self.left_src)
        self.zoom = QComboBox()
        for label, z in (("Fit", 0), ("25%", 0.25), ("50%", 0.5), ("100%", 1.0), ("200%", 2.0), ("400%", 4.0)):
            self.zoom.addItem(label, z)
        self.zoom.activated.connect(self._zoom_chosen)
        tools.addWidget(self.zoom)
        tools.addStretch(1)
        self.auto_preview = QCheckBox("Auto preview")
        self.auto_preview.setChecked(True)
        self.auto_preview.toggled.connect(lambda on: on and self.schedule_preview())
        tools.addWidget(self.auto_preview)
        self.preview_btn = QPushButton("Preview")
        self.preview_btn.clicked.connect(lambda: self.run_preview(force=True))
        tools.addWidget(self.preview_btn)
        cl.addLayout(tools)

        # settings
        right = QWidget()
        rl = QVBoxLayout(right)
        rl.setContentsMargins(0, 6, 6, 6)
        self.panel = SettingsPanel()
        self.panel.changed.connect(self._settings_changed)
        rl.addWidget(self.panel, 1)
        self.export_btn = QPushButton("Export")
        self.export_btn.setObjectName("primary")
        self.export_btn.clicked.connect(self.export_all)
        self.export_sel_btn = QPushButton("Export selected")
        self.export_sel_btn.clicked.connect(self.export_selected)
        self.test_btn = QPushButton("Test 3 s")
        self.test_btn.setToolTip("Export only the first 3 seconds of the selected video, to check the look and speed")
        self.test_btn.clicked.connect(self.export_test)
        self.test_btn.setEnabled(False)
        row = QHBoxLayout()
        row.addWidget(self.test_btn)
        row.addWidget(self.export_sel_btn)
        row.addWidget(self.export_btn, 1)
        rl.addLayout(row)

        split = QSplitter()
        split.addWidget(left)
        split.addWidget(center)
        split.addWidget(right)
        split.setStretchFactor(1, 1)
        split.setSizes([220, 860, 400])
        split.setCollapsible(1, False)
        self.setCentralWidget(split)

        # status bar
        self.progress = QProgressBar()
        self.progress.setRange(0, 1000)
        self.progress.setFixedWidth(260)
        self.progress.setTextVisible(False)
        self.status = QLabel("Ready")
        self.cancel_btn = QPushButton("Cancel")
        self.cancel_btn.setEnabled(False)
        self.cancel_btn.clicked.connect(self.cancel)
        sb = self.statusBar()
        sb.addWidget(self.status, 1)
        self.device_label = QLabel()
        self.device_label.setObjectName("hint")
        sb.addPermanentWidget(self.device_label)
        sb.addPermanentWidget(self.progress)
        sb.addPermanentWidget(self.cancel_btn)

        # menus
        m = self.menuBar().addMenu("&File")
        self._act(m, "Add files…", self.add_files, QKeySequence.StandardKey.Open)
        self._act(m, "Add folder…", self.add_folder)
        m.addSeparator()
        self._act(m, "Export all", self.export_all, "Ctrl+E")
        self._act(m, "Export selected", self.export_selected, "Ctrl+Shift+E")
        m.addSeparator()
        self._act(m, "Load preset…", self.load_preset)
        self._act(m, "Save preset…", self.save_preset)
        self._act(m, "Reset settings", lambda: self.panel.set_settings(Settings()))
        m.addSeparator()
        self._act(m, "Quit", self.close, QKeySequence.StandardKey.Quit)
        m = self.menuBar().addMenu("&Reference")
        self._act(m, "Load reference image…", self.load_reference)
        self._act(m, "Match settings to reference", self.run_match, "Ctrl+M")
        self._act(m, "Score preview against reference", self.score_preview)
        m = self.menuBar().addMenu("&Help")
        self.noncommercial_act = self._act(m, "Show non-commercial models", self._toggle_noncommercial)
        self.noncommercial_act.setCheckable(True)
        self._act(m, "Models and licenses", self.show_models)
        self._act(m, "About", self.about)

    def _act(self, menu, text, slot, shortcut=None):
        a = QAction(text, self)
        a.triggered.connect(slot)
        if shortcut:
            a.setShortcut(shortcut)
        menu.addAction(a)
        return a

    # -- persistence -----------------------------------------------------

    def _restore(self):
        geo = self.store.value("geometry")
        if geo:
            self.restoreGeometry(geo)
        else:
            self.resize(1460, 880)
        show = str(self.store.value("show_noncommercial", "false")).lower() == "true"
        self.noncommercial_act.setChecked(show)
        self.panel.set_show_noncommercial(show)
        try:
            saved = Settings.from_dict(json.loads(self.store.value("settings", "{}")))
            if str(self.store.value("settings_version", "1")) != SETTINGS_VERSION:
                saved.tile = 0  # version 2: tile size became automatic
                self.store.setValue("settings_version", SETTINGS_VERSION)
            self.panel.set_settings(saved)
            self.pipeline(saved.device)
            out = json.loads(self.store.value("output", "{}"))
            self.panel.set_output(OutputOptions(**{k: v for k, v in out.items() if k in OutputOptions.__annotations__}))
        except Exception:
            pass

    def closeEvent(self, e):
        self.store.setValue("geometry", self.saveGeometry())
        self.store.setValue("settings", json.dumps(self.panel.settings().to_dict()))
        self.store.setValue("output", json.dumps(asdict(self.panel.output())))
        self.runner.cancel_all()
        self.runner.pool.waitForDone(3000)
        super().closeEvent(e)

    # -- queue -----------------------------------------------------------

    def dragEnterEvent(self, e):
        if e.mimeData().hasUrls():
            e.acceptProposedAction()

    def dropEvent(self, e):
        self.add_paths([u.toLocalFile() for u in e.mimeData().urls() if u.isLocalFile()])

    def add_files(self):
        exts = " ".join(f"*{x}" for x in sorted(IMAGE_EXTS | VIDEO_EXTS))
        files, _ = QFileDialog.getOpenFileNames(self, "Add images or videos", self.store.value("last_dir", ""),
                                                f"Images and videos ({exts});;All files (*)")
        if files:
            self.store.setValue("last_dir", str(Path(files[0]).parent))
            self.add_paths(files)

    def add_folder(self):
        d = QFileDialog.getExistingDirectory(self, "Add folder", self.store.value("last_dir", ""))
        if d:
            self.store.setValue("last_dir", d)
            self.add_paths([d])

    def add_paths(self, paths):
        known = {it.path for it in self.items}
        added = 0
        for p in collect_inputs(paths):
            if p in known or p.suffix.lower() not in IMAGE_EXTS | VIDEO_EXTS:
                continue
            it = Item(p)
            self.items.append(it)
            li = QListWidgetItem(self._thumb(p), self._item_text(it))
            li.setToolTip(str(p))
            self.queue.addItem(li)
            added += 1
        if added and self.current is None:
            self.queue.setCurrentRow(0)
        self.status.setText(f"{len(self.items)} file(s) in queue")

    def _thumb(self, p: Path) -> QIcon:
        if is_video(p):
            return self.style().standardIcon(QStyle.StandardPixmap.SP_MediaPlay)
        pix = QPixmap(str(p))
        if pix.isNull():
            return self.style().standardIcon(QStyle.StandardPixmap.SP_FileIcon)
        return QIcon(pix.scaled(112, 112, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation))

    def _item_text(self, it: Item) -> str:
        return f"{it.path.name}\n{it.status}"

    def _refresh_item(self, it: Item):
        if it in self.items:
            self.queue.item(self.items.index(it)).setText(self._item_text(it))

    def remove_selected(self):
        rows = sorted({i.row() for i in self.queue.selectedIndexes()}, reverse=True)
        for r in rows:
            self.queue.takeItem(r)
            it = self.items.pop(r)
            if it is self.current:
                self.current = None
        if not self.items:
            self.viewer.set_images(None, (0, 0))
        elif self.current is None:
            self.queue.setCurrentRow(0)

    def _select_row(self, row: int):
        if row < 0 or row >= len(self.items):
            return
        it = self.items[row]
        self.current = it
        self.preview_cache.clear()
        self.done_rects = []
        self._reset_cover()
        try:
            if it.image is None:
                if it.video:
                    from ..video import read_frame

                    it.image = from_array((read_frame(it.path) * 255).astype(np.uint8))
                else:
                    it.image = load_image(it.path)
        except Exception as e:
            self.viewer.set_images(None, (0, 0))
            self.viewer.set_message(f"Cannot open {it.path.name}: {e}")
            return
        w, h = it.image.size
        self.panel.set_input_size(w, h)
        self.panel.set_video(it.video)
        self.test_btn.setEnabled(it.video)
        self.viewer.set_message("")
        self.viewer.set_images(to_qimage(it.image.rgb), self._out_size())
        self._left_source_changed()
        if it.output and it.output.exists() and not it.video and it.extra.get("settings") == self._settings_sig():
            self._show_output(it)
        self.schedule_preview()

    def _out_size(self) -> tuple[int, int]:
        w, h = self.current.image.size
        return self.panel.settings().output_size(w, h)

    def _settings_sig(self) -> str:
        return json.dumps(self.panel.settings().to_dict(), sort_keys=True)

    # -- preview ---------------------------------------------------------

    def pipeline(self, device: str) -> Pipeline:
        if device not in self.pipelines:
            self.pipelines[device] = Pipeline(device)
        pipe = self.pipelines[device]
        self.device_label.setText(device_name(pipe.device))
        return pipe

    def _settings_changed(self, kind: str):
        if kind == "output" or self.current is None or self.current.image is None:
            return
        self._reset_cover()
        if kind == "base":
            self.done_rects = []
            size = self._out_size()
            if size != (self.viewer.out_w, self.viewer.out_h):
                self.viewer.set_images(self.viewer.left.toImage() if self.viewer.left else None, size, keep_view=True)
                self._left_source_changed()
            else:
                self.viewer.clear_result()
            self.schedule_preview(delay=400)
        else:
            # Detail, sharpen and face settings reuse the cached AI result, so
            # every area previewed so far is re-rendered, not just the visible one.
            if self.viewer.right is not None:
                self.viewer.set_result(None)
            self.schedule_preview(delay=150, refinish=True)

    def _view_changed(self):
        if not self.viewer.dragging:
            self.schedule_preview(delay=400)

    def schedule_preview(self, delay: int = 300, refinish: bool = False):
        if not self.auto_preview.isChecked():
            return
        if not hasattr(self, "_preview_timer"):
            self._preview_timer = QTimer(self)
            self._preview_timer.setSingleShot(True)
            self._preview_timer.timeout.connect(lambda: self.run_preview(refinish=self._refinish_pending))
            self._refinish_pending = False
        self._refinish_pending = self._refinish_pending or refinish
        self._preview_timer.start(delay)

    # Rendered areas, for the current settings. An area counts as covered if
    # it lies inside one rendered rect, or if every grid cell it touches lies
    # fully inside rendered rects (for views spanning several patches).
    COVER_CELL = 8

    def _reset_cover(self):
        self.cover = None
        self.cover_rects: list[tuple[int, int, int, int]] = []
        self.cover_sig = ""

    def _cell_range(self, a: int, b: int, n: int, inner: bool) -> slice:
        g = self.COVER_CELL
        if inner:  # cells fully inside [a, b); the image edge counts as inside
            return slice(-(-a // g), -(-b // g) if b >= n else b // g)
        return slice(a // g, -(-b // g))  # cells touching [a, b)

    def _cells(self, rect, inner: bool) -> tuple[slice, slice]:
        x, y, w, h = rect
        iw, ih = self.current.image.size
        return self._cell_range(y, y + h, ih, inner), self._cell_range(x, x + w, iw, inner)

    def _mark_covered(self, rect, sig: str):
        if self.cover is None or self.cover_sig != sig:
            iw, ih = self.current.image.size
            g = self.COVER_CELL
            self.cover = np.zeros((-(-ih // g), -(-iw // g)), bool)
            self.cover_rects = []
            self.cover_sig = sig
        self.cover[self._cells(rect, inner=True)] = True
        self.cover_rects.append(rect)

    def _is_covered(self, rect, sig: str) -> bool:
        if self.cover is None or self.cover_sig != sig:
            return False
        if any(self._contains(r, rect) for r in self.cover_rects):
            return True
        return bool(self.cover[self._cells(rect, inner=False)].all())

    @staticmethod
    def _contains(outer, inner) -> bool:
        ox, oy, ow, oh = outer
        x, y, w, h = inner
        return ox <= x and oy <= y and x + w <= ox + ow and y + h <= oy + oh

    def _preview_rect(self) -> tuple[int, int, int, int] | None:
        it = self.current
        if it is None or it.image is None or not self.viewer.out_w:
            return None
        w, h = it.image.size
        k = w / self.viewer.out_w
        vis = self.viewer.visible_output_rect()
        if vis.isEmpty():
            return None
        dev = self.pipeline(self.panel.settings().device).device.type
        limit = 384 if dev == "cpu" else 1024
        cx, cy = vis.center().x() * k, vis.center().y() * k
        rw, rh = min(vis.width() * k, limit), min(vis.height() * k, limit)
        x, y = int(max(0, cx - rw / 2)), int(max(0, cy - rh / 2))
        rw, rh = max(8, int(rw)), max(8, int(rh))
        return x, y, min(rw, w - x), min(rh, h - y)

    def run_preview(self, force: bool = False, refinish: bool = False):
        self._refinish_pending = False
        it = self.current
        rect = self._preview_rect()
        if rect is None or (self.export_jobs and self.runner.current in self.export_jobs):
            return
        if self.viewer.right is not None and not force:
            return  # the full exported result is already on screen
        sig = self._settings_sig()
        # A re-render interrupted by a new request must still happen.
        refinish = refinish or bool(self.preview_inflight and self.preview_inflight[2])
        rects = [r for r in self.done_rects[-PREVIEW_CACHE_ITEMS:] if r != rect] if refinish else []
        if not rects and not force:
            if self._is_covered(rect, sig):
                return  # zooming or panning inside an area that is already rendered
            if self.preview_inflight and self.preview_inflight[0] == sig and any(
                    self._contains(r, rect) for r in self.preview_inflight[1]):
                return  # the running preview already covers this area
        rects.append(rect)
        s = self.panel.settings()
        pipe = self.pipeline(s.device)
        cache = self.preview_cache
        rgb = it.image.rgb
        if self.preview_job is not None:
            self.preview_job.cancel()
        self.runner.drop_pending(lambda j: j.signals.property("kind") == "preview")

        def work(progress, cancel):
            pipe.download_progress = lambda name, d, t: progress(f"Downloading {name}", d / t if t else 0.0)
            out = []
            for i, r in enumerate(rects):
                step = (lambda label, f, i=i: progress(label, (i + f) / len(rects)))
                out.append(pipe.preview(rgb, s, r, progress=step, cancel=cancel, cache=cache) + (r,))
            return out

        job = Job(work)
        job.signals.setProperty("kind", "preview")
        job.signals.progress.connect(self._progress)
        job.signals.finished.connect(lambda res, it=it, sig=sig: self._preview_done(it, res, sig, refinish))
        job.signals.failed.connect(self._failed)
        job.signals.cancelled.connect(lambda: self.status.setText("Preview cancelled"))
        for sig_ in (job.signals.finished, job.signals.failed, job.signals.cancelled):
            sig_.connect(lambda *_, j=job: self._preview_ended(j))
        self.preview_job = job
        self.preview_inflight = (sig, rects, refinish)
        self.runner.submit(job)

    def _preview_ended(self, job: Job):
        if job is self.preview_job:
            self.preview_job = None
            self.preview_inflight = None

    def _preview_done(self, it: Item, results, sig: str, refinish: bool):
        if it is not self.current or sig != self._settings_sig():
            return
        if refinish:
            self.viewer.patches = []
        for patch, (x, y, w, h), rect in results:
            self.viewer.add_patch(to_qimage(patch), QRect(x, y, w, h))
            it.extra["last_patch"] = (patch, (x, y, w, h))
            self._mark_covered(rect, sig)
            if rect in self.done_rects:
                self.done_rects.remove(rect)
            self.done_rects.append(rect)
        self.status.setText("Preview ready. Drag the divider to compare; pan or zoom to preview another area.")
        self.progress.setValue(0)

    # -- export ----------------------------------------------------------

    def export_all(self):
        self._export(self.items)

    def export_selected(self):
        rows = sorted({i.row() for i in self.queue.selectedIndexes()})
        self._export([self.items[r] for r in rows] or ([self.current] if self.current else []))

    def export_test(self):
        if self.current and self.current.video:
            self._export([self.current], test_seconds=3.0)

    def _export(self, items: list[Item], test_seconds: float | None = None):
        if not items:
            QMessageBox.information(self, APP, "Add some images or videos first.")
            return
        s = self.panel.settings()
        opts = self.panel.output()
        sig = self._settings_sig()
        pipe = self.pipeline(s.device)
        if self.preview_job:
            self.preview_job.cancel()
        for it in items:
            it.status = "Queued"
            self._refresh_item(it)

            def work(progress, cancel, it=it):
                pipe.download_progress = lambda name, d, t: progress(f"Downloading {name}", d / t if t else 0.0)
                return enhance_file(it.path, s, opts, pipe, progress=progress, cancel=cancel,
                                    test_seconds=test_seconds)

            job = Job(work)
            job.signals.setProperty("kind", "export")
            job.signals.progress.connect(lambda label, f, it=it: self._export_progress(it, label, f))
            job.signals.finished.connect(lambda path, it=it: self._export_done(it, path, sig))
            job.signals.failed.connect(lambda msg, it=it: self._export_failed(it, msg))
            job.signals.cancelled.connect(lambda it=it: self._export_failed(it, "Cancelled"))
            self.export_jobs.append(job)
            self.runner.submit(job)

    def _export_progress(self, it: Item, label: str, frac: float):
        it.status = f"{label} {frac * 100:.0f}%"
        self._refresh_item(it)
        self._progress(f"{it.path.name}: {label}", frac)

    def _export_done(self, it: Item, path: Path, sig: str):
        it.output = Path(path)
        it.status = f"Done: {it.output.name}"
        it.extra["settings"] = sig
        self._refresh_item(it)
        self.status.setText(f"Saved {it.output}")
        if it is self.current and not it.video:
            self._show_output(it)

    def _export_failed(self, it: Item, msg: str):
        it.status = "Cancelled" if msg == "Cancelled" else "Failed"
        self._refresh_item(it)
        if msg != "Cancelled":
            self.status.setText(f"{it.path.name}: {msg}")

    def _show_output(self, it: Item):
        try:
            out = load_image(it.output)
        except Exception:
            return
        self.viewer.set_result(to_qimage(out.rgb))
        it.extra["result"] = out.rgb

    # -- reference / matching -------------------------------------------

    def load_reference(self):
        if not self.current or self.current.video:
            QMessageBox.information(self, APP, "Select an image in the queue first.")
            return
        f, _ = QFileDialog.getOpenFileName(self, "Load reference (for example the same image exported from another app)",
                                           str(self.current.path.parent),
                                           "Images (" + " ".join(f"*{x}" for x in sorted(IMAGE_EXTS)) + ")")
        if not f:
            return
        self.current.reference = load_image(f).rgb
        self.current.reference_path = Path(f)
        rh, rw = self.current.reference.shape[:2]
        w, h = self.current.image.size
        self.panel.scale.setValue(round(rw / w, 3))
        if abs(rh / h - rw / w) > 0.01:
            QMessageBox.warning(self, APP, "The reference has a different aspect ratio from the source. "
                                "It may be cropped, so comparisons will be off.")
        self.left_src.setCurrentIndex(1)
        self._left_source_changed()

    def _left_source_changed(self):
        it = self.current
        if it is None or it.image is None:
            return
        if self.left_src.currentData() == "reference" and it.reference is not None:
            self.viewer.set_left(to_qimage(it.reference), "Reference")
        else:
            self.viewer.set_left(to_qimage(it.image.rgb), "Original")

    def run_match(self):
        it = self.current
        if it is None or it.reference is None:
            self.load_reference()
            it = self.current
            if it is None or it.reference is None:
                return
        s = self.panel.settings()
        pipe = self.pipeline(s.device)
        src, ref = it.image.rgb, it.reference
        quick = QMessageBox.question(
            self, APP, "Run a quick search? (Choose No for a thorough search, which tries more combinations "
            "and takes longer.)") == QMessageBox.StandardButton.Yes

        def work(progress, cancel):
            pipe.download_progress = lambda name, d, t: progress(f"Downloading {name}", d / t if t else 0.0)
            return match(src, ref, pipe, quick=quick, progress=progress, cancel=cancel)

        job = Job(work)
        job.signals.setProperty("kind", "match")
        job.signals.progress.connect(self._progress)
        job.signals.finished.connect(self._match_done)
        job.signals.failed.connect(self._failed)
        self.runner.submit(job)

    def _match_done(self, results):
        self.progress.setValue(0)
        self.status.setText("Search finished")
        dlg = MatchDialog(results, self)
        if dlg.exec():
            best = dlg.chosen().settings
            cur = self.panel.settings()
            best.device, best.tile = cur.device, cur.tile
            self.panel.set_settings(best)

    def score_preview(self):
        it = self.current
        if it is None or it.reference is None:
            QMessageBox.information(self, APP, "Load a reference image first (Reference → Load reference image).")
            return
        res = it.extra.get("result")
        if res is not None and res.shape[:2] == it.reference.shape[:2]:
            ours, ref = res, it.reference
        elif "last_patch" in it.extra:
            patch, (x, y, w, h) = it.extra["last_patch"]
            ours, ref = patch, it.reference[y:y + h, x:x + w]
            if ref.shape[:2] != ours.shape[:2]:
                QMessageBox.information(self, APP, "Set the output size to the reference size, then preview again.")
                return
        else:
            QMessageBox.information(self, APP, "Preview or export first.")
            return
        m = metrics(ours, ref)
        QMessageBox.information(
            self, APP,
            f"SSIM: {m['ssim']:.4f} (1.0 = identical structure)\nPSNR: {m['psnr']:.2f} dB\n"
            f"Colour difference (ΔE): {m['delta_e']:.2f}\nSharpness vs reference: {m['sharpness_ratio']:.2f}x")

    # -- presets ---------------------------------------------------------

    def load_preset(self):
        f, _ = QFileDialog.getOpenFileName(self, "Load preset", "", "Presets (*.json)")
        if f:
            try:
                self.panel.set_settings(Settings.from_dict(json.loads(Path(f).read_text())))
            except Exception as e:
                QMessageBox.warning(self, APP, f"Cannot load preset: {e}")

    def save_preset(self):
        f, _ = QFileDialog.getSaveFileName(self, "Save preset", "preset.json", "Presets (*.json)")
        if f:
            Path(f).write_text(json.dumps(self.panel.settings().to_dict(), indent=2))

    # -- status ----------------------------------------------------------

    def _progress(self, label: str, frac: float):
        self.status.setText(label)
        self.progress.setValue(int(frac * 1000))

    def _failed(self, msg: str):
        self.progress.setValue(0)
        self.status.setText(f"Error: {msg}")
        if "Downloading" in msg or "urlopen" in msg or "Checksum" in msg:
            QMessageBox.warning(self, APP, f"Could not get a model file:\n{msg}")

    def _busy(self, busy: bool):
        self.cancel_btn.setEnabled(busy)
        if not busy:
            self.progress.setValue(0)
            self.export_jobs.clear()

    def cancel(self):
        self.runner.cancel_all()
        self.status.setText("Cancelling…")

    def _zoom_chosen(self):
        z = self.zoom.currentData()
        if z:
            self.viewer.set_zoom(z)
        else:
            self.viewer.fit()

    def _toggle_noncommercial(self, show: bool):
        self.store.setValue("show_noncommercial", "true" if show else "false")
        self.panel.set_show_noncommercial(show)

    def show_models(self):
        lines = [f"Model folder: {models.model_dir()}", ""]
        for key, f in models.FILES.items():
            have = (models.model_dir() / f.filename).exists()
            note = "" if f.commercial else "  [non-commercial]"
            lines.append(f"{'✔' if have else '·'} {key}: {f.author}, {f.license}{note}")
        lines += ["", "Models download on first use and are checked against a SHA-256 hash.",
                  "Non-commercial models are hidden unless Help → Show non-commercial models is on."]
        QMessageBox.information(self, "Models and licenses", "\n".join(lines))

    def about(self):
        credits = "<br>".join(models.credits())
        QMessageBox.about(self, APP, f"<b>{APP}</b> {__version__}<br>Open-source AI photo and video enhancement."
                          f"<br><br><b>Model credits</b><br><small>{credits}</small>")


def run(argv: list[str] | None = None) -> int:
    app = QApplication.instance() or QApplication(argv or sys.argv)
    app.setApplicationName(APP)
    dark_palette(app)
    win = MainWindow()
    win.show()
    files = [a for a in (argv or sys.argv)[1:] if Path(a).exists()]
    if files:
        win.add_paths(files)
    return app.exec()
