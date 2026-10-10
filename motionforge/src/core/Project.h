#pragma once
#include "Layer.h"

#include <QColor>
#include <QJsonObject>
#include <QString>
#include <cmath>
#include <functional>
#include <memory>
#include <vector>

namespace mf {

enum class ItemType { Composition, Footage, Folder };

class Item {
public:
    virtual ~Item() = default;
    int id = 0;
    int folderId = 0;
    QString name;
    virtual ItemType itemType() const = 0;
};

class FolderItem : public Item {
public:
    ItemType itemType() const override { return ItemType::Folder; }
    bool expanded = true;
};

class FootageItem : public Item {
public:
    ItemType itemType() const override { return ItemType::Footage; }
    QString path;
    bool isStill = false;
    int width = 0;
    int height = 0;
    double fps = 30.0;
    double duration = 0.0;   // seconds (0 for stills)
    bool hasVideo = true;
    bool hasAudio = false;
};

class Composition : public Item {
public:
    ItemType itemType() const override { return ItemType::Composition; }
    int width = 1920;
    int height = 1080;
    double fps = 30.0;
    double duration = 10.0;
    QColor background = QColor(0, 0, 0);
    double workStart = 0.0;
    double workEnd = 10.0;
    bool motionBlurEnabled = true;   // the composition's master motion blur switch
    int motionBlurSamples = 12;
    double shutterAngle = 180.0;
    double shutterPhase = -90.0;
    bool hideShyLayers = false;
    std::vector<std::unique_ptr<Layer>> layers;   // index 0 is the top layer

    struct Marker {
        double time = 0.0;
        QString comment;
        bool selected = false;   // editor state only
    };
    std::vector<Marker> markers;   // sorted by time
    void addMarker(double t, const QString &comment = {});
    void sortMarkers();

    double frameDuration() const { return 1.0 / fps; }
    int frameCount() const { return int(duration * fps + 0.5); }
    int frameAt(double t) const { return int(std::floor(t * fps + 1e-6)); }
    double timeOfFrame(int f) const { return f / fps; }
    double snap(double t) const { return timeOfFrame(int(std::round(t * fps))); }
    Layer *layerById(int id) const;
    int indexOf(int layerId) const;
    Layer *parentOf(const Layer &l) const { return l.parentId ? layerById(l.parentId) : nullptr; }
};

// Owns all items. Plain data: the editor (ui/Editor) wraps it with signals and undo.
class Project {
public:
    Project();
    std::vector<std::unique_ptr<Item>> items;
    QString filePath;
    int nextId = 1;
    int bitsPerChannel = 8;

    int newId() { return nextId++; }
    Item *item(int id) const;
    Composition *comp(int id) const;
    FootageItem *footage(int id) const;
    std::vector<Composition *> compositions() const;

    Composition *addComposition(const QString &name, int w, int h, double fps, double duration);
    std::unique_ptr<Layer> makeLayer(LayerType type, const Composition &comp);
    QString uniqueLayerName(const Composition &comp, const QString &base) const;
    void removeItem(int id);
    bool compContains(const Composition &outer, int innerCompId) const;   // cycle check for precomps

    QJsonObject toJson() const;
    bool fromJson(const QJsonObject &o, QString *error = nullptr);
    void clear();

    // Hooks installed by the render module so core stays independent of it.
    static std::function<std::unique_ptr<Effect>(const QString &)> effectFactory;
};

QJsonObject layerListToJson(const std::vector<Layer *> &layers);

} // namespace mf
