#pragma once
#include "core/Project.h"
#include "media/AudioDecoder.h"

#include <vector>

namespace mf {

class Renderer;

// Mixes the audio of a composition (including nested precomps) to stereo float at kAudioRate.
class AudioMixer {
public:
    AudioMixer(const Project &project, const Renderer &renderer) : project_(project), renderer_(renderer) {}

    // Writes `frames` stereo frames starting at composition time t0 into out (size frames * 2).
    void mix(const Composition &comp, double t0, int frames, float *out, int depth = 0) const;
    bool compHasAudio(const Composition &comp, int depth = 0) const;
    bool layerHasAudio(const Layer &l, int depth = 0) const;

private:
    void mixLayer(const Composition &comp, const Layer &l, double t0, int frames, float *out, int depth) const;
    const Project &project_;
    const Renderer &renderer_;
};

inline float dbToGain(double db) { return db <= -96.0 ? 0.f : float(std::pow(10.0, db / 20.0)); }

} // namespace mf
