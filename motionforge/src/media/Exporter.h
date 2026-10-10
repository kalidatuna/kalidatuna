#pragma once
#include <QImage>
#include <QString>

struct AVFormatContext;
struct AVCodecContext;
struct AVFrame;
struct AVPacket;
struct AVStream;
struct SwsContext;

namespace mf {

enum class ExportFormat { H264, ProRes422HQ, ProRes4444, PngSequence };

QString exportFormatName(ExportFormat f);
QString exportFormatExtension(ExportFormat f);
bool exportFormatHasAlpha(ExportFormat f);

// Writes rendered frames to a movie file through FFmpeg, or to a PNG sequence.
class Exporter {
public:
    Exporter() = default;
    ~Exporter();
    Exporter(const Exporter &) = delete;
    Exporter &operator=(const Exporter &) = delete;

    // quality: 0 (smallest) .. 100 (best); used for H.264's CRF.
    bool open(const QString &path, ExportFormat format, int width, int height, double fps, int quality,
              QString *error);
    bool addFrame(const QImage &frame, QString *error);
    bool finish(QString *error);

private:
    bool encode(AVFrame *f, QString *error);
    void cleanup();

    ExportFormat format_ = ExportFormat::H264;
    QString path_;
    int width_ = 0;
    int height_ = 0;
    qint64 frameIndex_ = 0;
    AVFormatContext *fmt_ = nullptr;
    AVCodecContext *enc_ = nullptr;
    AVStream *stream_ = nullptr;
    AVFrame *frame_ = nullptr;
    AVPacket *pkt_ = nullptr;
    SwsContext *sws_ = nullptr;
};

} // namespace mf
