#pragma once
#include "Editor.h"

#include <QWidget>
#include <functional>

class QLineEdit;
class QScrollBar;
class QSlider;
class QToolButton;
class QLabel;
class QMenu;

namespace mf {

class ScrubField;

class TimelineView : public QWidget {
    Q_OBJECT
public:
    explicit TimelineView(Editor *editor, QWidget *parent = nullptr);

    std::function<void(QMenu &)> layerMenuBuilder;
    void setFilter(const QString &f) { filter_ = f; rebuild(); }
    void zoomTime(double factor, std::optional<double> aroundX = std::nullopt);
    void fitTime();
    void setViewStart(double s);
    double viewStart() const { return viewStart_; }
    double visibleDuration() const;
    int contentHeight() const { return contentHeight_; }
    void setScrollY(int y) { scrollY_ = y; update(); }
    void rebuild();

signals:
    void viewChanged();
    void contentHeightChanged(int h);

protected:
    void paintEvent(QPaintEvent *) override;
    void mousePressEvent(QMouseEvent *e) override;
    void mouseMoveEvent(QMouseEvent *e) override;
    void mouseReleaseEvent(QMouseEvent *e) override;
    void mouseDoubleClickEvent(QMouseEvent *e) override;
    void wheelEvent(QWheelEvent *e) override;
    void resizeEvent(QResizeEvent *) override;
    void contextMenuEvent(QContextMenuEvent *e) override;
    void dragEnterEvent(QDragEnterEvent *e) override;
    void dropEvent(QDropEvent *e) override;

private:
    enum class Kind { Layer, Group, Effect, Prop, Expr };
    struct Row {
        Kind kind;
        Layer *layer = nullptr;
        Property *prop = nullptr;
        Effect *effect = nullptr;
        QString title;
        int depth = 0;
        int y = 0;
        int h = 22;
        int groupId = 0;   // 1 contents, 2 transform, 3 effects
    };
    enum class Drag { None, Cti, WorkStart, WorkEnd, WorkBar, LayerMove, LayerTrimIn, LayerTrimOut, Keys, Marquee,
                      Scrub, Reorder, Divider, Marker };
    struct ValueHit {
        QRectF rect;
        int dim;
    };

    int timeX(double t) const;
    double xTime(double x) const;
    int leftWidth() const;
    int areaLeft() const { return leftWidth() + 1; }
    int rowAt(int y) const;
    QString valueText(const Property &p, const Value &v, int dim) const;
    std::vector<ValueHit> valueRects(const Row &r, const Value &v) const;
    Value currentValue(const Row &r) const;
    void paintHeader(QPainter &p);
    void paintRow(QPainter &p, const Row &r, int idx);
    void paintKeyframe(QPainter &p, QPointF c, const Keyframe &k, bool atTime);
    void beginRename(Layer *l, int y);
    void showModeMenu(Layer *l, QPoint pos);
    void showMatteMenu(Layer *l, QPoint pos);
    void showParentMenu(Layer *l, QPoint pos);
    void showLabelMenu(Layer *l, QPoint pos);
    void editValue(const Row &r, int dim, QRectF rect);
    void setTimeFromX(double x);
    double snapTime(double t) const;
    int keyAt(const Row &r, QPointF pos) const;
    int markerAt(QPointF pos) const;
    // Returns the delta that snaps any of `times` (+ delta) onto a snap target within 10 px.
    double snapDelta(const std::vector<double> &times, double delta, bool exceptCti = false) const;
    void paintWaveform(QPainter &p, const Layer &l, int top, int h);

    Editor *ed_;
    std::vector<Row> rows_;
    QString filter_;
    int nameW_ = 190;
    int scrollY_ = 0;
    int contentHeight_ = 0;
    double viewStart_ = 0.0;
    double pxPerSec_ = 100.0;
    bool fitPending_ = true;

    Drag drag_ = Drag::None;
    QPointF pressPos_;
    bool moved_ = false;
    double dragT0_ = 0;
    int dragRow_ = -1;
    int dragDim_ = 0;
    Value scrubStart_;
    struct LayerTimes { int id; double in, out, start; };
    std::vector<LayerTimes> layerStarts_;
    struct KeyStart { Property *prop; int index; double time; };
    std::vector<KeyStart> keyStarts_;
    QRectF marquee_;
    int reorderTarget_ = -1;
    int dragMarker_ = -1;
    QLineEdit *renameEdit_ = nullptr;
};

// Timeline panel: time display, search, comp switches, the view, scrollbars.
class TimelinePanel : public QWidget {
    Q_OBJECT
public:
    explicit TimelinePanel(Editor *editor, QWidget *parent = nullptr);
    TimelineView *view() const { return view_; }

private:
    void refresh();
    Editor *ed_;
    TimelineView *view_;
    QLabel *timeLabel_;
    QLabel *frameLabel_;
    QLabel *compLabel_;
    QToolButton *shyBtn_;
    QToolButton *mbBtn_;
    QScrollBar *vbar_;
    QScrollBar *hbar_;
    QSlider *zoom_;
};

} // namespace mf
