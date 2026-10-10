#include "MediaCache.h"

#include <QImageReader>

namespace mf {

MediaCache &MediaCache::instance()
{
    static MediaCache c;
    return c;
}

QImage MediaCache::still(const QString &path)
{
    auto it = stills_.find(path);
    if (it != stills_.end())
        return *it;
    QImageReader r(path);
    r.setAutoTransform(true);
    QImage img = r.read().convertToFormat(QImage::Format_ARGB32_Premultiplied);
    stills_.insert(path, img);
    return img;
}

QImage MediaCache::videoFrame(const QString &path, double seconds)
{
    auto it = decoders_.find(path);
    if (it == decoders_.end()) {
        auto d = std::make_shared<VideoDecoder>();
        if (!d->open(path))
            return {};
        // Keep a bounded number of open decoders.
        if (decoders_.size() >= 16) {
            decoders_.remove(decoderLru_.back());
            decoderLru_.pop_back();
        }
        it = decoders_.insert(path, d);
    }
    decoderLru_.remove(path);
    decoderLru_.push_front(path);
    return (*it)->frameAt(seconds);
}

void MediaCache::clear()
{
    stills_.clear();
    decoders_.clear();
    decoderLru_.clear();
}

} // namespace mf
