#pragma once
#include <QString>
#include <memory>
#include <vector>

namespace mf {

constexpr int kAudioRate = 48000;   // internal mixing rate, stereo float

// A fully decoded audio track: interleaved stereo float at kAudioRate.
struct AudioBuffer {
    std::vector<float> samples;   // L R L R ...
    std::vector<float> peaks;     // max |sample| per 1/kPeakRate seconds, for waveforms
    static constexpr int kPeakRate = 200;

    qint64 frames() const { return qint64(samples.size() / 2); }
    double duration() const { return double(frames()) / kAudioRate; }
    // Linear-interpolated stereo sample at a time in seconds (0 outside the buffer).
    void sampleAt(double seconds, float &l, float &r) const;
    float peakBetween(double t0, double t1) const;
};

// Decodes the best audio stream of a file. Returns null when there is none.
std::shared_ptr<AudioBuffer> decodeAudio(const QString &path, QString *error = nullptr);

} // namespace mf
