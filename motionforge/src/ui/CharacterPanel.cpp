#include "CharacterPanel.h"

#include "Dialogs.h"
#include "ScrubField.h"

#include <QFontComboBox>
#include <QFormLayout>
#include <QHBoxLayout>
#include <QLabel>
#include <QPlainTextEdit>
#include <QToolButton>
#include <QVBoxLayout>

namespace mf {

CharacterPanel::CharacterPanel(Editor *editor, QWidget *parent) : QWidget(parent), ed_(editor)
{
    auto *v = new QVBoxLayout(this);
    v->setContentsMargins(6, 6, 6, 6);
    font_ = new QFontComboBox;
    auto *styleRow = new QHBoxLayout;
    bold_ = new QToolButton;
    bold_->setText("B");
    bold_->setCheckable(true);
    bold_->setStyleSheet("font-weight:bold;");
    italic_ = new QToolButton;
    italic_->setText("I");
    italic_->setCheckable(true);
    italic_->setStyleSheet("font-style:italic;");
    styleRow->addWidget(bold_);
    styleRow->addWidget(italic_);
    styleRow->addSpacing(12);
    const char *alignNames[] = {"Left", "Center", "Right"};
    const char *alignGlyph[] = {"⟸", "⟺", "⟹"};
    for (int i = 0; i < 3; ++i) {
        align_[i] = new QToolButton;
        align_[i]->setText(alignGlyph[i]);
        align_[i]->setToolTip(QString("Align %1").arg(alignNames[i]));
        align_[i]->setCheckable(true);
        styleRow->addWidget(align_[i]);
        connect(align_[i], &QToolButton::clicked, this, [this, i] {
            for (Layer *l : textLayers())
                l->align = i;
            ed_->commit("Paragraph Alignment", false);
        });
    }
    styleRow->addStretch();

    auto mkField = [](double mn, double mx, double step) {
        auto *f = new ScrubField;
        f->setRange(mn, mx);
        f->setStep(step);
        return f;
    };
    size_ = mkField(1, 4000, 1);
    size_->setSuffix(" px");
    stroke_ = mkField(0, 1000, 0.5);
    stroke_->setSuffix(" px");
    tracking_ = mkField(-1000, 10000, 1);
    leading_ = mkField(0, 10000, 1);
    fill_ = new ColorButton(Qt::white);
    strokeColor_ = new ColorButton(Qt::black);
    text_ = new QPlainTextEdit;
    text_->setPlaceholderText("Text of the selected layer");
    text_->setMaximumHeight(90);

    auto *form = new QFormLayout;
    form->addRow("Font:", font_);
    form->addRow("Style:", styleRow);
    form->addRow("Size:", size_);
    form->addRow("Fill Color:", fill_);
    form->addRow("Stroke Color:", strokeColor_);
    form->addRow("Stroke Width:", stroke_);
    form->addRow("Tracking:", tracking_);
    form->addRow("Leading (0 = auto):", leading_);
    v->addLayout(form);
    v->addWidget(new QLabel("Text:"));
    v->addWidget(text_);
    v->addStretch();

    connect(font_, &QFontComboBox::currentFontChanged, this, [this](const QFont &f) {
        if (updating_)
            return;
        for (Layer *l : textLayers())
            l->fontFamily = f.family();
        ed_->commit("Change Font", false);
    });
    connect(bold_, &QToolButton::clicked, this, [this](bool on) {
        for (Layer *l : textLayers())
            l->bold = on;
        ed_->commit("Faux Bold", false);
    });
    connect(italic_, &QToolButton::clicked, this, [this](bool on) {
        for (Layer *l : textLayers())
            l->italic = on;
        ed_->commit("Faux Italic", false);
    });
    auto wire = [this](ScrubField *f, Property Layer::*m) {
        connect(f, &ScrubField::valueScrubbed, this, [this, m](double v) { setProp(m, 0, v, false); });
        connect(f, &ScrubField::valueCommitted, this, [this, m](double v) { setProp(m, 0, v, true); });
    };
    wire(size_, &Layer::fontSize);
    wire(stroke_, &Layer::strokeWidth);
    wire(tracking_, &Layer::tracking);
    wire(leading_, &Layer::leading);
    auto wireColor = [this](ColorButton *b, Property Layer::*m) {
        connect(b, &ColorButton::colorChanging, this, [this, m](QColor c) {
            for (Layer *l : textLayers())
                (l->*m).setValue(ed_->time(), Property::fromColor(c));
            ed_->touch();
        });
        connect(b, &ColorButton::colorPicked, this, [this, m](QColor c) {
            for (Layer *l : textLayers())
                (l->*m).setValue(ed_->time(), Property::fromColor(c));
            ed_->commit("Change Color", false);
        });
        connect(b, &ColorButton::pickCancelled, this, [this, b, m] {
            // The button has reverted to the original color; put it back on the layers.
            for (Layer *l : textLayers())
                (l->*m).setValue(ed_->time(), Property::fromColor(b->color()));
            ed_->touch();
        });
    };
    wireColor(fill_, &Layer::fillColor);
    wireColor(strokeColor_, &Layer::strokeColor);
    connect(text_, &QPlainTextEdit::textChanged, this, [this] {
        if (updating_)
            return;
        for (Layer *l : textLayers())
            l->text = text_->toPlainText();
        ed_->touch();
    });
    // Commit typed text once editing leaves the box.
    text_->installEventFilter(this);
    connect(ed_, &Editor::selectionChanged, this, &CharacterPanel::refresh);
    connect(ed_, &Editor::projectChanged, this, &CharacterPanel::refresh);
    connect(ed_, &Editor::valuesChanged, this, [this] {
        if (!text_->hasFocus())
            refresh();
    });
    connect(ed_, &Editor::timeChanged, this, &CharacterPanel::refresh);
    refresh();
}

bool CharacterPanel::eventFilter(QObject *o, QEvent *e)
{
    if (o == text_ && e->type() == QEvent::FocusOut && !textLayers().empty())
        ed_->commit("Edit Text", true);
    return QWidget::eventFilter(o, e);
}

std::vector<Layer *> CharacterPanel::textLayers() const
{
    std::vector<Layer *> r;
    for (Layer *l : ed_->selectedLayers())
        if (l->type == LayerType::Text)
            r.push_back(l);
    return r;
}

void CharacterPanel::setProp(Property Layer::*member, int dim, double v, bool commit)
{
    for (Layer *l : textLayers()) {
        Property &p = l->*member;
        Value val = p.valueAt(ed_->time());
        val[dim] = v;
        p.setValue(ed_->time(), val);
    }
    if (commit)
        ed_->commit("Change Text Property", false);
    else
        ed_->touch();
}

void CharacterPanel::refresh()
{
    const auto layers = textLayers();
    setEnabled(!layers.empty());
    if (layers.empty())
        return;
    updating_ = true;
    Layer *l = layers.back();
    const double t = ed_->time();
    font_->setCurrentFont(QFont(l->fontFamily));
    bold_->setChecked(l->bold);
    italic_->setChecked(l->italic);
    for (int i = 0; i < 3; ++i)
        align_[i]->setChecked(l->align == i);
    size_->setValue(l->fontSize.valueAt(t).value(0));
    stroke_->setValue(l->strokeWidth.valueAt(t).value(0));
    tracking_->setValue(l->tracking.valueAt(t).value(0));
    leading_->setValue(l->leading.valueAt(t).value(0));
    fill_->setColor(Property::toColor(l->fillColor.valueAt(t)));
    strokeColor_->setColor(Property::toColor(l->strokeColor.valueAt(t)));
    if (!text_->hasFocus() && text_->toPlainText() != l->text)
        text_->setPlainText(l->text);
    updating_ = false;
}

} // namespace mf
