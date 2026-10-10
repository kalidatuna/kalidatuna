#include "VideoDecoder.h"

#include <QFileInfo>
#include <QImageReader>
#include <algorithm>
#include <cmath>

extern "C" {
#include <libavutil/log.h>
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/imgutils.h>
#include <libswscale/swscale.h>
}

namespace mf {

static QString averr(int code)
{
    char buf[256];
    av_strerror(code, buf, sizeof buf);
    return QString::fromUtf8(buf);
}

static bool isStillImagePath(const QString &path)
{
    const QString ext = QFileInfo(path).suffix().toLower();
    if (ext == "gif")
        return false;   // may be animated: decode through FFmpeg
    return QImageReader::supportedImageFormats().contains(ext.toLatin1());
}

MediaInfo probeMedia(const QString &path)
{
    MediaInfo mi;
    if (isStillImagePath(path)) {
        QImageReader r(path);
        const QSize s = r.size();
        if (!s.isValid()) {
            mi.error = r.errorString();
            return mi;
        }
        mi.ok = mi.isStill = mi.hasVideo = true;
        mi.width = s.width();
        mi.height = s.height();
        return mi;
    }
    VideoDecoder d;
    QString err;
    if (!d.open(path, &err)) {
        mi.error = err;
        return mi;
    }
    return d.info();
}

VideoDecoder::~VideoDecoder()
{
    close();
}

void VideoDecoder::close()
{
    if (sws_)
        sws_freeContext(sws_);
    av_frame_free(&cur_);
    av_frame_free(&pending_);
    av_frame_free(&tmp_);
    av_packet_free(&pkt_);
    avcodec_free_context(&dec_);
    if (fmt_)
        avformat_close_input(&fmt_);
    sws_ = nullptr;
}

bool VideoDecoder::open(const QString &path, QString *error)
{
    av_log_set_level(AV_LOG_ERROR);
    auto fail = [&](const QString &msg) {
        if (error)
            *error = msg;
        close();
        return false;
    };
    int rc = avformat_open_input(&fmt_, path.toUtf8().constData(), nullptr, nullptr);
    if (rc < 0)
        return fail("Cannot open file: " + averr(rc));
    if ((rc = avformat_find_stream_info(fmt_, nullptr)) < 0)
        return fail("Cannot read stream info: " + averr(rc));
    stream_ = av_find_best_stream(fmt_, AVMEDIA_TYPE_VIDEO, -1, -1, nullptr, 0);
    info_.hasAudio = av_find_best_stream(fmt_, AVMEDIA_TYPE_AUDIO, -1, -1, nullptr, 0) >= 0;
    if (stream_ < 0)
        return fail(info_.hasAudio ? "Audio-only files are not supported yet." : "No video stream found.");
    AVStream *st = fmt_->streams[stream_];
    const AVCodec *codec = avcodec_find_decoder(st->codecpar->codec_id);
    if (!codec)
        return fail("No decoder for this video codec.");
    dec_ = avcodec_alloc_context3(codec);
    avcodec_parameters_to_context(dec_, st->codecpar);
    dec_->thread_count = 0;   // auto
    if ((rc = avcodec_open2(dec_, codec, nullptr)) < 0)
        return fail("Cannot open decoder: " + averr(rc));

    pkt_ = av_packet_alloc();
    cur_ = av_frame_alloc();
    pending_ = av_frame_alloc();
    tmp_ = av_frame_alloc();

    timeBase_ = av_q2d(st->time_base);
    startPts_ = st->start_time != AV_NOPTS_VALUE ? st->start_time : 0;
    AVRational fr = st->avg_frame_rate.num ? st->avg_frame_rate : st->r_frame_rate;
    info_.fps = fr.num && fr.den ? av_q2d(fr) : 30.0;
    if (st->duration != AV_NOPTS_VALUE)
        info_.duration = st->duration * timeBase_;
    else if (fmt_->duration != AV_NOPTS_VALUE)
        info_.duration = fmt_->duration / double(AV_TIME_BASE);
    info_.width = dec_->width;
    info_.height = dec_->height;
    info_.hasVideo = true;
    info_.ok = true;
    return true;
}

bool VideoDecoder::seekTo(qint64 pts)
{
    avcodec_flush_buffers(dec_);
    haveCur_ = havePending_ = eof_ = false;
    return av_seek_frame(fmt_, stream_, pts, AVSEEK_FLAG_BACKWARD) >= 0;
}

bool VideoDecoder::decodeNext(AVFrame *out)
{
    while (true) {
        int rc = avcodec_receive_frame(dec_, out);
        if (rc == 0)
            return true;
        if (rc == AVERROR_EOF)
            return false;
        if (rc != AVERROR(EAGAIN))
            return false;
        if (eof_)
            return false;
        rc = av_read_frame(fmt_, pkt_);
        if (rc < 0) {
            eof_ = true;
            avcodec_send_packet(dec_, nullptr);   // drain
            continue;
        }
        if (pkt_->stream_index == stream_)
            avcodec_send_packet(dec_, pkt_);
        av_packet_unref(pkt_);
    }
}

QImage VideoDecoder::frameAt(double seconds)
{
    if (!dec_)
        return {};
    seconds = std::clamp(seconds, 0.0, std::max(0.0, info_.duration - 0.5 / info_.fps));
    const qint64 target = startPts_ + qint64(std::floor((seconds + 1e-3) / timeBase_));
    const qint64 seekWindow = qint64(2.0 / timeBase_);

    if (!haveCur_ || target < curPts_ || target > curPts_ + seekWindow)
        seekTo(target);
    while (true) {
        if (havePending_) {
            if (pendingPts_ <= target) {
                av_frame_unref(cur_);
                av_frame_move_ref(cur_, pending_);
                curPts_ = pendingPts_;
                haveCur_ = true;
                havePending_ = false;
                continue;
            }
            break;
        }
        if (!decodeNext(tmp_))
            break;
        const qint64 pts = tmp_->best_effort_timestamp != AV_NOPTS_VALUE ? tmp_->best_effort_timestamp : tmp_->pts;
        av_frame_unref(pending_);
        av_frame_move_ref(pending_, tmp_);
        pendingPts_ = pts;
        havePending_ = true;
    }
    if (!haveCur_) {
        // Target lies before the first decodable frame; use the first one we have.
        if (havePending_)
            return convert(pending_);
        return converted_;
    }
    if (curPts_ == convertedPts_ && !converted_.isNull())
        return converted_;
    converted_ = convert(cur_);
    convertedPts_ = curPts_;
    return converted_;
}

QImage VideoDecoder::convert(const AVFrame *f)
{
    sws_ = sws_getCachedContext(sws_, f->width, f->height, AVPixelFormat(f->format), f->width, f->height,
                                AV_PIX_FMT_BGRA, SWS_BILINEAR, nullptr, nullptr, nullptr);
    if (!sws_)
        return {};
    QImage img(f->width, f->height, QImage::Format_ARGB32);
    uint8_t *dst[4] = {img.bits(), nullptr, nullptr, nullptr};
    int stride[4] = {int(img.bytesPerLine()), 0, 0, 0};
    sws_scale(sws_, f->data, f->linesize, 0, f->height, dst, stride);
    const AVPixFmtDescriptor *desc = av_pix_fmt_desc_get(AVPixelFormat(f->format));
    if (desc && (desc->flags & AV_PIX_FMT_FLAG_ALPHA))
        return img.convertToFormat(QImage::Format_ARGB32_Premultiplied);
    img.reinterpretAsFormat(QImage::Format_ARGB32_Premultiplied);   // opaque: identical layout
    return img;
}

} // namespace mf
