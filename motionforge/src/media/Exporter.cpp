#include "Exporter.h"

#include <QDir>
#include <QFileInfo>

extern "C" {
#include <libavutil/log.h>
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/opt.h>
#include <libswscale/swscale.h>
}

namespace mf {

QString exportFormatName(ExportFormat f)
{
    switch (f) {
    case ExportFormat::H264: return "H.264 (MP4)";
    case ExportFormat::ProRes422HQ: return "Apple ProRes 422 HQ (MOV)";
    case ExportFormat::ProRes4444: return "Apple ProRes 4444 with Alpha (MOV)";
    case ExportFormat::PngSequence: return "PNG Sequence (with Alpha)";
    }
    return {};
}

QString exportFormatExtension(ExportFormat f)
{
    switch (f) {
    case ExportFormat::H264: return "mp4";
    case ExportFormat::ProRes422HQ:
    case ExportFormat::ProRes4444: return "mov";
    case ExportFormat::PngSequence: return "png";
    }
    return {};
}

bool exportFormatHasAlpha(ExportFormat f)
{
    return f == ExportFormat::ProRes4444 || f == ExportFormat::PngSequence;
}

static QString averr(int code)
{
    char buf[256];
    av_strerror(code, buf, sizeof buf);
    return QString::fromUtf8(buf);
}

Exporter::~Exporter()
{
    cleanup();
}

void Exporter::cleanup()
{
    if (sws_)
        sws_freeContext(sws_);
    sws_ = nullptr;
    av_frame_free(&frame_);
    av_packet_free(&pkt_);
    avcodec_free_context(&enc_);
    if (fmt_) {
        if (!(fmt_->oformat->flags & AVFMT_NOFILE) && fmt_->pb)
            avio_closep(&fmt_->pb);
        avformat_free_context(fmt_);
        fmt_ = nullptr;
    }
}

bool Exporter::open(const QString &path, ExportFormat format, int width, int height, double fps, int quality,
                    QString *error)
{
    av_log_set_level(AV_LOG_ERROR);
    format_ = format;
    path_ = path;
    frameIndex_ = 0;
    width_ = width;
    height_ = height;
    if (format == ExportFormat::PngSequence) {
        QDir().mkpath(QFileInfo(path).absolutePath());
        return true;
    }
    auto fail = [&](const QString &m) {
        if (error)
            *error = m;
        cleanup();
        return false;
    };
    if (format == ExportFormat::H264) {
        width_ &= ~1;   // 4:2:0 needs even dimensions
        height_ &= ~1;
    }
    int rc = avformat_alloc_output_context2(&fmt_, nullptr, nullptr, path.toUtf8().constData());
    if (rc < 0 || !fmt_)
        return fail("Cannot create output: " + averr(rc));

    const AVCodec *codec = nullptr;
    AVPixelFormat pix = AV_PIX_FMT_YUV420P;
    if (format == ExportFormat::H264) {
        codec = avcodec_find_encoder_by_name("libx264");
        if (!codec)
            codec = avcodec_find_encoder(AV_CODEC_ID_H264);
        if (!codec)
            codec = avcodec_find_encoder(AV_CODEC_ID_MPEG4);
    } else {
        codec = avcodec_find_encoder_by_name("prores_ks");
        pix = format == ExportFormat::ProRes4444 ? AV_PIX_FMT_YUVA444P10LE : AV_PIX_FMT_YUV422P10LE;
    }
    if (!codec)
        return fail("The required video encoder is not available in this FFmpeg build.");

    stream_ = avformat_new_stream(fmt_, nullptr);
    enc_ = avcodec_alloc_context3(codec);
    const AVRational rate = av_d2q(fps, 100000);
    enc_->width = width_;
    enc_->height = height_;
    enc_->pix_fmt = pix;
    enc_->time_base = av_inv_q(rate);
    enc_->framerate = rate;
    enc_->gop_size = std::max(1, int(fps * 2));
    enc_->thread_count = 0;
    if (fmt_->oformat->flags & AVFMT_GLOBALHEADER)
        enc_->flags |= AV_CODEC_FLAG_GLOBAL_HEADER;
    if (QString(codec->name) == "libx264") {
        const int crf = std::clamp(int(std::lround(35 - quality * 0.25)), 10, 35);
        av_opt_set(enc_->priv_data, "crf", QByteArray::number(crf).constData(), 0);
        av_opt_set(enc_->priv_data, "preset", "medium", 0);
        av_opt_set(enc_->priv_data, "tune", "film", 0);
    } else if (format != ExportFormat::H264) {
        av_opt_set(enc_->priv_data, "profile", format == ExportFormat::ProRes4444 ? "4444" : "hq", 0);
        av_opt_set(enc_->priv_data, "vendor", "apl0", 0);
    } else {
        enc_->bit_rate = qint64(width_) * height_ * fps * 0.25;
    }
    if ((rc = avcodec_open2(enc_, codec, nullptr)) < 0)
        return fail("Cannot open encoder: " + averr(rc));
    avcodec_parameters_from_context(stream_->codecpar, enc_);
    stream_->time_base = enc_->time_base;
    stream_->avg_frame_rate = rate;

    if (!(fmt_->oformat->flags & AVFMT_NOFILE)) {
        if ((rc = avio_open(&fmt_->pb, path.toUtf8().constData(), AVIO_FLAG_WRITE)) < 0)
            return fail("Cannot write file: " + averr(rc));
    }
    if ((rc = avformat_write_header(fmt_, nullptr)) < 0)
        return fail("Cannot write header: " + averr(rc));

    frame_ = av_frame_alloc();
    frame_->format = pix;
    frame_->width = width_;
    frame_->height = height_;
    av_frame_get_buffer(frame_, 0);
    pkt_ = av_packet_alloc();
    return true;
}

bool Exporter::encode(AVFrame *f, QString *error)
{
    int rc = avcodec_send_frame(enc_, f);
    if (rc < 0) {
        if (error)
            *error = "Encoding failed: " + averr(rc);
        return false;
    }
    while ((rc = avcodec_receive_packet(enc_, pkt_)) == 0) {
        av_packet_rescale_ts(pkt_, enc_->time_base, stream_->time_base);
        pkt_->stream_index = stream_->index;
        av_interleaved_write_frame(fmt_, pkt_);
    }
    return rc == AVERROR(EAGAIN) || rc == AVERROR_EOF;
}

bool Exporter::addFrame(const QImage &frame, QString *error)
{
    if (format_ == ExportFormat::PngSequence) {
        const QFileInfo fi(path_);
        const QString name = QString("%1/%2_%3.png")
                                 .arg(fi.absolutePath(), fi.completeBaseName())
                                 .arg(frameIndex_++, 5, 10, QChar('0'));
        if (!frame.convertToFormat(QImage::Format_ARGB32).save(name)) {
            if (error)
                *error = "Cannot write " + name;
            return false;
        }
        return true;
    }
    // Encoders want straight (unpremultiplied) alpha.
    const QImage src = frame.convertToFormat(QImage::Format_ARGB32);
    sws_ = sws_getCachedContext(sws_, src.width(), src.height(), AV_PIX_FMT_BGRA, width_, height_,
                                enc_->pix_fmt, SWS_BICUBIC, nullptr, nullptr, nullptr);
    av_frame_make_writable(frame_);
    const uint8_t *srcData[4] = {src.constBits(), nullptr, nullptr, nullptr};
    const int srcStride[4] = {int(src.bytesPerLine()), 0, 0, 0};
    sws_scale(sws_, srcData, srcStride, 0, src.height(), frame_->data, frame_->linesize);
    frame_->pts = frameIndex_++;
    return encode(frame_, error);
}

bool Exporter::finish(QString *error)
{
    if (format_ == ExportFormat::PngSequence)
        return true;
    bool ok = encode(nullptr, error);
    av_write_trailer(fmt_);
    cleanup();
    return ok;
}

} // namespace mf
