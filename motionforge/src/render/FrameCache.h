#pragma once
#include <QHash>
#include <QImage>
#include <QSet>
#include <list>

namespace mf {

// LRU cache of rendered preview frames, bounded by memory.
class FrameCache {
public:
    explicit FrameCache(qint64 budgetBytes = 2LL * 1024 * 1024 * 1024) : budget_(budgetBytes) {}

    QImage get(int compId, int frame, double scale);
    void put(int compId, int frame, double scale, const QImage &img);
    bool contains(int compId, int frame, double scale) const;
    QSet<int> cachedFrames(int compId, double scale) const;
    void clear();
    void setBudget(qint64 bytes) { budget_ = bytes; trim(); }
    qint64 usedBytes() const { return used_; }

private:
    struct Key {
        int comp;
        int frame;
        int scaleKey;
        bool operator==(const Key &o) const { return comp == o.comp && frame == o.frame && scaleKey == o.scaleKey; }
    };
    friend size_t qHash(const Key &k, size_t seed) { return qHashMulti(seed, k.comp, k.frame, k.scaleKey); }
    static int scaleKey(double s) { return int(s * 1000 + 0.5); }
    void trim();

    struct Entry {
        QImage img;
        std::list<Key>::iterator lru;
    };
    QHash<Key, Entry> map_;
    std::list<Key> lru_;
    qint64 budget_;
    qint64 used_ = 0;
};

} // namespace mf
