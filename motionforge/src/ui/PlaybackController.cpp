#include "PlaybackController.h"

#include "CompViewer.h"

#include <cmath>

namespace mf {

PlaybackController::PlaybackController(Editor *editor, CompViewer *viewer, QObject *parent)
    : QObject(parent), ed_(editor), viewer_(viewer)
{
    timer_.setTimerType(Qt::PreciseTimer);
    connect(&timer_, &QTimer::timeout, this, &PlaybackController::tick);
    connect(ed_, &Editor::activeCompChanged, this, &PlaybackController::stop);
}

void PlaybackController::play()
{
    Composition *c = ed_->activeComp();
    if (!c)
        return;
    const int ws = c->frameAt(c->workStart), we = std::max(ws + 1, c->frameAt(c->workEnd));
    int f = ed_->currentFrame();
    if (f < ws || f >= we - 1)
        f = ws;
    ed_->setTime(c->timeOfFrame(f));
    anchorFrame_ = f;
    clock_.start();
    fpsClock_.start();
    shownFrames_ = 0;
    timer_.start(std::max(1, int(500.0 / c->fps)));
    emit playingChanged(true);
}

void PlaybackController::stop()
{
    if (!timer_.isActive())
        return;
    timer_.stop();
    emit playingChanged(false);
}

void PlaybackController::tick()
{
    Composition *c = ed_->activeComp();
    if (!c) {
        stop();
        return;
    }
    const int ws = c->frameAt(c->workStart), we = std::max(ws + 1, c->frameAt(c->workEnd));
    const int cur = ed_->currentFrame();
    const double scale = viewer_->renderScale();
    int target = anchorFrame_ + int(std::floor(clock_.elapsed() / 1000.0 * c->fps));
    if (target == cur)
        return;
    // If the next frame isn't cached yet, show frames in order instead of skipping.
    if (target > cur + 1 && !ed_->cache().contains(c->id, cur + 1, scale)) {
        target = cur + 1;
        anchorFrame_ = target;
        clock_.restart();
    }
    if (target >= we) {
        if (!loop_) {
            stop();
            return;
        }
        target = ws;
        anchorFrame_ = ws;
        clock_.restart();
    }
    ed_->setTime(c->timeOfFrame(target));
    viewer_->repaint();   // render now so timing is measured honestly
    ++shownFrames_;
    if (fpsClock_.elapsed() > 500) {
        const double fps = shownFrames_ * 1000.0 / fpsClock_.elapsed();
        emit fpsMeasured(fps, fps >= c->fps * 0.95);
        shownFrames_ = 0;
        fpsClock_.restart();
    }
}

} // namespace mf
