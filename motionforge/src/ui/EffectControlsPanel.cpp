#include "EffectControlsPanel.h"

#include "Dialogs.h"
#include "Icons.h"
#include "ScrubField.h"
#include "Theme.h"

#include <QApplication>
#include <QCheckBox>
#include <QComboBox>
#include <QHBoxLayout>
#include <QLabel>
#include <QMenu>
#include <QScrollArea>
#include <QToolButton>
#include <QVBoxLayout>

namespace mf {

EffectControlsPanel::EffectControlsPanel(Editor *editor, QWidget *parent) : QWidget(parent), ed_(editor)
{
    auto *v = new QVBoxLayout(this);
    v->setContentsMargins(0, 0, 0, 0);
    v->setSpacing(0);
    header_ = new QLabel;
    header_->setStyleSheet("background:#202020; color:#9a9a9a; padding:5px 8px;");
    v->addWidget(header_);
    scroll_ = new QScrollArea;
    scroll_->setWidgetResizable(true);
    scroll_->setFrameShape(QFrame::NoFrame);
    v->addWidget(scroll_, 1);
    connect(ed_, &Editor::projectChanged, this, &EffectControlsPanel::rebuild);
    connect(ed_, &Editor::activeCompChanged, this, &EffectControlsPanel::rebuild);
    connect(ed_, &Editor::selectionChanged, this, [this] {
        Layer *l = ed_->primaryLayer();
        if ((l ? l->id : 0) != shownLayer_)
            rebuild();
    });
    connect(ed_, &Editor::timeChanged, this, &EffectControlsPanel::refreshValues);
    connect(ed_, &Editor::valuesChanged, this, &EffectControlsPanel::refreshValues);
    rebuild();
}

void EffectControlsPanel::refreshValues()
{
    for (auto &f : refreshers_)
        f();
}

QWidget *EffectControlsPanel::paramRow(Layer *l, Effect *e, Property *p)
{
    const PropRef ref{l->id, Editor::keyFor(*l, p)};
    auto *row = new QWidget;
    auto *h = new QHBoxLayout(row);
    h->setContentsMargins(22, 1, 6, 1);
    h->setSpacing(6);
    auto *watch = new QToolButton;
    watch->setAutoRaise(true);
    watch->setFixedSize(18, 18);
    watch->setFocusPolicy(Qt::NoFocus);
    watch->setEnabled(p->animatable);
    watch->setToolTip("Time-Vary Stopwatch (Alt+click: expression)");
    auto *name = new QLabel(p->name);
    name->setMinimumWidth(130);
    name->setStyleSheet("color:#c6c6c6;");
    h->addWidget(watch);
    h->addWidget(name);
    Editor *ed = ed_;

    auto setDim = [ed, ref](int dim, double val, bool commit) {
        Property *pp = ed->resolve(ref);
        if (!pp)
            return;
        Value v = pp->valueAt(ed->time());
        if (dim < v.size())
            v[dim] = val;
        pp->setValue(ed->time(), v);
        if (commit)
            ed->commit("Change " + pp->name, false);
        else
            ed->touch();
    };
    auto current = [ed, ref, l]() -> Value {
        Property *pp = ed->resolve(ref);
        Layer *ll = ed->layerOfRef(ref);
        if (!pp || !ll)
            return {};
        return ed->renderer().eval(*pp, ed->time(), *ll, *ed->activeComp());
    };

    switch (p->type) {
    case PropType::Number:
    case PropType::Percent:
    case PropType::Angle:
    case PropType::Point:
    case PropType::Time: {
        const int dims = p->type == PropType::Angle ? 1 : p->dims();
        std::vector<ScrubField *> fields;
        for (int d = 0; d < dims; ++d) {
            auto *f = new ScrubField;
            f->setRange(p->type == PropType::Point ? -1e9 : p->minValue, p->type == PropType::Point ? 1e9 : p->maxValue);
            f->setStep(p->dragStep);
            f->setDecimals(p->dragStep < 0.1 ? 2 : 1);
            if (p->type == PropType::Percent)
                f->setSuffix("%");
            if (p->type == PropType::Angle)
                f->setAngleMode(true);
            connect(f, &ScrubField::valueScrubbed, this, [setDim, d](double v) { setDim(d, v, false); });
            connect(f, &ScrubField::valueCommitted, this, [setDim, d](double v) { setDim(d, v, true); });
            h->addWidget(f);
            fields.push_back(f);
        }
        refreshers_.push_back([fields, current, ref, ed] {
            const Value v = current();
            Property *pp = ed->resolve(ref);
            for (size_t i = 0; i < fields.size(); ++i)
                if (int(i) < v.size()) {
                    fields[i]->setValue(v[int(i)]);
                    fields[i]->setStyleSheet(pp && pp->hasExpression() ? "color:#e05050;" : "");
                }
        });
        break;
    }
    case PropType::Color: {
        auto *cb = new ColorButton(Property::toColor(p->valueAt(ed_->time())));
        connect(cb, &ColorButton::colorChanging, this, [ed, ref](QColor c) {
            if (Property *pp = ed->resolve(ref)) {
                pp->setValue(ed->time(), Property::fromColor(c));
                ed->touch();
            }
        });
        connect(cb, &ColorButton::colorPicked, this, [ed, ref](QColor c) {
            if (Property *pp = ed->resolve(ref)) {
                pp->setValue(ed->time(), Property::fromColor(c));
                ed->commit("Change Color", false);
            }
        });
        const Value before = p->valueAt(ed_->time());
        connect(cb, &ColorButton::pickCancelled, this, [ed, ref, before] {
            if (Property *pp = ed->resolve(ref)) {
                pp->setValue(ed->time(), before);
                ed->touch();
            }
        });
        h->addWidget(cb);
        refreshers_.push_back([cb, current] { cb->setColor(Property::toColor(current())); });
        break;
    }
    case PropType::Checkbox: {
        auto *ck = new QCheckBox;
        ck->setFocusPolicy(Qt::NoFocus);
        connect(ck, &QCheckBox::clicked, this, [setDim](bool on) { setDim(0, on ? 1.0 : 0.0, true); });
        h->addWidget(ck);
        refreshers_.push_back([ck, current] {
            ck->blockSignals(true);
            ck->setChecked(current().value(0) > 0.5);
            ck->blockSignals(false);
        });
        break;
    }
    case PropType::Choice: {
        auto *cb = new QComboBox;
        cb->setFocusPolicy(Qt::NoFocus);
        cb->addItems(p->choices);
        connect(cb, &QComboBox::activated, this, [setDim](int i) { setDim(0, i, true); });
        h->addWidget(cb);
        refreshers_.push_back([cb, current] {
            cb->blockSignals(true);
            cb->setCurrentIndex(int(current().value(0)));
            cb->blockSignals(false);
        });
        break;
    }
    }
    h->addStretch();

    connect(watch, &QToolButton::clicked, this, [this, ed, ref] {
        Property *pp = ed->resolve(ref);
        Layer *ll = ed->layerOfRef(ref);
        if (!pp || !ll)
            return;
        if (QApplication::keyboardModifiers() & Qt::AltModifier)
            showExpressionEditor(this, ed, ref);
        else
            ed->toggleStopwatch(*pp, *ll);
    });
    refreshers_.push_back([watch, ed, ref] {
        Property *pp = ed->resolve(ref);
        const bool on = pp && pp->isAnimated();
        watch->setIcon(icon(on ? "stopwatch-on" : "stopwatch", on ? theme::value : theme::textDim));
    });
    row->setContextMenuPolicy(Qt::CustomContextMenu);
    connect(row, &QWidget::customContextMenuRequested, this, [this, ed, ref, row](const QPoint &pos) {
        Property *pp = ed->resolve(ref);
        Layer *ll = ed->layerOfRef(ref);
        if (!pp || !ll)
            return;
        QMenu m;
        m.addAction("Reset", [ed, pp] {
            pp->reset();
            ed->commit("Reset", true);
        });
        m.addAction(pp->expression.isEmpty() ? "Add Expression…" : "Edit Expression…",
                    [this, ed, ref] { showExpressionEditor(this, ed, ref); });
        m.addAction("Add Keyframe", [ed, pp, ll] { ed->setKeyAtCurrentTime(*pp, *ll); })->setEnabled(pp->animatable);
        m.exec(row->mapToGlobal(pos));
    });
    Q_UNUSED(e);
    return row;
}

void EffectControlsPanel::rebuild()
{
    refreshers_.clear();
    Layer *l = ed_->primaryLayer();
    shownLayer_ = l ? l->id : 0;
    auto *content = new QWidget;
    auto *v = new QVBoxLayout(content);
    v->setContentsMargins(0, 4, 0, 4);
    v->setSpacing(0);
    if (!l) {
        header_->setText("Effect Controls");
        auto *lbl = new QLabel("Select a layer to see its effects.\n\nApply effects from the Effect menu,\n"
                               "or drag them from Effects & Presets.");
        lbl->setAlignment(Qt::AlignCenter);
        lbl->setStyleSheet("color:#6a6a6a; padding:20px;");
        v->addWidget(lbl);
    } else {
        header_->setText(QString("Effect Controls: <b style='color:#ddd'>%1</b> &nbsp;·&nbsp; %2")
                             .arg(l->name.toHtmlEscaped(), ed_->activeComp()->name.toHtmlEscaped()));
        if (l->effects.empty()) {
            auto *lbl = new QLabel("No effects on this layer.");
            lbl->setStyleSheet("color:#6a6a6a; padding:12px;");
            v->addWidget(lbl);
        }
        for (auto &e : l->effects) {
            Effect *fx = e.get();
            const int uid = fx->uid, lid = l->id;
            auto *head = new QWidget;
            head->setStyleSheet("background:#2a2a2a;");
            auto *hh = new QHBoxLayout(head);
            hh->setContentsMargins(4, 2, 6, 2);
            auto *twirl = new QToolButton;
            twirl->setArrowType(fx->expanded ? Qt::DownArrow : Qt::RightArrow);
            twirl->setAutoRaise(true);
            twirl->setFixedSize(16, 16);
            twirl->setFocusPolicy(Qt::NoFocus);
            auto *en = new QToolButton;
            en->setIcon(icon("fx", fx->enabled ? theme::text : QColor(0x55, 0x55, 0x55)));
            en->setAutoRaise(true);
            en->setToolTip("Enable / disable effect");
            en->setFocusPolicy(Qt::NoFocus);
            auto *name = new QLabel(fx->name);
            name->setStyleSheet(fx->enabled ? "color:#e0e0e0; font-weight:bold;" : "color:#777; font-weight:bold;");
            auto *reset = new QToolButton;
            reset->setText("Reset");
            reset->setStyleSheet("color:#3d9df2;");
            reset->setAutoRaise(true);
            reset->setFocusPolicy(Qt::NoFocus);
            auto *menuBtn = new QToolButton;
            menuBtn->setText("⋯");
            menuBtn->setAutoRaise(true);
            menuBtn->setFocusPolicy(Qt::NoFocus);
            hh->addWidget(twirl);
            hh->addWidget(en);
            hh->addWidget(name, 1);
            hh->addWidget(reset);
            hh->addWidget(menuBtn);
            v->addWidget(head);
            connect(twirl, &QToolButton::clicked, this, [this, fx] {
                fx->expanded = !fx->expanded;
                emit ed_->projectChanged();   // view state only, not an undo step
            });
            connect(en, &QToolButton::clicked, this, [this, fx] {
                fx->enabled = !fx->enabled;
                ed_->commit("Toggle Effect", true);
            });
            connect(reset, &QToolButton::clicked, this, [this, fx] {
                for (auto &p : fx->params)
                    p.reset();
                ed_->commit("Reset Effect", true);
            });
            connect(menuBtn, &QToolButton::clicked, this, [this, menuBtn, lid, uid] {
                QMenu m;
                m.addAction("Move Up", [this, lid, uid] { ed_->moveEffect(lid, uid, -1); });
                m.addAction("Move Down", [this, lid, uid] { ed_->moveEffect(lid, uid, 1); });
                m.addSeparator();
                m.addAction("Remove Effect", [this, lid, uid] { ed_->removeEffect(lid, uid); });
                m.exec(menuBtn->mapToGlobal(QPoint(0, menuBtn->height())));
            });
            if (fx->expanded)
                for (auto &p : fx->params)
                    v->addWidget(paramRow(l, fx, &p));
            auto *gap = new QWidget;
            gap->setFixedHeight(4);
            v->addWidget(gap);
        }
    }
    v->addStretch();
    scroll_->setWidget(content);
    refreshValues();
}

} // namespace mf
