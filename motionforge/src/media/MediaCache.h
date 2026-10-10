#pragma once
#include "AudioDecoder.h"
#include "VideoDecoder.h"

#include <QHash>
#include <QImage>
#include <QSet>
#include <list>
#include <memory>

namespace mf {

// Shared decoders and decoded stills, keyed by file path. Main thread only.
class MediaCache {
public:
    static MediaCache &instance();
    QImage still(const QString &path);
    QImage videoFrame(const QString &path, double seconds);
    // Decoded audio for a file (decoded on first use, then shared). Null if it has no audio.
    std::shared_ptr<AudioBuffer> audio(const QString &path);
    void clear();

private:
    QHash<QString, QImage> stills_;
    QHash<QString, std::shared_ptr<VideoDecoder>> decoders_;
    std::list<QString> decoderLru_;
    QHash<QString, std::shared_ptr<AudioBuffer>> audio_;
    QSet<QString> noAudio_;
};

} // namespace mf
