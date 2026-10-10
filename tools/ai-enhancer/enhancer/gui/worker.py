"""Run pipeline jobs off the UI thread."""

from __future__ import annotations

import threading
import traceback
from typing import Callable

from PySide6.QtCore import QObject, QRunnable, QThreadPool, Signal

from ..tiling import Cancelled


class JobSignals(QObject):
    progress = Signal(str, float)
    finished = Signal(object)
    failed = Signal(str)
    cancelled = Signal()


class Job(QRunnable):
    """Calls ``fn(progress, cancel)`` on a worker thread and reports through Qt signals."""

    def __init__(self, fn: Callable[[Callable[[str, float], None], Callable[[], bool]], object]):
        super().__init__()
        self.fn = fn
        self.signals = JobSignals()
        self._cancel = threading.Event()
        self.setAutoDelete(False)

    def cancel(self):
        self._cancel.set()

    @property
    def is_cancelled(self) -> bool:
        return self._cancel.is_set()

    def run(self):
        try:
            result = self.fn(self.signals.progress.emit, self._cancel.is_set)
        except Cancelled:
            self.signals.cancelled.emit()
        except Exception as e:
            traceback.print_exc()
            self.signals.failed.emit(f"{type(e).__name__}: {e}")
        else:
            if self._cancel.is_set():
                self.signals.cancelled.emit()
            else:
                self.signals.finished.emit(result)


class JobRunner(QObject):
    """Runs one job at a time; models are shared, so jobs must not overlap."""

    busy_changed = Signal(bool)

    def __init__(self):
        super().__init__()
        self.pool = QThreadPool()
        self.pool.setMaxThreadCount(1)
        self.current: Job | None = None
        self._pending: list[Job] = []

    def submit(self, job: Job) -> Job:
        for sig in (job.signals.finished, job.signals.failed, job.signals.cancelled):
            sig.connect(lambda *_, j=job: self._done(j))
        if self.current is None:
            self._start(job)
        else:
            self._pending.append(job)
        return job

    def _start(self, job: Job):
        self.current = job
        self.busy_changed.emit(True)
        self.pool.start(job)

    def _done(self, job: Job):
        if job is not self.current:
            return
        self.current = None
        if self._pending:
            self._start(self._pending.pop(0))
        else:
            self.busy_changed.emit(False)

    def cancel_all(self):
        for j in self._pending:
            j.cancel()
            j.signals.cancelled.emit()
        self._pending.clear()
        if self.current:
            self.current.cancel()

    def drop_pending(self, predicate: Callable[[Job], bool]):
        keep = []
        for j in self._pending:
            if predicate(j):
                j.cancel()
            else:
                keep.append(j)
        self._pending = keep
