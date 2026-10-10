#include "ProjectPanel.h"

#include "CompViewer.h"
#include "Icons.h"
#include "Theme.h"
#include "media/MediaCache.h"

#include <QDragEnterEvent>
#include <QFileInfo>
#include <QHBoxLayout>
#include <QHeaderView>
#include <QInputDialog>
#include <QLabel>
#include <QMenu>
#include <QMimeData>
#include <QPainter>
#include <QToolButton>
#include <QUrl>
#include <QVBoxLayout>

namespace mf {

static const char *kItemMime = "application/x-motionforge-item";

ProjectTree::ProjectTree(Editor *ed, QWidget *parent) : QTreeWidget(parent), ed_(ed)
{
    setDragEnabled(true);
    setAcceptDrops(true);
    setDropIndicatorShown(true);
    setDragDropMode(QAbstractItemView::DragDrop);
    setSelectionMode(QAbstractItemView::SingleSelection);
}

QStringList ProjectTree::mimeTypes() const
{
    return {kItemMime, "text/uri-list"};
}

QMimeData *ProjectTree::mimeData(const QList<QTreeWidgetItem *> &items) const
{
    if (items.isEmpty())
        return nullptr;
    auto *m = new QMimeData;
    m->setData(kItemMime, QByteArray::number(items.first()->data(0, Qt::UserRole).toInt()));
    return m;
}

void ProjectTree::dragEnterEvent(QDragEnterEvent *e)
{
    if (e->mimeData()->hasUrls() || e->mimeData()->hasFormat(kItemMime))
        e->acceptProposedAction();
}

void ProjectTree::dragMoveEvent(QDragMoveEvent *e)
{
    e->acceptProposedAction();
}

void ProjectTree::dropEvent(QDropEvent *e)
{
    QTreeWidgetItem *target = itemAt(e->position().toPoint());
    int folder = 0;
    if (target) {
        Item *ti = ed_->project().item(target->data(0, Qt::UserRole).toInt());
        if (ti && ti->itemType() == ItemType::Folder)
            folder = ti->id;
        else if (ti)
            folder = ti->folderId;
    }
    if (e->mimeData()->hasFormat(kItemMime)) {
        const int id = e->mimeData()->data(kItemMime).toInt();
        if (Item *it = ed_->project().item(id); it && it->id != folder) {
            it->folderId = folder;
            ed_->commit("Move to Folder", true);
        }
    } else if (e->mimeData()->hasUrls()) {
        QStringList errors;
        for (const QUrl &u : e->mimeData()->urls()) {
            QString err;
            if (FootageItem *f = ed_->importFile(u.toLocalFile(), &err))
                f->folderId = folder;
            else
                errors << QFileInfo(u.toLocalFile()).fileName() + ": " + err;
        }
        if (!errors.isEmpty())
            emit ed_->message(errors.join("; "));
        ed_->commit("Import", true);
    }
    e->acceptProposedAction();
}

ProjectPanel::ProjectPanel(Editor *editor, QWidget *parent) : QWidget(parent), ed_(editor)
{
    auto *v = new QVBoxLayout(this);
    v->setContentsMargins(0, 0, 0, 0);
    v->setSpacing(0);

    auto *preview = new QWidget;
    preview->setStyleSheet("background:#202020;");
    auto *ph = new QHBoxLayout(preview);
    ph->setContentsMargins(8, 6, 8, 6);
    thumb_ = new QLabel;
    thumb_->setFixedSize(96, 64);
    thumb_->setAlignment(Qt::AlignCenter);
    thumb_->setStyleSheet("background:#111; border:1px solid #333;");
    info_ = new QLabel;
    info_->setStyleSheet("color:#9a9a9a;");
    info_->setAlignment(Qt::AlignLeft | Qt::AlignTop);
    info_->setWordWrap(true);
    ph->addWidget(thumb_);
    ph->addWidget(info_, 1);
    v->addWidget(preview);

    tree_ = new ProjectTree(editor);
    tree_->setColumnCount(4);
    tree_->setHeaderLabels({"Name", "Type", "Size", "Duration"});
    tree_->header()->setStretchLastSection(false);
    tree_->header()->setSectionResizeMode(0, QHeaderView::Stretch);
    tree_->setRootIsDecorated(true);
    tree_->setAlternatingRowColors(true);
    tree_->setContextMenuPolicy(Qt::CustomContextMenu);
    tree_->setEditTriggers(QAbstractItemView::EditKeyPressed | QAbstractItemView::SelectedClicked);
    v->addWidget(tree_, 1);

    auto *bar = new QWidget;
    bar->setStyleSheet("background:#1d1d1d;");
    auto *bh = new QHBoxLayout(bar);
    bh->setContentsMargins(4, 2, 4, 2);
    auto mk = [&](const char *ic, const QString &tip, std::function<void()> fn) {
        auto *b = new QToolButton;
        b->setIcon(icon(ic));
        b->setToolTip(tip);
        b->setFocusPolicy(Qt::NoFocus);
        connect(b, &QToolButton::clicked, this, fn);
        bh->addWidget(b);
    };
    mk("folder", "Create a new folder", [this] { ed_->newFolder("Untitled Folder"); });
    mk("comp", "Create a new composition", [this] {
        if (onNewComposition)
            onNewComposition();
    });
    mk("footage", "Import file…", [this] {
        if (onImport)
            onImport();
    });
    bh->addStretch();
    mk("trash", "Delete selected item", [this] {
        if (int id = selectedItemId())
            ed_->deleteItem(id);
    });
    v->addWidget(bar);

    connect(tree_, &QTreeWidget::itemSelectionChanged, this, [this] {
        if (rebuilding_)
            return;
        ed_->setSelectedItem(selectedItemId());
        updatePreview();
    });
    connect(tree_, &QTreeWidget::itemDoubleClicked, this, [this](QTreeWidgetItem *it, int col) {
        Item *item = ed_->project().item(it->data(0, Qt::UserRole).toInt());
        if (!item)
            return;
        if (item->itemType() == ItemType::Composition)
            ed_->setActiveComp(item->id);
        else if (item->itemType() == ItemType::Footage) {
            if (ed_->activeComp())
                ed_->addItemLayer(item->id);
            else
                ed_->newCompFromItem(item->id);
        }
        Q_UNUSED(col);
    });
    connect(tree_, &QTreeWidget::itemChanged, this, [this](QTreeWidgetItem *it, int col) {
        if (rebuilding_ || col != 0)
            return;
        Item *item = ed_->project().item(it->data(0, Qt::UserRole).toInt());
        if (item && item->name != it->text(0) && !it->text(0).trimmed().isEmpty())
            ed_->renameItem(item->id, it->text(0).trimmed());
    });
    connect(tree_, &QWidget::customContextMenuRequested, this, &ProjectPanel::contextMenu);
    connect(ed_, &Editor::projectChanged, this, &ProjectPanel::rebuild);
    rebuild();
}

int ProjectPanel::selectedItemId() const
{
    auto sel = tree_->selectedItems();
    return sel.isEmpty() ? 0 : sel.first()->data(0, Qt::UserRole).toInt();
}

void ProjectPanel::rebuild()
{
    rebuilding_ = true;
    const int selected = selectedItemId();
    QHash<int, bool> expanded;
    for (QTreeWidgetItemIterator it(tree_); *it; ++it)
        expanded.insert((*it)->data(0, Qt::UserRole).toInt(), (*it)->isExpanded());
    tree_->clear();
    QHash<int, QTreeWidgetItem *> nodes;
    auto &items = ed_->project().items;
    // Folders first so children can attach.
    std::vector<Item *> ordered;
    for (auto &i : items)
        if (i->itemType() == ItemType::Folder)
            ordered.push_back(i.get());
    for (auto &i : items)
        if (i->itemType() != ItemType::Folder)
            ordered.push_back(i.get());
    for (Item *i : ordered) {
        auto *node = new QTreeWidgetItem;
        node->setText(0, i->name);
        node->setData(0, Qt::UserRole, i->id);
        node->setFlags(node->flags() | Qt::ItemIsEditable | Qt::ItemIsDragEnabled | Qt::ItemIsDropEnabled);
        if (auto *c = dynamic_cast<Composition *>(i)) {
            node->setIcon(0, icon("comp", QColor(0xa8, 0x96, 0x77)));
            node->setText(1, "Composition");
            node->setText(2, QString("%1 × %2").arg(c->width).arg(c->height));
            node->setText(3, timecode(c->duration, c->fps));
        } else if (auto *f = dynamic_cast<FootageItem *>(i)) {
            const bool audioOnly = !f->hasVideo;
            node->setIcon(0, icon(audioOnly ? "audio" : f->isStill ? "image" : "footage",
                                  audioOnly ? QColor(0x4a, 0xa4, 0x4c) : QColor(0xa9, 0xcb, 0xc7)));
            node->setText(1, audioOnly ? "Audio" : f->isStill ? "Image" : (f->hasAudio ? "Video + Audio" : "Video"));
            node->setText(2, audioOnly ? QString("48 kHz") : QString("%1 × %2").arg(f->width).arg(f->height));
            node->setText(3, f->isStill ? "" : timecode(f->duration, f->fps));
            node->setToolTip(0, f->path);
        } else {
            node->setIcon(0, icon("folder", QColor(0xe4, 0xd8, 0x4c)));
            node->setText(1, "Folder");
        }
        QTreeWidgetItem *parent = nodes.value(i->folderId);
        if (parent)
            parent->addChild(node);
        else
            tree_->addTopLevelItem(node);
        nodes.insert(i->id, node);
    }
    for (auto it = nodes.begin(); it != nodes.end(); ++it) {
        it.value()->setExpanded(expanded.value(it.key(), true));
        if (it.key() == selected)
            it.value()->setSelected(true);
    }
    tree_->resizeColumnToContents(1);
    tree_->resizeColumnToContents(2);
    tree_->resizeColumnToContents(3);
    rebuilding_ = false;
    updatePreview();
}

void ProjectPanel::updatePreview()
{
    Item *it = ed_->project().item(selectedItemId());
    thumb_->clear();
    thumb_->setVisible(it != nullptr);
    if (!it) {
        const int n = int(ed_->project().items.size());
        info_->setText(QString("%1 item%2").arg(n).arg(n == 1 ? "" : "s"));
        return;
    }
    QImage img;
    QString text = "<b style='color:#ddd'>" + it->name.toHtmlEscaped() + "</b><br>";
    if (auto *f = dynamic_cast<FootageItem *>(it)) {
        if (!f->hasVideo) {
            // Waveform thumbnail for audio files.
            img = QImage(96, 64, QImage::Format_ARGB32_Premultiplied);
            img.fill(QColor(0x11, 0x11, 0x11));
            if (auto buf = MediaCache::instance().audio(f->path)) {
                QPainter p(&img);
                p.setPen(QColor(0x4a, 0xa4, 0x4c));
                const double d = buf->duration();
                for (int x = 0; x < 96; ++x) {
                    const float pk = buf->peakBetween(d * x / 96, d * (x + 1) / 96);
                    p.drawLine(QPointF(x + 0.5, 32 - pk * 30), QPointF(x + 0.5, 32 + pk * 30));
                }
            }
            text += QString("Audio · 48 kHz stereo<br>Δ %1").arg(timecode(f->duration, 30));
        } else {
            img = f->isStill ? MediaCache::instance().still(f->path) : MediaCache::instance().videoFrame(f->path, 0);
            text += QString("%1 × %2").arg(f->width).arg(f->height);
            if (!f->isStill)
                text += QString("<br>Δ %1, %2 fps").arg(timecode(f->duration, f->fps)).arg(f->fps, 0, 'f', 2);
            if (f->hasAudio)
                text += "<br>With audio";
        }
    } else if (auto *c = dynamic_cast<Composition *>(it)) {
        const double s = std::min(96.0 / c->width, 64.0 / c->height);
        img = ed_->renderer().renderFlattened(*c, 0, std::max(0.02, s));
        text += QString("%1 × %2<br>Δ %3, %4 fps").arg(c->width).arg(c->height).arg(timecode(c->duration, c->fps)).arg(c->fps, 0, 'f', 2);
    }
    if (!img.isNull())
        thumb_->setPixmap(QPixmap::fromImage(img.scaled(thumb_->size() - QSize(2, 2), Qt::KeepAspectRatio, Qt::SmoothTransformation)));
    info_->setText(text);
}

void ProjectPanel::contextMenu(const QPoint &pos)
{
    QMenu m(this);
    Item *it = ed_->project().item(selectedItemId());
    if (it) {
        if (it->itemType() == ItemType::Footage) {
            m.addAction("New Comp from Selection", [this, it] { ed_->newCompFromItem(it->id); });
            if (ed_->activeComp())
                m.addAction("Add to Active Composition", [this, it] { ed_->addItemLayer(it->id); });
        }
        if (it->itemType() == ItemType::Composition) {
            m.addAction("Open Composition", [this, it] { ed_->setActiveComp(it->id); });
            if (ed_->activeComp() && ed_->activeComp()->id != it->id)
                m.addAction("Add to Active Composition", [this, it] { ed_->addItemLayer(it->id); });
        }
        m.addAction("Rename", [this] {
            if (auto sel = tree_->selectedItems(); !sel.isEmpty())
                tree_->editItem(sel.first(), 0);
        });
        m.addSeparator();
        m.addAction("Delete", [this, it] { ed_->deleteItem(it->id); });
        m.addSeparator();
    }
    m.addAction("New Composition…", [this] {
        if (onNewComposition)
            onNewComposition();
    });
    m.addAction("New Folder", [this] { ed_->newFolder("Untitled Folder"); });
    m.addAction("Import File…", [this] {
        if (onImport)
            onImport();
    });
    m.exec(tree_->viewport()->mapToGlobal(pos));
}

} // namespace mf
