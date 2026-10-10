#include "CompViewer.h"

#include "Dialogs.h"
#include "Icons.h"
#include "Theme.h"
#include "ofx/OfxHost.h"

#include <QComboBox>
#include <QFileInfo>
#include <QHBoxLayout>
#include <QLabel>
#include <QMimeData>
#include <QMouseEvent>
#include <QPainter>
#include <QTimer>
#include <QToolButton>
#include <QUrl>
#include <QVBoxLayout>
#include <cmath>

namespace mf {

QString timecode(double t, double fps)
{
    const int fr = int(std::round(fps));
    const qint64 total = qint64(std::round(t * fps));
    const qint64 frames = total % std::max(1, fr);
    const qint64 secs = total / std::max(1, fr);
    return QString("%1:%2:%3:%4")
        .arg(secs / 3600, 1, 10, QChar('0'))
        .arg((secs / 60) % 60, 2, 10, QChar('0'))
        .arg(secs % 60, 2, 10, QChar('0'))
        .arg(frames, 2, 10, QChar('0'));
}

CompViewer::CompViewer(Editor *editor, QWidget *parent) : QWidget(parent), ed_(editor)
{
    setMouseTracking(true);
    setAcceptDrops(true);
    setFocusPolicy(Qt::StrongFocus);
    setMinimumSize(200, 150);
    auto inval = [this] { invalidate(); };
    connect(ed_, &Editor::timeChanged, this, inval);
    connect(ed_, &Editor::valuesChanged, this, inval);
    connect(ed_, &Editor::projectChanged, this, inval);
    connect(ed_, &Editor::selectionChanged, this, qOverload<>(&QWidget::update));
    connect(ed_, &Editor::activeCompChanged, this, [this] {
        fit_ = true;
        fitToView();
        invalidate();
    });
}

void CompViewer::setTool(Tool t)
{
    tool_ = t;
    switch (t) {
    case Tool::Hand: setCursor(Qt::OpenHandCursor); break;
    case Tool::Zoom: setCursor(Qt::CrossCursor); break;
    case Tool::Text: setCursor(Qt::IBeamCursor); break;
    case Tool::Rect:
    case Tool::Ellipse:
    case Tool::Polygon:
    case Tool::Star: setCursor(Qt::CrossCursor); break;
    default: setCursor(Qt::ArrowCursor); break;
    }
}

void CompViewer::setZoom(double z, std::optional<QPointF> around)
{
    z = std::clamp(z, 0.015, 32.0);
    if (around) {
        // Keep the comp point under the cursor fixed.
        const QPointF before = toComp(*around);
        zoom_ = z;
        const QPointF after = viewTransform().map(before);
        pan_ += *around - after;
    } else {
        zoom_ = z;
    }
    fit_ = false;
    emit zoomChanged(zoom_);
    invalidate();
}

void CompViewer::fitToView()
{
    Composition *c = ed_->activeComp();
    if (!c)
        return;
    const double z = std::min((width() - 40.0) / c->width, (height() - 40.0) / c->height);
    zoom_ = std::max(0.015, z);
    pan_ = {};
    fit_ = true;
    emit zoomChanged(zoom_);
    invalidate();
}

void CompViewer::zoomBy(double factor)
{
    static const double steps[] = {0.015, 0.03, 0.0625, 0.125, 0.25, 0.333, 0.5, 0.667, 1, 1.5, 2, 3, 4, 8, 16, 32};
    double target = zoom_;
    if (factor > 1) {
        for (double s : steps)
            if (s > zoom_ + 1e-3) {
                target = s;
                break;
            }
    } else {
        for (int i = int(std::size(steps)) - 1; i >= 0; --i)
            if (steps[i] < zoom_ - 1e-3) {
                target = steps[i];
                break;
            }
    }
    setZoom(target);
}

void CompViewer::setResolution(int r)
{
    resolution_ = r;
    invalidate();
}

double CompViewer::renderScale() const
{
    switch (resolution_) {
    case 1: return 1.0;
    case 2: return 0.5;
    case 3: return 1.0 / 3.0;
    case 4: return 0.25;
    default:
        if (zoom_ >= 0.75)
            return 1.0;
        if (zoom_ >= 0.45)
            return 0.5;
        if (zoom_ >= 0.3)
            return 1.0 / 3.0;
        return 0.25;
    }
}

QTransform CompViewer::viewTransform() const
{
    Composition *c = ed_->activeComp();
    const QPointF center = c ? QPointF(c->width / 2.0, c->height / 2.0) : QPointF();
    QTransform t;
    t.translate(width() / 2.0 + pan_.x(), height() / 2.0 + pan_.y());
    t.scale(zoom_, zoom_);
    t.translate(-center.x(), -center.y());
    return t;
}

void CompViewer::resizeEvent(QResizeEvent *)
{
    if (fit_)
        fitToView();
}

static void drawChecker(QPainter &p, const QRectF &r)
{
    p.save();
    p.setClipRect(r);
    const int s = 10;
    for (int y = int(r.top()); y < r.bottom(); y += s)
        for (int x = int(r.left()); x < r.right(); x += s)
            p.fillRect(x, y, s, s, (((x - int(r.left())) / s + (y - int(r.top())) / s) & 1) ? QColor(0x99, 0x99, 0x99) : QColor(0xcc, 0xcc, 0xcc));
    p.restore();
}

void CompViewer::paintEvent(QPaintEvent *)
{
    QPainter p(this);
    p.fillRect(rect(), QColor(0x18, 0x18, 0x18));
    Composition *c = ed_->activeComp();
    if (!c) {
        p.setPen(theme::textDim);
        p.drawText(rect(), Qt::AlignCenter,
                   "No composition\n\nComposition ▸ New Composition (Ctrl+N)\nor drop footage into the Project panel");
        return;
    }
    if (dirty_) {
        int ms = 0;
        frameScale_ = renderScale();
        frame_ = ed_->frameImage(frameScale_, &ms);
        dirty_ = false;
        if (ms > 0)
            emit renderTimeChanged(ms);
        QString err = ed_->renderer().lastEffectError;
        ed_->renderer().lastEffectError.clear();
        const QString pluginMsgs = ofx::Manager::instance().takeMessages();
        if (!pluginMsgs.isEmpty())
            err = err.isEmpty() ? pluginMsgs.section('\n', -1) : err;
        if (!err.isEmpty())
            QTimer::singleShot(0, ed_, [ed = ed_, err] { emit ed->message(err); });
    }
    const QTransform view = viewTransform();
    const QRectF compRect = view.mapRect(QRectF(0, 0, c->width, c->height));
    if (checker_)
        drawChecker(p, compRect);
    else
        p.fillRect(compRect, c->background);
    p.setRenderHint(QPainter::SmoothPixmapTransform, zoom_ / frameScale_ < 2.0);
    p.drawImage(compRect, frame_);

    if (grid_) {
        p.setPen(QPen(QColor(255, 255, 255, 70), 1));
        for (int i = 1; i < 3; ++i) {
            const double x = compRect.left() + compRect.width() * i / 3.0;
            const double y = compRect.top() + compRect.height() * i / 3.0;
            p.drawLine(QPointF(x, compRect.top()), QPointF(x, compRect.bottom()));
            p.drawLine(QPointF(compRect.left(), y), QPointF(compRect.right(), y));
        }
        p.setPen(QPen(QColor(255, 255, 255, 50), 1, Qt::DashLine));
        p.setBrush(Qt::NoBrush);
        p.drawRect(compRect.adjusted(compRect.width() * 0.05, compRect.height() * 0.05, -compRect.width() * 0.05, -compRect.height() * 0.05));
        p.drawRect(compRect.adjusted(compRect.width() * 0.1, compRect.height() * 0.1, -compRect.width() * 0.1, -compRect.height() * 0.1));
    }
    drawOverlays(p);

    if (drag_ == Drag::Shape && !shapeRect_.isNull()) {
        p.setPen(QPen(theme::accent, 1, Qt::DashLine));
        p.setBrush(QColor(45, 140, 235, 40));
        const QRectF r = view.mapRect(shapeRect_);
        if (tool_ == Tool::Ellipse)
            p.drawEllipse(r);
        else
            p.drawRect(r);
    }
}

void CompViewer::drawMotionPath(QPainter &p, Layer &l, const QTransform &view)
{
    Composition *c = ed_->activeComp();
    if (!l.position.isAnimated() || l.position.keys.size() < 2)
        return;
    const Layer *parent = c->parentOf(l);
    const double t0 = l.position.keys.first().time, t1 = l.position.keys.last().time;
    const int steps = std::clamp(int((t1 - t0) * c->fps), 2, 600);
    QPolygonF poly;
    auto parentT = [&](double t) { return parent ? ed_->renderer().layerToComp(*parent, *c, t) : QTransform(); };
    for (int i = 0; i <= steps; ++i) {
        const double t = t0 + (t1 - t0) * i / steps;
        poly << (parentT(t) * view).map(Property::toPoint(l.position.valueAt(t)));
    }
    const QColor lc = labelColor(l.label);
    p.setPen(QPen(lc, 1, Qt::DotLine));
    p.setBrush(Qt::NoBrush);
    p.drawPolyline(poly);
    p.setPen(Qt::NoPen);
    p.setBrush(lc);
    for (int i = 0; i <= steps; ++i)
        p.drawEllipse(poly[i], 1.2, 1.2);
    for (const auto &k : l.position.keys) {
        const QPointF kp = (parentT(k.time) * view).map(Property::toPoint(k.value));
        p.setBrush(k.selected ? theme::keyframeSelected : lc);
        p.drawRect(QRectF(kp - QPointF(3, 3), QSizeF(6, 6)));
    }
}

void CompViewer::drawOverlays(QPainter &p)
{
    Composition *c = ed_->activeComp();
    const double t = ed_->time();
    const QTransform view = viewTransform();
    p.setRenderHint(QPainter::Antialiasing);
    for (Layer *l : ed_->selectedLayers()) {
        drawMotionPath(p, *l, view);
        const QTransform m = ed_->renderer().layerToComp(*l, *c, t) * view;
        const QRectF b = ed_->renderer().layerBounds(*l, *c, t);
        const QColor lc = labelColor(l->label);
        p.setPen(QPen(lc, 1));
        p.setBrush(Qt::NoBrush);
        p.drawPolygon(m.map(QPolygonF(b)));
        if (l->type == LayerType::Text) {
            // Baseline marker under the first line, like AE's text layer overlay.
            p.drawLine(m.map(QPointF(b.left(), 0)), m.map(QPointF(b.right(), 0)));
        }
        const QPointF pts[8] = {b.topLeft(), {b.center().x(), b.top()}, b.topRight(), {b.right(), b.center().y()},
                                b.bottomRight(), {b.center().x(), b.bottom()}, b.bottomLeft(), {b.left(), b.center().y()}};
        p.setBrush(QColor(0x23, 0x23, 0x23));
        for (const QPointF &pt : pts) {
            const QPointF w = m.map(pt);
            p.drawRect(QRectF(w - QPointF(3.5, 3.5), QSizeF(7, 7)));
        }
        const QPointF a = m.map(Property::toPoint(ed_->renderer().eval(l->anchor, t, *l, *c)));
        p.setBrush(Qt::NoBrush);
        p.setPen(QPen(Qt::white, 1));
        p.drawEllipse(a, 4.5, 4.5);
        p.drawLine(a - QPointF(9, 0), a + QPointF(9, 0));
        p.drawLine(a - QPointF(0, 9), a + QPointF(0, 9));
    }
    // Null objects are always outlined so they can be found and grabbed.
    for (const auto &l : c->layers)
        if (l->type == LayerType::Null && l->activeAt(t) && !ed_->isSelected(l->id)) {
            const QTransform m = ed_->renderer().layerToComp(*l, *c, t) * view;
            p.setPen(QPen(labelColor(l->label), 1));
            p.drawPolygon(m.map(QPolygonF(QRectF(0, 0, l->width, l->height))));
        }
}

Layer *CompViewer::hitTest(QPointF compPt) const
{
    Composition *c = ed_->activeComp();
    if (!c)
        return nullptr;
    const double t = ed_->time();
    for (const auto &l : c->layers) {
        if (!l->activeAt(t) || l->locked || (!l->videoOn && l->type != LayerType::Null))
            continue;
        if (c->hideShyLayers && l->shy)
            continue;
        bool invertible = false;
        const QTransform inv = ed_->renderer().layerToComp(*l, *c, t).inverted(&invertible);
        if (!invertible)
            continue;
        const QRectF b = ed_->renderer().layerBounds(*l, *c, t);
        if (b.contains(inv.map(compPt)))
            return l.get();
    }
    return nullptr;
}

CompViewer::Handle CompViewer::handleAt(QPointF w, Layer *&layerOut) const
{
    Composition *c = ed_->activeComp();
    const double t = ed_->time();
    for (Layer *l : ed_->selectedLayers()) {
        if (l->locked)
            continue;
        const QTransform m = ed_->renderer().layerToComp(*l, *c, t) * viewTransform();
        const QRectF b = ed_->renderer().layerBounds(*l, *c, t);
        const QPointF pts[8] = {b.topLeft(), {b.center().x(), b.top()}, b.topRight(), {b.right(), b.center().y()},
                                b.bottomRight(), {b.center().x(), b.bottom()}, b.bottomLeft(), {b.left(), b.center().y()}};
        for (int i = 0; i < 8; ++i)
            if (QLineF(m.map(pts[i]), w).length() < 7) {
                layerOut = l;
                return Handle(i + 1);
            }
    }
    return HNone;
}

QPointF CompViewer::parentSpaceDelta(const Layer &l, QPointF compDelta) const
{
    Composition *c = ed_->activeComp();
    const Layer *parent = c->parentOf(l);
    if (!parent)
        return compDelta;
    const QTransform inv = ed_->renderer().layerToComp(*parent, *c, ed_->time()).inverted();
    return inv.map(compDelta) - inv.map(QPointF(0, 0));
}

void CompViewer::mousePressEvent(QMouseEvent *e)
{
    Composition *c = ed_->activeComp();
    pressWidget_ = e->position();
    pressComp_ = toComp(e->position());
    moved_ = false;
    if (!c)
        return;
    if (e->button() == Qt::MiddleButton || (e->button() == Qt::LeftButton && tool_ == Tool::Hand)) {
        drag_ = Drag::Pan;
        panStart_ = pan_;
        setCursor(Qt::ClosedHandCursor);
        return;
    }
    if (e->button() != Qt::LeftButton)
        return;
    const double t = ed_->time();
    switch (tool_) {
    case Tool::Zoom:
        setZoom(zoom_ * ((e->modifiers() & Qt::AltModifier) ? 0.5 : 2.0), e->position());
        return;
    case Tool::Text: {
        ed_->newText("Text", pressComp_);
        if (Layer *l = ed_->primaryLayer())
            showTextEditor(this, ed_, l->id);
        emit toolChangeRequested(Tool::Select);
        return;
    }
    case Tool::Rect:
    case Tool::Ellipse:
    case Tool::Polygon:
    case Tool::Star:
        drag_ = Drag::Shape;
        shapeRect_ = QRectF(pressComp_, QSizeF());
        return;
    default:
        break;
    }

    Layer *hl = nullptr;
    const Handle h = tool_ == Tool::Select ? handleAt(e->position(), hl) : HNone;
    Layer *hit = h != HNone ? hl : hitTest(pressComp_);
    if (h == HNone) {
        if (!hit) {
            ed_->clearSelection();
            drag_ = Drag::None;
            return;
        }
        if (e->modifiers() & Qt::ShiftModifier)
            ed_->selectLayer(hit->id, false, true);
        else if (!ed_->isSelected(hit->id))
            ed_->selectLayer(hit->id);
    }
    starts_.clear();
    for (Layer *l : ed_->selectedLayers()) {
        if (l->locked)
            continue;
        Start s;
        s.id = l->id;
        s.position = l->position.valueAt(t);
        s.scale = l->scale.valueAt(t);
        s.anchor = l->anchor.valueAt(t);
        s.rotation = l->rotation.valueAt(t).value(0);
        s.toComp = ed_->renderer().layerToComp(*l, *c, t);
        const Layer *parent = c->parentOf(*l);
        s.parentToComp = parent ? ed_->renderer().layerToComp(*parent, *c, t) : QTransform();
        starts_.push_back(s);
    }
    if (h != HNone) {
        drag_ = Drag::Scale;
        handle_ = h;
        // Only scale the grabbed layer.
        starts_.erase(std::remove_if(starts_.begin(), starts_.end(), [&](const Start &s) { return s.id != hl->id; }),
                      starts_.end());
    } else if (tool_ == Tool::Rotate) {
        drag_ = Drag::Rotate;
    } else if (tool_ == Tool::Anchor) {
        drag_ = Drag::Anchor;
    } else {
        drag_ = Drag::Move;
    }
}

void CompViewer::mouseMoveEvent(QMouseEvent *e)
{
    Composition *c = ed_->activeComp();
    const QPointF cp = toComp(e->position());
    if (c) {
        const QPointF ip = cp * frameScale_;
        const bool inside = QRectF(0, 0, c->width, c->height).contains(cp);
        QColor col;
        if (inside && frame_.valid(ip.toPoint()))
            col = QColor::fromRgba(frame_.pixel(ip.toPoint()));
        emit cursorInfo(cp, col, inside);
    }
    if (drag_ == Drag::None || !c)
        return;
    if (drag_ == Drag::Pan) {
        pan_ = panStart_ + (e->position() - pressWidget_);
        fit_ = false;
        update();
        return;
    }
    QPointF delta = cp - pressComp_;
    if (!moved_ && QLineF(e->position(), pressWidget_).length() < 3)
        return;
    moved_ = true;
    const double t = ed_->time();
    const bool shift = e->modifiers() & Qt::ShiftModifier;

    if (drag_ == Drag::Shape) {
        QPointF end = cp;
        if (shift) {
            const double s = std::max(std::abs(delta.x()), std::abs(delta.y()));
            end = pressComp_ + QPointF(delta.x() < 0 ? -s : s, delta.y() < 0 ? -s : s);
        }
        shapeRect_ = QRectF(pressComp_, end).normalized();
        update();
        return;
    }
    for (const Start &s : starts_) {
        Layer *l = c->layerById(s.id);
        if (!l)
            continue;
        switch (drag_) {
        case Drag::Move: {
            QPointF d = delta;
            if (shift)
                (std::abs(d.x()) > std::abs(d.y()) ? d.ry() : d.rx()) = 0;
            const QPointF pd = parentSpaceDelta(*l, d);
            l->position.setValue(t, {s.position[0] + pd.x(), s.position[1] + pd.y()});
            break;
        }
        case Drag::Scale: {
            bool ok = false;
            const QTransform inv = s.toComp.inverted(&ok);
            if (!ok)
                break;
            const QPointF a(s.anchor[0], s.anchor[1]);
            const QPointF p0 = inv.map(pressComp_) - a, p1 = inv.map(cp) - a;
            double fx = (std::abs(p0.x()) > 1e-3) ? p1.x() / p0.x() : 1.0;
            double fy = (std::abs(p0.y()) > 1e-3) ? p1.y() / p0.y() : 1.0;
            if (handle_ == HT || handle_ == HB)
                fx = shift ? fy : 1.0;
            if (handle_ == HL || handle_ == HR)
                fy = shift ? fx : 1.0;
            if (shift && handle_ != HT && handle_ != HB && handle_ != HL && handle_ != HR)
                fy = fx = (std::abs(fx) > std::abs(fy) ? fx : fy);
            l->scale.setValue(t, {s.scale[0] * fx, s.scale[1] * fy});
            break;
        }
        case Drag::Rotate: {
            const QPointF a = s.toComp.map(QPointF(s.anchor[0], s.anchor[1]));
            const double a0 = std::atan2(pressComp_.y() - a.y(), pressComp_.x() - a.x());
            const double a1 = std::atan2(cp.y() - a.y(), cp.x() - a.x());
            double deg = qRadiansToDegrees(a1 - a0);
            if (shift)
                deg = std::round(deg / 45.0) * 45.0;
            l->rotation.setValue(t, {s.rotation + deg});
            break;
        }
        case Drag::Anchor: {
            // Pan Behind: move the anchor in layer space, compensate position so pixels stay put.
            bool ok = false;
            const QTransform inv = s.toComp.inverted(&ok);
            if (!ok)
                break;
            const QPointF la = inv.map(cp) - inv.map(pressComp_);
            l->anchor.setValue(t, {s.anchor[0] + la.x(), s.anchor[1] + la.y()});
            const QPointF pd = parentSpaceDelta(*l, delta);
            l->position.setValue(t, {s.position[0] + pd.x(), s.position[1] + pd.y()});
            break;
        }
        default:
            break;
        }
    }
    ed_->touch();
}

void CompViewer::mouseReleaseEvent(QMouseEvent *e)
{
    const Drag d = drag_;
    drag_ = Drag::None;
    if (d == Drag::Pan) {
        setTool(tool_);
        return;
    }
    if (d == Drag::Shape) {
        const QRectF r = shapeRect_;
        shapeRect_ = {};
        if (r.width() > 3 && r.height() > 3) {
            const ShapeKind k = tool_ == Tool::Ellipse ? ShapeKind::Ellipse
                                : tool_ == Tool::Polygon ? ShapeKind::Polygon
                                : tool_ == Tool::Star    ? ShapeKind::Star
                                                         : ShapeKind::Rectangle;
            ed_->newShape(k, r);
        }
        update();
        return;
    }
    if (!moved_)
        return;
    switch (d) {
    case Drag::Move: ed_->commit("Move Layer"); break;
    case Drag::Scale: ed_->commit("Scale Layer"); break;
    case Drag::Rotate: ed_->commit("Rotate Layer"); break;
    case Drag::Anchor: ed_->commit("Move Anchor Point"); break;
    default: break;
    }
    Q_UNUSED(e);
}

void CompViewer::mouseDoubleClickEvent(QMouseEvent *e)
{
    Layer *l = hitTest(toComp(e->position()));
    if (!l)
        return;
    if (l->type == LayerType::Text)
        showTextEditor(this, ed_, l->id);
    else if (l->type == LayerType::Precomp)
        ed_->setActiveComp(l->sourceItemId);
}

void CompViewer::wheelEvent(QWheelEvent *e)
{
    const double steps = e->angleDelta().y() / 120.0;
    if (e->modifiers() & Qt::ShiftModifier) {
        pan_.rx() += e->angleDelta().y() / 2.0;
        fit_ = false;
        update();
    } else if (e->modifiers() & Qt::ControlModifier) {
        pan_.ry() += e->angleDelta().y() / 2.0;
        fit_ = false;
        update();
    } else {
        setZoom(zoom_ * std::pow(1.15, steps), e->position());
    }
}

void CompViewer::dragEnterEvent(QDragEnterEvent *e)
{
    const QMimeData *m = e->mimeData();
    if (m->hasFormat("application/x-motionforge-item") || m->hasFormat("application/x-motionforge-effect") ||
        m->hasFormat("application/x-motionforge-preset") || m->hasUrls())
        e->acceptProposedAction();
}

void CompViewer::dropEvent(QDropEvent *e)
{
    const QMimeData *m = e->mimeData();
    const QPointF cp = toComp(e->position());
    if (m->hasFormat("application/x-motionforge-item")) {
        ed_->addItemLayer(m->data("application/x-motionforge-item").toInt(), cp);
    } else if (m->hasFormat("application/x-motionforge-effect") || m->hasFormat("application/x-motionforge-preset")) {
        if (Layer *l = hitTest(cp))
            ed_->selectLayer(l->id);
        if (m->hasFormat("application/x-motionforge-effect"))
            ed_->addEffect(QString::fromUtf8(m->data("application/x-motionforge-effect")));
        else
            ed_->applyPreset(QString::fromUtf8(m->data("application/x-motionforge-preset")));
    } else if (m->hasUrls()) {
        for (const QUrl &u : m->urls()) {
            QString err;
            if (FootageItem *f = ed_->importFile(u.toLocalFile(), &err)) {
                if (ed_->activeComp())
                    ed_->addItemLayer(f->id, cp);
                else
                    ed_->newCompFromItem(f->id);
            } else {
                emit ed_->message(QFileInfo(u.toLocalFile()).fileName() + ": " + err);
            }
        }
    }
    e->acceptProposedAction();
}

// ------------------------------------------------------------ panel

CompPanel::CompPanel(Editor *editor, QWidget *parent) : QWidget(parent), ed_(editor)
{
    auto *v = new QVBoxLayout(this);
    v->setContentsMargins(0, 0, 0, 0);
    v->setSpacing(0);

    auto *top = new QWidget;
    top->setStyleSheet("background:#1d1d1d;");
    auto *th = new QHBoxLayout(top);
    th->setContentsMargins(6, 2, 6, 2);
    auto *compLbl = new QLabel("Composition:");
    compLbl->setStyleSheet("color:#8a8a8a;");
    compCombo_ = new QComboBox;
    compCombo_->setMinimumWidth(180);
    compCombo_->setFocusPolicy(Qt::NoFocus);
    th->addWidget(compLbl);
    th->addWidget(compCombo_);
    th->addStretch();
    v->addWidget(top);

    viewer_ = new CompViewer(editor);
    v->addWidget(viewer_, 1);

    auto *bar = new QWidget;
    bar->setStyleSheet("background:#1d1d1d;");
    auto *h = new QHBoxLayout(bar);
    h->setContentsMargins(6, 2, 6, 2);
    h->setSpacing(6);
    zoomCombo_ = new QComboBox;
    zoomCombo_->setFocusPolicy(Qt::NoFocus);
    zoomCombo_->addItem("Fit", 0.0);
    for (double z : {0.125, 0.25, 0.333, 0.5, 0.667, 1.0, 1.5, 2.0, 4.0, 8.0})
        zoomCombo_->addItem(QString("%1%").arg(z * 100, 0, 'f', z * 100 == std::floor(z * 100) ? 0 : 1), z);
    zoomCombo_->setEditable(false);
    resCombo_ = new QComboBox;
    resCombo_->setFocusPolicy(Qt::NoFocus);
    resCombo_->addItems({"Auto", "Full", "Half", "Third", "Quarter"});
    timeLabel_ = new QLabel;
    timeLabel_->setStyleSheet("color:#3d9df2; font-family:monospace;");
    renderLabel_ = new QLabel;
    renderLabel_->setStyleSheet("color:#6a6a6a;");
    auto mkToggle = [&](const QString &ic, const QString &tip, std::function<void(bool)> fn) {
        auto *b = new QToolButton;
        b->setIcon(icon(ic));
        b->setToolTip(tip);
        b->setCheckable(true);
        b->setFocusPolicy(Qt::NoFocus);
        connect(b, &QToolButton::toggled, this, fn);
        return b;
    };
    h->addWidget(zoomCombo_);
    h->addWidget(resCombo_);
    h->addWidget(mkToggle("checker", "Toggle Transparency Grid", [this](bool on) { viewer_->setTransparencyGrid(on); }));
    h->addWidget(mkToggle("grid", "Toggle Grid & Safe Margins", [this](bool on) { viewer_->setShowGrid(on); }));
    h->addSpacing(8);
    h->addWidget(timeLabel_);
    h->addStretch();
    h->addWidget(renderLabel_);
    v->addWidget(bar);

    connect(zoomCombo_, &QComboBox::activated, this, [this](int i) {
        const double z = zoomCombo_->itemData(i).toDouble();
        if (z <= 0)
            viewer_->fitToView();
        else
            viewer_->setZoom(z);
    });
    connect(resCombo_, &QComboBox::activated, viewer_, &CompViewer::setResolution);
    connect(viewer_, &CompViewer::zoomChanged, this, [this](double z) {
        zoomCombo_->setItemText(0, QString("Fit (%1%)").arg(z * 100, 0, 'f', 1));
    });
    connect(viewer_, &CompViewer::renderTimeChanged, this,
            [this](int ms) { renderLabel_->setText(QString("Render: %1 ms").arg(ms)); });
    connect(compCombo_, &QComboBox::activated, this,
            [this](int i) { ed_->setActiveComp(compCombo_->itemData(i).toInt()); });
    connect(ed_, &Editor::projectChanged, this, &CompPanel::refreshComps);
    connect(ed_, &Editor::activeCompChanged, this, &CompPanel::refreshComps);
    connect(ed_, &Editor::timeChanged, this, &CompPanel::refreshTime);
    refreshComps();
}

void CompPanel::refreshComps()
{
    compCombo_->clear();
    for (Composition *c : ed_->project().compositions())
        compCombo_->addItem(icon("comp"), c->name, c->id);
    if (Composition *c = ed_->activeComp())
        compCombo_->setCurrentIndex(compCombo_->findData(c->id));
    refreshTime();
}

void CompPanel::refreshTime()
{
    Composition *c = ed_->activeComp();
    timeLabel_->setText(c ? timecode(ed_->time(), c->fps) : QString());
}

} // namespace mf
