#pragma once
#include "Effects.h"
#include "core/Project.h"

#include <QImage>
#include <QPainterPath>
#include <QTransform>

namespace mf {

// CPU compositor. Produces premultiplied ARGB frames with a transparent background
// (viewers and exporters put the composition background underneath).
class Renderer {
public:
    explicit Renderer(const Project &project) : project_(project) {}

    // scale: 1.0 = full resolution, 0.5 = half, etc.
    QImage render(const Composition &comp, double t, double scale = 1.0);
    // Renders and flattens onto the composition background color.
    QImage renderFlattened(const Composition &comp, double t, double scale = 1.0);

    Value eval(const Property &p, double t, const Layer &layer, const Composition &comp) const;
    QTransform localTransform(const Layer &layer, const Composition &comp, double t) const;
    QTransform layerToComp(const Layer &layer, const Composition &comp, double t) const;
    QRectF layerBounds(const Layer &layer, const Composition &comp, double t) const;
    double sourceTime(const Layer &layer, const Composition &comp, double t) const;

    QPainterPath textPath(const Layer &layer, const Composition &comp, double t) const;
    QPainterPath shapePath(const Layer &layer, const Composition &comp, double t) const;

private:
    struct Source {
        QImage img;
        QPointF origin;      // layer-space position of image pixel (0,0)
        double fx = 1.0;     // image pixels per layer pixel
        double fy = 1.0;
    };

    QImage renderComp(const Composition &comp, double t, double scale, int depth);
    Source renderSource(const Layer &layer, const Composition &comp, double t, double factor, int depth);
    void applyEffects(Source &src, const Layer &layer, const Composition &comp, double t, int depth,
                      size_t upTo = SIZE_MAX);
    QImage layerBuffer(const Layer &layer, const Composition &comp, double t, double scale, int depth);
    void drawLayerSample(QImage &buf, const Layer &layer, const Composition &comp, double t, double scale, int depth);
    void applyAdjustment(QImage &accum, const Layer &layer, const Composition &comp, double t, double scale,
                         const QImage *matte, MatteMode matteMode, double matteOpacity);
    static void applyMatte(QImage &buf, const QImage &matte, MatteMode mode, double matteOpacity);
    bool isVectorSource(const Layer &layer) const;

    const Project &project_;

public:
    // Last error reported by an effect (e.g. a plugin failing to render).
    mutable QString lastEffectError;
};

} // namespace mf
