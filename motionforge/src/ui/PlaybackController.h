#pragma once
#include "Editor.h"

#include <QElapsedTimer>
#include <QObject>
#include <QTimer>
#include <deque>
#include <memory>

class QAudioSink;
class QIODevice;

namespace mf {

class CompViewer;

// Plays the work area.
//  - Silent comps: uncached frames render one after another (never skipped), cached frames
//    play in real time, like a RAM preview.
//  - Comps with audio: the sound card is the clock, so picture follows the music and drops
//    frames when rendering can't keep up (cached frames always play smoothly).
class PlaybackController : public QObject {
    Q_OBJECT
public:
    PlaybackController(Editor *editor, CompViewer *viewer, QObject *parent = nullptr);
    ~PlaybackController() override;
    bool isPlaying() const { return timer_.isActive(); }
    void play();
    void stop();
    void toggle() { isPlaying() ? stop() : play(); }
    void setLoop(bool on) { loop_ = on; }
    bool loop() const { return loop_; }
    void setAudioEnabled(bool on) { audioEnabled_ = on; }
    bool audioEnabled() const { return audioEnabled_; }
    bool audioActive() const { return sink_ != nullptr; }

signals:
    void playingChanged(bool playing);
    void fpsMeasured(double fps, bool realtime);
    void audioStatus(const QString &text);

private:
    void tick();
    bool startAudio(double from);
    void feedAudio();
    double audioClockTime() const;
    void showFrame(int frame);

    Editor *ed_;
    CompViewer *viewer_;
    QTimer timer_;
    QElapsedTimer clock_;
    QElapsedTimer fpsClock_;
    int anchorFrame_ = 0;
    int shownFrames_ = 0;
    bool loop_ = true;
    bool audioEnabled_ = true;

    std::unique_ptr<QAudioSink> sink_;
    QIODevice *audioDev_ = nullptr;
    double feedTime_ = 0;
    qint64 framesWritten_ = 0;
    bool feedDone_ = false;
    struct Segment {
        qint64 startFrame;
        double compTime;
    };
    std::deque<Segment> segments_;
};

} // namespace mf
