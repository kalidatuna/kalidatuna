#include "Dialogs.h"

#include "Theme.h"

#include <QCheckBox>
#include <QColorDialog>
#include <QComboBox>
#include <QDialogButtonBox>
#include <QDoubleSpinBox>
#include <QFormLayout>
#include <QGroupBox>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QPainter>
#include <QPlainTextEdit>
#include <QPushButton>
#include <QSpinBox>
#include <QSplitter>
#include <QTableWidget>
#include <QHeaderView>
#include <QVBoxLayout>

namespace mf {

// ------------------------------------------------------------ ColorButton

ColorButton::ColorButton(QColor c, QWidget *parent) : QWidget(parent), color_(c)
{
    setCursor(Qt::PointingHandCursor);
    setFixedSize(40, 18);
}

void ColorButton::paintEvent(QPaintEvent *)
{
    QPainter p(this);
    p.fillRect(rect().adjusted(1, 1, -1, -1), color_);
    p.setPen(QColor(0x60, 0x60, 0x60));
    p.drawRect(rect().adjusted(0, 0, -1, -1));
}

void ColorButton::mousePressEvent(QMouseEvent *)
{
    const QColor before = color_;
    QColorDialog dlg(color_, this);
    connect(&dlg, &QColorDialog::currentColorChanged, this, [this](const QColor &c) {
        color_ = c;
        update();
        emit colorChanging(c);
    });
    if (dlg.exec() == QDialog::Accepted) {
        color_ = dlg.selectedColor();
        update();
        emit colorPicked(color_);
    } else {
        color_ = before;
        update();
        emit pickCancelled();
    }
}

// ------------------------------------------------------------ Composition

namespace {
struct Preset {
    const char *name;
    int w, h;
    double fps;
};
const Preset kPresets[] = {
    {"Custom", 0, 0, 0},
    {"HD 1080p 30", 1920, 1080, 30},
    {"HD 1080p 29.97", 1920, 1080, 29.97},
    {"HD 1080p 25", 1920, 1080, 25},
    {"HD 1080p 24", 1920, 1080, 24},
    {"HD 1080p 23.976", 1920, 1080, 23.976},
    {"HD 1080p 60", 1920, 1080, 60},
    {"HD 720p 30", 1280, 720, 30},
    {"UHD 4K 30", 3840, 2160, 30},
    {"UHD 4K 24", 3840, 2160, 24},
    {"Vertical 1080x1920 30 (TikTok / Reels / Shorts)", 1080, 1920, 30},
    {"Vertical 1080x1920 60", 1080, 1920, 60},
    {"Square 1080x1080 30", 1080, 1080, 30},
    {"Portrait 1080x1350 30", 1080, 1350, 30},
};
} // namespace

CompositionDialog::CompositionDialog(const CompSettings &s, bool isNew, QWidget *parent) : QDialog(parent)
{
    setWindowTitle(isNew ? "Composition Settings — New" : "Composition Settings");
    auto *v = new QVBoxLayout(this);
    auto *form = new QFormLayout;
    name_ = new QLineEdit(s.name);
    preset_ = new QComboBox;
    for (const auto &p : kPresets)
        preset_->addItem(p.name);
    w_ = new QSpinBox;
    w_->setRange(4, 16384);
    w_->setValue(s.width);
    h_ = new QSpinBox;
    h_->setRange(4, 16384);
    h_->setValue(s.height);
    lockAspect_ = new QCheckBox("Lock Aspect Ratio");
    aspect_ = double(s.width) / s.height;
    fps_ = new QComboBox;
    fps_->setEditable(true);
    for (const char *f : {"8", "12", "15", "23.976", "24", "25", "29.97", "30", "48", "50", "59.94", "60", "120"})
        fps_->addItem(f);
    fps_->setCurrentText(QString::number(s.fps));
    dur_ = new QDoubleSpinBox;
    dur_->setRange(0.1, 36000);
    dur_->setDecimals(2);
    dur_->setSuffix(" s");
    dur_->setValue(s.duration);
    bg_ = new ColorButton(s.background);

    auto *size = new QHBoxLayout;
    size->addWidget(w_);
    size->addWidget(new QLabel("×"));
    size->addWidget(h_);
    size->addWidget(new QLabel("px"));
    size->addWidget(lockAspect_);
    size->addStretch();
    form->addRow("Composition Name:", name_);
    form->addRow("Preset:", preset_);
    form->addRow("Size:", size);
    form->addRow("Frame Rate:", fps_);
    form->addRow("Duration:", dur_);
    form->addRow("Background Color:", bg_);
    v->addLayout(form);

    auto *adv = new QGroupBox("Motion Blur");
    auto *af = new QFormLayout(adv);
    samples_ = new QSpinBox;
    samples_->setRange(2, 64);
    samples_->setValue(s.mbSamples);
    shutter_ = new QDoubleSpinBox;
    shutter_->setRange(0, 720);
    shutter_->setSuffix("°");
    shutter_->setValue(s.shutterAngle);
    af->addRow("Shutter Angle:", shutter_);
    af->addRow("Samples Per Frame:", samples_);
    v->addWidget(adv);

    auto *bb = new QDialogButtonBox(QDialogButtonBox::Ok | QDialogButtonBox::Cancel);
    v->addWidget(bb);
    connect(bb, &QDialogButtonBox::accepted, this, &QDialog::accept);
    connect(bb, &QDialogButtonBox::rejected, this, &QDialog::reject);

    auto matchPreset = [this] {
        for (int i = 1; i < int(std::size(kPresets)); ++i)
            if (kPresets[i].w == w_->value() && kPresets[i].h == h_->value() &&
                std::abs(kPresets[i].fps - fps_->currentText().toDouble()) < 1e-3) {
                preset_->blockSignals(true);
                preset_->setCurrentIndex(i);
                preset_->blockSignals(false);
                return;
            }
        preset_->blockSignals(true);
        preset_->setCurrentIndex(0);
        preset_->blockSignals(false);
    };
    matchPreset();
    connect(preset_, &QComboBox::currentIndexChanged, this, [this](int i) {
        if (i <= 0)
            return;
        const bool lock = lockAspect_->isChecked();
        lockAspect_->setChecked(false);
        w_->setValue(kPresets[i].w);
        h_->setValue(kPresets[i].h);
        aspect_ = double(kPresets[i].w) / kPresets[i].h;
        fps_->setCurrentText(QString::number(kPresets[i].fps));
        lockAspect_->setChecked(lock);
    });
    connect(w_, &QSpinBox::valueChanged, this, [this, matchPreset](int w) {
        if (lockAspect_->isChecked()) {
            h_->blockSignals(true);
            h_->setValue(int(std::round(w / aspect_)));
            h_->blockSignals(false);
        } else {
            aspect_ = double(w) / h_->value();
        }
        matchPreset();
    });
    connect(h_, &QSpinBox::valueChanged, this, [this, matchPreset](int h) {
        if (lockAspect_->isChecked()) {
            w_->blockSignals(true);
            w_->setValue(int(std::round(h * aspect_)));
            w_->blockSignals(false);
        } else {
            aspect_ = double(w_->value()) / h;
        }
        matchPreset();
    });
    connect(fps_, &QComboBox::currentTextChanged, this, matchPreset);
}

CompSettings CompositionDialog::settings() const
{
    CompSettings s;
    s.name = name_->text().trimmed().isEmpty() ? "Comp" : name_->text().trimmed();
    s.width = w_->value();
    s.height = h_->value();
    s.fps = std::clamp(fps_->currentText().toDouble(), 1.0, 240.0);
    s.duration = dur_->value();
    s.background = bg_->color();
    s.mbSamples = samples_->value();
    s.shutterAngle = shutter_->value();
    return s;
}

// ------------------------------------------------------------ Solid

SolidDialog::SolidDialog(const SolidSettings &s, int compW, int compH, QWidget *parent) : QDialog(parent)
{
    setWindowTitle("Solid Settings");
    auto *v = new QVBoxLayout(this);
    auto *form = new QFormLayout;
    name_ = new QLineEdit(s.name);
    w_ = new QSpinBox;
    w_->setRange(1, 30000);
    w_->setValue(s.width);
    h_ = new QSpinBox;
    h_->setRange(1, 30000);
    h_->setValue(s.height);
    auto *makeComp = new QPushButton("Make Comp Size");
    color_ = new ColorButton(s.color);
    auto *size = new QHBoxLayout;
    size->addWidget(w_);
    size->addWidget(new QLabel("×"));
    size->addWidget(h_);
    size->addWidget(makeComp);
    form->addRow("Name:", name_);
    form->addRow("Size:", size);
    form->addRow("Color:", color_);
    v->addLayout(form);
    auto *bb = new QDialogButtonBox(QDialogButtonBox::Ok | QDialogButtonBox::Cancel);
    v->addWidget(bb);
    connect(bb, &QDialogButtonBox::accepted, this, &QDialog::accept);
    connect(bb, &QDialogButtonBox::rejected, this, &QDialog::reject);
    connect(makeComp, &QPushButton::clicked, this, [this, compW, compH] {
        w_->setValue(compW);
        h_->setValue(compH);
    });
}

SolidSettings SolidDialog::settings() const
{
    return {name_->text().trimmed().isEmpty() ? "Solid" : name_->text().trimmed(), w_->value(), h_->value(),
            color_->color()};
}

// ------------------------------------------------------------ Text

void showTextEditor(QWidget *parent, Editor *ed, int layerId)
{
    Composition *c = ed->activeComp();
    Layer *l = c ? c->layerById(layerId) : nullptr;
    if (!l || l->type != LayerType::Text)
        return;
    const QString before = l->text;
    QDialog dlg(parent);
    dlg.setWindowTitle("Edit Text — " + l->name);
    auto *v = new QVBoxLayout(&dlg);
    auto *edit = new QPlainTextEdit(before);
    QFont f = edit->font();
    f.setPointSizeF(14);
    edit->setFont(f);
    edit->selectAll();
    v->addWidget(new QLabel("Type your text (Enter for a new line). Changes preview live."));
    v->addWidget(edit);
    auto *bb = new QDialogButtonBox(QDialogButtonBox::Ok | QDialogButtonBox::Cancel);
    v->addWidget(bb);
    QObject::connect(bb, &QDialogButtonBox::accepted, &dlg, &QDialog::accept);
    QObject::connect(bb, &QDialogButtonBox::rejected, &dlg, &QDialog::reject);
    QObject::connect(edit, &QPlainTextEdit::textChanged, &dlg, [&] {
        if (Layer *ll = ed->activeComp()->layerById(layerId)) {
            ll->text = edit->toPlainText();
            ed->touch();
        }
    });
    dlg.resize(460, 220);
    const bool ok = dlg.exec() == QDialog::Accepted;
    Layer *ll = ed->activeComp()->layerById(layerId);
    if (!ll)
        return;
    if (ok) {
        const bool autoName = ll->name == before.section('\n', 0, 0).left(40) || ll->name == "Text";
        if (autoName && !ll->text.trimmed().isEmpty())
            ll->name = ed->project().uniqueLayerName(*ed->activeComp(), ll->text.section('\n', 0, 0).left(40));
        ed->commit("Edit Text", true);
    } else {
        ll->text = before;
        ed->touch();
    }
}

// ------------------------------------------------------------ Expressions

void showExpressionEditor(QWidget *parent, Editor *ed, const PropRef &ref)
{
    Property *p = ed->resolve(ref);
    Layer *l = ed->layerOfRef(ref);
    if (!p || !l)
        return;
    QDialog dlg(parent);
    dlg.setWindowTitle(QString("Expression: %1 (%2)").arg(p->name, l->name));
    auto *v = new QVBoxLayout(&dlg);
    auto *split = new QSplitter(Qt::Horizontal);
    auto *edit = new QPlainTextEdit(p->expression);
    QFont mono("Monospace");
    mono.setStyleHint(QFont::Monospace);
    mono.setPointSizeF(11);
    edit->setFont(mono);
    edit->setPlaceholderText(p->dims() > 1 ? "e.g.  wiggle(5, 30)   or   [value[0] + time * 100, value[1]]"
                                           : "e.g.  time * 360   or   wiggle(3, 10)");
    auto *ref_ = new QListWidget;
    const QList<QPair<QString, QString>> snippets = {
        {"wiggle(freq, amount)", "wiggle(5, 30)"},
        {"loopOut(\"cycle\")", "loopOut(\"cycle\")"},
        {"loopOut(\"pingpong\")", "loopOut(\"pingpong\")"},
        {"loopOut(\"offset\")", "loopOut(\"offset\")"},
        {"loopIn(\"cycle\")", "loopIn(\"cycle\")"},
        {"time", "time"},
        {"value", "value"},
        {"linear(t, tMin, tMax, v1, v2)", "linear(time, 0, 1, 0, 100)"},
        {"ease(t, tMin, tMax, v1, v2)", "ease(time, 0, 1, 0, 100)"},
        {"easeIn(t, …)", "easeIn(time, 0, 1, 0, 100)"},
        {"easeOut(t, …)", "easeOut(time, 0, 1, 0, 100)"},
        {"random(min, max)", "random(0, 100)"},
        {"seedRandom(seed, timeless)", "seedRandom(index, true);\nrandom(0, 100)"},
        {"noise(t)", "noise(time) * 50"},
        {"valueAtTime(t)", "valueAtTime(time - 0.5)"},
        {"Math.sin(time * …)", "value + Math.sin(time * Math.PI * 2) * 20"},
        {"clamp(v, min, max)", "clamp(value, 0, 100)"},
        {"add(a, b) / sub / mul / div", "add(value, [100, 0])"},
        {"thisComp.width / height", "[thisComp.width / 2, thisComp.height / 2]"},
        {"index, inPoint, outPoint", "linear(time, inPoint, inPoint + 0.5, 0, 100)"},
        {"framesToTime / timeToFrames", "timeToFrames(time)"},
    };
    for (const auto &s : snippets) {
        auto *it = new QListWidgetItem(s.first);
        it->setData(Qt::UserRole, s.second);
        it->setToolTip(s.second);
        ref_->addItem(it);
    }
    split->addWidget(edit);
    split->addWidget(ref_);
    split->setStretchFactor(0, 3);
    split->setStretchFactor(1, 2);
    v->addWidget(new QLabel("JavaScript expression — the last statement's value is the result. "
                            "Double-click a reference item to insert it."));
    v->addWidget(split, 1);
    auto *err = new QLabel;
    err->setStyleSheet("color:#e06060;");
    err->setWordWrap(true);
    v->addWidget(err);
    auto *bb = new QDialogButtonBox(QDialogButtonBox::Ok | QDialogButtonBox::Cancel | QDialogButtonBox::Apply);
    v->addWidget(bb);
    QObject::connect(ref_, &QListWidget::itemDoubleClicked, edit,
                     [edit](QListWidgetItem *it) { edit->insertPlainText(it->data(Qt::UserRole).toString()); });
    const QString before = p->expression;
    auto apply = [&] {
        Property *pp = ed->resolve(ref);
        Layer *ll = ed->layerOfRef(ref);
        if (!pp || !ll)
            return;
        pp->expression = edit->toPlainText();
        pp->expressionEnabled = true;
        ed->renderer().eval(*pp, ed->time(), *ll, *ed->activeComp());
        err->setText(pp->expressionError.isEmpty() ? QString() : "Error: " + pp->expressionError);
        ed->touch();
    };
    QObject::connect(bb->button(QDialogButtonBox::Apply), &QPushButton::clicked, &dlg, apply);
    QObject::connect(bb, &QDialogButtonBox::accepted, &dlg, &QDialog::accept);
    QObject::connect(bb, &QDialogButtonBox::rejected, &dlg, &QDialog::reject);
    dlg.resize(760, 360);
    if (dlg.exec() == QDialog::Accepted) {
        apply();
        ed->commit("Edit Expression", true);
    } else if (Property *pp = ed->resolve(ref)) {
        pp->expression = before;
        ed->touch();
    }
}

void showTimeStretchDialog(QWidget *parent, Editor *ed)
{
    Layer *l = ed->primaryLayer();
    if (!l)
        return;
    QDialog dlg(parent);
    dlg.setWindowTitle("Time Stretch");
    auto *form = new QFormLayout(&dlg);
    auto *sp = new QDoubleSpinBox;
    sp->setRange(1, 10000);
    sp->setSuffix(" %");
    sp->setValue(l->stretch);
    form->addRow("Stretch Factor:", sp);
    form->addRow(new QLabel("100% = original speed, 200% = half speed (slow motion), 50% = double speed."));
    auto *bb = new QDialogButtonBox(QDialogButtonBox::Ok | QDialogButtonBox::Cancel);
    form->addRow(bb);
    QObject::connect(bb, &QDialogButtonBox::accepted, &dlg, &QDialog::accept);
    QObject::connect(bb, &QDialogButtonBox::rejected, &dlg, &QDialog::reject);
    if (dlg.exec() == QDialog::Accepted)
        ed->setTimeStretch(*l, sp->value());
}

void showShortcutsDialog(QWidget *parent)
{
    const QList<QPair<QString, QString>> rows = {
        {"Space", "Play / pause preview"},
        {"Page Down / Page Up", "Next / previous frame"},
        {"Home / End", "Go to start / end of composition"},
        {"J / K", "Previous / next keyframe"},
        {"B / N", "Set work area start / end to current time"},
        {"Ctrl+N", "New composition"},
        {"Ctrl+K", "Composition settings"},
        {"Ctrl+Y", "New solid"},
        {"Ctrl+Alt+Y", "New adjustment layer"},
        {"Ctrl+Alt+Shift+Y", "New null object"},
        {"Ctrl+Alt+Shift+T", "New text layer"},
        {"Ctrl+I", "Import file"},
        {"Ctrl+M", "Add to render queue"},
        {"Ctrl+D", "Duplicate layer"},
        {"Ctrl+Shift+D", "Split layer at current time"},
        {"Ctrl+Shift+C", "Pre-compose"},
        {"[ / ]", "Move layer in / out point to current time"},
        {"Alt+[ / Alt+]", "Trim layer in / out point to current time"},
        {"Ctrl+] / Ctrl+[", "Bring layer forward / send backward"},
        {"Ctrl+Shift+] / [", "Bring to front / send to back"},
        {"P / S / R / T / A", "Reveal Position / Scale / Rotation / Opacity / Anchor Point"},
        {"U", "Reveal animated properties"},
        {"E", "Reveal effects"},
        {"Shift + P/S/R/T/A", "Add property to the revealed set"},
        {"Alt+Shift+P/S/R/T/A", "Add keyframe at current time"},
        {"F9 / Shift+F9 / Ctrl+Shift+F9", "Easy Ease / Ease In / Ease Out"},
        {"Ctrl+Alt+H", "Toggle hold keyframe"},
        {"Ctrl+Alt+T", "Enable time remapping"},
        {"Ctrl+Alt+Home", "Center anchor point in layer"},
        {"Ctrl+Alt+F", "Fit layer to composition"},
        {"Alt+Shift+=", "Add expression to selected property"},
        {"Ctrl+Shift+E", "Remove all effects"},
        {"V / H / Z / W / Y", "Selection / Hand / Zoom / Rotation / Pan Behind tools"},
        {"Q", "Shape tools (repeat to cycle)"},
        {"Ctrl+T", "Type tool"},
        {". / ,", "Zoom viewer in / out"},
        {"Shift+/", "Fit composition in viewer"},
        {"Alt + mouse wheel", "Zoom timeline"},
        {"F2", "Deselect all"},
        {"Ctrl+Z / Ctrl+Shift+Z", "Undo / redo"},
    };
    QDialog dlg(parent);
    dlg.setWindowTitle("Keyboard Shortcuts");
    auto *v = new QVBoxLayout(&dlg);
    auto *table = new QTableWidget(rows.size(), 2);
    table->setHorizontalHeaderLabels({"Shortcut", "Action"});
    table->verticalHeader()->hide();
    table->horizontalHeader()->setStretchLastSection(true);
    table->setEditTriggers(QAbstractItemView::NoEditTriggers);
    for (int i = 0; i < rows.size(); ++i) {
        table->setItem(i, 0, new QTableWidgetItem(rows[i].first));
        table->setItem(i, 1, new QTableWidgetItem(rows[i].second));
    }
    table->resizeColumnToContents(0);
    v->addWidget(table);
    auto *bb = new QDialogButtonBox(QDialogButtonBox::Close);
    QObject::connect(bb, &QDialogButtonBox::rejected, &dlg, &QDialog::reject);
    v->addWidget(bb);
    dlg.resize(560, 620);
    dlg.exec();
}

} // namespace mf
