#include "InfoPreviewPanel.h"

#include "CompViewer.h"
#include "Icons.h"
#include "PlaybackController.h"

#include <QGridLayout>
#include <QHBoxLayout>
#include <QLabel>
#include <QToolButton>
#include <QVBoxLayout>

namespace mf {

InfoPanel::InfoPanel(Editor *editor, CompViewer *viewer, QWidget *parent) : QWidget(parent), ed_(editor)
{
    setMinimumHeight(120);
    auto *v = new QVBoxLayout(this);
    v->setContentsMargins(8, 6, 8, 6);
    auto *h = new QHBoxLayout;
    rgba_ = new QLabel;
    xy_ = new QLabel;
    QFont mono("Monospace");
    mono.setStyleHint(QFont::Monospace);
    rgba_->setFont(mono);
    xy_->setFont(mono);
    h->addWidget(rgba_);
    h->addStretch();
    h->addWidget(xy_);
    v->addLayout(h);
    details_ = new QLabel;
    details_->setWordWrap(true);
    details_->setStyleSheet("color:#9a9a9a;");
    details_->setTextFormat(Qt::RichText);
    v->addWidget(details_);
    v->addStretch();
    connect(viewer, &CompViewer::cursorInfo, this, [this](QPointF p, QColor c, bool inside) {
        if (!inside) {
            rgba_->setText("R:\nG:\nB:\nA:");
        } else {
            rgba_->setText(QString("<span style='color:#e06060'>R: %1</span><br><span style='color:#60d060'>G: %2</span><br>"
                                   "<span style='color:#6090ff'>B: %3</span><br>A: %4")
                               .arg(c.red()).arg(c.green()).arg(c.blue()).arg(c.alpha()));
        }
        xy_->setText(QString("X: %1\nY: %2").arg(int(std::floor(p.x()))).arg(int(std::floor(p.y()))));
    });
    connect(ed_, &Editor::selectionChanged, this, &InfoPanel::refreshSelection);
    connect(ed_, &Editor::valuesChanged, this, &InfoPanel::refreshSelection);
    connect(ed_, &Editor::timeChanged, this, &InfoPanel::refreshSelection);
    connect(ed_, &Editor::message, this, [this](const QString &m) {
        details_->setText("<span style='color:#c6c6c6'>" + m.toHtmlEscaped() + "</span>");
    });
    rgba_->setText("R:\nG:\nB:\nA:");
    xy_->setText("X:\nY:");
}

void InfoPanel::refreshSelection()
{
    Composition *c = ed_->activeComp();
    Layer *l = ed_->primaryLayer();
    if (!c || !l) {
        details_->clear();
        return;
    }
    QString t = QString("<b style='color:#ddd'>%1</b><br>%2 · In %3 · Out %4 · Δ %5")
                    .arg(l->name.toHtmlEscaped(), layerTypeName(l->type), timecode(l->inPoint, c->fps),
                         timecode(l->outPoint, c->fps), timecode(l->outPoint - l->inPoint, c->fps));
    QStringList errors;
    l->forEachProperty([&](Property &p) {
        if (!p.expressionError.isEmpty())
            errors << QString("%1: %2").arg(p.name, p.expressionError).toHtmlEscaped();
    });
    if (!errors.isEmpty())
        t += "<br><span style='color:#e06060'>Expression error — " + errors.join("<br>") + "</span>";
    details_->setText(t);
}

PreviewPanel::PreviewPanel(Editor *editor, PlaybackController *playback, QWidget *parent)
    : QWidget(parent), ed_(editor), pb_(playback)
{
    auto *v = new QVBoxLayout(this);
    v->setContentsMargins(8, 6, 8, 6);
    auto *h = new QHBoxLayout;
    auto mk = [&](const char *ic, const QString &tip, std::function<void()> fn) {
        auto *b = new QToolButton;
        b->setIcon(icon(ic));
        b->setIconSize(QSize(20, 20));
        b->setToolTip(tip);
        b->setFocusPolicy(Qt::NoFocus);
        connect(b, &QToolButton::clicked, this, fn);
        h->addWidget(b);
        return b;
    };
    mk("first", "First Frame (Home)", [this] { ed_->setTime(0); });
    mk("prev", "Previous Frame (Page Up)", [this] { ed_->stepFrames(-1); });
    play_ = mk("play", "Play/Stop (Space)", [this] { pb_->toggle(); });
    mk("next", "Next Frame (Page Down)", [this] { ed_->stepFrames(1); });
    mk("last", "Last Frame (End)", [this] {
        if (Composition *c = ed_->activeComp())
            ed_->setTime(c->duration);
    });
    auto *loop = mk("loop", "Loop", [] {});
    loop->setCheckable(true);
    loop->setChecked(true);
    connect(loop, &QToolButton::toggled, this, [this](bool on) { pb_->setLoop(on); });
    h->addStretch();
    v->addLayout(h);
    fps_ = new QLabel("Space plays the work area. Frames render once, then play back in real time from cache.");
    fps_->setWordWrap(true);
    fps_->setStyleSheet("color:#8a8a8a;");
    v->addWidget(fps_);
    v->addStretch();
    connect(pb_, &PlaybackController::playingChanged, this,
            [this](bool on) { play_->setIcon(icon(on ? "pause" : "play")); });
    connect(pb_, &PlaybackController::fpsMeasured, this, [this](double fps, bool rt) {
        Composition *c = ed_->activeComp();
        fps_->setText(QString("<span style='color:%1'>%2 fps</span> %3")
                          .arg(rt ? "#36b34a" : "#e0a040")
                          .arg(fps, 0, 'f', 1)
                          .arg(rt ? "(real-time)" : QString("(target %1, caching)").arg(c ? c->fps : 0, 0, 'f', 2)));
    });
}

} // namespace mf
