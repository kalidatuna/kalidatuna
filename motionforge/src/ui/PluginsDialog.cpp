#include "PluginsDialog.h"

#include "ofx/OfxHost.h"

#include <QCoreApplication>
#include <QDialogButtonBox>
#include <QFileDialog>
#include <QFileInfo>
#include <QHBoxLayout>
#include <QHeaderView>
#include <QLabel>
#include <QListWidget>
#include <QProcess>
#include <QPushButton>
#include <QSettings>
#include <QTableWidget>
#include <QVBoxLayout>

namespace mf {

QStringList openFxSearchPaths()
{
    QStringList paths = ofx::Manager::defaultSearchPaths();
    paths += QSettings().value("ofx/extraPaths").toStringList();
    paths.removeDuplicates();
    return paths;
}

static bool probeOutOfProcess(const QString &binary, QString *error)
{
    const QFileInfo fi(binary);
    const QString key = "ofx/probe/" + QString(binary).replace('/', '|');
    const QString stamp = QString("%1-%2").arg(fi.lastModified().toSecsSinceEpoch()).arg(fi.size());
    QSettings s;
    const QString cached = s.value(key).toString();
    if (cached.startsWith(stamp + "|")) {
        const QString verdict = cached.mid(stamp.size() + 1);
        if (verdict == "ok")
            return true;
        if (error)
            *error = verdict;
        return false;
    }
    QProcess p;
    p.setProcessChannelMode(QProcess::MergedChannels);
    p.start(QCoreApplication::applicationFilePath(), {"--ofx-probe", binary});
    QString verdict;
    if (!p.waitForFinished(60000)) {
        p.kill();
        verdict = "timed out while loading (more than 60 s)";
    } else if (p.exitStatus() == QProcess::CrashExit) {
        verdict = "crashed while loading";
    } else if (p.exitCode() != 0) {
        const QString out = QString::fromUtf8(p.readAll());
        const int i = out.indexOf("error=");
        verdict = i >= 0 ? out.mid(i + 6).trimmed() : "failed to load";
    } else {
        verdict = "ok";
    }
    s.setValue(key, stamp + "|" + verdict);
    if (verdict == "ok")
        return true;
    if (error)
        *error = verdict;
    return false;
}

PluginScanSummary scanOpenFxPlugins()
{
    const ofx::ScanResult r = ofx::Manager::instance().scan(openFxSearchPaths(), probeOutOfProcess);
    return {r.plugins, int(r.failed.size())};
}

PluginsDialog::PluginsDialog(QWidget *parent) : QDialog(parent)
{
    setWindowTitle("OpenFX Plugins");
    auto *v = new QVBoxLayout(this);
    auto *intro = new QLabel(
        "MotionForge loads <b>OpenFX</b> plugins built for Linux — the format used by Natron, DaVinci Resolve, "
        "Nuke and Vegas. Install a plugin by putting its <code>.ofx.bundle</code> folder in one of the folders "
        "below. Plugins made only for After Effects (<code>.aex</code>/<code>.plugin</code>) are Windows/macOS "
        "binaries for Adobe's own plugin interface and can't be loaded by any Linux application.");
    intro->setWordWrap(true);
    intro->setTextFormat(Qt::RichText);
    v->addWidget(intro);

    v->addWidget(new QLabel("<b>Search folders</b>"));
    auto *ph = new QHBoxLayout;
    paths_ = new QListWidget;
    paths_->setMaximumHeight(110);
    auto *pb = new QVBoxLayout;
    auto *add = new QPushButton("Add Folder…");
    auto *remove = new QPushButton("Remove");
    auto *rescan = new QPushButton("Rescan");
    pb->addWidget(add);
    pb->addWidget(remove);
    pb->addWidget(rescan);
    pb->addStretch();
    ph->addWidget(paths_, 1);
    ph->addLayout(pb);
    v->addLayout(ph);

    summary_ = new QLabel;
    v->addWidget(summary_);
    table_ = new QTableWidget(0, 5);
    table_->setHorizontalHeaderLabels({"Plugin", "Category", "Status", "Pixels", "Bundle"});
    table_->verticalHeader()->hide();
    table_->setEditTriggers(QAbstractItemView::NoEditTriggers);
    table_->setSelectionBehavior(QAbstractItemView::SelectRows);
    table_->horizontalHeader()->setSectionResizeMode(2, QHeaderView::Stretch);
    v->addWidget(table_, 1);
    auto *bb = new QDialogButtonBox(QDialogButtonBox::Close);
    v->addWidget(bb);
    connect(bb, &QDialogButtonBox::rejected, this, &QDialog::reject);

    connect(add, &QPushButton::clicked, this, [this] {
        const QString dir = QFileDialog::getExistingDirectory(this, "Add OpenFX Plugin Folder");
        if (dir.isEmpty())
            return;
        QSettings s;
        QStringList extra = s.value("ofx/extraPaths").toStringList();
        extra << dir;
        extra.removeDuplicates();
        s.setValue("ofx/extraPaths", extra);
        refresh();
    });
    connect(remove, &QPushButton::clicked, this, [this] {
        if (!paths_->currentItem())
            return;
        QSettings s;
        QStringList extra = s.value("ofx/extraPaths").toStringList();
        extra.removeAll(paths_->currentItem()->text());
        s.setValue("ofx/extraPaths", extra);
        refresh();
    });
    connect(rescan, &QPushButton::clicked, this, [this] {
        setCursor(Qt::WaitCursor);
        scanOpenFxPlugins();
        unsetCursor();
        refresh();
        if (onRescanned)
            onRescanned();
    });
    resize(980, 620);
    refresh();
}

void PluginsDialog::refresh()
{
    paths_->clear();
    const QStringList extra = QSettings().value("ofx/extraPaths").toStringList();
    for (const QString &p : openFxSearchPaths()) {
        auto *it = new QListWidgetItem(p + (QFileInfo(p).isDir() ? "" : "   (doesn't exist)"));
        it->setData(Qt::UserRole, p);
        if (!extra.contains(p))
            it->setFlags(it->flags() & ~Qt::ItemIsSelectable);
        it->setText(p);
        it->setToolTip(QFileInfo(p).isDir() ? p : p + " — folder doesn't exist");
        if (!QFileInfo(p).isDir())
            it->setForeground(QColor(0x70, 0x70, 0x70));
        paths_->addItem(it);
    }
    const auto plugins = ofx::Manager::instance().plugins();
    int ok = 0;
    table_->setRowCount(int(plugins.size()));
    for (int i = 0; i < int(plugins.size()); ++i) {
        const auto &p = plugins[size_t(i)];
        ok += p.loaded;
        auto *name = new QTableWidgetItem(p.label);
        name->setToolTip(p.identifier + QString(" v%1.%2").arg(p.versionMajor).arg(p.versionMinor));
        table_->setItem(i, 0, name);
        table_->setItem(i, 1, new QTableWidgetItem(p.grouping));
        auto *st = new QTableWidgetItem(p.loaded ? "Loaded (" + p.context + ")" : "Not available: " + p.error);
        st->setForeground(p.loaded ? QColor(0x60, 0xc0, 0x70) : QColor(0xe0, 0x90, 0x50));
        st->setToolTip(st->text());
        table_->setItem(i, 2, st);
        table_->setItem(i, 3, new QTableWidgetItem(p.pixelDepth));
        auto *b = new QTableWidgetItem(QFileInfo(p.bundlePath).fileName());
        b->setToolTip(p.bundlePath);
        table_->setItem(i, 4, b);
    }
    table_->resizeColumnsToContents();
    table_->horizontalHeader()->setSectionResizeMode(2, QHeaderView::Stretch);
    summary_->setText(plugins.empty()
                          ? "No OpenFX plugins found. Install some (for example Natron's free openfx-misc collection) "
                            "into one of the folders above, then press Rescan."
                          : QString("<b>%1</b> plugins loaded, %2 not available.").arg(ok).arg(int(plugins.size()) - ok));
}

} // namespace mf
