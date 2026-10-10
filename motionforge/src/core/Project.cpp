#include "Project.h"

#include <QJsonArray>
#include <algorithm>
#include <cmath>

namespace mf {

std::function<std::unique_ptr<Effect>(const QString &)> Project::effectFactory;

Layer *Composition::layerById(int lid) const
{
    for (const auto &l : layers)
        if (l->id == lid)
            return l.get();
    return nullptr;
}

int Composition::indexOf(int lid) const
{
    for (size_t i = 0; i < layers.size(); ++i)
        if (layers[i]->id == lid)
            return int(i);
    return -1;
}

void Composition::addMarker(double t, const QString &comment)
{
    for (auto &m : markers)
        if (std::abs(m.time - t) < 1e-6)
            return;
    markers.push_back({t, comment, false});
    sortMarkers();
}

void Composition::sortMarkers()
{
    std::stable_sort(markers.begin(), markers.end(), [](const Marker &a, const Marker &b) { return a.time < b.time; });
}

Project::Project() = default;

Item *Project::item(int iid) const
{
    for (const auto &i : items)
        if (i->id == iid)
            return i.get();
    return nullptr;
}

Composition *Project::comp(int iid) const
{
    return dynamic_cast<Composition *>(item(iid));
}

FootageItem *Project::footage(int iid) const
{
    return dynamic_cast<FootageItem *>(item(iid));
}

std::vector<Composition *> Project::compositions() const
{
    std::vector<Composition *> r;
    for (const auto &i : items)
        if (auto c = dynamic_cast<Composition *>(i.get()))
            r.push_back(c);
    return r;
}

Composition *Project::addComposition(const QString &name, int w, int h, double fps, double duration)
{
    auto c = std::make_unique<Composition>();
    c->id = newId();
    c->name = name;
    c->width = w;
    c->height = h;
    c->fps = fps;
    c->duration = duration;
    c->workStart = 0;
    c->workEnd = duration;
    auto *raw = c.get();
    items.push_back(std::move(c));
    return raw;
}

QString Project::uniqueLayerName(const Composition &comp, const QString &base) const
{
    auto taken = [&](const QString &n) {
        for (const auto &l : comp.layers)
            if (l->name == n)
                return true;
        return false;
    };
    if (!taken(base))
        return base;
    for (int i = 2;; ++i) {
        QString n = QString("%1 %2").arg(base).arg(i);
        if (!taken(n))
            return n;
    }
}

std::unique_ptr<Layer> Project::makeLayer(LayerType type, const Composition &comp)
{
    auto l = std::make_unique<Layer>(type);
    l->id = newId();
    l->inPoint = 0;
    l->outPoint = comp.duration;
    l->width = comp.width;
    l->height = comp.height;
    l->position.defaultValue = l->position.staticValue = {comp.width / 2.0, comp.height / 2.0};
    switch (type) {
    case LayerType::Solid:
    case LayerType::Adjustment:
        l->setDefaultAnchor(comp.width, comp.height);
        break;
    case LayerType::Null:
        l->width = l->height = 100;
        l->setDefaultAnchor(100, 100);
        break;
    default:
        break;
    }
    return l;
}

void Project::removeItem(int iid)
{
    // Remove layers that reference the item, then the item itself.
    for (auto *c : compositions()) {
        auto &ls = c->layers;
        ls.erase(std::remove_if(ls.begin(), ls.end(), [&](const auto &l) {
                     return (l->type == LayerType::Footage || l->type == LayerType::Precomp) && l->sourceItemId == iid;
                 }),
                 ls.end());
    }
    for (auto &i : items)
        if (i->folderId == iid)
            i->folderId = 0;
    items.erase(std::remove_if(items.begin(), items.end(), [&](const auto &i) { return i->id == iid; }), items.end());
}

bool Project::compContains(const Composition &outer, int innerCompId) const
{
    if (outer.id == innerCompId)
        return true;
    for (const auto &l : outer.layers)
        if (l->type == LayerType::Precomp)
            if (auto *c = comp(l->sourceItemId))
                if (compContains(*c, innerCompId))
                    return true;
    return false;
}

QJsonObject Project::toJson() const
{
    QJsonObject o;
    o["format"] = "motionforge-project";
    o["version"] = 1;
    o["nextId"] = nextId;
    o["bpc"] = bitsPerChannel;
    QJsonArray arr;
    for (const auto &i : items) {
        QJsonObject io;
        io["id"] = i->id;
        io["name"] = i->name;
        io["folder"] = i->folderId;
        if (auto *f = dynamic_cast<FolderItem *>(i.get())) {
            io["kind"] = "folder";
            io["expanded"] = f->expanded;
        } else if (auto *f = dynamic_cast<FootageItem *>(i.get())) {
            io["kind"] = "footage";
            io["path"] = f->path;
            io["still"] = f->isStill;
            io["width"] = f->width;
            io["height"] = f->height;
            io["fps"] = f->fps;
            io["duration"] = f->duration;
            io["audio"] = f->hasAudio;
            io["video"] = f->hasVideo;
        } else if (auto *c = dynamic_cast<Composition *>(i.get())) {
            io["kind"] = "comp";
            io["width"] = c->width;
            io["height"] = c->height;
            io["fps"] = c->fps;
            io["duration"] = c->duration;
            io["bg"] = c->background.name();
            io["workStart"] = c->workStart;
            io["workEnd"] = c->workEnd;
            io["mb"] = c->motionBlurEnabled;
            io["mbSamples"] = c->motionBlurSamples;
            io["shutterAngle"] = c->shutterAngle;
            io["shutterPhase"] = c->shutterPhase;
            io["hideShy"] = c->hideShyLayers;
            if (!c->markers.empty()) {
                QJsonArray ms;
                for (const auto &m : c->markers) {
                    QJsonObject mo;
                    mo["t"] = m.time;
                    if (!m.comment.isEmpty())
                        mo["comment"] = m.comment;
                    ms.append(mo);
                }
                io["markers"] = ms;
            }
            QJsonArray ls;
            for (const auto &l : c->layers)
                ls.append(l->toJson());
            io["layers"] = ls;
        }
        arr.append(io);
    }
    o["items"] = arr;
    return o;
}

bool Project::fromJson(const QJsonObject &o, QString *error)
{
    if (o["format"].toString() != "motionforge-project") {
        if (error)
            *error = "Not a MotionForge project file.";
        return false;
    }
    clear();
    nextId = o["nextId"].toInt(1);
    bitsPerChannel = o["bpc"].toInt(8);
    for (const auto &iv : o["items"].toArray()) {
        const auto io = iv.toObject();
        const QString kind = io["kind"].toString();
        std::unique_ptr<Item> item;
        if (kind == "folder") {
            auto f = std::make_unique<FolderItem>();
            f->expanded = io["expanded"].toBool(true);
            item = std::move(f);
        } else if (kind == "footage") {
            auto f = std::make_unique<FootageItem>();
            f->path = io["path"].toString();
            f->isStill = io["still"].toBool();
            f->width = io["width"].toInt();
            f->height = io["height"].toInt();
            f->fps = io["fps"].toDouble(30);
            f->duration = io["duration"].toDouble();
            f->hasAudio = io["audio"].toBool();
            f->hasVideo = io["video"].toBool(true);
            item = std::move(f);
        } else if (kind == "comp") {
            auto c = std::make_unique<Composition>();
            c->width = io["width"].toInt(1920);
            c->height = io["height"].toInt(1080);
            c->fps = io["fps"].toDouble(30);
            c->duration = io["duration"].toDouble(10);
            c->background = QColor(io["bg"].toString("#000000"));
            c->workStart = io["workStart"].toDouble();
            c->workEnd = io["workEnd"].toDouble(c->duration);
            c->motionBlurEnabled = io["mb"].toBool(true);
            c->motionBlurSamples = io["mbSamples"].toInt(12);
            c->shutterAngle = io["shutterAngle"].toDouble(180);
            c->shutterPhase = io["shutterPhase"].toDouble(-90);
            c->hideShyLayers = io["hideShy"].toBool();
            for (const auto &mv : io["markers"].toArray())
                c->markers.push_back({mv.toObject()["t"].toDouble(), mv.toObject()["comment"].toString(), false});
            c->sortMarkers();
            for (const auto &lv : io["layers"].toArray())
                c->layers.push_back(Layer::fromJson(lv.toObject(), effectFactory));
            item = std::move(c);
        } else {
            continue;
        }
        item->id = io["id"].toInt();
        item->name = io["name"].toString();
        item->folderId = io["folder"].toInt();
        nextId = std::max(nextId, item->id + 1);
        items.push_back(std::move(item));
    }
    // Make sure ids handed out later never collide with saved layers or effects.
    for (auto *c : compositions())
        for (const auto &l : c->layers) {
            nextId = std::max(nextId, l->id + 1);
            for (const auto &e : l->effects)
                nextId = std::max(nextId, e->uid + 1);
        }
    return true;
}

void Project::clear()
{
    items.clear();
    nextId = 1;
}

QJsonObject layerListToJson(const std::vector<Layer *> &layers)
{
    QJsonArray arr;
    for (auto *l : layers)
        arr.append(l->toJson());
    QJsonObject o;
    o["format"] = "motionforge-layers";
    o["layers"] = arr;
    return o;
}

} // namespace mf
