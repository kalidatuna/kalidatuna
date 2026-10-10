#include "EffectsPresetsPanel.h"

#include "Icons.h"
#include "render/Effects.h"

#include <QLineEdit>
#include <QMimeData>
#include <QVBoxLayout>

namespace mf {

QStringList EffectsTree::mimeTypes() const
{
    return {"application/x-motionforge-effect", "application/x-motionforge-preset"};
}

QMimeData *EffectsTree::mimeData(const QList<QTreeWidgetItem *> &items) const
{
    if (items.isEmpty() || items.first()->data(0, Qt::UserRole).toString().isEmpty())
        return nullptr;
    auto *m = new QMimeData;
    const QString id = items.first()->data(0, Qt::UserRole).toString();
    const bool preset = items.first()->data(0, Qt::UserRole + 1).toBool();
    m->setData(preset ? "application/x-motionforge-preset" : "application/x-motionforge-effect", id.toUtf8());
    return m;
}

EffectsPresetsPanel::EffectsPresetsPanel(Editor *editor, QWidget *parent) : QWidget(parent), ed_(editor)
{
    auto *v = new QVBoxLayout(this);
    v->setContentsMargins(4, 4, 4, 4);
    v->setSpacing(4);
    auto *search = new QLineEdit;
    search->setPlaceholderText("Search effects & presets");
    search->setClearButtonEnabled(true);
    tree_ = new EffectsTree;
    tree_->setHeaderHidden(true);
    tree_->setDragEnabled(true);
    tree_->setDragDropMode(QAbstractItemView::DragOnly);
    tree_->setToolTip("Double-click or drag onto a layer to apply");
    v->addWidget(search);
    v->addWidget(tree_, 1);
    connect(search, &QLineEdit::textChanged, this, &EffectsPresetsPanel::populate);
    connect(tree_, &QTreeWidget::itemDoubleClicked, this, [this](QTreeWidgetItem *it) {
        const QString id = it->data(0, Qt::UserRole).toString();
        if (id.isEmpty())
            return;
        if (it->data(0, Qt::UserRole + 1).toBool())
            ed_->applyPreset(id);
        else
            ed_->addEffect(id);
    });
    populate({});
}

void EffectsPresetsPanel::populate(const QString &filter)
{
    filter_ = filter;
    tree_->clear();
    auto *presets = new QTreeWidgetItem(tree_, {"* Animation Presets"});
    presets->setIcon(0, icon("folder", QColor(0xe4, 0xd8, 0x4c)));
    for (const auto &p : Editor::presets()) {
        if (!filter.isEmpty() && !p.second.contains(filter, Qt::CaseInsensitive))
            continue;
        auto *it = new QTreeWidgetItem(presets, {p.second});
        it->setData(0, Qt::UserRole, p.first);
        it->setData(0, Qt::UserRole + 1, true);
        it->setIcon(0, icon("graph"));
    }
    for (const QString &cat : EffectRegistry::categories()) {
        auto *catItem = new QTreeWidgetItem(tree_, {cat});
        catItem->setIcon(0, icon("folder", QColor(0xe4, 0xd8, 0x4c)));
        for (const auto &d : EffectRegistry::all()) {
            if (d.category != cat)
                continue;
            if (!filter.isEmpty() && !d.name.contains(filter, Qt::CaseInsensitive))
                continue;
            auto *it = new QTreeWidgetItem(catItem, {d.name});
            it->setData(0, Qt::UserRole, d.id);
            it->setIcon(0, icon("fx", d.external ? QColor(0x8a, 0xc7, 0xa6) : QColor(0xc8, 0xc8, 0xc8)));
            if (d.external)
                it->setToolTip(0, (d.description.isEmpty() ? QString() : d.description.left(400) + "\n\n") +
                                      "OpenFX plugin");
        }
        if (catItem->childCount() == 0)
            delete catItem;
    }
    if (presets->childCount() == 0)
        delete presets;
    if (!filter.isEmpty())
        tree_->expandAll();
}

} // namespace mf
