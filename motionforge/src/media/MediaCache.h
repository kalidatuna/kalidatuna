#pragma once
#include "VideoDecoder.h"

#include <QHash>
#include <QImage>
#include <list>
#include <memory>

namespace mf {

// Shared decoders and decoded stills, keyed by file path. Main thread only.
class MediaCache {
public:
    static MediaCache &instance();
    QImage still(const QString &path);
    QImage videoFrame(const QString &path, double seconds);
    void clear();

private:
    QHash<QString, QImage> stills_;
    QHash<QString, std::shared_ptr<VideoDecoder>> decoders_;
    std::list<QString> decoderLru_;
};

} // namespace mf
