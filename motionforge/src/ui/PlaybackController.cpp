#include "PlaybackController.h"

#include "CompViewer.h"
#include "media/AudioDecoder.h"

#include <QAudioFormat>
#include <QAudioSink>
#include <QMediaDevices>
#include <cmath>

namespace mf {

PlaybackController::PlaybackController(Editor *editor, CompViewer *viewer, QObject *parent)
    : QObject(parent), ed_(editor), viewer_(viewer)
{
    timer_.setTimerType(Qt::PreciseTimer);
    connect(&timer_, &QTimer::timeout, this, &PlaybackController::tick);
    connect(ed_, &Editor::activeCompChanged, this, &PlaybackController::stop);
}

PlaybackController::~PlaybackController()
{
    stop();
}

bool PlaybackController::startAudio(double from)
{
    const QAudioDevice dev = QMediaDevices::defaultAudioOutput();
    if (dev.isNull()) {
        emit audioStatus("No audio output device: previewing without sound.");
        return false;
    }
    QAudioFormat fmt;
    fmt.setSampleRate(kAudioRate);
    fmt.setChannelCount(2);
    fmt.setSampleFormat(QAudioFormat::Float);
    if (!dev.isFormatSupported(fmt)) {
        fmt.setSampleFormat(QAudioFormat::Int16);
        if (!dev.isFormatSupported(fmt)) {
            emit audioStatus("The audio device doesn't support 48 kHz stereo.");
            return false;
        }
    }
    sink_ = std::make_unique<QAudioSink>(dev, fmt);
    sink_->setBufferSize(kAudioRate / 8 * fmt.bytesPerFrame());   // ~125 ms
    audioDev_ = sink_->start();
    if (!audioDev_) {
        sink_.reset();
        emit audioStatus("Could not open the audio device.");
        return false;
    }
    feedTime_ = from;
    framesWritten_ = 0;
    feedDone_ = false;
    segments_ = {{0, from}};
    feedAudio();
    emit audioStatus({});
    return true;
}

void PlaybackController::feedAudio()
{
    Composition *c = ed_->activeComp();
    if (!sink_ || !c || feedDone_)
        return;
    const int bpf = sink_->format().bytesPerFrame();
    int frames = int(sink_->bytesFree() / bpf);
    const bool isFloat = sink_->format().sampleFormat() == QAudioFormat::Float;
    std::vector<float> mix;
    QByteArray bytes;
    while (frames > 0 && !feedDone_) {
        int n = std::min(frames, 2048);
        // Stop at the end of the work area, then loop or finish.
        const int left = int(std::ceil((c->workEnd - feedTime_) * kAudioRate));
        if (left <= 0) {
            if (!loop_) {
                feedDone_ = true;
                break;
            }
            feedTime_ = c->workStart;
            segments_.push_back({framesWritten_, feedTime_});
            continue;
        }
        n = std::min(n, left);
        mix.resize(size_t(n) * 2);
        ed_->mixer().mix(*c, feedTime_, n, mix.data());
        if (isFloat) {
            for (float &v : mix)
                v = std::clamp(v, -1.f, 1.f);
            bytes = QByteArray(reinterpret_cast<const char *>(mix.data()), qsizetype(mix.size() * sizeof(float)));
        } else {
            bytes.resize(qsizetype(mix.size() * 2));
            auto *d = reinterpret_cast<qint16 *>(bytes.data());
            for (size_t i = 0; i < mix.size(); ++i)
                d[i] = qint16(std::lround(std::clamp(mix[i], -1.f, 1.f) * 32767.f));
        }
        audioDev_->write(bytes);
        framesWritten_ += n;
        feedTime_ += double(n) / kAudioRate;
        frames -= n;
    }
}

double PlaybackController::audioClockTime() const
{
    // Frames handed to the device minus those still waiting in its buffer ≈ what is audible now.
    const int bpf = sink_->format().bytesPerFrame();
    const qint64 queued = (sink_->bufferSize() - sink_->bytesFree()) / bpf;
    const qint64 played = std::max<qint64>(0, framesWritten_ - queued);
    const Segment *seg = &segments_.front();
    for (const Segment &s : segments_)
        if (s.startFrame <= played)
            seg = &s;
    return seg->compTime + double(played - seg->startFrame) / kAudioRate;
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
    if (audioEnabled_ && ed_->mixer().compHasAudio(*c))
        startAudio(c->timeOfFrame(f));
    timer_.start(std::max(1, int(500.0 / c->fps)));
    emit playingChanged(true);
}

void PlaybackController::stop()
{
    if (sink_) {
        sink_->stop();
        sink_.reset();
        audioDev_ = nullptr;
    }
    if (!timer_.isActive())
        return;
    timer_.stop();
    emit playingChanged(false);
}

void PlaybackController::showFrame(int frame)
{
    Composition *c = ed_->activeComp();
    ed_->setTime(c->timeOfFrame(frame));
    viewer_->repaint();   // render now so timing is measured honestly
    ++shownFrames_;
    if (fpsClock_.elapsed() > 500) {
        const double fps = shownFrames_ * 1000.0 / fpsClock_.elapsed();
        emit fpsMeasured(fps, fps >= c->fps * 0.95);
        shownFrames_ = 0;
        fpsClock_.restart();
    }
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

    if (sink_) {
        feedAudio();
        const double t = audioClockTime();
        if (feedDone_ && t >= c->workEnd - 1e-6) {
            stop();
            return;
        }
        const int target = std::clamp(c->frameAt(t), ws, we - 1);
        if (target != cur)
            showFrame(target);
        feedAudio();   // rendering may have taken a while
        return;
    }

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
    showFrame(target);
}

} // namespace mf
