#pragma once
#include "core/Effect.h"

#include <QHash>
#include <QImage>
#include <QRectF>
#include <functional>
#include <memory>
#include <vector>

namespace mf {

using ParamMap = QHash<QString, Value>;

struct EffectContext {
    double time = 0.0;
    double pixelScale = 1.0;   // image pixels per layer pixel
    QPointF origin;            // layer-space position of image pixel (0,0)
    QRectF layerRect;          // the layer's own bounds in layer space
    quint32 seed = 0;

    QPointF toImage(QPointF layerPt) const { return (layerPt - origin) * pixelScale; }
};

struct EffectDef {
    QString id;
    QString name;
    QString category;
    std::function<std::vector<Property>(const QRectF &layerRect)> makeParams;
    // Extra transparent border (image pixels) the effect needs to draw outside the layer.
    std::function<int(const ParamMap &, double pixelScale, const QRectF &layerRect)> padding;
    std::function<void(QImage &, const ParamMap &, const EffectContext &)> apply;
};

class EffectRegistry {
public:
    static const std::vector<EffectDef> &all();
    static const EffectDef *find(const QString &id);
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
