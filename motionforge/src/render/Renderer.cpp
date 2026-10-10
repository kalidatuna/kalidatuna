#include "Renderer.h"

#include "expr/ExpressionEngine.h"
#include "media/MediaCache.h"

#include <QFontMetricsF>
#include <QPainter>
#include <cmath>
#include <optional>

namespace mf {

static constexpr int kMaxDepth = 16;
static constexpr double kTextBaseSize = 100.0;

static QPainter::CompositionMode painterMode(BlendMode m)
{
    switch (m) {
    case BlendMode::Normal: return QPainter::CompositionMode_SourceOver;
    case BlendMode::Add: return QPainter::CompositionMode_Plus;
    case BlendMode::Multiply: return QPainter::CompositionMode_Multiply;
    case BlendMode::Screen: return QPainter::CompositionMode_Screen;
    case BlendMode::Overlay: return QPainter::CompositionMode_Overlay;
    case BlendMode::Darken: return QPainter::CompositionMode_Darken;
    case BlendMode::Lighten: return QPainter::CompositionMode_Lighten;
    case BlendMode::ColorDodge: return QPainter::CompositionMode_ColorDodge;
    case BlendMode::ColorBurn: return QPainter::CompositionMode_ColorBurn;
    case BlendMode::HardLight: return QPainter::CompositionMode_HardLight;
    case BlendMode::SoftLight: return QPainter::CompositionMode_SoftLight;
    case BlendMode::Difference: return QPainter::CompositionMode_Difference;
    case BlendMode::Exclusion: return QPainter::CompositionMode_Exclusion;
    }
    return QPainter::CompositionMode_SourceOver;
}

static QImage blankBuffer(const Composition &comp, double scale)
{
    QImage img(std::max(1, int(std::ceil(comp.width * scale))), std::max(1, int(std::ceil(comp.height * scale))),
               QImage::Format_ARGB32_Premultiplied);
    img.fill(Qt::transparent);
    return img;
}

Value Renderer::eval(const Property &p, double t, const Layer &layer, const Composition &comp) const
{
    const Value pre = p.valueAt(t);
    if (!p.hasExpression())
        return pre;
    return ExpressionEngine::instance().evaluate(p, pre, t, &layer, &comp, comp.indexOf(layer.id));
}

QTransform Renderer::localTransform(const Layer &layer, const Composition &comp, double t) const
{
    const QPointF a = Property::toPoint(eval(layer.anchor, t, layer, comp));
    const QPointF p = Property::toPoint(eval(layer.position, t, layer, comp));
    const Value s = eval(layer.scale, t, layer, comp);
    const double r = eval(layer.rotation, t, layer, comp).value(0);
    QTransform m;
    m.translate(p.x(), p.y());
    m.rotate(r);
    m.scale(s.value(0) / 100.0, s.value(1) / 100.0);
    m.translate(-a.x(), -a.y());
    return m;
}

QTransform Renderer::layerToComp(const Layer &layer, const Composition &comp, double t) const
{
    QTransform m = localTransform(layer, comp, t);
    const Layer *parent = comp.parentOf(layer);
    for (int guard = 0; parent && guard < 64; ++guard) {
        m = m * localTransform(*parent, comp, t);
        parent = comp.parentOf(*parent);
    }
    return m;
}

double Renderer::sourceTime(const Layer &layer, const Composition &comp, double t) const
{
    if (layer.timeRemapEnabled)
        return eval(layer.timeRemap, t, layer, comp).value(0);
    return (t - layer.startTime) * 100.0 / (std::abs(layer.stretch) < 1e-6 ? 100.0 : layer.stretch);
}

QPainterPath Renderer::textPath(const Layer &layer, const Composition &comp, double t) const
{
    const double size = eval(layer.fontSize, t, layer, comp).value(0);
    const double track = eval(layer.tracking, t, layer, comp).value(0);
    const double lead = eval(layer.leading, t, layer, comp).value(0);
    QFont font(layer.fontFamily);
    font.setPixelSize(int(kTextBaseSize));
    font.setBold(layer.bold);
    font.setItalic(layer.italic);
    font.setLetterSpacing(QFont::AbsoluteSpacing, track / 1000.0 * kTextBaseSize);
    font.setStyleStrategy(QFont::PreferOutline);
    const QFontMetricsF fm(font);
    const double k = size / kTextBaseSize;
    const double lineStep = lead > 0 ? lead / k : kTextBaseSize * 1.2;
    QPainterPath path;
    const QStringList lines = layer.text.split('\n');
    for (int i = 0; i < lines.size(); ++i) {
        const double w = fm.horizontalAdvance(lines[i]);
        const double x = layer.align == 1 ? -w / 2.0 : layer.align == 2 ? -w : 0.0;
        path.addText(QPointF(x, i * lineStep), font, lines[i]);
    }
    return QTransform::fromScale(k, k).map(path);
}

QPainterPath Renderer::shapePath(const Layer &layer, const Composition &comp, double t) const
{
    const Value sz = eval(layer.shapeSize, t, layer, comp);
    const QPointF off = Property::toPoint(eval(layer.shapeOffset, t, layer, comp));
    const double w = std::max(0.0, sz.value(0)), h = std::max(0.0, sz.value(1));
    QPainterPath path;
    const QRectF r(off.x() - w / 2, off.y() - h / 2, w, h);
    switch (layer.shapeKind) {
    case ShapeKind::Rectangle: {
        const double rr = std::min(eval(layer.shapeRoundness, t, layer, comp).value(0), std::min(w, h) / 2);
        if (rr > 0)
            path.addRoundedRect(r, rr, rr);
        else
            path.addRect(r);
        break;
    }
    case ShapeKind::Ellipse:
        path.addEllipse(r);
        break;
    case ShapeKind::Polygon:
    case ShapeKind::Star: {
        const int n = std::max(3, int(std::round(eval(layer.shapePoints, t, layer, comp).value(0))));
        const bool star = layer.shapeKind == ShapeKind::Star;
        const double inner = eval(layer.shapeInnerRatio, t, layer, comp).value(0) / 100.0;
        const int count = star ? n * 2 : n;
        QPolygonF poly;
        for (int i = 0; i < count; ++i) {
            const double ang = -M_PI / 2 + i * 2 * M_PI / count;
            const double k = (star && (i & 1)) ? inner : 1.0;
            poly << QPointF(off.x() + std::cos(ang) * w / 2 * k, off.y() + std::sin(ang) * h / 2 * k);
        }
        path.addPolygon(poly);
        path.closeSubpath();
        break;
    }
    }
    return path;
}

QRectF Renderer::layerBounds(const Layer &layer, const Composition &comp, double t) const
{
    switch (layer.type) {
    case LayerType::Solid:
    case LayerType::Adjustment:
    case LayerType::Null:
        return QRectF(0, 0, layer.width, layer.height);
    case LayerType::Footage:
        if (auto *f = project_.footage(layer.sourceItemId))
            return QRectF(0, 0, f->width, f->height);
        return {};
    case LayerType::Precomp:
        if (auto *c = project_.comp(layer.sourceItemId))
            return QRectF(0, 0, c->width, c->height);
        return {};
    case LayerType::Text: {
        QRectF b = textPath(layer, comp, t).boundingRect();
        const double sw = eval(layer.strokeWidth, t, layer, comp).value(0);
        if (b.isEmpty())
            b = QRectF(0, -eval(layer.fontSize, t, layer, comp).value(0), 10, eval(layer.fontSize, t, layer, comp).value(0));
        return b.adjusted(-sw / 2, -sw / 2, sw / 2, sw / 2);
    }
    case LayerType::Shape: {
        const bool stroke = eval(layer.shapeStrokeOn, t, layer, comp).value(0) > 0.5;
        const double sw = stroke ? eval(layer.shapeStrokeWidth, t, layer, comp).value(0) : 0.0;
        return shapePath(layer, comp, t).boundingRect().adjusted(-sw / 2, -sw / 2, sw / 2, sw / 2);
    }
    }
    return {};
}

bool Renderer::isVectorSource(const Layer &layer) const
{
    return layer.type == LayerType::Text || layer.type == LayerType::Shape || layer.type == LayerType::Solid;
}

Renderer::Source Renderer::renderSource(const Layer &layer, const Composition &comp, double t, double factor, int depth)
{
    Source s;
    switch (layer.type) {
    case LayerType::Solid: {
        const int w = std::max(1, int(std::ceil(layer.width * factor)));
        const int h = std::max(1, int(std::ceil(layer.height * factor)));
        s.img = QImage(w, h, QImage::Format_ARGB32_Premultiplied);
        s.img.fill(layer.solidColor);
        s.fx = double(w) / layer.width;
        s.fy = double(h) / layer.height;
        return s;
    }
    case LayerType::Footage: {
        const FootageItem *f = project_.footage(layer.sourceItemId);
        if (!f)
            return s;
        QImage frame = f->isStill ? MediaCache::instance().still(f->path)
                                  : MediaCache::instance().videoFrame(f->path, sourceTime(layer, comp, t));
        if (frame.isNull())
            return s;
        if (factor < 0.95) {
            frame = frame.scaled(std::max(1, int(std::ceil(frame.width() * factor))),
                                 std::max(1, int(std::ceil(frame.height() * factor))), Qt::IgnoreAspectRatio,
                                 Qt::SmoothTransformation);
        }
        s.fx = double(frame.width()) / std::max(1, f->width);
        s.fy = double(frame.height()) / std::max(1, f->height);
        s.img = frame;
        return s;
    }
    case LayerType::Precomp: {
        const Composition *sub = project_.comp(layer.sourceItemId);
        if (!sub || depth >= kMaxDepth)
            return s;
        s.img = renderComp(*sub, sourceTime(layer, comp, t), factor, depth + 1);
        s.fx = double(s.img.width()) / sub->width;
        s.fy = double(s.img.height()) / sub->height;
        return s;
    }
    case LayerType::Text:
    case LayerType::Shape: {
        const bool text = layer.type == LayerType::Text;
        const QPainterPath path = text ? textPath(layer, comp, t) : shapePath(layer, comp, t);
        const QRectF b = layerBounds(layer, comp, t);
        if (b.isEmpty())
            return s;
        const int w = std::max(1, int(std::ceil(b.width() * factor)) + 2);
        const int h = std::max(1, int(std::ceil(b.height() * factor)) + 2);
        s.img = QImage(w, h, QImage::Format_ARGB32_Premultiplied);
        s.img.fill(Qt::transparent);
        s.fx = s.fy = factor;
        s.origin = b.topLeft() - QPointF(1.0 / factor, 1.0 / factor);
        QPainter p(&s.img);
        p.setRenderHint(QPainter::Antialiasing);
        p.scale(factor, factor);
        p.translate(-s.origin);
        const bool fillOn = text || eval(layer.shapeFillOn, t, layer, comp).value(0) > 0.5;
        const bool strokeOn = text ? eval(layer.strokeWidth, t, layer, comp).value(0) > 0
                                   : eval(layer.shapeStrokeOn, t, layer, comp).value(0) > 0.5;
        const QColor fillC = Property::toColor(eval(text ? layer.fillColor : layer.shapeFill, t, layer, comp));
        const QColor strokeC = Property::toColor(eval(text ? layer.strokeColor : layer.shapeStroke, t, layer, comp));
        const double sw = eval(text ? layer.strokeWidth : layer.shapeStrokeWidth, t, layer, comp).value(0);
        // Text draws stroke under fill (AE "Fill Over Stroke"); shapes draw stroke on top.
        auto drawStroke = [&] {
            if (strokeOn && sw > 0) {
                QPen pen(strokeC, sw);
                pen.setJoinStyle(Qt::RoundJoin);
                p.strokePath(path, pen);
            }
        };
        if (text)
            drawStroke();
        if (fillOn)
            p.fillPath(path, fillC);
        if (!text)
            drawStroke();
        return s;
    }
    case LayerType::Null:
    case LayerType::Adjustment:
        return s;
    }
    return s;
}

void Renderer::applyEffects(Source &src, const Layer &layer, const Composition &comp, double t) const
{
    const QRectF bounds = layerBounds(layer, comp, t);
    for (const auto &e : layer.effects) {
        if (!e->enabled || src.img.isNull())
            continue;
        const EffectDef *def = EffectRegistry::find(e->typeId);
        if (!def)
            continue;
        ParamMap m;
        for (const auto &p : e->params)
            m.insert(p.id, eval(p, t, layer, comp));
        const int pad = def->padding ? std::min(4000, def->padding(m, src.fx, bounds)) : 0;
        if (pad > 0) {
            src.img = padImage(src.img, pad);
            src.origin -= QPointF(pad / src.fx, pad / src.fy);
        }
        EffectContext ctx;
        ctx.time = t;
        ctx.pixelScale = src.fx;
        ctx.origin = src.origin;
        ctx.layerRect = bounds;
        ctx.seed = hashSeed(e->typeId, layer.id * 131 + e->uid);
        def->apply(src.img, m, ctx);
    }
}

void Renderer::drawLayerSample(QImage &buf, const Layer &layer, const Composition &comp, double t, double scale,
                               int depth)
{
    const QTransform toBuf = layerToComp(layer, comp, t) * QTransform::fromScale(scale, scale);
    const double worldScale = std::max(std::hypot(toBuf.m11(), toBuf.m12()), std::hypot(toBuf.m21(), toBuf.m22()));
    const double maxFactor = isVectorSource(layer) ? 8.0 : 1.0;
    const double factor = std::clamp(worldScale, 0.02, maxFactor);
    Source src = renderSource(layer, comp, t, factor, depth);
    if (src.img.isNull())
        return;
    applyEffects(src, layer, comp, t);
    const QTransform imgToLayer = QTransform::fromScale(1.0 / src.fx, 1.0 / src.fy) *
                                  QTransform::fromTranslate(src.origin.x(), src.origin.y());
    QPainter p(&buf);
    p.setRenderHint(QPainter::SmoothPixmapTransform);
    p.setRenderHint(QPainter::Antialiasing);
    p.setTransform(imgToLayer * toBuf);
    p.drawImage(0, 0, src.img);
}

QImage Renderer::layerBuffer(const Layer &layer, const Composition &comp, double t, double scale, int depth)
{
    QImage buf = blankBuffer(comp, scale);
    std::vector<double> times{t};
    if (comp.motionBlurEnabled && layer.motionBlur && comp.motionBlurSamples > 1) {
        const double fd = comp.frameDuration();
        const int n = std::clamp(comp.motionBlurSamples, 2, 64);
        const double start = t + comp.shutterPhase / 360.0 * fd;
        const double span = comp.shutterAngle / 360.0 * fd;
        std::vector<double> sampleTimes;
        bool moving = false;
        const QTransform ref = layerToComp(layer, comp, start);
        for (int i = 0; i < n; ++i) {
            const double st = start + span * i / (n - 1);
            sampleTimes.push_back(st);
            if (!qFuzzyCompare(layerToComp(layer, comp, st), ref))
                moving = true;
        }
        // Nested comps and remapped footage can move internally, so always sample those.
        if (moving || layer.type == LayerType::Precomp)
            times = sampleTimes;
    }
    if (times.size() == 1) {
        drawLayerSample(buf, layer, comp, t, scale, depth);
        return buf;
    }
    const int px = buf.width() * buf.height();
    std::vector<quint32> acc(size_t(px) * 4, 0);
    QImage sample = blankBuffer(comp, scale);
    for (double st : times) {
        sample.fill(Qt::transparent);
        drawLayerSample(sample, layer, comp, st, scale, depth);
        const uchar *s = sample.constBits();
        parallelFor(px, [&](int b, int e) {
            for (int i = b * 4; i < e * 4; ++i)
                acc[size_t(i)] += s[i];
        });
    }
    uchar *d = buf.bits();
    const quint32 n = quint32(times.size());
    parallelFor(px, [&](int b, int e) {
        for (int i = b * 4; i < e * 4; ++i)
            d[i] = uchar((acc[size_t(i)] + n / 2) / n);
    });
    return buf;
}

void Renderer::applyMatte(QImage &buf, const QImage &matte, MatteMode mode, double matteOpacity)
{
    const int w = buf.width();
    const bool luma = mode == MatteMode::Luma || mode == MatteMode::LumaInverted;
    const bool invert = mode == MatteMode::AlphaInverted || mode == MatteMode::LumaInverted;
    parallelFor(buf.height(), [&](int y0, int y1) {
        for (int y = y0; y < y1; ++y) {
            QRgb *d = reinterpret_cast<QRgb *>(buf.scanLine(y));
            const QRgb *m = reinterpret_cast<const QRgb *>(matte.constScanLine(y));
            for (int x = 0; x < w; ++x) {
                double k = luma ? (0.299 * qRed(m[x]) + 0.587 * qGreen(m[x]) + 0.114 * qBlue(m[x])) / 255.0
                                : qAlpha(m[x]) / 255.0;
                k *= matteOpacity;
                if (invert)
                    k = 1.0 - k;
                if (k >= 1.0)
                    continue;
                d[x] = qRgba(int(qRed(d[x]) * k + 0.5), int(qGreen(d[x]) * k + 0.5), int(qBlue(d[x]) * k + 0.5),
                             int(qAlpha(d[x]) * k + 0.5));
            }
        }
    });
}

void Renderer::applyAdjustment(QImage &accum, const Layer &layer, const Composition &comp, double t, double scale,
                               const QImage *matte, MatteMode matteMode, double matteOpacity)
{
    if (layer.effects.empty())
        return;
    // Coverage of the adjustment layer's own rectangle in the composition.
    QImage cover = blankBuffer(comp, scale);
    {
        QPainter p(&cover);
        p.setRenderHint(QPainter::Antialiasing);
        p.setTransform(layerToComp(layer, comp, t) * QTransform::fromScale(scale, scale));
        p.fillRect(QRectF(0, 0, layer.width, layer.height), Qt::white);
    }
    if (matte)
        applyMatte(cover, *matte, matteMode, matteOpacity);

    Source src;
    src.img = accum.copy();
    src.fx = src.fy = scale;
    // Effects on adjustment layers work in composition space and never grow the frame.
    const QRectF bounds(0, 0, comp.width, comp.height);
    for (const auto &e : layer.effects) {
        if (!e->enabled)
            continue;
        const EffectDef *def = EffectRegistry::find(e->typeId);
        if (!def)
            continue;
        ParamMap m;
        for (const auto &p : e->params)
            m.insert(p.id, eval(p, t, layer, comp));
        EffectContext ctx;
        ctx.time = t;
        ctx.pixelScale = scale;
        ctx.layerRect = bounds;
        ctx.seed = hashSeed(e->typeId, layer.id * 131 + e->uid);
        def->apply(src.img, m, ctx);
    }
    const double op = eval(layer.opacity, t, layer, comp).value(0) / 100.0;
    const int w = accum.width();
    parallelFor(accum.height(), [&](int y0, int y1) {
        for (int y = y0; y < y1; ++y) {
            QRgb *a = reinterpret_cast<QRgb *>(accum.scanLine(y));
            const QRgb *e = reinterpret_cast<const QRgb *>(src.img.constScanLine(y));
            const QRgb *c = reinterpret_cast<const QRgb *>(cover.constScanLine(y));
            for (int x = 0; x < w; ++x) {
                const double k = qAlpha(c[x]) / 255.0 * op;
                if (k <= 0)
                    continue;
                auto mix = [&](int from, int to) { return int(from + (to - from) * k + 0.5); };
                a[x] = qRgba(mix(qRed(a[x]), qRed(e[x])), mix(qGreen(a[x]), qGreen(e[x])),
                             mix(qBlue(a[x]), qBlue(e[x])), mix(qAlpha(a[x]), qAlpha(e[x])));
            }
        }
    });
}

QImage Renderer::renderComp(const Composition &comp, double t, double scale, int depth)
{
    QImage accum = blankBuffer(comp, scale);
    const auto &layers = comp.layers;
    const int n = int(layers.size());
    bool anySolo = false;
    for (const auto &l : layers)
        anySolo |= l->solo && l->videoOn;

    for (int i = n - 1; i >= 0; --i) {
        const Layer &L = *layers[i];
        if (!L.activeAt(t))
            continue;
        // A layer directly above a matted layer is consumed as its matte.
        if (i + 1 < n && layers[i + 1]->matte != MatteMode::None)
            continue;
        if (!L.videoOn || (anySolo && !L.solo) || L.type == LayerType::Null)
            continue;

        std::optional<QImage> matte;
        double matteOpacity = 1.0;
        if (L.matte != MatteMode::None && i > 0) {
            const Layer &M = *layers[i - 1];
            if (M.activeAt(t)) {
                matte = layerBuffer(M, comp, t, scale, depth);
                matteOpacity = eval(M.opacity, t, M, comp).value(0) / 100.0;
            } else {
                matte = blankBuffer(comp, scale);
            }
        }

        if (L.type == LayerType::Adjustment) {
            applyAdjustment(accum, L, comp, t, scale, matte ? &*matte : nullptr, L.matte, matteOpacity);
            continue;
        }
        const double opacity = eval(L.opacity, t, L, comp).value(0) / 100.0;
        if (opacity <= 0.0)
            continue;
        QImage buf = layerBuffer(L, comp, t, scale, depth);
        if (matte)
            applyMatte(buf, *matte, L.matte, matteOpacity);
        QPainter p(&accum);
        p.setCompositionMode(painterMode(L.blend));
        p.setOpacity(opacity);
        p.drawImage(0, 0, buf);
    }
    return accum;
}

QImage Renderer::render(const Composition &comp, double t, double scale)
{
    return renderComp(comp, t, scale, 0);
}

QImage Renderer::renderFlattened(const Composition &comp, double t, double scale)
{
    QImage out = blankBuffer(comp, scale);
    out.fill(comp.background);
    QPainter p(&out);
    p.drawImage(0, 0, render(comp, t, scale));
    return out;
}

} // namespace mf
