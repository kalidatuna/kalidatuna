#pragma once
#include <QSet>
#include <QString>
#include <QStringList>
#include <functional>
#include <memory>
#include <vector>

namespace mf::ofx {

// What we learned about one OpenFX plugin while loading it.
struct PluginInfo {
    QString identifier;
    QString label;
    QString grouping;
    QString context;      // the context MotionForge uses it in (Filter, General or Generator)
    QString pixelDepth;   // float or byte
    QString binaryPath;
    QString bundlePath;
    int versionMajor = 0;
    int versionMinor = 0;
    bool loaded = false;
    QString error;        // why it isn't available
};

struct ScanResult {
    int bundles = 0;
    int plugins = 0;
    QStringList failed;   // "path: reason"
};

// Hosts OpenFX image-effect plugins (the open standard used by Natron, Resolve, Nuke, Vegas…)
// and registers each one as a MotionForge effect. Plugins run on the render thread.
class Manager {
public:
    static Manager &instance();

    // Standard locations: $OFX_PLUGIN_PATH, /usr/OFX/Plugins, ~/.local/share/MotionForge/OFX/Plugins,
    // Natron's bundled plugins, plus any extra paths.
    static QStringList defaultSearchPaths();
    static QStringList findBundles(const QStringList &paths);
    static QString binaryForBundle(const QString &bundlePath);

    // Loads every bundle found. `probe` (optional) test-loads a binary in a separate process first,
    // returning false (and a reason) for plugins that crash or hang.
    ScanResult scan(const QStringList &paths,
                    const std::function<bool(const QString &binary, QString *error)> &probe = {});
    // Loads one plugin binary in-process and registers its effects. Returns how many were registered.
    int loadBinary(const QString &binaryPath, const QString &bundlePath, QString *error);

    std::vector<PluginInfo> plugins() const;   // live status, including plugins disabled after a crash
    // Destroys plugin instances whose effects no longer exist.
    void pruneInstances(const QSet<int> &liveEffectUids);
    void destroyAllInstances();
    QString takeMessages();

    // Entry point for `motionforge --ofx-probe <binary>`: loads and describes every plugin, exits 0 if fine.
    static int probeMain(const QString &binaryPath);

private:
    Manager();
    std::vector<PluginInfo> probeFailures_;
    QSet<QString> loadedBinaries_;
};

} // namespace mf::ofx
