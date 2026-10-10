#pragma once
#include "Editor.h"

#include <QTreeWidget>
#include <QWidget>

class QLabel;

namespace mf {

class ProjectTree : public QTreeWidget {
    Q_OBJECT
public:
    explicit ProjectTree(Editor *ed, QWidget *parent = nullptr);

protected:
    QMimeData *mimeData(const QList<QTreeWidgetItem *> &items) const override;
    QStringList mimeTypes() const override;
    void dragEnterEvent(QDragEnterEvent *e) override;
    void dragMoveEvent(QDragMoveEvent *e) override;
    void dropEvent(QDropEvent *e) override;

private:
    Editor *ed_;
};

class ProjectPanel : public QWidget {
    Q_OBJECT
public:
    explicit ProjectPanel(Editor *editor, QWidget *parent = nullptr);
    std::function<void()> onNewComposition;
    std::function<void()> onImport;
    int selectedItemId() const;

private:
    void rebuild();
    void updatePreview();
    void contextMenu(const QPoint &pos);

    Editor *ed_;
    ProjectTree *tree_;
    QLabel *thumb_;
    QLabel *info_;
    bool rebuilding_ = false;
};

} // namespace mf
