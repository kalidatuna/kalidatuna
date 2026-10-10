#pragma once
#include "CompViewer.h"
#include "Editor.h"

#include <QMainWindow>

class QActionGroup;
class QDockWidget;
class QLabel;
class QMenu;
class QTimer;

namespace mf {

class TimelinePanel;
class ProjectPanel;
class EffectControlsPanel;
class EffectsPresetsPanel;
class CharacterPanel;
class InfoPanel;
class PreviewPanel;
class RenderQueuePanel;
class PlaybackController;

class MainWindow : public QMainWindow {
    Q_OBJECT
public:
    explicit MainWindow(bool loadPlugins = true);
    bool openProject(const QString &path);
    void buildSampleProject();
    Editor *editor() const { return ed_; }
    CompViewer *viewer() const { return compPanel_->viewer(); }
    TimelinePanel *timeline() const { return timeline_; }
    RenderQueuePanel *renderQueue() const { return renderQueue_; }
    PlaybackController *playback() const { return playback_; }
    bool saveProjectTo(const QString &path) { QString e; return ed_->save(path, &e); }

protected:
    void closeEvent(QCloseEvent *e) override;
    void dragEnterEvent(QDragEnterEvent *e) override;
    void dropEvent(QDropEvent *e) override;

private:
    void createDocks();
    void createActions();
    void createMenus();
    void createToolBar();
    void resetWorkspace();
    void updateTitle();
    void updateActions();
    void fillLayerMenu(QMenu &m);
    void addRecent(const QString &path);
    void rebuildRecentMenu();
    void setTool(Tool t);

    bool maybeSave();
    bool save();
    bool saveAs();
    void newProject();
    void open();
    void importFiles();
    void newComposition();
    void compositionSettings();
    void newSolid();
    void layerSettings();
    void saveFrameAs();
    void precompose();
    void autosave();
    void loadPlugins();
    void rebuildEffectMenu();
    void showPluginsDialog();

    QAction *act(const QString &text, const QKeySequence &key, std::function<void()> fn, QMenu *menu = nullptr);

    Editor *ed_;
    CompPanel *compPanel_;
    TimelinePanel *timeline_;
    ProjectPanel *project_;
    EffectControlsPanel *effectControls_;
    EffectsPresetsPanel *effects_;
    CharacterPanel *character_;
    InfoPanel *info_;
    PreviewPanel *preview_;
    RenderQueuePanel *renderQueue_;
    PlaybackController *playback_;
    QList<QDockWidget *> docks_;
    QDockWidget *projectDock_, *effectControlsDock_, *timelineDock_, *renderDock_, *infoDock_, *previewDock_,
        *effectsDock_, *characterDock_;
    QHash<int, QAction *> toolActions_;
    QAction *undoAct_, *redoAct_;
    QMenu *recentMenu_;
    QLabel *statusTime_;
    QTimer *autosaveTimer_;
    int shapeToolIndex_ = 0;
    QMenu *effectMenu_ = nullptr;
    QList<QMenu *> effectCategoryMenus_;
};

} // namespace mf
