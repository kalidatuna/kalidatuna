#include "TimelinePanel.h"

#include "CompViewer.h"
#include "Dialogs.h"
#include "Icons.h"
#include "ScrubField.h"
#include "Theme.h"
#include "media/MediaCache.h"

#include <QColorDialog>
#include <QContextMenuEvent>
#include <QHBoxLayout>
#include <QInputDialog>
#include <QLabel>
#include <QLineEdit>
#include <QMenu>
#include <QMimeData>
#include <QMouseEvent>
#include <QPainter>
#include <QPainterPath>
#include <QScrollBar>
#include <QSlider>
#include <QToolButton>
#include <QVBoxLayout>
#include <cmath>

namespace mf {

static constexpr int kHeaderH = 36;
static constexpr int kLayerH = 22;
static constexpr int kPropH = 20;
static constexpr int kIndent = 14;
static constexpr int xEye = 0, xAudio = 20, xSolo = 40, xLock = 60, xLabel = 80, xIndex = 96, xName = 120;

namespace {
struct Cols {
    int sw, mode, matte, parent, end;
};
Cols columns(int nameW)
{
    Cols c;
    c.sw = xName + nameW;
    c.mode = c.sw + 44;
    c.matte = c.mode + 84;
    c.parent = c.matte + 84;
    c.end = c.parent + 116;
    return c;
}
QString shortMatte(MatteMode m)
{
    switch (m) {
    case MatteMode::None: return "None";
    case MatteMode::Alpha: return "Alpha";
    case MatteMode::AlphaInverted: return "Alpha Inv";
    case MatteMode::Luma: return "Luma";
    case MatteMode::LumaInverted: return "Luma Inv";
    }
    return {};
}
} // namespace

TimelineView::TimelineView(Editor *editor, QWidget *parent) : QWidget(parent), ed_(editor)
{
    setMouseTracking(true);
    setAcceptDrops(true);
    setFocusPolicy(Qt::ClickFocus);
    setMinimumHeight(120);
    connect(ed_, &Editor::projectChanged, this, &TimelineView::rebuild);
    connect(ed_, &Editor::activeCompChanged, this, [this] {
        fitPending_ = true;
        scrollY_ = 0;
        rebuild();
    });
    connect(ed_, &Editor::selectionChanged, this, qOverload<>(&QWidget::update));
    connect(ed_, &Editor::valuesChanged, this, qOverload<>(&QWidget::update));
    connect(ed_, &Editor::timeChanged, this, [this](double t) {
        // Keep the CTI visible while playing or stepping.
        const int x = timeX(t);
        if (x > width() - 10 || x < areaLeft())
            setViewStart(t - visibleDuration() * 0.1);
        update();
    });
    rebuild();
}

int TimelineView::leftWidth() const
{
    return columns(nameW_).end;
}

double TimelineView::visibleDuration() const
{
    return std::max(1.0, double(width() - areaLeft())) / pxPerSec_;
}

int TimelineView::timeX(double t) const
{
    return areaLeft() + int(std::round((t - viewStart_) * pxPerSec_));
}

double TimelineView::xTime(double x) const
{
    return viewStart_ + (x - areaLeft()) / pxPerSec_;
}

double TimelineView::snapTime(double t) const
{
    Composition *c = ed_->activeComp();
    return c ? c->snap(t) : t;
}

void TimelineView::setViewStart(double s)
{
    Composition *c = ed_->activeComp();
    const double maxStart = c ? std::max(0.0, c->duration - visibleDuration() * 0.5) : 0.0;
    viewStart_ = std::clamp(s, 0.0, maxStart);
    emit viewChanged();
    update();
}

void TimelineView::fitTime()
{
    Composition *c = ed_->activeComp();
    if (!c || width() - areaLeft() < 50)
        return;
    pxPerSec_ = (width() - areaLeft() - 16.0) / c->duration;
    viewStart_ = 0;
    fitPending_ = false;
    emit viewChanged();
    update();
}

void TimelineView::zoomTime(double factor, std::optional<double> aroundX)
{
    Composition *c = ed_->activeComp();
    if (!c)
        return;
    const double anchorX = aroundX.value_or(timeX(ed_->time()));
    const double anchorT = xTime(anchorX);
    const double minPx = (width() - areaLeft() - 16.0) / c->duration;
    pxPerSec_ = std::clamp(pxPerSec_ * factor, std::max(1.0, minPx * 0.9), c->fps * 60.0);
    viewStart_ = anchorT - (anchorX - areaLeft()) / pxPerSec_;
    setViewStart(viewStart_);
}

void TimelineView::resizeEvent(QResizeEvent *)
{
    if (fitPending_)
        fitTime();
}

void TimelineView::rebuild()
{
    if (renameEdit_) {
        renameEdit_->deleteLater();
        renameEdit_ = nullptr;
    }
    rows_.clear();
    Composition *c = ed_->activeComp();
    int y = 0;
    auto add = [&](Row r) {
        r.y = y;
        r.h = r.kind == Kind::Layer ? kLayerH : kPropH;
        y += r.h;
        rows_.push_back(r);
    };
    auto addProp = [&](Layer *l, Property *p, int depth) {
        add({Kind::Prop, l, p, nullptr, p->name, depth});
        if (!p->expression.isEmpty())
            add({Kind::Expr, l, p, nullptr, "Expression: " + p->name, depth + 1});
    };
    if (c) {
        for (const auto &lp : c->layers) {
            Layer *l = lp.get();
            if (c->hideShyLayers && l->shy)
                continue;
            if (!filter_.isEmpty() && !l->name.contains(filter_, Qt::CaseInsensitive))
                continue;
            add({Kind::Layer, l, nullptr, nullptr, l->name, 0});
            const QSet<QString> reveal = ed_->revealed(l->id);
            if (!reveal.isEmpty()) {
                for (auto &g : l->propertyGroups())
                    for (Property *p : g.props)
                        if (reveal.contains(p->id))
                            addProp(l, p, 1);
                if (reveal.contains("effects") && !l->effects.empty()) {
                    for (auto &e : l->effects) {
                        add({Kind::Effect, l, nullptr, e.get(), e->name, 1});
                        if (e->expanded)
                            for (auto &p : e->params)
                                if (!p.hidden)
                                    addProp(l, &p, 2);
                    }
                }
                for (auto &e : l->effects)
                    for (auto &p : e->params)
                        if (reveal.contains(Editor::keyFor(*l, &p)))
                            addProp(l, &p, 1);
                continue;
            }
            if (!l->expanded)
                continue;
            for (auto &g : l->propertyGroups()) {
                if (g.name == "Transform" || g.name == "Audio")
                    continue;
                if (g.name == "Time Remap") {
                    addProp(l, g.props.front(), 1);
                    continue;
                }
                add({Kind::Group, l, nullptr, nullptr, g.name, 1, 0, 0, 1});
                if (l->contentsExpanded)
                    for (Property *p : g.props)
                        addProp(l, p, 2);
            }
            if (!l->effects.empty()) {
                add({Kind::Group, l, nullptr, nullptr, "Effects", 1, 0, 0, 3});
                if (l->effectsExpanded)
                    for (auto &e : l->effects) {
                        add({Kind::Effect, l, nullptr, e.get(), e->name, 2});
                        if (e->expanded)
                            for (auto &p : e->params)
                                if (!p.hidden)
                                    addProp(l, &p, 3);
                    }
            }
            for (auto &g : l->propertyGroups()) {
                if (g.name != "Transform" && g.name != "Audio")
                    continue;
                const bool transform = g.name == "Transform";
                add({Kind::Group, l, nullptr, nullptr, g.name, 1, 0, 0, transform ? 2 : 4});
                if (transform ? l->transformExpanded : l->audioExpanded)
                    for (Property *p : g.props)
                        addProp(l, p, 2);
            }
        }
    }
    contentHeight_ = y;
    emit contentHeightChanged(y);
    update();
}

int TimelineView::rowAt(int y) const
{
    const int cy = y - kHeaderH + scrollY_;
    for (int i = 0; i < int(rows_.size()); ++i)
        if (cy >= rows_[i].y && cy < rows_[i].y + rows_[i].h)
            return i;
    return -1;
}

Value TimelineView::currentValue(const Row &r) const
{
    Composition *c = ed_->activeComp();
    return ed_->renderer().eval(*r.prop, ed_->time(), *r.layer, *c);
}

QString TimelineView::valueText(const Property &p, const Value &v, int dim) const
{
    const double d = v.value(dim);
    switch (p.type) {
    case PropType::Percent: return QString::number(d, 'f', 1) + (dim == p.dims() - 1 ? "%" : "");
    case PropType::Angle: return formatAngle(d);
    case PropType::Checkbox: return d > 0.5 ? "On" : "Off";
    case PropType::Choice: return p.choices.value(int(d));
    case PropType::Time: {
        Composition *c = ed_->activeComp();
        return timecode(d, c ? c->fps : 30);
    }
    case PropType::Color: return {};
    case PropType::String: return p.text.isEmpty() ? QString("(empty)") : p.text.left(60);
    default: return QString::number(d, 'f', std::abs(p.dragStep) < 0.1 ? 2 : 1);
    }
}

std::vector<TimelineView::ValueHit> TimelineView::valueRects(const Row &r, const Value &v) const
{
    std::vector<ValueHit> out;
    const Cols cols = columns(nameW_);
    const QFontMetrics fm = fontMetrics();
    const int top = kHeaderH + r.y - scrollY_;
    double x = cols.sw + 6;
    const int dims = (r.prop->type == PropType::Color || r.prop->type == PropType::Angle ||
                      r.prop->type == PropType::Checkbox || r.prop->type == PropType::Choice ||
                      r.prop->type == PropType::String)
                         ? 1
                         : r.prop->dims();
    for (int d = 0; d < dims; ++d) {
        if (r.prop->type == PropType::Color) {
            out.push_back({QRectF(x, top + 4, 30, r.h - 8), 0});
            break;
        }
        const QString t = valueText(*r.prop, v, d);
        const int w = fm.horizontalAdvance(t);
        out.push_back({QRectF(x, top, w, r.h), d});
        x += w + fm.horizontalAdvance(",  ");
    }
    return out;
}

// ------------------------------------------------------------ painting

void TimelineView::paintKeyframe(QPainter &p, QPointF c, const Keyframe &k, bool atTime)
{
    const double s = 5.0;
    const QColor fill = k.selected ? theme::keyframeSelected : (atTime ? QColor(0xe8, 0xe8, 0xe8) : theme::keyframe);
    auto half = [&](Interp in, bool left) {
        QPainterPath path;
        const double dir = left ? -1 : 1;
        if (in == Interp::Hold) {
            path.addRect(left ? QRectF(c.x() - s, c.y() - s, s, 2 * s) : QRectF(c.x(), c.y() - s, s, 2 * s));
        } else if (in == Interp::Bezier) {
            path.moveTo(c.x(), c.y() - s);
            path.cubicTo(c.x() + dir * s * 1.2, c.y() - s, c.x() + dir * s * 1.2, c.y() + s, c.x(), c.y() + s);
            path.closeSubpath();
        } else {
            path.moveTo(c.x(), c.y() - s);
            path.lineTo(c.x() + dir * s, c.y());
            path.lineTo(c.x(), c.y() + s);
            path.closeSubpath();
        }
        p.drawPath(path);
    };
    p.setPen(QPen(QColor(0x10, 0x10, 0x10), 1));
    p.setBrush(fill);
    half(k.inInterp, true);
    half(k.outInterp, false);
}

void TimelineView::paintHeader(QPainter &p)
{
    Composition *c = ed_->activeComp();
    const Cols cols = columns(nameW_);
    p.fillRect(0, 0, width(), kHeaderH, QColor(0x20, 0x20, 0x20));
    p.setPen(theme::textDim);
    const int ty = kHeaderH - 18;
    auto ic = [&](const char *name, int x) { icon(name, theme::textDim).paint(&p, QRect(x + 3, ty + 2, 14, 14)); };
    ic("eye", xEye);
    ic("audio", xAudio);
    ic("solo", xSolo);
    ic("lock", xLock);
    p.drawText(QRect(xIndex, ty, 24, 18), Qt::AlignCenter, "#");
    p.drawText(QRect(xName + 18, ty, nameW_ - 18, 18), Qt::AlignVCenter | Qt::AlignLeft, "Layer Name");
    ic("shy", cols.sw);
    ic("motionblur", cols.sw + 20);
    p.drawText(QRect(cols.mode + 4, ty, 80, 18), Qt::AlignVCenter, "Mode");
    p.drawText(QRect(cols.matte + 4, ty, 80, 18), Qt::AlignVCenter, "TrkMat");
    p.drawText(QRect(cols.parent + 4, ty, 110, 18), Qt::AlignVCenter, "Parent & Link");
    if (!c)
        return;

    // Ruler
    const int L = areaLeft();
    p.save();
    p.setClipRect(L, 0, width() - L, kHeaderH);
    p.fillRect(L, 0, width() - L, kHeaderH, QColor(0x1b, 0x1b, 0x1b));
    // work area
    const int wa0 = timeX(c->workStart), wa1 = timeX(c->workEnd);
    p.fillRect(QRect(wa0, 2, wa1 - wa0, 9), theme::workArea);
    p.fillRect(QRect(wa0, 2, 3, 9), QColor(0x8f, 0xb2, 0xe0));
    p.fillRect(QRect(wa1 - 3, 2, 3, 9), QColor(0x8f, 0xb2, 0xe0));
    // cache bar
    const QSet<int> cached = ed_->cache().cachedFrames(c->id, 1.0) + ed_->cache().cachedFrames(c->id, 0.5) +
                             ed_->cache().cachedFrames(c->id, 1.0 / 3.0) + ed_->cache().cachedFrames(c->id, 0.25);
    p.setPen(Qt::NoPen);
    for (int f : cached) {
        const int x0 = timeX(c->timeOfFrame(f)), x1 = timeX(c->timeOfFrame(f + 1));
        p.fillRect(QRect(x0, 12, std::max(1, x1 - x0), 3), theme::cacheBar);
    }
    // ticks
    const double fd = c->frameDuration();
    static const double secSteps[] = {1, 2, 5, 10, 15, 30, 60, 120, 300};
    double step = fd;
    for (int fs : {1, 2, 5, 10})
        if (fd * fs * pxPerSec_ >= 60) {
            step = fd * fs;
            break;
        } else {
            step = -1;
        }
    if (step < 0)
        for (double s : secSteps)
            if (s * pxPerSec_ >= 60) {
                step = s;
                break;
            }
    if (step < 0)
        step = 600;
    p.setPen(theme::textDim);
    const double tStart = std::floor(viewStart_ / step) * step;
    for (double t = tStart; t < viewStart_ + visibleDuration() + step; t += step) {
        if (t < -1e-9 || t > c->duration + 1e-9)
            continue;
        const int x = timeX(t);
        p.drawLine(x, kHeaderH - 8, x, kHeaderH);
        const int sec = int(std::floor(t + 1e-6));
        const int fr = int(std::round((t - sec) * c->fps));
        const QString label = fr == 0 ? QString("%1s").arg(sec, 2, 10, QChar('0'))
                                      : QString("%1:%2f").arg(sec, 2, 10, QChar('0')).arg(fr, 2, 10, QChar('0'));
        p.drawText(QRect(x - 40, 13, 80, 12), Qt::AlignCenter, label);
        // minor ticks
        for (int i = 1; i < 5; ++i) {
            const int mx = timeX(t + step * i / 5.0);
            p.drawLine(mx, kHeaderH - 4, mx, kHeaderH);
        }
    }
    // composition markers
    for (const auto &m : c->markers) {
        const int mx = timeX(m.time);
        QPainterPath mk;
        mk.moveTo(mx - 4, 25);
        mk.lineTo(mx + 4, 25);
        mk.lineTo(mx + 4, 31);
        mk.lineTo(mx, 35);
        mk.lineTo(mx - 4, 31);
        mk.closeSubpath();
        p.setPen(QPen(QColor(0x10, 0x10, 0x10), 1));
        p.setBrush(m.selected ? theme::keyframeSelected : QColor(0x8a, 0xc7, 0xa6));
        p.drawPath(mk);
        if (!m.comment.isEmpty()) {
            p.setPen(QColor(0xd0, 0xd0, 0xd0));
            p.drawText(QRect(mx + 6, 24, 120, 12), Qt::AlignLeft | Qt::AlignVCenter, m.comment);
        }
    }
    // comp end shading
    const int endX = timeX(c->duration);
    if (endX < width())
        p.fillRect(QRect(endX, 0, width() - endX, kHeaderH), QColor(0x14, 0x14, 0x14));
    // CTI head
    const int cx = timeX(ed_->time());
    QPainterPath head;
    head.moveTo(cx - 6, kHeaderH - 14);
    head.lineTo(cx + 6, kHeaderH - 14);
    head.lineTo(cx + 6, kHeaderH - 6);
    head.lineTo(cx, kHeaderH);
    head.lineTo(cx - 6, kHeaderH - 6);
    head.closeSubpath();
    p.setPen(Qt::NoPen);
    p.setBrush(theme::cti);
    p.drawPath(head);
    p.restore();
    p.setPen(theme::border);
    p.drawLine(0, kHeaderH - 1, width(), kHeaderH - 1);
}

void TimelineView::paintRow(QPainter &p, const Row &r, int idx)
{
    Composition *c = ed_->activeComp();
    const Cols cols = columns(nameW_);
    const int top = kHeaderH + r.y - scrollY_;
    const QRect rowRect(0, top, width(), r.h);
    const bool sel = ed_->isSelected(r.layer->id);
    const int L = areaLeft();
    const double t = ed_->time();

    if (r.kind == Kind::Layer) {
        Layer *l = r.layer;
        p.fillRect(QRect(0, top, L, r.h), sel ? theme::rowSelected : theme::row);
        p.fillRect(QRect(L, top, width() - L, r.h), sel ? QColor(0x2c, 0x2c, 0x2c) : QColor(0x21, 0x21, 0x21));
        auto ic = [&](const char *name, int x, bool on) {
            if (on)
                icon(name).paint(&p, QRect(x + 3, top + 4, 14, 14));
        };
        ic("eye", xEye, l->videoOn && !l->audioOnly);
        ic("audio", xAudio, l->hasAudio && l->audioOn);
        ic("solo", xSolo, l->solo);
        ic("lock", xLock, l->locked);
        p.fillRect(QRect(xLabel + 3, top + 6, 10, 10), labelColor(l->label));
        p.setPen(theme::textDim);
        p.drawText(QRect(xIndex, top, 24, r.h), Qt::AlignCenter, QString::number(c->indexOf(l->id) + 1));
        // twirl
        const bool open = l->expanded || !ed_->revealed(l->id).isEmpty();
        QPainterPath tri;
        const QPointF tc(xName + 8, top + r.h / 2.0);
        if (open) {
            tri.moveTo(tc + QPointF(-4, -2));
            tri.lineTo(tc + QPointF(4, -2));
            tri.lineTo(tc + QPointF(0, 3));
        } else {
            tri.moveTo(tc + QPointF(-2, -4));
            tri.lineTo(tc + QPointF(3, 0));
            tri.lineTo(tc + QPointF(-2, 4));
        }
        tri.closeSubpath();
        p.setPen(Qt::NoPen);
        p.setBrush(theme::textDim);
        p.drawPath(tri);
        QString typeIcon = l->type == LayerType::Text      ? "text"
                           : l->type == LayerType::Shape   ? "star"
                           : l->type == LayerType::Precomp ? "comp"
                           : l->type == LayerType::Footage ? "footage"
                           : l->type == LayerType::Adjustment ? "adjust"
                                                           : "rect";
        icon(typeIcon, theme::textDim).paint(&p, QRect(xName + 16, top + 4, 14, 14));
        p.setPen(sel ? Qt::white : theme::text);
        p.drawText(QRect(xName + 34, top, nameW_ - 36, r.h), Qt::AlignVCenter | Qt::AlignLeft,
                   fontMetrics().elidedText(l->name, Qt::ElideRight, nameW_ - 36));
        ic("shy", cols.sw, l->shy);
        if (l->hasVisual())
            ic("motionblur", cols.sw + 20, l->motionBlur);
        p.setPen(theme::text);
        if (l->hasVisual() && l->type != LayerType::Adjustment)
            p.drawText(QRect(cols.mode + 4, top, 80, r.h), Qt::AlignVCenter, blendModeName(l->blend));
        if (l->hasVisual() && idx >= 0 && c->indexOf(l->id) > 0)
            p.drawText(QRect(cols.matte + 4, top, 80, r.h), Qt::AlignVCenter, shortMatte(l->matte));
        Layer *parent = c->parentOf(*l);
        p.drawText(QRect(cols.parent + 4, top, 112, r.h), Qt::AlignVCenter,
                   parent ? QString("%1. %2").arg(c->indexOf(parent->id) + 1).arg(parent->name) : "None");
        // Duration bar
        p.save();
        p.setClipRect(L, top, width() - L, r.h);
        const int x0 = timeX(l->inPoint), x1 = timeX(l->outPoint);
        QColor bar = labelColor(l->label);
        bar.setAlpha(sel ? 200 : 120);
        p.fillRect(QRect(x0, top + 3, x1 - x0, r.h - 6), bar);
        p.setPen(QColor(0, 0, 0, 120));
        p.setBrush(Qt::NoBrush);
        p.drawRect(QRect(x0, top + 3, x1 - x0 - 1, r.h - 7));
        if (l->hasAudio)
            paintWaveform(p, *l, top + 3, r.h - 6);
        if (sel) {
            p.fillRect(QRect(x0, top + 3, 3, r.h - 6), QColor(255, 255, 255, 120));
            p.fillRect(QRect(x1 - 3, top + 3, 3, r.h - 6), QColor(255, 255, 255, 120));
        }
        p.restore();
    } else {
        p.fillRect(QRect(0, top, L, r.h), QColor(0x22, 0x22, 0x22));
        p.fillRect(QRect(L, top, width() - L, r.h), QColor(0x1e, 0x1e, 0x1e));
        const int x = xName + r.depth * kIndent;
        if (r.kind == Kind::Group || r.kind == Kind::Effect) {
            bool open = false;
            if (r.kind == Kind::Effect)
                open = r.effect->expanded;
            else
                open = r.groupId == 1 ? r.layer->contentsExpanded
                       : r.groupId == 2 ? r.layer->transformExpanded
                       : r.groupId == 4 ? r.layer->audioExpanded
                                        : r.layer->effectsExpanded;
            QPainterPath tri;
            const QPointF tc(x - 6, top + r.h / 2.0);
            if (open) {
                tri.moveTo(tc + QPointF(-4, -2));
                tri.lineTo(tc + QPointF(4, -2));
                tri.lineTo(tc + QPointF(0, 3));
            } else {
                tri.moveTo(tc + QPointF(-2, -4));
                tri.lineTo(tc + QPointF(3, 0));
                tri.lineTo(tc + QPointF(-2, 4));
            }
            tri.closeSubpath();
            p.setPen(Qt::NoPen);
            p.setBrush(theme::textDim);
            p.drawPath(tri);
            if (r.kind == Kind::Effect) {
                icon("fx", r.effect->enabled ? theme::text : QColor(0x55, 0x55, 0x55))
                    .paint(&p, QRect(xEye + 3, top + 3, 14, 14));
                p.setPen(r.effect->enabled ? theme::text : theme::textDim);
            } else {
                p.setPen(theme::text);
            }
            p.drawText(QRect(x + 2, top, cols.sw - x, r.h), Qt::AlignVCenter, r.title);
            if (r.kind == Kind::Effect || r.groupId == 2) {
                p.setPen(theme::value);
                p.drawText(QRect(cols.sw + 6, top, 60, r.h), Qt::AlignVCenter, "Reset");
            }
        } else if (r.kind == Kind::Prop) {
            Property *pr = r.prop;
            const bool animated = pr->isAnimated();
            icon(animated ? "stopwatch-on" : "stopwatch", animated ? theme::value : theme::textDim)
                .paint(&p, QRect(x - 14, top + 3, 14, 14));
            const bool propSel = ed_->selectedProperty() == PropRef{r.layer->id, Editor::keyFor(*r.layer, pr)};
            p.setPen(propSel ? Qt::white : theme::text);
            p.drawText(QRect(x + 4, top, cols.sw - x - 4, r.h), Qt::AlignVCenter, r.title);
            if (!pr->expressionError.isEmpty()) {
                p.setPen(QColor(0xe0, 0x50, 0x50));
                p.drawText(QRect(cols.sw - 14, top, 12, r.h), Qt::AlignCenter, "!");
            }
            // Keyframe navigator
            if (animated) {
                p.setPen(theme::text);
                p.drawText(QRect(xEye, top, 18, r.h), Qt::AlignCenter, "◀");
                p.drawText(QRect(xSolo, top, 18, r.h), Qt::AlignCenter, "▶");
                const bool onKey = pr->keyIndexAt(t, 1e-4) >= 0;
                QPainterPath d;
                const QPointF dc(xAudio + 10, top + r.h / 2.0);
                d.moveTo(dc + QPointF(0, -5));
                d.lineTo(dc + QPointF(5, 0));
                d.lineTo(dc + QPointF(0, 5));
                d.lineTo(dc + QPointF(-5, 0));
                d.closeSubpath();
                p.setBrush(onKey ? theme::value : Qt::NoBrush);
                p.setPen(QPen(theme::text, 1));
                p.drawPath(d);
            }
            const Value v = currentValue(r);
            const bool fromExpr = pr->hasExpression();
            for (const ValueHit &vh : valueRects(r, v)) {
                if (pr->type == PropType::Color) {
                    p.fillRect(vh.rect, Property::toColor(v));
                    p.setPen(QColor(0x60, 0x60, 0x60));
                    p.setBrush(Qt::NoBrush);
                    p.drawRect(vh.rect);
                    continue;
                }
                p.setPen(fromExpr ? QColor(0xe0, 0x50, 0x50) : theme::value);
                p.drawText(vh.rect, Qt::AlignVCenter | Qt::AlignLeft, valueText(*pr, v, vh.dim));
                if (vh.dim < pr->dims() - 1 && pr->type != PropType::Angle) {
                    p.setPen(theme::textDim);
                    p.drawText(QRectF(vh.rect.right(), vh.rect.top(), 10, vh.rect.height()), Qt::AlignVCenter, ",");
                }
            }
            // Keyframes
            p.save();
            p.setClipRect(L, top, width() - L, r.h);
            for (const Keyframe &k : pr->keys)
                paintKeyframe(p, QPointF(timeX(k.time), top + r.h / 2.0), k, std::abs(k.time - t) < 1e-4);
            p.restore();
        } else if (r.kind == Kind::Expr) {
            p.setPen(QColor(0x9a, 0xd0, 0x8a));
            p.drawText(QRect(x - 14, top, 14, r.h), Qt::AlignCenter, "=");
            p.setPen(theme::textDim);
            p.drawText(QRect(x + 4, top, cols.sw - x - 4, r.h), Qt::AlignVCenter, "Expression");
            QFont mono("Monospace");
            mono.setStyleHint(QFont::Monospace);
            mono.setPointSizeF(font().pointSizeF());
            p.save();
            p.setFont(mono);
            p.setPen(r.prop->expressionEnabled ? QColor(0xd8, 0xc8, 0x8a) : theme::textDim);
            const QString exprLine = r.prop->expression.simplified();
            p.drawText(QRect(L + 6, top, width() - L - 12, r.h), Qt::AlignVCenter,
                       QFontMetrics(mono).elidedText(exprLine, Qt::ElideRight, width() - L - 12));
            if (!r.prop->expressionError.isEmpty()) {
                p.setPen(QColor(0xe0, 0x50, 0x50));
                p.drawText(QRect(cols.sw + 6, top, cols.end - cols.sw - 8, r.h), Qt::AlignVCenter,
                           QFontMetrics(mono).elidedText(r.prop->expressionError, Qt::ElideRight, cols.end - cols.sw - 8));
            }
            p.restore();
        }
    }
    p.setPen(QColor(0x18, 0x18, 0x18));
    p.drawLine(0, top + r.h - 1, width(), top + r.h - 1);
    Q_UNUSED(rowRect);
}

void TimelineView::paintEvent(QPaintEvent *)
{
    QPainter p(this);
    p.fillRect(rect(), QColor(0x1a, 0x1a, 0x1a));
    Composition *c = ed_->activeComp();
    if (fitPending_ && c)
        fitTime();
    p.save();
    p.setClipRect(0, kHeaderH, width(), height() - kHeaderH);
    for (int i = 0; i < int(rows_.size()); ++i) {
        const Row &r = rows_[i];
        const int top = kHeaderH + r.y - scrollY_;
        if (top + r.h < kHeaderH || top > height())
            continue;
        paintRow(p, r, i);
    }
    if (c) {
        // Outside comp duration
        const int endX = timeX(c->duration);
        if (endX < width())
            p.fillRect(QRect(endX, kHeaderH, width() - endX, height()), QColor(0, 0, 0, 90));
        // Work area shading outside
        const int wa0 = timeX(c->workStart), wa1 = timeX(c->workEnd);
        p.fillRect(QRect(areaLeft(), kHeaderH, std::max(0, wa0 - areaLeft()), height()), QColor(0, 0, 0, 40));
        if (wa1 < endX)
            p.fillRect(QRect(wa1, kHeaderH, endX - wa1, height()), QColor(0, 0, 0, 40));
        // Marker guide lines help line cuts up with the beat.
        p.setPen(QPen(QColor(0x8a, 0xc7, 0xa6, 70), 1, Qt::DashLine));
        for (const auto &m : c->markers) {
            const int mx = timeX(m.time);
            if (mx >= areaLeft())
                p.drawLine(mx, kHeaderH, mx, height());
        }
        // CTI line
        const int cx = timeX(ed_->time());
        if (cx >= areaLeft()) {
            p.setPen(QPen(theme::cti, 1));
            p.drawLine(cx, kHeaderH, cx, height());
        }
    }
    if (drag_ == Drag::Marquee) {
        p.setPen(QPen(QColor(200, 200, 200), 1, Qt::DashLine));
        p.setBrush(QColor(255, 255, 255, 20));
        p.drawRect(marquee_);
    }
    if (drag_ == Drag::Reorder && reorderTarget_ >= 0) {
        int y = kHeaderH - scrollY_;
        int layerIdx = 0;
        for (const Row &r : rows_)
            if (r.kind == Kind::Layer) {
                if (layerIdx == reorderTarget_) {
                    y = kHeaderH + r.y - scrollY_;
                    break;
                }
                ++layerIdx;
                y = kHeaderH + r.y + r.h - scrollY_;
            }
        p.fillRect(QRect(0, y - 1, width(), 3), theme::accent);
    }
    p.restore();
    paintHeader(p);
    // divider
    p.fillRect(QRect(leftWidth(), 0, 1, height()), QColor(0x0e, 0x0e, 0x0e));
    if (!c) {
        p.setPen(theme::textDim);
        p.drawText(rect().adjusted(0, kHeaderH, 0, 0), Qt::AlignCenter, "No composition open");
    }
}

// ------------------------------------------------------------ interaction

void TimelineView::setTimeFromX(double x)
{
    ed_->setTime(xTime(x));
}

int TimelineView::keyAt(const Row &r, QPointF pos) const
{
    if (r.kind != Kind::Prop)
        return -1;
    for (int i = r.prop->keys.size() - 1; i >= 0; --i)
        if (std::abs(timeX(r.prop->keys[i].time) - pos.x()) <= 6)
            return i;
    return -1;
}

void TimelineView::mousePressEvent(QMouseEvent *e)
{
    Composition *c = ed_->activeComp();
    if (!c || e->button() != Qt::LeftButton)
        return;
    pressPos_ = e->position();
    moved_ = false;
    const QPointF pos = e->position();
    const int L = areaLeft();
    const bool shift = e->modifiers() & Qt::ShiftModifier;
    const bool ctrl = e->modifiers() & Qt::ControlModifier;
    const Cols cols = columns(nameW_);

    if (std::abs(pos.x() - leftWidth()) <= 3) {
        drag_ = Drag::Divider;
        dragT0_ = nameW_;
        return;
    }
    if (pos.y() < kHeaderH) {
        if (pos.x() < L)
            return;
        if (const int mi = markerAt(pos); mi >= 0) {
            if (ctrl) {
                ed_->removeMarker(mi);
                return;
            }
            for (auto &m : c->markers)
                m.selected = false;
            c->markers[mi].selected = true;
            drag_ = Drag::Marker;
            dragMarker_ = mi;
            dragT0_ = c->markers[mi].time;
            update();
            return;
        }
        const int wa0 = timeX(c->workStart), wa1 = timeX(c->workEnd);
        if (pos.y() < 12) {
            if (std::abs(pos.x() - wa0) < 6)
                drag_ = Drag::WorkStart;
            else if (std::abs(pos.x() - wa1) < 6)
                drag_ = Drag::WorkEnd;
            else if (pos.x() > wa0 && pos.x() < wa1) {
                drag_ = Drag::WorkBar;
                dragT0_ = xTime(pos.x());
                layerStarts_ = {{0, c->workStart, c->workEnd, 0}};
            } else {
                drag_ = Drag::Cti;
                setTimeFromX(pos.x());
            }
            return;
        }
        drag_ = Drag::Cti;
        setTimeFromX(pos.x());
        return;
    }

    const int ri = rowAt(int(pos.y()));
    if (ri < 0) {
        if (pos.x() >= L) {
            if (!shift)
                ed_->deselectAllKeys();
            drag_ = Drag::Marquee;
            marquee_ = QRectF(pos, QSizeF());
        } else {
            ed_->clearSelection();
        }
        update();
        return;
    }
    Row &r = rows_[ri];
    dragRow_ = ri;
    Layer *l = r.layer;
    const int top = kHeaderH + r.y - scrollY_;

    if (pos.x() < L) {
        // ---------------- left pane
        if (r.kind == Kind::Layer) {
            if (pos.x() < xAudio) {
                if (!l->audioOnly) {
                    l->videoOn = !l->videoOn;
                    ed_->commit("Toggle Video", false);
                }
            } else if (pos.x() < xSolo) {
                if (l->hasAudio) {
                    l->audioOn = !l->audioOn;
                    ed_->commit("Toggle Audio", false);
                }
            } else if (pos.x() < xLock) {
                l->solo = !l->solo;
                ed_->commit("Toggle Solo", false);
            } else if (pos.x() < xLabel) {
                l->locked = !l->locked;
                ed_->commit("Toggle Lock", false);
            } else if (pos.x() < xIndex) {
                showLabelMenu(l, e->globalPosition().toPoint());
            } else if (pos.x() >= xName && pos.x() < xName + 16) {
                if (!ed_->revealed(l->id).isEmpty())
                    ed_->clearReveal(l->id);
                else {
                    l->expanded = !l->expanded;
                    rebuild();
                }
            } else if (pos.x() < cols.sw) {
                if (ctrl)
                    ed_->selectLayer(l->id, false, true);
                else if (shift && !ed_->selectedLayerIds().isEmpty()) {
                    // range select by index
                    const int a = c->indexOf(ed_->selectedLayerIds().last()), b = c->indexOf(l->id);
                    QList<int> ids = ed_->selectedLayerIds();
                    for (int i = std::min(a, b); i <= std::max(a, b); ++i)
                        if (!ids.contains(c->layers[i]->id))
                            ids << c->layers[i]->id;
                    ed_->setSelection(ids);
                } else if (!ed_->isSelected(l->id)) {
                    ed_->selectLayer(l->id);
                }
                drag_ = Drag::Reorder;
                reorderTarget_ = -1;
            } else if (pos.x() < cols.sw + 20) {
                l->shy = !l->shy;
                ed_->commit("Toggle Shy", true);
            } else if (pos.x() < cols.mode) {
                if (l->hasVisual()) {
                    l->motionBlur = !l->motionBlur;
                    ed_->commit("Toggle Motion Blur", false);
                }
            } else if (pos.x() < cols.matte) {
                if (l->hasVisual() && l->type != LayerType::Adjustment)
                    showModeMenu(l, e->globalPosition().toPoint());
            } else if (pos.x() < cols.parent) {
                if (c->indexOf(l->id) > 0 && l->hasVisual())
                    showMatteMenu(l, e->globalPosition().toPoint());
            } else {
                showParentMenu(l, e->globalPosition().toPoint());
            }
            return;
        }
        const int x = xName + r.depth * kIndent;
        if (r.kind == Kind::Group || r.kind == Kind::Effect) {
            if (r.kind == Kind::Effect && pos.x() < xSolo) {
                r.effect->enabled = !r.effect->enabled;
                ed_->commit("Toggle Effect", false);
                return;
            }
            if (pos.x() >= cols.sw && pos.x() < cols.sw + 60 && (r.kind == Kind::Effect || r.groupId == 2)) {
                if (r.kind == Kind::Effect) {
                    for (auto &p : r.effect->params)
                        p.reset();
                    ed_->commit("Reset Effect", true);
                } else {
                    ed_->resetTransform(*l);
                }
                return;
            }
            if (r.kind == Kind::Effect)
                r.effect->expanded = !r.effect->expanded;
            else if (r.groupId == 1)
                l->contentsExpanded = !l->contentsExpanded;
            else if (r.groupId == 2)
                l->transformExpanded = !l->transformExpanded;
            else if (r.groupId == 4)
                l->audioExpanded = !l->audioExpanded;
            else
                l->effectsExpanded = !l->effectsExpanded;
            if (!ed_->isSelected(l->id))
                ed_->selectLayer(l->id);
            rebuild();
            return;
        }
        if (r.kind == Kind::Prop) {
            Property *pr = r.prop;
            if (pr->isAnimated() && pos.x() < xLock) {
                if (pos.x() < xAudio) {
                    for (int i = pr->keys.size() - 1; i >= 0; --i)
                        if (pr->keys[i].time < ed_->time() - 1e-6) {
                            ed_->setTime(pr->keys[i].time);
                            break;
                        }
                } else if (pos.x() < xSolo) {
                    const int k = pr->keyIndexAt(ed_->time(), 1e-4);
                    if (k >= 0) {
                        pr->keys.remove(k);
                        if (pr->keys.isEmpty())
                            pr->staticValue = currentValue(r);
                        ed_->commit("Remove Keyframe", true);
                    } else {
                        ed_->setKeyAtCurrentTime(*pr, *l);
                    }
                } else {
                    for (const auto &k : pr->keys)
                        if (k.time > ed_->time() + 1e-6) {
                            ed_->setTime(k.time);
                            break;
                        }
                }
                return;
            }
            if (pos.x() >= x - 14 && pos.x() < x + 2 && pr->animatable) {
                if (e->modifiers() & Qt::AltModifier)
                    showExpressionEditor(this, ed_, {l->id, Editor::keyFor(*l, pr)});
                else
                    ed_->toggleStopwatch(*pr, *l);
                return;
            }
            const Value v = currentValue(r);
            for (const ValueHit &vh : valueRects(r, v)) {
                if (vh.rect.adjusted(-2, 0, 2, 0).contains(pos)) {
                    if (pr->type == PropType::Color || pr->type == PropType::Checkbox || pr->type == PropType::Choice ||
                        pr->type == PropType::String) {
                        editValue(r, vh.dim, vh.rect);
                        return;
                    }
                    drag_ = Drag::Scrub;
                    dragDim_ = vh.dim;
                    scrubStart_ = pr->valueAt(ed_->time());
                    return;
                }
            }
            if (pos.x() < cols.sw) {
                // Clicking a property name selects it and all its keyframes (like AE).
                if (!ed_->isSelected(l->id))
                    ed_->selectLayer(l->id);
                if (!shift)
                    ed_->deselectAllKeys();
                for (auto &k : pr->keys)
                    k.selected = true;
                ed_->setSelectedProperty({l->id, Editor::keyFor(*l, pr)});
                update();
            }
            return;
        }
        Q_UNUSED(top);
        return;
    }

    // ---------------- right pane
    if (r.kind == Kind::Layer) {
        const int x0 = timeX(l->inPoint), x1 = timeX(l->outPoint);
        if (!ed_->isSelected(l->id) || ctrl)
            ed_->selectLayer(l->id, shift, ctrl);
        if (l->locked)
            return;
        layerStarts_.clear();
        for (Layer *s : ed_->selectedLayers())
            layerStarts_.push_back({s->id, s->inPoint, s->outPoint, s->startTime});
        dragT0_ = xTime(pos.x());
        if (std::abs(pos.x() - x0) <= 4)
            drag_ = Drag::LayerTrimIn;
        else if (std::abs(pos.x() - x1) <= 4)
            drag_ = Drag::LayerTrimOut;
        else if (pos.x() > x0 && pos.x() < x1)
            drag_ = Drag::LayerMove;
        else
            drag_ = Drag::None;
        keyStarts_.clear();
        if (drag_ == Drag::LayerMove)
            for (Layer *s : ed_->selectedLayers())
                s->forEachProperty([&](Property &p) {
                    for (int i = 0; i < p.keys.size(); ++i)
                        keyStarts_.push_back({&p, i, p.keys[i].time});
                });
        return;
    }
    if (r.kind == Kind::Prop) {
        const int k = keyAt(r, pos);
        if (k >= 0) {
            Keyframe &kf = r.prop->keys[k];
            if (shift || ctrl) {
                kf.selected = !kf.selected;
            } else if (!kf.selected) {
                ed_->deselectAllKeys();
                kf.selected = true;
            }
            if (!ed_->isSelected(l->id))
                ed_->selectLayer(l->id, true);
            ed_->setSelectedProperty({l->id, Editor::keyFor(*l, r.prop)});
            drag_ = Drag::Keys;
            dragT0_ = xTime(pos.x());
            keyStarts_.clear();
            ed_->forEachSelectedKey([&](Layer &, Property &p, Keyframe &key) {
                keyStarts_.push_back({&p, int(&key - p.keys.data()), key.time});
            });
            update();
            return;
        }
    }
    if (!shift)
        ed_->deselectAllKeys();
    drag_ = Drag::Marquee;
    marquee_ = QRectF(pos, QSizeF());
    update();
}

void TimelineView::mouseMoveEvent(QMouseEvent *e)
{
    Composition *c = ed_->activeComp();
    const QPointF pos = e->position();
    if (drag_ == Drag::None) {
        // Hover cursors
        Qt::CursorShape cur = Qt::ArrowCursor;
        if (std::abs(pos.x() - leftWidth()) <= 3)
            cur = Qt::SplitHCursor;
        else if (c && pos.y() >= kHeaderH && pos.x() > areaLeft()) {
            const int ri = rowAt(int(pos.y()));
            if (ri >= 0 && rows_[ri].kind == Kind::Layer) {
                const Layer *l = rows_[ri].layer;
                if (std::abs(pos.x() - timeX(l->inPoint)) <= 4 || std::abs(pos.x() - timeX(l->outPoint)) <= 4)
                    cur = Qt::SizeHorCursor;
            }
        } else if (c && pos.y() >= kHeaderH) {
            const int ri = rowAt(int(pos.y()));
            if (ri >= 0 && rows_[ri].kind == Kind::Prop) {
                const Value v = currentValue(rows_[ri]);
                for (const ValueHit &vh : valueRects(rows_[ri], v))
                    if (vh.rect.contains(pos))
                        cur = rows_[ri].prop->type == PropType::Color || rows_[ri].prop->type == PropType::Checkbox ||
                                      rows_[ri].prop->type == PropType::Choice
                                  ? Qt::PointingHandCursor
                                  : Qt::SizeHorCursor;
            }
        }
        setCursor(cur);
        return;
    }
    if (!c)
        return;
    if (!moved_ && QLineF(pos, pressPos_).length() >= 3)
        moved_ = true;
    const double t = xTime(pos.x());
    switch (drag_) {
    case Drag::Divider:
        nameW_ = std::clamp(int(dragT0_ + pos.x() - pressPos_.x()), 120, 500);
        emit viewChanged();
        update();
        break;
    case Drag::Cti:
        if (e->modifiers() & Qt::ShiftModifier) {
            // Snap the CTI to markers and keyframes of selected layers.
            std::vector<double> targets;
            for (const auto &m : c->markers)
                targets.push_back(m.time);
            for (Layer *sl : ed_->selectedLayers()) {
                auto kt = ed_->keyTimesForLayer(*sl);
                targets.insert(targets.end(), kt.begin(), kt.end());
                targets.push_back(sl->inPoint);
                targets.push_back(sl->outPoint);
            }
            double best = t;
            double bestPx = 10;
            for (double tt : targets)
                if (std::abs(tt - t) * pxPerSec_ < bestPx) {
                    bestPx = std::abs(tt - t) * pxPerSec_;
                    best = tt;
                }
            ed_->setTime(best);
        } else {
            setTimeFromX(pos.x());
        }
        break;
    case Drag::Marker:
        if (dragMarker_ >= 0 && dragMarker_ < int(c->markers.size())) {
            c->markers[dragMarker_].time = std::clamp(snapTime(dragT0_ + t - xTime(pressPos_.x())), 0.0, c->duration);
            update();
        }
        break;
    case Drag::WorkStart:
        c->workStart = std::clamp(snapTime(t), 0.0, c->workEnd - c->frameDuration());
        update();
        break;
    case Drag::WorkEnd:
        c->workEnd = std::clamp(snapTime(t), c->workStart + c->frameDuration(), c->duration);
        update();
        break;
    case Drag::WorkBar: {
        const double len = layerStarts_[0].out - layerStarts_[0].in;
        const double s = std::clamp(snapTime(layerStarts_[0].in + t - dragT0_), 0.0, c->duration - len);
        c->workStart = s;
        c->workEnd = s + len;
        update();
        break;
    }
    case Drag::LayerMove:
    case Drag::LayerTrimIn:
    case Drag::LayerTrimOut: {
        if (!moved_)
            break;
        double d = snapTime(t - dragT0_);
        if (e->modifiers() & Qt::ShiftModifier) {
            // Snap the grabbed layer's edges to markers, the CTI and the work area.
            const auto &s0 = layerStarts_.front();
            if (drag_ == Drag::LayerMove)
                d = snapDelta({s0.in, s0.out}, d);
            else if (drag_ == Drag::LayerTrimIn)
                d = snapDelta({s0.in}, d);
            else
                d = snapDelta({s0.out}, d);
        }
        for (const auto &s : layerStarts_) {
            Layer *l = c->layerById(s.id);
            if (!l)
                continue;
            if (drag_ == Drag::LayerMove) {
                l->inPoint = s.in + d;
                l->outPoint = s.out + d;
                l->startTime = s.start + d;
            } else if (drag_ == Drag::LayerTrimIn) {
                double ni = std::min(s.in + d, s.out - c->frameDuration());
                if (l->type == LayerType::Footage || l->type == LayerType::Precomp)
                    if (!l->timeRemapEnabled)
                        ni = std::max(ni, l->startTime);   // can't trim before the source starts
                l->inPoint = ni;
            } else {
                double no = std::max(s.out + d, s.in + c->frameDuration());
                if (l->type == LayerType::Footage && !l->timeRemapEnabled)
                    if (auto *f = ed_->project().footage(l->sourceItemId); f && !f->isStill)
                        no = std::min(no, l->startTime + f->duration * l->stretch / 100.0);
                if (l->type == LayerType::Precomp && !l->timeRemapEnabled)
                    if (auto *sc = ed_->project().comp(l->sourceItemId))
                        no = std::min(no, l->startTime + sc->duration * l->stretch / 100.0);
                l->outPoint = no;
            }
        }
        if (drag_ == Drag::LayerMove)
            for (const auto &k : keyStarts_)
                k.prop->keys[k.index].time = k.time + d;
        ed_->touch();
        break;
    }
    case Drag::Keys: {
        if (!moved_)
            break;
        double d = snapTime(t - dragT0_);
        if ((e->modifiers() & Qt::ShiftModifier) && !keyStarts_.empty()) {
            std::vector<double> times;
            for (const auto &k : keyStarts_)
                times.push_back(k.time);
            d = snapDelta(times, d);
        }
        for (const auto &k : keyStarts_)
            if (k.index < k.prop->keys.size())
                k.prop->keys[k.index].time = k.time + d;
        ed_->touch();
        break;
    }
    case Drag::Marquee: {
        marquee_ = QRectF(pressPos_, pos).normalized();
        const bool add = e->modifiers() & Qt::ShiftModifier;
        for (const Row &r : rows_) {
            if (r.kind != Kind::Prop)
                continue;
            const double cy = kHeaderH + r.y - scrollY_ + r.h / 2.0;
            for (auto &k : r.prop->keys) {
                const bool inside = marquee_.contains(QPointF(timeX(k.time), cy));
                if (inside)
                    k.selected = true;
                else if (!add)
                    k.selected = false;
            }
        }
        update();
        break;
    }
    case Drag::Scrub: {
        if (!moved_)
            break;
        const Row &r = rows_[dragRow_];
        double mult = 1.0;
        if (e->modifiers() & Qt::ShiftModifier)
            mult = 10.0;
        else if (e->modifiers() & Qt::ControlModifier)
            mult = 0.1;
        Value v = scrubStart_;
        double step = r.prop->dragStep;
        if (r.prop->type == PropType::Time && c)
            step = c->frameDuration();
        v[dragDim_] = scrubStart_[dragDim_] + (pos.x() - pressPos_.x()) * step * mult;
        r.prop->setValue(ed_->time(), v);
        ed_->touch();
        break;
    }
    case Drag::Reorder: {
        if (!moved_)
            break;
        // Compute insertion index among visible layer rows.
        int idx = 0, target = 0;
        const int cy = int(pos.y()) - kHeaderH + scrollY_;
        for (const Row &r : rows_)
            if (r.kind == Kind::Layer) {
                if (cy > r.y + r.h / 2)
                    target = idx + 1;
                ++idx;
            }
        reorderTarget_ = target;
        update();
        break;
    }
    default:
        break;
    }
}

void TimelineView::mouseReleaseEvent(QMouseEvent *e)
{
    Composition *c = ed_->activeComp();
    const Drag d = drag_;
    drag_ = Drag::None;
    if (!c)
        return;
    switch (d) {
    case Drag::WorkStart:
    case Drag::WorkEnd:
    case Drag::WorkBar:
        ed_->commit("Change Work Area", false);
        break;
    case Drag::LayerMove:
    case Drag::LayerTrimIn:
    case Drag::LayerTrimOut:
        if (moved_)
            ed_->commit(d == Drag::LayerMove ? "Move Layer" : "Trim Layer", false);
        break;
    case Drag::Keys:
        if (moved_) {
            // Merge keys that landed on the same frame (the moved one wins).
            for (const auto &k : keyStarts_)
                k.prop->sortKeys();
            ed_->commit("Move Keyframes", false);
        }
        break;
    case Drag::Scrub:
        if (moved_) {
            ed_->commit("Change Value", false);
        } else {
            const Row &r = rows_[dragRow_];
            for (const ValueHit &vh : valueRects(r, currentValue(r)))
                if (vh.dim == dragDim_)
                    editValue(r, vh.dim, vh.rect);
        }
        break;
    case Drag::Reorder:
        if (moved_ && reorderTarget_ >= 0 && dragRow_ >= 0) {
            Layer *l = rows_[dragRow_].layer;
            // Map visible index to composition index.
            int idx = 0, compIndex = int(c->layers.size());
            for (const Row &r : rows_)
                if (r.kind == Kind::Layer) {
                    if (idx == reorderTarget_) {
                        compIndex = c->indexOf(r.layer->id);
                        break;
                    }
                    ++idx;
                }
            const int from = c->indexOf(l->id);
            if (compIndex > from)
                --compIndex;
            ed_->moveLayerTo(l->id, compIndex);
        }
        reorderTarget_ = -1;
        update();
        break;
    case Drag::Marquee:
        marquee_ = {};
        update();
        break;
    case Drag::Marker:
        if (moved_) {
            c->sortMarkers();
            ed_->commit("Move Marker", false);
        } else {
            ed_->setTime(c->markers[std::clamp(dragMarker_, 0, int(c->markers.size()) - 1)].time);
        }
        dragMarker_ = -1;
        break;
    default:
        break;
    }
    Q_UNUSED(e);
}

int TimelineView::markerAt(QPointF pos) const
{
    Composition *c = ed_->activeComp();
    if (!c || pos.y() < 23 || pos.y() > kHeaderH)
        return -1;
    for (int i = int(c->markers.size()) - 1; i >= 0; --i)
        if (std::abs(timeX(c->markers[i].time) - pos.x()) <= 6)
            return i;
    return -1;
}

double TimelineView::snapDelta(const std::vector<double> &times, double delta, bool) const
{
    const std::vector<double> targets = ed_->snapTimes();
    double bestPx = 10.0, best = delta;
    for (double tm : times)
        for (double target : targets) {
            const double px = std::abs(tm + delta - target) * pxPerSec_;
            if (px < bestPx) {
                bestPx = px;
                best = target - tm;
            }
        }
    return best;
}

void TimelineView::paintWaveform(QPainter &p, const Layer &l, int top, int h)
{
    Composition *c = ed_->activeComp();
    if (l.type != LayerType::Footage)
        return;
    const FootageItem *f = ed_->project().footage(l.sourceItemId);
    auto buf = f ? MediaCache::instance().audio(f->path) : nullptr;
    if (!buf)
        return;
    const int x0 = std::max(areaLeft(), timeX(l.inPoint)), x1 = std::min(width(), timeX(l.outPoint));
    const double mid = top + h / 2.0;
    p.setPen(QPen(QColor(255, 255, 255, 150), 1));
    const double gain = dbToGain(l.audioLevels.valueAt(ed_->time()).value(0));
    for (int x = x0; x < x1; ++x) {
        const double sa = ed_->renderer().sourceTime(l, *c, xTime(x));
        const double sb = ed_->renderer().sourceTime(l, *c, xTime(x + 1));
        const float pk = std::min(1.0f, buf->peakBetween(std::min(sa, sb), std::max(sa, sb)) * float(gain));
        const double half = std::max(0.5, pk * (h / 2.0 - 1));
        p.drawLine(QPointF(x + 0.5, mid - half), QPointF(x + 0.5, mid + half));
    }
}

void TimelineView::mouseDoubleClickEvent(QMouseEvent *e)
{
    if (Composition *c = ed_->activeComp(); c && e->position().y() < kHeaderH) {
        if (const int mi = markerAt(e->position()); mi >= 0) {
            bool ok = false;
            const QString text = QInputDialog::getText(this, "Composition Marker", "Comment:", QLineEdit::Normal,
                                                       c->markers[mi].comment, &ok);
            if (ok) {
                c->markers[mi].comment = text;
                ed_->commit("Marker Comment", false);
            }
        }
        return;
    }
    const int ri = rowAt(int(e->position().y()));
    if (ri < 0)
        return;
    const Row &r = rows_[ri];
    const Cols cols = columns(nameW_);
    if (r.kind == Kind::Layer && e->position().x() >= xName + 16 && e->position().x() < cols.sw) {
        beginRename(r.layer, kHeaderH + r.y - scrollY_);
    } else if (r.kind == Kind::Layer && e->position().x() > areaLeft()) {
        if (r.layer->type == LayerType::Precomp)
            ed_->setActiveComp(r.layer->sourceItemId);
        else if (r.layer->type == LayerType::Text)
            showTextEditor(this, ed_, r.layer->id);
    } else if (r.kind == Kind::Expr) {
        showExpressionEditor(this, ed_, {r.layer->id, Editor::keyFor(*r.layer, r.prop)});
    } else if (r.kind == Kind::Prop && e->position().x() > areaLeft() && keyAt(r, e->position()) >= 0) {
        // Double-clicking a keyframe jumps the CTI to it.
        ed_->setTime(r.prop->keys[keyAt(r, e->position())].time);
    }
}

void TimelineView::wheelEvent(QWheelEvent *e)
{
    const double steps = e->angleDelta().y() / 120.0;
    if (e->modifiers() & Qt::AltModifier || (e->modifiers() & Qt::ControlModifier)) {
        const double dy = e->angleDelta().y() ? e->angleDelta().y() : e->angleDelta().x();
        zoomTime(std::pow(1.2, dy / 120.0), e->position().x());
    } else if (e->modifiers() & Qt::ShiftModifier) {
        setViewStart(viewStart_ - steps * visibleDuration() * 0.1);
    } else {
        const int maxScroll = std::max(0, contentHeight_ - (height() - kHeaderH) + 40);
        scrollY_ = std::clamp(scrollY_ - int(steps * 40), 0, maxScroll);
        emit viewChanged();
        update();
    }
}

void TimelineView::contextMenuEvent(QContextMenuEvent *e)
{
    const int ri = rowAt(e->pos().y());
    QMenu menu(this);
    if (ri < 0) {
        if (layerMenuBuilder)
            layerMenuBuilder(menu);
        menu.exec(e->globalPos());
        return;
    }
    Row r = rows_[ri];
    Layer *l = r.layer;
    if (!ed_->isSelected(l->id))
        ed_->selectLayer(l->id);
    if (r.kind == Kind::Prop) {
        Property *pr = r.prop;
        const int k = e->pos().x() > areaLeft() ? keyAt(r, e->pos()) : -1;
        if (k >= 0) {
            if (!pr->keys[k].selected) {
                ed_->deselectAllKeys();
                pr->keys[k].selected = true;
            }
            menu.addAction("Easy Ease\tF9", [this] { ed_->easeSelectedKeys(true, true); });
            menu.addAction("Easy Ease In\tShift+F9", [this] { ed_->easeSelectedKeys(true, false); });
            menu.addAction("Easy Ease Out\tCtrl+Shift+F9", [this] { ed_->easeSelectedKeys(false, true); });
            menu.addAction("Linear", [this] {
                ed_->forEachSelectedKey([](Layer &, Property &, Keyframe &kf) {
                    kf.inInterp = kf.outInterp = Interp::Linear;
                });
                ed_->commit("Linear Keyframes", false);
            });
            menu.addAction("Toggle Hold Keyframe\tCtrl+Alt+H", [this] { ed_->toggleHoldSelectedKeys(); });
            menu.addSeparator();
            menu.addAction("Copy\tCtrl+C", [this] { ed_->copySelection(); });
            menu.addAction("Delete\tDel", [this] { ed_->deleteSelectedKeys(); });
        } else {
            menu.addAction("Add Keyframe", [this, pr, l] { ed_->setKeyAtCurrentTime(*pr, *l); })->setEnabled(pr->animatable);
            menu.addAction(pr->expression.isEmpty() ? "Add Expression…\tAlt+Shift+=" : "Edit Expression…",
                           [this, l, pr] { showExpressionEditor(this, ed_, {l->id, Editor::keyFor(*l, pr)}); });
            if (!pr->expression.isEmpty()) {
                menu.addAction(pr->expressionEnabled ? "Disable Expression" : "Enable Expression", [this, pr] {
                    pr->expressionEnabled = !pr->expressionEnabled;
                    ed_->commit("Toggle Expression", true);
                });
                menu.addAction("Remove Expression", [this, pr] {
                    pr->expression.clear();
                    pr->expressionError.clear();
                    ed_->commit("Remove Expression", true);
                });
            }
            menu.addSeparator();
            menu.addAction("Reset", [this, pr] {
                pr->reset();
                ed_->commit("Reset Property", true);
            });
        }
    } else if (r.kind == Kind::Effect) {
        Effect *fx = r.effect;
        const int uid = fx->uid, lid = l->id;
        menu.addAction("Reset", [this, fx] {
            for (auto &p : fx->params)
                p.reset();
            ed_->commit("Reset Effect", true);
        });
        menu.addAction("Move Up", [this, lid, uid] { ed_->moveEffect(lid, uid, -1); });
        menu.addAction("Move Down", [this, lid, uid] { ed_->moveEffect(lid, uid, 1); });
        menu.addSeparator();
        menu.addAction("Remove Effect", [this, lid, uid] { ed_->removeEffect(lid, uid); });
    } else if (layerMenuBuilder) {
        layerMenuBuilder(menu);
    }
    menu.exec(e->globalPos());
}

void TimelineView::dragEnterEvent(QDragEnterEvent *e)
{
    const QMimeData *m = e->mimeData();
    if (m->hasFormat("application/x-motionforge-item") || m->hasFormat("application/x-motionforge-effect") ||
        m->hasFormat("application/x-motionforge-preset") || m->hasUrls())
        e->acceptProposedAction();
}

void TimelineView::dropEvent(QDropEvent *e)
{
    const QMimeData *m = e->mimeData();
    const int ri = rowAt(int(e->position().y()));
    Layer *target = ri >= 0 ? rows_[ri].layer : nullptr;
    if (m->hasFormat("application/x-motionforge-effect") || m->hasFormat("application/x-motionforge-preset")) {
        if (target)
            ed_->selectLayer(target->id);
        if (m->hasFormat("application/x-motionforge-effect"))
            ed_->addEffect(QString::fromUtf8(m->data("application/x-motionforge-effect")));
        else
            ed_->applyPreset(QString::fromUtf8(m->data("application/x-motionforge-preset")));
    } else if (m->hasFormat("application/x-motionforge-item")) {
        if (target)
            ed_->selectLayer(target->id);
        else
            ed_->clearSelection();
        ed_->addItemLayer(m->data("application/x-motionforge-item").toInt());
    } else if (m->hasUrls()) {
        for (const QUrl &u : m->urls()) {
            QString err;
            if (FootageItem *f = ed_->importFile(u.toLocalFile(), &err))
                ed_->addItemLayer(f->id);
            else
                emit ed_->message(err);
        }
    }
    e->acceptProposedAction();
}

void TimelineView::beginRename(Layer *l, int y)
{
    const int lid = l->id;
    renameEdit_ = new QLineEdit(this);
    renameEdit_->setText(l->name);
    renameEdit_->setGeometry(xName + 32, y, nameW_ - 32, kLayerH);
    renameEdit_->selectAll();
    renameEdit_->show();
    renameEdit_->setFocus();
    connect(renameEdit_, &QLineEdit::editingFinished, this, [this, lid] {
        if (!renameEdit_)
            return;
        const QString name = renameEdit_->text().trimmed();
        renameEdit_->deleteLater();
        renameEdit_ = nullptr;
        Composition *c = ed_->activeComp();
        Layer *ll = c ? c->layerById(lid) : nullptr;
        if (ll && !name.isEmpty() && name != ll->name) {
            ll->name = name;
            ed_->commit("Rename Layer", true);
        }
    });
}

void TimelineView::showModeMenu(Layer *l, QPoint pos)
{
    QMenu m(this);
    for (int i = 0; i <= int(BlendMode::Exclusion); ++i) {
        QAction *a = m.addAction(blendModeName(BlendMode(i)));
        a->setCheckable(true);
        a->setChecked(int(l->blend) == i);
        connect(a, &QAction::triggered, this, [this, i] {
            for (Layer *s : ed_->selectedLayers())
                s->blend = BlendMode(i);
            ed_->commit("Blending Mode", true);
        });
        if (i == 0 || i == 4 || i == 8 || i == 10)
            m.addSeparator();
    }
    m.exec(pos);
}

void TimelineView::showMatteMenu(Layer *l, QPoint pos)
{
    QMenu m(this);
    for (int i = 0; i <= int(MatteMode::LumaInverted); ++i) {
        QAction *a = m.addAction(matteModeName(MatteMode(i)));
        a->setCheckable(true);
        a->setChecked(int(l->matte) == i);
        connect(a, &QAction::triggered, this, [this, l, i] {
            l->matte = MatteMode(i);
            ed_->commit("Track Matte", true);
        });
    }
    m.exec(pos);
}

void TimelineView::showParentMenu(Layer *l, QPoint pos)
{
    Composition *c = ed_->activeComp();
    QMenu m(this);
    QAction *none = m.addAction("None");
    none->setCheckable(true);
    none->setChecked(l->parentId == 0);
    auto setParent = [this, c, l](int pid) {
        // Keep the child visually in place by converting its transform into the new parent's space.
        const double t = ed_->time();
        const QTransform world = ed_->renderer().layerToComp(*l, *c, t);
        l->parentId = pid;
        const Layer *np = c->parentOf(*l);
        const QTransform parentWorld = np ? ed_->renderer().layerToComp(*np, *c, t) : QTransform();
        const QPointF anchorWorld = world.map(Property::toPoint(l->anchor.valueAt(t)));
        const QPointF newPos = parentWorld.inverted().map(anchorWorld);
        l->position.setValue(t, Property::fromPoint(newPos));
        ed_->commit("Parent", true);
    };
    connect(none, &QAction::triggered, this, [setParent] { setParent(0); });
    m.addSeparator();
    for (const auto &o : c->layers) {
        if (o->id == l->id)
            continue;
        // Prevent cycles.
        bool cycle = false;
        for (const Layer *p = o.get(); p; p = c->parentOf(*p))
            if (p->id == l->id) {
                cycle = true;
                break;
            }
        QAction *a = m.addAction(QString("%1. %2").arg(c->indexOf(o->id) + 1).arg(o->name));
        a->setCheckable(true);
        a->setChecked(l->parentId == o->id);
        a->setEnabled(!cycle);
        const int pid = o->id;
        connect(a, &QAction::triggered, this, [setParent, pid] { setParent(pid); });
    }
    m.exec(pos);
}

void TimelineView::showLabelMenu(Layer *l, QPoint pos)
{
    QMenu m(this);
    for (int i = 0; i <= kLabelCount; ++i) {
        QPixmap pm(12, 12);
        pm.fill(labelColor(i));
        QAction *a = m.addAction(QIcon(pm), labelName(i));
        connect(a, &QAction::triggered, this, [this, i] {
            for (Layer *s : ed_->selectedLayers())
                s->label = i;
            ed_->commit("Label", true);
        });
    }
    if (!ed_->isSelected(l->id))
        ed_->selectLayer(l->id);
    m.exec(pos);
}

void TimelineView::editValue(const Row &r, int dim, QRectF rect)
{
    Property *pr = r.prop;
    const double t = ed_->time();
    const int lid = r.layer->id;
    const QString key = Editor::keyFor(*r.layer, pr);
    if (pr->type == PropType::Checkbox) {
        Value v = pr->valueAt(t);
        v[0] = v[0] > 0.5 ? 0.0 : 1.0;
        pr->setValue(t, v);
        ed_->commit("Toggle " + pr->name, false);
        return;
    }
    if (pr->type == PropType::String) {
        bool ok = false;
        const QString text = QInputDialog::getText(this, pr->name, pr->name + ":", QLineEdit::Normal, pr->text, &ok);
        if (Property *p = ed_->resolve({lid, key}); ok && p && p->text != text) {
            p->text = text;
            ed_->commit("Change " + p->name, false);
        }
        return;
    }
    if (pr->type == PropType::Choice) {
        QMenu m(this);
        for (int i = 0; i < pr->choices.size(); ++i) {
            QAction *a = m.addAction(pr->choices[i]);
            a->setCheckable(true);
            a->setChecked(int(pr->valueAt(t).value(0)) == i);
            connect(a, &QAction::triggered, this, [this, pr, t, i] {
                pr->setValue(t, {double(i)});
                ed_->commit("Change " + pr->name, false);
            });
        }
        m.exec(mapToGlobal(rect.bottomLeft().toPoint()));
        return;
    }
    if (pr->type == PropType::Color) {
        const Value before = pr->valueAt(t);
        QColorDialog dlg(Property::toColor(before), this);
        dlg.setOption(QColorDialog::ShowAlphaChannel, false);
        connect(&dlg, &QColorDialog::currentColorChanged, this, [this, lid, key, t](const QColor &col) {
            if (Property *p = ed_->resolve({lid, key})) {
                p->setValue(t, Property::fromColor(col));
                ed_->touch();
            }
        });
        if (dlg.exec() == QDialog::Accepted) {
            if (Property *p = ed_->resolve({lid, key}))
                p->setValue(t, Property::fromColor(dlg.selectedColor()));
            ed_->commit("Change Color", false);
        } else if (Property *p = ed_->resolve({lid, key})) {
            p->setValue(t, before);
            ed_->touch();
        }
        return;
    }
    auto *edit = new QLineEdit(this);
    const Value v = pr->valueAt(t);
    edit->setText(pr->type == PropType::Time ? QString::number(v.value(dim), 'f', 3) : QString::number(v.value(dim), 'f', 2));
    edit->setGeometry(QRect(int(rect.left()) - 2, int(rect.top()), std::max(70, int(rect.width()) + 30), int(rect.height())));
    edit->selectAll();
    edit->show();
    edit->setFocus();
    connect(edit, &QLineEdit::editingFinished, this, [this, edit, lid, key, dim, t] {
        if (!edit->isVisible())
            return;
        edit->hide();
        edit->deleteLater();
        QString txt = edit->text().trimmed();
        txt.remove('%').remove(QChar(0xB0)).remove('s');
        bool ok = false;
        const double nv = txt.toDouble(&ok);
        Property *p = ed_->resolve({lid, key});
        if (!ok || !p)
            return;
        Value val = p->valueAt(t);
        val[dim] = nv;
        p->setValue(t, val);
        ed_->commit("Change " + p->name, false);
    });
}

// ------------------------------------------------------------ panel

TimelinePanel::TimelinePanel(Editor *editor, QWidget *parent) : QWidget(parent), ed_(editor)
{
    auto *v = new QVBoxLayout(this);
    v->setContentsMargins(0, 0, 0, 0);
    v->setSpacing(0);

    auto *top = new QWidget;
    top->setStyleSheet("background:#232323;");
    auto *h = new QHBoxLayout(top);
    h->setContentsMargins(8, 3, 8, 3);
    h->setSpacing(10);
    timeLabel_ = new QLabel;
    timeLabel_->setStyleSheet("color:#3d9df2; font-size:16pt; font-family:monospace;");
    timeLabel_->setToolTip("Current time");
    frameLabel_ = new QLabel;
    frameLabel_->setStyleSheet("color:#8a8a8a;");
    compLabel_ = new QLabel;
    compLabel_->setStyleSheet("color:#c6c6c6; font-weight:bold;");
    auto *search = new QLineEdit;
    search->setPlaceholderText("Search layers");
    search->setClearButtonEnabled(true);
    search->setMaximumWidth(200);
    shyBtn_ = new QToolButton;
    shyBtn_->setIcon(icon("shy"));
    shyBtn_->setCheckable(true);
    shyBtn_->setToolTip("Hide all layers for which the Shy switch is set");
    shyBtn_->setFocusPolicy(Qt::NoFocus);
    mbBtn_ = new QToolButton;
    mbBtn_->setIcon(icon("motionblur"));
    mbBtn_->setCheckable(true);
    mbBtn_->setToolTip("Enable Motion Blur for all layers with the Motion Blur switch set");
    mbBtn_->setFocusPolicy(Qt::NoFocus);
    h->addWidget(timeLabel_);
    h->addWidget(frameLabel_);
    h->addSpacing(12);
    h->addWidget(compLabel_);
    h->addWidget(search);
    h->addStretch();
    h->addWidget(shyBtn_);
    h->addWidget(mbBtn_);
    v->addWidget(top);

    auto *mid = new QHBoxLayout;
    mid->setSpacing(0);
    view_ = new TimelineView(editor);
    vbar_ = new QScrollBar(Qt::Vertical);
    mid->addWidget(view_, 1);
    mid->addWidget(vbar_);
    v->addLayout(mid, 1);

    auto *bottom = new QWidget;
    bottom->setStyleSheet("background:#1d1d1d;");
    auto *bh = new QHBoxLayout(bottom);
    bh->setContentsMargins(4, 1, 4, 1);
    auto *zoomLbl = new QLabel("Zoom");
    zoomLbl->setStyleSheet("color:#6a6a6a;");
    zoom_ = new QSlider(Qt::Horizontal);
    zoom_->setRange(0, 100);
    zoom_->setFixedWidth(140);
    zoom_->setFocusPolicy(Qt::NoFocus);
    hbar_ = new QScrollBar(Qt::Horizontal);
    bh->addWidget(zoomLbl);
    bh->addWidget(zoom_);
    bh->addWidget(hbar_, 1);
    v->addWidget(bottom);

    connect(search, &QLineEdit::textChanged, view_, &TimelineView::setFilter);
    connect(shyBtn_, &QToolButton::toggled, this, [this](bool on) {
        if (Composition *c = ed_->activeComp(); c && c->hideShyLayers != on) {
            c->hideShyLayers = on;
            ed_->commit("Hide Shy Layers", true);
        }
    });
    connect(mbBtn_, &QToolButton::toggled, this, [this](bool on) {
        if (Composition *c = ed_->activeComp(); c && c->motionBlurEnabled != on) {
            c->motionBlurEnabled = on;
            ed_->commit("Comp Motion Blur", false);
        }
    });
    auto syncBars = [this] {
        Composition *c = ed_->activeComp();
        const int viewH = view_->height() - kHeaderH;
        vbar_->setRange(0, std::max(0, view_->contentHeight() - viewH + 40));
        vbar_->setPageStep(viewH);
        if (c) {
            const int total = int(c->duration * 1000);
            const int page = int(view_->visibleDuration() * 1000);
            hbar_->blockSignals(true);
            hbar_->setRange(0, std::max(0, total - page));
            hbar_->setPageStep(page);
            hbar_->setValue(int(view_->viewStart() * 1000));
            hbar_->blockSignals(false);
            const double frac = std::log(view_->visibleDuration() / c->duration) / std::log(1.0 / (c->duration * c->fps / 10.0));
            zoom_->blockSignals(true);
            zoom_->setValue(int(std::clamp(frac, 0.0, 1.0) * 100));
            zoom_->blockSignals(false);
        }
    };
    connect(view_, &TimelineView::viewChanged, this, syncBars);
    connect(view_, &TimelineView::contentHeightChanged, this, syncBars);
    connect(vbar_, &QScrollBar::valueChanged, view_, &TimelineView::setScrollY);
    connect(hbar_, &QScrollBar::valueChanged, this, [this](int v) { view_->setViewStart(v / 1000.0); });
    connect(zoom_, &QSlider::valueChanged, this, [this](int v) {
        Composition *c = ed_->activeComp();
        if (!c)
            return;
        // Slider maps logarithmically from "whole comp" to "~10 frames visible".
        const double target = c->duration * std::pow(1.0 / (c->duration * c->fps / 10.0), v / 100.0);
        view_->zoomTime(view_->visibleDuration() / target);
    });
    connect(ed_, &Editor::timeChanged, this, &TimelinePanel::refresh);
    connect(ed_, &Editor::activeCompChanged, this, &TimelinePanel::refresh);
    connect(ed_, &Editor::projectChanged, this, &TimelinePanel::refresh);
    connect(ed_, &Editor::valuesChanged, this, &TimelinePanel::refresh);
    refresh();
}

void TimelinePanel::refresh()
{
    Composition *c = ed_->activeComp();
    if (!c) {
        timeLabel_->setText("0:00:00:00");
        frameLabel_->clear();
        compLabel_->clear();
        return;
    }
    timeLabel_->setText(timecode(ed_->time(), c->fps));
    frameLabel_->setText(QString("%1 (%2 fps)").arg(ed_->currentFrame(), 5, 10, QChar('0')).arg(c->fps, 0, 'f', 2));
    compLabel_->setText(c->name);
    shyBtn_->blockSignals(true);
    shyBtn_->setChecked(c->hideShyLayers);
    shyBtn_->blockSignals(false);
    mbBtn_->blockSignals(true);
    mbBtn_->setChecked(c->motionBlurEnabled);
    mbBtn_->blockSignals(false);
}

} // namespace mf
