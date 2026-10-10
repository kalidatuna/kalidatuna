"""Settings panel widgets."""

from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QCheckBox, QComboBox, QDoubleSpinBox, QFileDialog, QFormLayout, QGroupBox, QHBoxLayout, QLabel,
    QLineEdit, QScrollArea, QSlider, QSpinBox, QToolButton, QVBoxLayout, QWidget,
)

from .. import models, presets
from ..batch import OutputOptions
from ..pipeline import Settings


class Slider(QWidget):
    """0..1 slider with a percentage readout."""

    valueChanged = Signal(float)

    def __init__(self, value: float = 0.0, parent=None):
        super().__init__(parent)
        lay = QHBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        self.slider = QSlider(Qt.Orientation.Horizontal)
        self.slider.setRange(0, 100)
        self.readout = QLabel()
        self.readout.setMinimumWidth(30)
        self.readout.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        lay.addWidget(self.slider, 1)
        lay.addWidget(self.readout)
        self.slider.valueChanged.connect(self._changed)
        self.setValue(value)

    def _changed(self, v: int):
        self.readout.setText(str(v))
        self.valueChanged.emit(v / 100.0)

    def value(self) -> float:
        return self.slider.value() / 100.0

    def setValue(self, v: float):
        self.slider.setValue(round(v * 100))
        self.readout.setText(str(self.slider.value()))


def _combo(items: list[tuple[str, str]]) -> QComboBox:
    c = QComboBox()
    for key, label in items:
        c.addItem(label, key)
    return c


def _select(c: QComboBox, key: str):
    i = c.findData(key)
    if i >= 0:
        c.setCurrentIndex(i)


CODEC_LABELS = {
    "h264": "H.264 (MP4)",
    "h265": "H.265 / HEVC (MP4)",
    "h264_nvenc": "H.264, NVIDIA GPU encoder",
    "hevc_nvenc": "H.265, NVIDIA GPU encoder",
    "prores": "ProRes 422 HQ (MOV, for After Effects)",
}


class SettingsPanel(QScrollArea):
    """Emits ``changed`` with "base" (needs a new AI pass), "post" (cheap), or "output"."""

    changed = Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWidgetResizable(True)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.setMinimumWidth(380)
        self.in_size = (0, 0)
        self._loading = False
        body = QWidget()
        root = QVBoxLayout(body)
        root.setSpacing(10)

        # AI model
        g = QGroupBox("AI model")
        f = QFormLayout(g)
        self.preset = _combo([("", "Choose a preset…")] + [(k, v[0]) for k, v in presets.PRESETS.items()])
        self.preset.activated.connect(self._preset_chosen)
        f.addRow("Preset", self.preset)
        self.model = _combo([(k, m.label) for k, m in models.UPSCALERS.items()])
        self.model_desc = QLabel()
        self.model_desc.setWordWrap(True)
        self.model_desc.setObjectName("hint")
        f.addRow(self.model)
        f.addRow(self.model_desc)
        self.video_warning = QLabel()
        self.video_warning.setWordWrap(True)
        self.video_warning.setObjectName("warning")
        self.video_warning.hide()
        f.addRow(self.video_warning)
        self.is_video = False
        root.addWidget(g)

        # Size
        g = QGroupBox("Output size")
        f = QFormLayout(g)
        quick = QHBoxLayout()
        for v in (1, 2, 4, 6):
            b = QToolButton()
            b.setText(f"{v}x")
            b.clicked.connect(lambda _=False, v=v: self.scale.setValue(v))
            quick.addWidget(b)
        f.addRow(quick)
        self.scale = QDoubleSpinBox()
        self.scale.setRange(0.25, 16.0)
        self.scale.setDecimals(2)
        self.scale.setSingleStep(0.25)
        self.scale.setSuffix(" x")
        f.addRow("Scale", self.scale)
        dims = QHBoxLayout()
        self.out_w = QSpinBox()
        self.out_h = QSpinBox()
        for sb in (self.out_w, self.out_h):
            sb.setRange(1, 200000)
            sb.setSuffix(" px")
            sb.setKeyboardTracking(False)
        dims.addWidget(self.out_w)
        dims.addWidget(QLabel("x"))
        dims.addWidget(self.out_h)
        f.addRow("Size", dims)
        root.addWidget(g)

        # Enhance
        g = QGroupBox("Enhance")
        f = QFormLayout(g)
        self.noise = Slider(0.5)
        self.noise_label = QLabel("Reduce noise")
        f.addRow(self.noise_label, self.noise)
        self.recover = Slider(0.0)
        f.addRow("Recover original detail", self.recover)
        self.sharpen = Slider(0.0)
        f.addRow("Sharpen", self.sharpen)
        root.addWidget(g)

        # Clean-up pre-pass
        g = QGroupBox("Clean up before upscaling")
        f = QFormLayout(g)
        self.denoise = _combo([("", "Off")] + [(k, v[0]) for k, v in models.DENOISERS.items()])
        f.addRow("Model", self.denoise)
        self.denoise_strength = Slider(1.0)
        f.addRow("Strength", self.denoise_strength)
        root.addWidget(g)

        # Faces
        g = QGroupBox("Face recovery")
        f = QFormLayout(g)
        self.face_on = QCheckBox("Enable")
        f.addRow(self.face_on)
        self.face_model = QComboBox()
        self.show_noncommercial = True
        self._fill_face_models()
        f.addRow("Model", self.face_model)
        self.face_strength = Slider(0.8)
        f.addRow("Strength", self.face_strength)
        self.face_fidelity = Slider(0.7)
        self.fidelity_label = QLabel("Fidelity")
        f.addRow(self.fidelity_label, self.face_fidelity)
        root.addWidget(g)

        # Export
        g = QGroupBox("Export")
        f = QFormLayout(g)
        self.fmt = _combo([("png", "PNG"), ("jpeg", "JPEG"), ("tiff", "TIFF"), ("webp", "WebP"),
                           ("same", "Same as input")])
        f.addRow("Format", self.fmt)
        self.quality = QSpinBox()
        self.quality.setRange(50, 100)
        f.addRow("Quality", self.quality)
        self.keep16 = QCheckBox("Keep 16-bit depth (PNG, TIFF)")
        f.addRow(self.keep16)
        folder = QHBoxLayout()
        self.folder = QLineEdit()
        self.folder.setPlaceholderText("Same folder as source")
        browse = QToolButton()
        browse.setText("…")
        browse.clicked.connect(self._browse)
        folder.addWidget(self.folder, 1)
        folder.addWidget(browse)
        f.addRow("Folder", folder)
        self.codec = _combo([(k, label) for k, label in CODEC_LABELS.items()])
        self.codec.setToolTip("Alight Motion: H.264 or H.265. After Effects: ProRes. "
                              "NVIDIA options encode on the graphics card, which is much faster.")
        f.addRow("Video codec", self.codec)
        self.crf = QSpinBox()
        self.crf.setRange(0, 40)
        self.crf.setToolTip("Lower is higher quality and larger files")
        f.addRow("Video quality (CRF)", self.crf)
        self.skip_repeats = QCheckBox("Reuse repeated video frames (faster)")
        self.skip_repeats.setToolTip("Frames with no visible change from the previous one reuse its result. "
                                     "Any visible change, even a blink, is processed normally.")
        f.addRow(self.skip_repeats)
        root.addWidget(g)

        # Advanced
        g = QGroupBox("Performance")
        f = QFormLayout(g)
        self.device = _combo([("auto", "Automatic"), ("cuda", "NVIDIA GPU (CUDA)"), ("mps", "Apple GPU (Metal)"),
                              ("cpu", "CPU")])
        f.addRow("Device", self.device)
        self.tile = QSpinBox()
        self.tile.setRange(0, 2048)
        self.tile.setSingleStep(64)
        self.tile.setSpecialValueText("Auto")
        self.tile.setToolTip("Auto uses the largest tile that fits in GPU memory, which is fastest. "
                             "Set a size only if you see out-of-memory errors.")
        f.addRow("Tile size", self.tile)
        root.addWidget(g)
        root.addStretch(1)
        self.setWidget(body)
        # Long item names must not force the panel wider than the scroll area.
        for c in body.findChildren(QComboBox):
            c.setSizeAdjustPolicy(QComboBox.SizeAdjustPolicy.AdjustToMinimumContentsLengthWithIcon)
            c.setMinimumContentsLength(8)

        base = [self.model.currentIndexChanged, self.noise.valueChanged, self.denoise.currentIndexChanged,
                self.denoise_strength.valueChanged, self.tile.valueChanged, self.device.currentIndexChanged]
        post = [self.recover.valueChanged, self.sharpen.valueChanged, self.face_on.toggled,
                self.face_model.currentIndexChanged, self.face_strength.valueChanged,
                self.face_fidelity.valueChanged]
        out = [self.fmt.currentIndexChanged, self.quality.valueChanged, self.keep16.toggled,
               self.folder.textChanged, self.codec.currentIndexChanged, self.crf.valueChanged,
               self.skip_repeats.toggled]
        for s in base:
            s.connect(lambda *_: self._emit("base"))
        for s in post:
            s.connect(lambda *_: self._emit("post"))
        for s in out:
            s.connect(lambda *_: self._emit("output"))
        self.scale.valueChanged.connect(self._scale_changed)
        self.out_w.valueChanged.connect(lambda v: self._dim_changed(v, 0))
        self.out_h.valueChanged.connect(lambda v: self._dim_changed(v, 1))
        self.set_settings(Settings())
        self.set_output(OutputOptions())

    def _preset_chosen(self, _):
        key = self.preset.currentData()
        self.preset.setCurrentIndex(0)
        if key:
            self.set_settings(presets.apply(self.settings(), key))

    def _fill_face_models(self):
        current = self.face_model.currentData()
        self.face_model.blockSignals(True)
        self.face_model.clear()
        for k, (label, file_key) in models.FACE_MODELS.items():
            if self.show_noncommercial or models.is_commercial((file_key,)):
                self.face_model.addItem(label, k)
        _select(self.face_model, current or "")
        self.face_model.blockSignals(False)

    def set_show_noncommercial(self, show: bool):
        """Hide models whose licenses forbid commercial use (CodeFormer)."""
        before = self.face_model.currentData()
        self.show_noncommercial = show
        self._fill_face_models()
        if self.face_model.currentData() != before:
            self._emit("post")

    def _browse(self):
        d = QFileDialog.getExistingDirectory(self, "Output folder", self.folder.text())
        if d:
            self.folder.setText(d)

    def _emit(self, kind: str):
        self._sync_enabled()
        if not self._loading:
            self.changed.emit(kind)

    def _sync_enabled(self):
        up = models.UPSCALERS[self.model.currentData()]
        self.model_desc.setText(f"{up.description} Speed: {up.speed}.")
        slow = self.is_video and up.speed in ("slow", "very slow")
        self.video_warning.setVisible(slow)
        if slow:
            self.video_warning.setText(f"⚠ {up.label} is {up.speed} for video. For long clips, use the preset "
                                       "\u201cTikTok edit: fast\u201d. Try Test 3 s first to see the time.")
        self.noise.setEnabled(up.denoise_blend)
        self.noise_label.setEnabled(up.denoise_blend)
        self.denoise_strength.setEnabled(bool(self.denoise.currentData()))
        on = self.face_on.isChecked()
        for w in (self.face_model, self.face_strength):
            w.setEnabled(on)
        cf = on and self.face_model.currentData() == "codeformer"
        self.face_fidelity.setEnabled(cf)
        self.fidelity_label.setEnabled(cf)
        self.quality.setEnabled(self.fmt.currentData() in ("jpeg", "webp", "same"))

    def set_video(self, is_video: bool):
        self.is_video = is_video
        self._sync_enabled()

    def set_input_size(self, w: int, h: int):
        self.in_size = (w, h)
        self._update_dims()

    def _update_dims(self):
        w, h = self.in_size
        for sb, v in ((self.out_w, w), (self.out_h, h)):
            sb.blockSignals(True)
            sb.setValue(max(1, round(v * self.scale.value())) if v else 1)
            sb.setEnabled(bool(v))
            sb.blockSignals(False)

    def _scale_changed(self, _):
        self._update_dims()
        self._emit("base")

    def _dim_changed(self, v: int, axis: int):
        src = self.in_size[axis]
        if src:
            self.scale.setValue(min(16.0, max(0.25, v / src)))

    def settings(self) -> Settings:
        return Settings(
            model=self.model.currentData(),
            scale=self.scale.value(),
            noise=self.noise.value(),
            denoise_model=self.denoise.currentData(),
            denoise_strength=self.denoise_strength.value(),
            recover_detail=self.recover.value(),
            face_model=self.face_model.currentData() if self.face_on.isChecked() else "",
            face_strength=self.face_strength.value(),
            face_fidelity=self.face_fidelity.value(),
            sharpen=self.sharpen.value(),
            tile=self.tile.value(),
            device=self.device.currentData(),
        )

    def set_settings(self, s: Settings):
        self._loading = True
        try:
            _select(self.model, s.model)
            self.scale.setValue(s.scale)
            self.noise.setValue(s.noise)
            _select(self.denoise, s.denoise_model)
            self.denoise_strength.setValue(s.denoise_strength)
            self.recover.setValue(s.recover_detail)
            self.sharpen.setValue(s.sharpen)
            self.face_on.setChecked(bool(s.face_model))
            if s.face_model:
                _select(self.face_model, s.face_model)
            self.face_strength.setValue(s.face_strength)
            self.face_fidelity.setValue(s.face_fidelity)
            self.tile.setValue(s.tile)
            _select(self.device, s.device)
        finally:
            self._loading = False
        self._sync_enabled()
        self._update_dims()
        self.changed.emit("base")

    def output(self) -> OutputOptions:
        return OutputOptions(folder=self.folder.text().strip(), fmt=self.fmt.currentData(),
                             quality=self.quality.value(), keep_16bit=self.keep16.isChecked(),
                             video_codec=self.codec.currentData(), video_crf=self.crf.value(),
                             video_skip_repeats=self.skip_repeats.isChecked())

    def set_output(self, o: OutputOptions):
        self._loading = True
        try:
            _select(self.fmt, o.fmt)
            self.quality.setValue(o.quality)
            self.keep16.setChecked(o.keep_16bit)
            self.folder.setText(o.folder)
            _select(self.codec, o.video_codec)
            self.crf.setValue(o.video_crf)
            self.skip_repeats.setChecked(o.video_skip_repeats)
        finally:
            self._loading = False
        self._sync_enabled()
