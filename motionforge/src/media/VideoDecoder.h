#pragma once
#include <QImage>
#include <QString>

struct AVFormatContext;
struct AVCodecContext;
struct AVFrame;
struct AVPacket;
struct SwsContext;

namespace mf {

struct MediaInfo {
    bool ok = false;
    bool isStill = false;
    bool hasVideo = false;
    bool hasAudio = false;
    int width = 0;
    int height = 0;
    double fps = 30.0;
    double duration = 0.0;
    QString error;
};

// Decodes video frames by time. Sequential requests decode forward without seeking.
class VideoDecoder {
public:
    VideoDecoder() = default;
    ~VideoDecoder();
    VideoDecoder(const VideoDecoder &) = delete;
    VideoDecoder &operator=(const VideoDecoder &) = delete;

    bool open(const QString &path, QString *error = nullptr);
    const MediaInfo &info() const { return info_; }
    QImage frameAt(double seconds);

private:
    bool seekTo(qint64 pts);
    bool decodeNext(AVFrame *out);
    QImage convert(const AVFrame *f);
    void close();

    MediaInfo info_;
    AVFormatContext *fmt_ = nullptr;
    AVCodecContext *dec_ = nullptr;
    AVPacket *pkt_ = nullptr;
    AVFrame *cur_ = nullptr;
    AVFrame *pending_ = nullptr;
    AVFrame *tmp_ = nullptr;
    SwsContext *sws_ = nullptr;
    int stream_ = -1;
    double timeBase_ = 0.0;
    qint64 startPts_ = 0;
    bool haveCur_ = false;
    bool havePending_ = false;
    bool eof_ = false;
    qint64 curPts_ = 0;
    qint64 pendingPts_ = 0;
    qint64 convertedPts_ = -1;
    QImage converted_;
};

MediaInfo probeMedia(const QString &path);

} // namespace mf
