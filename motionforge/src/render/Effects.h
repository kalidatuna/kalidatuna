#pragma once
#include "core/Effect.h"

#include <QHash>
#include <QImage>
#include <QRectF>
#include <deque>
#include <functional>
#include <memory>
#include <vector>

namespace mf {

using ParamMap = QHash<QString, Value>;

class Layer;
class Composition;

struct EffectContext {
    double time = 0.0;
    double pixelScale = 1.0;   // image pixels per layer pixel
    QPointF origin;            // layer-space position of image pixel (0,0)
    QRectF layerRect;          // the layer's own bounds in layer space
    quint32 seed = 0;

    // For effects that need more than evaluated parameters (OpenFX plugins).
    const Effect *effect = nullptr;
    const Layer *layer = nullptr;
    const Composition *comp = nullptr;
    std::function<Value(const Property &, double time)> evalAt;
    // Renders this effect's input (the layer plus the effects before it) at another time, at the
    // same resolution. Returns the image and sets *origin to its layer-space position.
    std::function<QImage(double time, QPointF *origin)> inputAt;
    // An effect that grows the image to the left/top reports here how far (layer units)
    // the image's (0,0) moved, so the renderer can keep it in place.
    QPointF originShift;
    QString error;             // set by an effect that failed; the image is left unchanged

    QPointF toImage(QPointF layerPt) const { return (layerPt - origin) * pixelScale; }
};

struct EffectDef {
    QString id;
    QString name;
    QString category;
    std::function<std::vector<Property>(const QRectF &layerRect)> makeParams;
    // Extra transparent border (image pixels) the effect needs to draw outside the layer.
    std::function<int(const ParamMap &, double pixelScale, const QRectF &layerRect)> padding;
    std::function<void(QImage &, const ParamMap &, EffectContext &)> apply;
    bool external = false;     // provided by a plugin
    QString description;
};

class EffectRegistry {
public:
    static const std::deque<EffectDef> &all();   // deque: pointers stay valid as plugins register
    static const EffectDef *find(const QString &id);
    static void registerEffect(EffectDef def);
    static std::unique_ptr<Effect> create(const QString &id, int uid, const QRectF &layerRect);
    static QStringList categories();
};

// Installs the registry as the project's effect factory (needed for loading files).
void installEffectFactory();

// Shared image helpers (also used by the renderer).
void parallelFor(int n, const std::function<void(int begin, int end)> &fn);
void gaussianBlur(QImage &img, double sigmaX, double sigmaY, bool clampEdges = false);
QImage padImage(const QImage &img, int pad);

} // namespace mf
