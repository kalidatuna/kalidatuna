#pragma once
#include "Editor.h"

#include <QTreeWidget>
#include <QWidget>

namespace mf {

class EffectsTree : public QTreeWidget {
    Q_OBJECT
public:
    using QTreeWidget::QTreeWidget;

protected:
    QMimeData *mimeData(const QList<QTreeWidgetItem *> &items) const override;
    QStringList mimeTypes() const override;
};

class EffectsPresetsPanel : public QWidget {
    Q_OBJECT
public:
    explicit EffectsPresetsPanel(Editor *editor, QWidget *parent = nullptr);

private:
    void populate(const QString &filter);
    Editor *ed_;
    EffectsTree *tree_;
};

} // namespace mf
