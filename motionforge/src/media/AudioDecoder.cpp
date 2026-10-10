#include "AudioDecoder.h"

#include <algorithm>
#include <cmath>

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/channel_layout.h>
#include <libavutil/log.h>
#include <libavutil/opt.h>
#include <libswresample/swresample.h>
}

namespace mf {

void AudioBuffer::sampleAt(double seconds, float &l, float &r) const
{
    const double pos = seconds * kAudioRate;
    const qint64 i = qint64(std::floor(pos));
    const qint64 n = frames();
    if (i < 0 || i >= n) {
        l = r = 0.f;
        return;
    }
    const float f = float(pos - i);
    const qint64 j = std::min(i + 1, n - 1);
    l = samples[size_t(i * 2)] * (1 - f) + samples[size_t(j * 2)] * f;
    r = samples[size_t(i * 2 + 1)] * (1 - f) + samples[size_t(j * 2 + 1)] * f;
}

float AudioBuffer::peakBetween(double t0, double t1) const
{
    if (peaks.empty())
        return 0.f;
    const qint64 a = std::max<qint64>(0, qint64(std::floor(t0 * kPeakRate)));
    const qint64 b = std::min<qint64>(qint64(peaks.size()) - 1, qint64(std::ceil(t1 * kPeakRate)));
    float m = 0.f;
    for (qint64 i = a; i <= b; ++i)
        m = std::max(m, peaks[size_t(i)]);
    return m;
}

std::shared_ptr<AudioBuffer> decodeAudio(const QString &path, QString *error)
{
    av_log_set_level(AV_LOG_ERROR);
    AVFormatContext *fmt = nullptr;
    auto fail = [&](const QString &m) -> std::shared_ptr<AudioBuffer> {
        if (error)
            *error = m;
        if (fmt)
            avformat_close_input(&fmt);
        return nullptr;
    };
    if (avformat_open_input(&fmt, path.toUtf8().constData(), nullptr, nullptr) < 0)
        return fail("Cannot open file");
    if (avformat_find_stream_info(fmt, nullptr) < 0)
        return fail("Cannot read stream info");
    const int si = av_find_best_stream(fmt, AVMEDIA_TYPE_AUDIO, -1, -1, nullptr, 0);
    if (si < 0)
        return fail("No audio stream");
    AVStream *st = fmt->streams[si];
    const AVCodec *codec = avcodec_find_decoder(st->codecpar->codec_id);
    if (!codec)
        return fail("No decoder for this audio codec");
    AVCodecContext *dec = avcodec_alloc_context3(codec);
    avcodec_parameters_to_context(dec, st->codecpar);
    if (avcodec_open2(dec, codec, nullptr) < 0) {
        avcodec_free_context(&dec);
        return fail("Cannot open audio decoder");
    }
    SwrContext *swr = nullptr;
#if LIBAVUTIL_VERSION_INT >= AV_VERSION_INT(57, 28, 100)   // FFmpeg 5.1+ channel layout API
    AVChannelLayout outLayout = AV_CHANNEL_LAYOUT_STEREO;
    AVChannelLayout inLayout;
    if (dec->ch_layout.nb_channels > 0)
        av_channel_layout_copy(&inLayout, &dec->ch_layout);
    else
        av_channel_layout_default(&inLayout, 2);
    const bool swrOk = swr_alloc_set_opts2(&swr, &outLayout, AV_SAMPLE_FMT_FLT, kAudioRate, &inLayout,
                                           dec->sample_fmt, dec->sample_rate, 0, nullptr) >= 0;
    av_channel_layout_uninit(&inLayout);
#else   // FFmpeg 4.x (Ubuntu 22.04, Linux Mint 21)
    const int64_t inLayout = dec->channel_layout ? int64_t(dec->channel_layout)
                                                 : av_get_default_channel_layout(std::max(1, dec->channels));
    swr = swr_alloc_set_opts(nullptr, AV_CH_LAYOUT_STEREO, AV_SAMPLE_FMT_FLT, kAudioRate, inLayout,
                             dec->sample_fmt, dec->sample_rate, 0, nullptr);
    const bool swrOk = swr != nullptr;
#endif
    if (!swrOk || swr_init(swr) < 0) {
        swr_free(&swr);
        avcodec_free_context(&dec);
        return fail("Cannot set up audio resampler");
    }

    auto buf = std::make_shared<AudioBuffer>();
    if (fmt->duration > 0)
        buf->samples.reserve(size_t(fmt->duration / double(AV_TIME_BASE) * kAudioRate * 2 * 1.02));
    // Skip leading silence/offset correctly: place samples at their presentation time.
    const double streamStart = st->start_time != AV_NOPTS_VALUE ? st->start_time * av_q2d(st->time_base) : 0.0;
    AVPacket *pkt = av_packet_alloc();
    AVFrame *frame = av_frame_alloc();
    std::vector<float> tmp;
    auto drainFrame = [&](AVFrame *f) {
        const int outMax = swr_get_out_samples(swr, f ? f->nb_samples : 0);
        if (outMax <= 0)
            return;
        tmp.resize(size_t(outMax) * 2);
        uint8_t *out[1] = {reinterpret_cast<uint8_t *>(tmp.data())};
        const int got = swr_convert(swr, out, outMax, f ? const_cast<const uint8_t **>(f->extended_data) : nullptr,
                                    f ? f->nb_samples : 0);
        if (got > 0)
            buf->samples.insert(buf->samples.end(), tmp.begin(), tmp.begin() + got * 2);
    };
    bool first = true;
    while (av_read_frame(fmt, pkt) >= 0) {
        if (pkt->stream_index == si && avcodec_send_packet(dec, pkt) >= 0) {
            while (avcodec_receive_frame(dec, frame) == 0) {
                if (first) {
                    first = false;
                    // Pad if the first frame starts after the stream start (rare, e.g. MP4 edit lists).
                    if (frame->pts != AV_NOPTS_VALUE) {
                        const double t = frame->pts * av_q2d(st->time_base) - streamStart;
                        if (t > 0.001 && t < 10)
                            buf->samples.resize(size_t(t * kAudioRate) * 2, 0.f);
                    }
                }
                drainFrame(frame);
            }
        }
        av_packet_unref(pkt);
    }
    avcodec_send_packet(dec, nullptr);
    while (avcodec_receive_frame(dec, frame) == 0)
        drainFrame(frame);
    drainFrame(nullptr);
    av_frame_free(&frame);
    av_packet_free(&pkt);
    swr_free(&swr);
    avcodec_free_context(&dec);
    avformat_close_input(&fmt);

    // Waveform peaks.
    const qint64 per = kAudioRate / AudioBuffer::kPeakRate;
    buf->peaks.resize(size_t(buf->frames() / per + 1), 0.f);
    for (qint64 i = 0; i < buf->frames(); ++i) {
        const float a = std::max(std::abs(buf->samples[size_t(i * 2)]), std::abs(buf->samples[size_t(i * 2 + 1)]));
        float &pk = buf->peaks[size_t(i / per)];
        pk = std::max(pk, a);
    }
    return buf;
}

} // namespace mf
