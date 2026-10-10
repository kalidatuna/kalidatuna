#include "AudioMixer.h"

#include "Renderer.h"
#include "media/MediaCache.h"

#include <algorithm>
#include <cmath>

namespace mf {

static constexpr int kMaxDepth = 16;
// Source times and levels are evaluated at this granularity and interpolated in between.
static constexpr int kBlock = 256;

bool AudioMixer::layerHasAudio(const Layer &l, int depth) const
{
    if (!l.audioOn || depth > kMaxDepth)
        return false;
    if (l.type == LayerType::Footage)
        if (const FootageItem *f = project_.footage(l.sourceItemId))
            return f->hasAudio;
    if (l.type == LayerType::Precomp)
        if (const Composition *c = project_.comp(l.sourceItemId))
            return compHasAudio(*c, depth + 1);
    return false;
}

bool AudioMixer::compHasAudio(const Composition &comp, int depth) const
{
    for (const auto &l : comp.layers)
        if (layerHasAudio(*l, depth))
            return true;
    return false;
}

void AudioMixer::mix(const Composition &comp, double t0, int frames, float *out, int depth) const
{
    std::fill(out, out + size_t(frames) * 2, 0.f);
    if (depth > kMaxDepth)
        return;
    bool anySolo = false;
    for (const auto &l : comp.layers)
        anySolo |= l->solo && l->audioOn;
    for (const auto &l : comp.layers) {
        if (anySolo && !l->solo)
            continue;
        if (layerHasAudio(*l, depth))
            mixLayer(comp, *l, t0, frames, out, depth);
    }
}

void AudioMixer::mixLayer(const Composition &comp, const Layer &l, double t0, int frames, float *out,
                          int depth) const
{
    const double dt = 1.0 / kAudioRate;
    const double t1 = t0 + frames * dt;
    if (t1 <= l.inPoint || t0 >= l.outPoint)
        return;

    for (int b = 0; b < frames; b += kBlock) {
        const int n = std::min(kBlock, frames - b);
        const double bt0 = t0 + b * dt, bt1 = bt0 + n * dt;
        if (bt1 <= l.inPoint || bt0 >= l.outPoint)
            continue;
        const double s0 = renderer_.sourceTime(l, comp, bt0);
        const double s1 = renderer_.sourceTime(l, comp, bt1);
        const float g0 = dbToGain(renderer_.eval(l.audioLevels, bt0, l, comp).value(0));
        const float g1 = dbToGain(renderer_.eval(l.audioLevels, bt1, l, comp).value(0));

        if (l.type == LayerType::Footage) {
            const FootageItem *f = project_.footage(l.sourceItemId);
            auto buf = f ? MediaCache::instance().audio(f->path) : nullptr;
            if (!buf)
                return;
            for (int i = 0; i < n; ++i) {
                const double t = bt0 + i * dt;
                if (t < l.inPoint || t >= l.outPoint)
                    continue;
                const double u = double(i) / n;
                float sl, sr;
                buf->sampleAt(s0 + (s1 - s0) * u, sl, sr);
                const float g = g0 + (g1 - g0) * float(u);
                out[size_t(b + i) * 2] += sl * g;
                out[size_t(b + i) * 2 + 1] += sr * g;
            }
        } else if (l.type == LayerType::Precomp) {
            const Composition *sub = project_.comp(l.sourceItemId);
            if (!sub)
                return;
            // Mix the nested comp over the source span, then resample it onto this block.
            const double span = s1 - s0;
            const int subFrames = std::clamp(int(std::ceil(std::abs(span) * kAudioRate)) + 2, 2, kBlock * 64);
            std::vector<float> tmp(size_t(subFrames) * 2);
            mix(*sub, std::min(s0, s1), subFrames, tmp.data(), depth + 1);
            for (int i = 0; i < n; ++i) {
                const double t = bt0 + i * dt;
                if (t < l.inPoint || t >= l.outPoint)
                    continue;
                const double u = double(i) / n;
                const double pos = (span >= 0 ? u * span : (1 - u) * -span) * kAudioRate;
                const int k = std::clamp(int(pos), 0, subFrames - 2);
                const float fr = float(pos - k);
                const float g = g0 + (g1 - g0) * float(u);
                out[size_t(b + i) * 2] += (tmp[size_t(k) * 2] * (1 - fr) + tmp[size_t(k + 1) * 2] * fr) * g;
                out[size_t(b + i) * 2 + 1] += (tmp[size_t(k) * 2 + 1] * (1 - fr) + tmp[size_t(k + 1) * 2 + 1] * fr) * g;
            }
        }
    }
}

} // namespace mf
