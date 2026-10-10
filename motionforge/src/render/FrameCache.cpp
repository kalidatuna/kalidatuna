#include "FrameCache.h"

namespace mf {

QImage FrameCache::get(int compId, int frame, double scale)
{
    auto it = map_.find({compId, frame, scaleKey(scale)});
    if (it == map_.end())
        return {};
    lru_.splice(lru_.begin(), lru_, it->lru);
    return it->img;
}

bool FrameCache::contains(int compId, int frame, double scale) const
{
    return map_.contains({compId, frame, scaleKey(scale)});
}

void FrameCache::put(int compId, int frame, double scale, const QImage &img)
{
    const Key k{compId, frame, scaleKey(scale)};
    auto it = map_.find(k);
    if (it != map_.end()) {
        used_ -= it->img.sizeInBytes();
        lru_.erase(it->lru);
        map_.erase(it);
    }
    lru_.push_front(k);
    map_.insert(k, {img, lru_.begin()});
    used_ += img.sizeInBytes();
    trim();
}

QSet<int> FrameCache::cachedFrames(int compId, double scale) const
{
    QSet<int> r;
    const int sk = scaleKey(scale);
    for (auto it = map_.begin(); it != map_.end(); ++it)
        if (it.key().comp == compId && it.key().scaleKey == sk)
            r.insert(it.key().frame);
    return r;
}

void FrameCache::clear()
{
    map_.clear();
    lru_.clear();
    used_ = 0;
}

void FrameCache::trim()
{
    while (used_ > budget_ && !lru_.empty()) {
        auto it = map_.find(lru_.back());
        used_ -= it->img.sizeInBytes();
        map_.erase(it);
        lru_.pop_back();
    }
}

} // namespace mf
