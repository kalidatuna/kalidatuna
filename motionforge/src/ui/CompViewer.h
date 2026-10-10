#pragma once
#include "Editor.h"

#include <QImage>
#include <QWidget>

class QComboBox;
class QLabel;
class QToolButton;

namespace mf {

enum class Tool { Select, Hand, Zoom, Rotate, Anchor, Rect, Ellipse, Polygon, Star, Text };

class CompViewer : public QWidget {
    Q_OBJECT
public:
    explicit CompViewer(Editor *editor, QWidget *parent = nullptr);

    void setTool(Tool t);
    Tool tool() const { return tool_; }
    double zoom() const { return zoom_; }
    void setZoom(double z, std::optional<QPointF> around = std::nullopt);
    void fitToView();
    void zoomBy(double factor);
    void setResolution(int r);   // 0 auto, 1 full, 2 half, 3 third, 4 quarter
    int resolution() const { return resolution_; }
    double renderScale() const;
    void setTransparencyGrid(bool on) { checker_ = on; update(); }
    void setShowGrid(bool on) { grid_ = on; update(); }
    bool transparencyGrid() const { return checker_; }
    bool showGrid() const { return grid_; }
    void invalidate() { dirty_ = true; update(); }
    QImage currentFrame() const { return frame_; }

signals:
    void zoomChanged(double zoom);
    void cursorInfo(QPointF compPos, QColor color, bool inside);
    void renderTimeChanged(int ms);
    void toolChangeRequested(Tool t);

protected:
    void paintEvent(QPaintEvent *) override;
    void resizeEvent(QResizeEvent *) override;
    void mousePressEvent(QMouseEvent *e) override;
    void mouseMoveEvent(QMouseEvent *e) override;
    void mouseReleaseEvent(QMouseEvent *e) override;
    void mouseDoubleClickEvent(QMouseEvent *e) override;
    void wheelEvent(QWheelEvent *e) override;
    void dragEnterEvent(QDragEnterEvent *e) override;
    void dropEvent(QDropEvent *e) override;

private:
    enum class Drag { None, Pan, Move, Scale, Rotate, Anchor, Shape };
    enum Handle { HNone, HTL, HT, HTR, HR, HBR, HB, HBL, HL };

    QTransform viewTransform() const;   // comp pixels -> widget
    QPointF toComp(QPointF w) const { return viewTransform().inverted().map(w); }
    Layer *hitTest(QPointF compPt) const;
    Handle handleAt(QPointF widgetPt, Layer *&layerOut) const;
    void drawOverlays(QPainter &p);
    void drawMotionPath(QPainter &p, Layer &l, const QTransform &view);
    QPointF parentSpaceDelta(const Layer &l, QPointF compDelta) const;

    Editor *ed_;
    Tool tool_ = Tool::Select;
    double zoom_ = 0.5;
    bool fit_ = true;
    QPointF pan_;
    int resolution_ = 0;
    bool checker_ = false;
    bool grid_ = false;
    bool dirty_ = true;
    QImage frame_;
    double frameScale_ = 1.0;

    Drag drag_ = Drag::None;
    Handle handle_ = HNone;
    QPointF pressWidget_;
    QPointF pressComp_;
    QPointF panStart_;
    bool moved_ = false;
    struct Start {
        int id;
        Value position, scale, anchor;
        double rotation;
        QTransform toComp;
        QTransform parentToComp;
    };
    std::vector<Start> starts_;
    QRectF shapeRect_;
};

// The Composition panel: comp switcher, viewer and the bottom control strip.
class CompPanel : public QWidget {
    Q_OBJECT
public:
    explicit CompPanel(Editor *editor, QWidget *parent = nullptr);
    CompViewer *viewer() const { return viewer_; }

private:
    void refreshComps();
    void refreshTime();
    Editor *ed_;
    CompViewer *viewer_;
    QComboBox *compCombo_;
    QComboBox *zoomCombo_;
    QComboBox *resCombo_;
    QLabel *timeLabel_;
    QLabel *renderLabel_;
};

QString timecode(double t, double fps);

} // namespace mf
