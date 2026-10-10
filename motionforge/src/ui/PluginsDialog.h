#pragma once
#include <QDialog>
#include <functional>

class QListWidget;
class QTableWidget;
class QLabel;

namespace mf {

// Loads OpenFX plugins at startup: each new or changed binary is first test-loaded in a separate
// process (so a plugin that crashes while loading can't take the editor down), results are cached.
struct PluginScanSummary {
    int plugins = 0;
    int failed = 0;
};
PluginScanSummary scanOpenFxPlugins();
QStringList openFxSearchPaths();

class PluginsDialog : public QDialog {
    Q_OBJECT
public:
    explicit PluginsDialog(QWidget *parent = nullptr);
    std::function<void()> onRescanned;

private:
    void refresh();
    QListWidget *paths_;
    QTableWidget *table_;
    QLabel *summary_;
};

} // namespace mf
