"""Before/after image viewer with a draggable split, zoom, and pan."""

from __future__ import annotations

import numpy as np
from PySide6.QtCore import QPointF, QRect, QRectF, Qt, Signal
from PySide6.QtGui import QColor, QFont, QImage, QPainter, QPen, QPixmap
from PySide6.QtWidgets import QWidget

from ..imageio import to_uint8


def to_qimage(rgb: np.ndarray) -> QImage:
    u8 = np.ascontiguousarray(to_uint8(rgb))
    h, w = u8.shape[:2]
    return QImage(u8.data, w, h, 3 * w, QImage.Format.Format_RGB888).copy()


class CompareView(QWidget):
    """Shows the input and the enhanced result in output-pixel coordinates.

    Modes: ``split`` (drag the divider), ``side`` (side by side), ``before``,
    ``after``. ``left_label`` lets the left side show a reference image (for
    example a Topaz export) instead of the original.
    """

    view_changed = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setMouseTracking(True)
        self.setMinimumSize(320, 240)
        self.setFocusPolicy(Qt.FocusPolicy.StrongFocus)
        self.out_w = self.out_h = 0
        self.left: QPixmap | None = None
        self.left_label = "Original"
        self.right: QPixmap | None = None  # full enhanced result
        self.patches: list[tuple[QPixmap, QRect]] = []  # preview patches in output pixels
        self.mode = "split"
        self.split = 0.5
        self.zoom = 1.0
        self.center = QPointF(0, 0)  # output-pixel point at the widget centre
        self.message = ""
        self._drag: str | None = None
        self._last = QPointF()

    # -- content ---------------------------------------------------------

    def set_images(self, left: QImage | None, out_size: tuple[int, int], keep_view: bool = False):
        self.left = QPixmap.fromImage(left) if left is not None else None
        changed = (self.out_w, self.out_h) != tuple(out_size)
        if changed and keep_view and self.out_w:
            k = out_size[0] / self.out_w
            self.center = QPointF(self.center.x() * k, self.center.y() * k)
            self.zoom /= k
        self.out_w, self.out_h = out_size
        self.right = None
        self.patches = []
        if not keep_view:
            self.fit()
        self.update()

    def set_left(self, img: QImage | None, label: str):
        self.left = QPixmap.fromImage(img) if img is not None else None
        self.left_label = label
        self.update()

    def set_result(self, img: QImage | None):
        self.right = QPixmap.fromImage(img) if img is not None else None
        if img is not None:
            self.patches = []
        self.update()

    def add_patch(self, img: QImage, rect: QRect):
        self.patches = [p for p in self.patches if not rect.contains(p[1])]
        self.patches.append((QPixmap.fromImage(img), rect))
        self.update()

    def clear_result(self):
        self.right = None
        self.patches = []
        self.update()

    def set_message(self, text: str):
        self.message = text
        self.update()

    def set_mode(self, mode: str):
        self.mode = mode
        self.update()

    # -- geometry --------------------------------------------------------

    def fit(self):
        if not self.out_w:
            return
        pane_w = self.width() / 2 if self.mode == "side" else self.width()
        self.zoom = min(pane_w / self.out_w, self.height() / self.out_h) * 0.98
        self.center = QPointF(self.out_w / 2, self.out_h / 2)
        self.update()
        self.view_changed.emit()

    def set_zoom(self, zoom: float, anchor: QPointF | None = None):
        zoom = max(0.02, min(32.0, zoom))
        if anchor is not None:
            before = self.to_image(anchor)
            self.zoom = zoom
            after = self.to_image(anchor)
            self.center += before - after
        else:
            self.zoom = zoom
        self.update()
        self.view_changed.emit()

    def _pane_center(self) -> QPointF:
        if self.mode == "side":
            return QPointF(self.width() / 4, self.height() / 2)
        return QPointF(self.width() / 2, self.height() / 2)

    def to_image(self, p: QPointF) -> QPointF:
        if self.mode == "side" and p.x() > self.width() / 2:
            p = QPointF(p.x() - self.width() / 2, p.y())
        c = self._pane_center()
        return QPointF((p.x() - c.x()) / self.zoom + self.center.x(), (p.y() - c.y()) / self.zoom + self.center.y())

    def visible_output_rect(self) -> QRectF:
        pane_w = self.width() / 2 if self.mode == "side" else self.width()
        w, h = pane_w / self.zoom, self.height() / self.zoom
        r = QRectF(self.center.x() - w / 2, self.center.y() - h / 2, w, h)
        return r.intersected(QRectF(0, 0, self.out_w, self.out_h))

    def _target(self, offset_x: float = 0.0) -> QRectF:
        c = self._pane_center()
        return QRectF(c.x() + offset_x - self.center.x() * self.zoom, c.y() - self.center.y() * self.zoom,
                      self.out_w * self.zoom, self.out_h * self.zoom)

    def _split_x(self) -> float:
        return self.width() * self.split

    # -- painting --------------------------------------------------------

    def _draw_left(self, p: QPainter, target: QRectF):
        if self.left is not None:
            p.drawPixmap(target, self.left, QRectF(self.left.rect()))

    def _draw_right(self, p: QPainter, target: QRectF):
        if self.right is not None:
            p.drawPixmap(target, self.right, QRectF(self.right.rect()))
            return
        self._draw_left(p, target)
        k = self.zoom
        for pix, r in self.patches:
            dst = QRectF(target.x() + r.x() * k, target.y() + r.y() * k, r.width() * k, r.height() * k)
            p.drawPixmap(dst, pix, QRectF(pix.rect()))
            p.setPen(QPen(QColor(90, 170, 255, 160), 1, Qt.PenStyle.DashLine))
            p.drawRect(dst)

    def _badge(self, p: QPainter, x: float, text: str, right_align: bool = False):
        f = QFont(self.font())
        f.setPointSizeF(f.pointSizeF() * 0.95)
        f.setBold(True)
        p.setFont(f)
        w = p.fontMetrics().horizontalAdvance(text) + 16
        rx = x - w - 8 if right_align else x + 8
        rect = QRectF(rx, 8, w, 22)
        p.setPen(Qt.PenStyle.NoPen)
        p.setBrush(QColor(0, 0, 0, 150))
        p.drawRoundedRect(rect, 6, 6)
        p.setPen(QColor(235, 235, 235))
        p.drawText(rect, Qt.AlignmentFlag.AlignCenter, text)

    def paintEvent(self, _):
        p = QPainter(self)
        p.fillRect(self.rect(), QColor(24, 24, 27))
        if not self.out_w or self.left is None:
            p.setPen(QColor(140, 140, 150))
            p.drawText(self.rect(), Qt.AlignmentFlag.AlignCenter,
                       self.message or "Drop images or videos here, or use Add Files")
            return
        smooth = self.zoom < 2.0
        p.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform, smooth)
        has_result = self.right is not None or bool(self.patches)
        after_label = "Enhanced" if has_result else "Enhanced (not previewed)"
        if self.mode == "before":
            self._draw_left(p, self._target())
            self._badge(p, 0, self.left_label)
        elif self.mode == "after":
            self._draw_right(p, self._target())
            self._badge(p, 0, after_label)
        elif self.mode == "side":
            half = self.width() / 2
            p.save()
            p.setClipRect(QRectF(0, 0, half, self.height()))
            self._draw_left(p, self._target())
            p.restore()
            p.save()
            p.setClipRect(QRectF(half, 0, half, self.height()))
            self._draw_right(p, self._target(half))
            p.restore()
            p.setPen(QPen(QColor(60, 60, 66), 2))
            p.drawLine(QPointF(half, 0), QPointF(half, self.height()))
            self._badge(p, 0, self.left_label)
            self._badge(p, half, after_label)
        else:
            sx = self._split_x()
            target = self._target()
            p.save()
            p.setClipRect(QRectF(0, 0, sx, self.height()))
            self._draw_left(p, target)
            p.restore()
            p.save()
            p.setClipRect(QRectF(sx, 0, self.width() - sx, self.height()))
            self._draw_right(p, target)
            p.restore()
            p.setPen(QPen(QColor(255, 255, 255, 220), 2))
            p.drawLine(QPointF(sx, 0), QPointF(sx, self.height()))
            p.setBrush(QColor(255, 255, 255, 230))
            p.setPen(Qt.PenStyle.NoPen)
            p.drawEllipse(QPointF(sx, self.height() / 2), 9, 9)
            self._badge(p, sx, self.left_label, right_align=True)
            self._badge(p, sx, after_label)
        if self.message:
            p.setPen(QColor(255, 255, 255))
            rect = QRectF(0, self.height() - 34, self.width(), 26)
            p.fillRect(rect, QColor(0, 0, 0, 140))
            p.drawText(rect, Qt.AlignmentFlag.AlignCenter, self.message)

    # -- interaction -----------------------------------------------------

    def _near_split(self, x: float) -> bool:
        return self.mode == "split" and abs(x - self._split_x()) < 10

    def mousePressEvent(self, e):
        if e.button() == Qt.MouseButton.LeftButton:
            self._drag = "split" if self._near_split(e.position().x()) else "pan"
            self._last = e.position()

    def mouseMoveEvent(self, e):
        pos = e.position()
        if self._drag == "split":
            self.split = min(1.0, max(0.0, pos.x() / max(1, self.width())))
            self.update()
        elif self._drag == "pan":
            d = pos - self._last
            self.center -= QPointF(d.x() / self.zoom, d.y() / self.zoom)
            self._last = pos
            self.update()
        else:
            cursor = Qt.CursorShape.SplitHCursor if self._near_split(pos.x()) else Qt.CursorShape.OpenHandCursor
            self.setCursor(cursor)

    @property
    def dragging(self) -> bool:
        return self._drag is not None

    def mouseReleaseEvent(self, e):
        panned = self._drag == "pan"
        self._drag = None
        if panned:
            self.view_changed.emit()

    def mouseDoubleClickEvent(self, e):
        self.fit()

    def wheelEvent(self, e):
        steps = e.angleDelta().y() / 120.0
        self.set_zoom(self.zoom * (1.25 ** steps), e.position())

    def resizeEvent(self, e):
        super().resizeEvent(e)
        self.view_changed.emit()
