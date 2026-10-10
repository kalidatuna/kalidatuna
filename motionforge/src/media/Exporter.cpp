#include "Exporter.h"

#include "AudioDecoder.h"

#include <QDir>
#include <algorithm>
#include <cmath>
#include <QFile>
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
    av_frame_free(&aframe_);
    avcodec_free_context(&aenc_);
    astream_ = nullptr;
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
                    QString *error, bool withAudio)
{
    withAudio_ = withAudio;
    afifo_.clear();
    audioPts_ = 0;
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

    if (withAudio_ && !openAudio(error)) {
        cleanup();
        return false;
    }
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

bool Exporter::openAudio(QString *error)
{
    const bool mp4 = format_ == ExportFormat::H264;
    const AVCodec *codec = avcodec_find_encoder(mp4 ? AV_CODEC_ID_AAC : AV_CODEC_ID_PCM_S16LE);
    if (!codec) {
        if (error)
            *error = "No audio encoder available.";
        return false;
    }
    astream_ = avformat_new_stream(fmt_, nullptr);
    aenc_ = avcodec_alloc_context3(codec);
    aenc_->sample_rate = kAudioRate;
    aenc_->sample_fmt = mp4 ? AV_SAMPLE_FMT_FLTP : AV_SAMPLE_FMT_S16;
    AVChannelLayout stereo = AV_CHANNEL_LAYOUT_STEREO;
    av_channel_layout_copy(&aenc_->ch_layout, &stereo);
    aenc_->time_base = AVRational{1, kAudioRate};
    if (mp4)
        aenc_->bit_rate = 320000;
    if (fmt_->oformat->flags & AVFMT_GLOBALHEADER)
        aenc_->flags |= AV_CODEC_FLAG_GLOBAL_HEADER;
    int rc = avcodec_open2(aenc_, codec, nullptr);
    if (rc < 0) {
        if (error)
            *error = "Cannot open audio encoder: " + averr(rc);
        return false;
    }
    avcodec_parameters_from_context(astream_->codecpar, aenc_);
    astream_->time_base = aenc_->time_base;
    aframe_ = av_frame_alloc();
    aframe_->format = aenc_->sample_fmt;
    av_channel_layout_copy(&aframe_->ch_layout, &aenc_->ch_layout);
    aframe_->sample_rate = kAudioRate;
    aframe_->nb_samples = aenc_->frame_size > 0 ? aenc_->frame_size : 1024;
    av_frame_get_buffer(aframe_, 0);
    return true;
}

bool Exporter::encodeAudio(bool flush, QString *error)
{
    const int fs = aframe_->nb_samples;
    auto sendFrame = [&](int n) -> bool {
        av_frame_make_writable(aframe_);
        aframe_->nb_samples = n;
        if (aenc_->sample_fmt == AV_SAMPLE_FMT_FLTP) {
            auto *l = reinterpret_cast<float *>(aframe_->data[0]);
            auto *r = reinterpret_cast<float *>(aframe_->data[1]);
            for (int i = 0; i < n; ++i) {
                l[i] = std::clamp(afifo_[size_t(i) * 2], -1.f, 1.f);
                r[i] = std::clamp(afifo_[size_t(i) * 2 + 1], -1.f, 1.f);
            }
        } else {
            auto *d = reinterpret_cast<int16_t *>(aframe_->data[0]);
            for (int i = 0; i < n * 2; ++i)
                d[i] = int16_t(std::lround(std::clamp(afifo_[size_t(i)], -1.f, 1.f) * 32767.f));
        }
        aframe_->pts = audioPts_;
        audioPts_ += n;
        afifo_.erase(afifo_.begin(), afifo_.begin() + n * 2);
        int rc = avcodec_send_frame(aenc_, aframe_);
        if (rc < 0) {
            if (error)
                *error = "Audio encoding failed: " + averr(rc);
            return false;
        }
        return true;
    };
    auto drain = [&] {
        while (avcodec_receive_packet(aenc_, pkt_) == 0) {
            av_packet_rescale_ts(pkt_, aenc_->time_base, astream_->time_base);
            pkt_->stream_index = astream_->index;
            av_interleaved_write_frame(fmt_, pkt_);
        }
    };
    while (int(afifo_.size() / 2) >= fs) {
        if (!sendFrame(fs))
            return false;
        drain();
    }
    if (flush) {
        if (!afifo_.empty() && !sendFrame(int(afifo_.size() / 2)))
            return false;
        avcodec_send_frame(aenc_, nullptr);
        drain();
    }
    return true;
}

bool Exporter::addAudio(const float *samples, int frames, QString *error)
{
    if (!withAudio_)
        return true;
    afifo_.insert(afifo_.end(), samples, samples + size_t(frames) * 2);
    if (format_ == ExportFormat::PngSequence)
        return true;   // written as a WAV file at the end
    return encodeAudio(false, error);
}

bool Exporter::writeWav(QString *error)
{
    const QFileInfo fi(path_);
    QFile f(fi.absolutePath() + "/" + fi.completeBaseName() + ".wav");
    if (!f.open(QIODevice::WriteOnly)) {
        if (error)
            *error = "Cannot write " + f.fileName();
        return false;
    }
    const quint32 dataBytes = quint32(afifo_.size() * 2);
    auto u32 = [&](quint32 v) { f.write(reinterpret_cast<const char *>(&v), 4); };
    auto u16 = [&](quint16 v) { f.write(reinterpret_cast<const char *>(&v), 2); };
    f.write("RIFF");
    u32(36 + dataBytes);
    f.write("WAVEfmt ");
    u32(16);
    u16(1);
    u16(2);
    u32(kAudioRate);
    u32(kAudioRate * 4);
    u16(4);
    u16(16);
    f.write("data");
    u32(dataBytes);
    std::vector<int16_t> pcm(afifo_.size());
    for (size_t i = 0; i < afifo_.size(); ++i)
        pcm[i] = int16_t(std::lround(std::clamp(afifo_[i], -1.f, 1.f) * 32767.f));
    f.write(reinterpret_cast<const char *>(pcm.data()), qint64(pcm.size() * 2));
    afifo_.clear();
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
        return withAudio_ && !afifo_.empty() ? writeWav(error) : true;
    bool ok = encode(nullptr, error);
    if (ok && withAudio_)
        ok = encodeAudio(true, error);
    av_write_trailer(fmt_);
    cleanup();
    return ok;
}

} // namespace mf
