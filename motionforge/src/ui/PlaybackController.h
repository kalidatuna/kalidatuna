#pragma once
#include "Editor.h"

#include <QElapsedTimer>
#include <QObject>
#include <QTimer>

namespace mf {

class CompViewer;

// Plays the work area. Uncached frames are rendered one after another (never skipped),
// cached frames play back in real time, like a RAM preview.
class PlaybackController : public QObject {
    Q_OBJECT
public:
    PlaybackController(Editor *editor, CompViewer *viewer, QObject *parent = nullptr);
    bool isPlaying() const { return timer_.isActive(); }
    void play();
    void stop();
    void toggle() { isPlaying() ? stop() : play(); }
    void setLoop(bool on) { loop_ = on; }
    bool loop() const { return loop_; }

signals:
    void playingChanged(bool playing);
    void fpsMeasured(double fps, bool realtime);

private:
    void tick();
    Editor *ed_;
    CompViewer *viewer_;
    QTimer timer_;
    QElapsedTimer clock_;
    QElapsedTimer fpsClock_;
    int anchorFrame_ = 0;
    int shownFrames_ = 0;
    bool loop_ = true;
};

} // namespace mf
