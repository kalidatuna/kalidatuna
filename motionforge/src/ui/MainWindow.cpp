#include "MainWindow.h"

#include "CharacterPanel.h"
#include "Dialogs.h"
#include "EffectControlsPanel.h"
#include "EffectsPresetsPanel.h"
#include "Icons.h"
#include "InfoPreviewPanel.h"
#include "PlaybackController.h"
#include "ProjectPanel.h"
#include "RenderQueuePanel.h"
#include "Theme.h"
#include "TimelinePanel.h"
#include "render/Effects.h"

#include <QActionGroup>
#include <QApplication>
#include <QCloseEvent>
#include <QDir>
#include <QDockWidget>
#include <QFileDialog>
#include <QFileInfo>
#include <QJsonDocument>
#include <QInputDialog>
#include <QLabel>
#include <QMenu>
#include <QMenuBar>
#include <QMessageBox>
#include <QMimeData>
#include <QSettings>
#include <QStandardPaths>
#include <QScrollArea>
#include <QStatusBar>
#include <QTimer>
#include <QToolBar>
#include <QToolButton>
#include <QUrl>
#include <cmath>

namespace mf {

MainWindow::MainWindow()
{
    ed_ = new Editor;
    ed_->setParent(this);
    setAcceptDrops(true);
    setDockNestingEnabled(true);
    setCorner(Qt::BottomLeftCorner, Qt::BottomDockWidgetArea);
    setCorner(Qt::BottomRightCorner, Qt::BottomDockWidgetArea);

    compPanel_ = new CompPanel(ed_);
    setCentralWidget(compPanel_);
    playback_ = new PlaybackController(ed_, compPanel_->viewer(), this);
    createDocks();
    createActions();
    createToolBar();

    statusTime_ = new QLabel;
    statusBar()->addPermanentWidget(statusTime_);
    connect(ed_, &Editor::message, this, [this](const QString &m) { statusBar()->showMessage(m, 6000); });
    connect(ed_, &Editor::undoStateChanged, this, [this] {
        updateTitle();
        updateActions();
    });
    connect(ed_, &Editor::selectionChanged, this, &MainWindow::updateActions);
    connect(ed_, &Editor::activeCompChanged, this, &MainWindow::updateActions);
    connect(compPanel_->viewer(), &CompViewer::toolChangeRequested, this, &MainWindow::setTool);
    connect(renderQueue_, &RenderQueuePanel::renderFinished, this,
            [this](const QString &s) { statusBar()->showMessage(s, 10000); });

    autosaveTimer_ = new QTimer(this);
    connect(autosaveTimer_, &QTimer::timeout, this, &MainWindow::autosave);
    autosaveTimer_->start(5 * 60 * 1000);

    QSettings s;
    if (!restoreGeometry(s.value("window/geometry").toByteArray()))
        resize(1600, 960);
    if (!restoreState(s.value("window/state").toByteArray(), 2))
        resetWorkspace();
    updateTitle();
    updateActions();
}

// ------------------------------------------------------------ layout

void MainWindow::createDocks()
{
    auto mk = [this](const QString &title, QWidget *w, const QString &name) {
        auto *d = new QDockWidget(title, this);
        d->setObjectName(name);
        d->setWidget(w);
        d->setFeatures(QDockWidget::DockWidgetMovable | QDockWidget::DockWidgetFloatable |
                       QDockWidget::DockWidgetClosable);
        docks_ << d;
        return d;
    };
    project_ = new ProjectPanel(ed_);
    project_->onNewComposition = [this] { newComposition(); };
    project_->onImport = [this] { importFiles(); };
    effectControls_ = new EffectControlsPanel(ed_);
    timeline_ = new TimelinePanel(ed_);
    timeline_->view()->layerMenuBuilder = [this](QMenu &m) { fillLayerMenu(m); };
    renderQueue_ = new RenderQueuePanel(ed_);
    info_ = new InfoPanel(ed_, compPanel_->viewer());
    preview_ = new PreviewPanel(ed_, playback_);
    effects_ = new EffectsPresetsPanel(ed_);
    character_ = new CharacterPanel(ed_);

    projectDock_ = mk("Project", project_, "dock.project");
    effectControlsDock_ = mk("Effect Controls", effectControls_, "dock.effectControls");
    timelineDock_ = mk("Timeline", timeline_, "dock.timeline");
    renderDock_ = mk("Render Queue", renderQueue_, "dock.render");
    infoDock_ = mk("Info", info_, "dock.info");
    previewDock_ = mk("Preview", preview_, "dock.preview");
    effectsDock_ = mk("Effects & Presets", effects_, "dock.effects");
    auto *charScroll = new QScrollArea;
    charScroll->setWidget(character_);
    charScroll->setWidgetResizable(true);
    charScroll->setFrameShape(QFrame::NoFrame);
    characterDock_ = mk("Character", charScroll, "dock.character");
}

void MainWindow::resetWorkspace()
{
    for (QDockWidget *d : docks_) {
        removeDockWidget(d);
        d->setFloating(false);
    }
    addDockWidget(Qt::LeftDockWidgetArea, projectDock_);
    addDockWidget(Qt::LeftDockWidgetArea, effectControlsDock_);
    tabifyDockWidget(projectDock_, effectControlsDock_);
    addDockWidget(Qt::RightDockWidgetArea, infoDock_);
    addDockWidget(Qt::RightDockWidgetArea, previewDock_);
    addDockWidget(Qt::RightDockWidgetArea, effectsDock_);
    addDockWidget(Qt::RightDockWidgetArea, characterDock_);
    tabifyDockWidget(effectsDock_, characterDock_);
    addDockWidget(Qt::BottomDockWidgetArea, timelineDock_);
    addDockWidget(Qt::BottomDockWidgetArea, renderDock_);
    tabifyDockWidget(timelineDock_, renderDock_);
    for (QDockWidget *d : docks_)
        d->show();
    projectDock_->raise();
    timelineDock_->raise();
    effectsDock_->raise();
    // Dock sizes only stick once the window has its real geometry.
    QTimer::singleShot(0, this, [this] {
        resizeDocks({projectDock_, infoDock_}, {340, 300}, Qt::Horizontal);
        resizeDocks({timelineDock_}, {height() * 42 / 100}, Qt::Vertical);
        resizeDocks({infoDock_, previewDock_, effectsDock_}, {150, 110, 400}, Qt::Vertical);
    });
}

QAction *MainWindow::act(const QString &text, const QKeySequence &key, std::function<void()> fn, QMenu *menu)
{
    auto *a = new QAction(text, this);
    if (!key.isEmpty())
        a->setShortcut(key);
    connect(a, &QAction::triggered, this, fn);
    addAction(a);   // keep shortcuts alive even when menus are hidden
    if (menu)
        menu->addAction(a);
    return a;
}

void MainWindow::setTool(Tool t)
{
    compPanel_->viewer()->setTool(t);
    for (auto it = toolActions_.begin(); it != toolActions_.end(); ++it)
        it.value()->setChecked(it.key() == int(t));
}

void MainWindow::createToolBar()
{
    QToolBar *tb = addToolBar("Tools");
    tb->setObjectName("toolbar.tools");
    tb->setMovable(false);
    tb->setIconSize(QSize(20, 20));
    struct T {
        Tool tool;
        const char *ic;
        const char *tip;
    };
    const T tools[] = {
        {Tool::Select, "select", "Selection Tool (V)"},  {Tool::Hand, "hand", "Hand Tool (H)"},
        {Tool::Zoom, "zoom", "Zoom Tool (Z)"},           {Tool::Rotate, "rotate", "Rotation Tool (W)"},
        {Tool::Anchor, "anchor", "Pan Behind (Anchor Point) Tool (Y)"},
        {Tool::Rect, "rect", "Rectangle Tool (Q)"},      {Tool::Ellipse, "ellipse", "Ellipse Tool (Q)"},
        {Tool::Polygon, "polygon", "Polygon Tool (Q)"},  {Tool::Star, "star", "Star Tool (Q)"},
        {Tool::Text, "text", "Type Tool (Ctrl+T)"},
    };
    auto *group = new QActionGroup(this);
    for (const T &t : tools) {
        QAction *a = tb->addAction(icon(t.ic), t.tip);
        a->setCheckable(true);
        group->addAction(a);
        const Tool tool = t.tool;
        connect(a, &QAction::triggered, this, [this, tool] { setTool(tool); });
        toolActions_.insert(int(t.tool), a);
        if (t.tool == Tool::Anchor || t.tool == Tool::Star)
            tb->addSeparator();
    }
    toolActions_[int(Tool::Select)]->setChecked(true);
    tb->addSeparator();
    auto *spacer = new QWidget;
    spacer->setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Preferred);
    tb->addWidget(spacer);
    auto *ws = new QToolButton;
    ws->setText("Default Workspace ▾");
    ws->setPopupMode(QToolButton::InstantPopup);
    auto *wsMenu = new QMenu(ws);
    wsMenu->addAction("Reset “Default” to Saved Layout", this, &MainWindow::resetWorkspace);
    ws->setMenu(wsMenu);
    tb->addWidget(ws);
}

// ------------------------------------------------------------ actions & menus

void MainWindow::createActions()
{
    QMenuBar *mb = menuBar();
    Editor *ed = ed_;

    // File
    QMenu *file = mb->addMenu("&File");
    QMenu *fileNew = file->addMenu("New");
    act("New Project", QKeySequence("Ctrl+Alt+N"), [this] { newProject(); }, fileNew);
    act("New Folder", {}, [ed] { ed->newFolder("Untitled Folder"); }, fileNew);
    act("Open Project…", QKeySequence::Open, [this] { open(); }, file);
    recentMenu_ = file->addMenu("Open Recent");
    rebuildRecentMenu();
    act("Open Sample Project", {}, [this] {
        if (maybeSave())
            buildSampleProject();
    }, file);
    file->addSeparator();
    act("Close Project", {}, [this] { newProject(); }, file);
    act("Save", QKeySequence::Save, [this] { save(); }, file);
    act("Save As…", QKeySequence("Ctrl+Shift+S"), [this] { saveAs(); }, file);
    file->addSeparator();
    QMenu *imp = file->addMenu("Import");
    act("File…", QKeySequence("Ctrl+I"), [this] { importFiles(); }, imp);
    QMenu *exp = file->addMenu("Export");
    act("Add to Render Queue", {}, [this] {
        if (Composition *c = ed_->activeComp()) {
            renderQueue_->addComp(c->id);
            renderDock_->raise();
        }
    }, exp);
    file->addSeparator();
    act("Exit", QKeySequence("Ctrl+Q"), [this] { close(); }, file);

    // Edit
    QMenu *edit = mb->addMenu("&Edit");
    undoAct_ = act("Undo", QKeySequence::Undo, [ed] { ed->undo(); }, edit);
    redoAct_ = act("Redo", QKeySequence("Ctrl+Shift+Z"), [ed] { ed->redo(); }, edit);
    edit->addSeparator();
    act("Cut", QKeySequence::Cut, [ed] { ed->cut(); }, edit);
    act("Copy", QKeySequence::Copy, [ed] { ed->copySelection(); }, edit);
    act("Paste", QKeySequence::Paste, [ed] { ed->paste(); }, edit);
    act("Clear", QKeySequence::Delete, [ed] {
        if (ed->hasSelectedKeys())
            ed->deleteSelectedKeys();
        else
            ed->deleteSelectedLayers();
    }, edit);
    addAction(act("Clear (Backspace)", QKeySequence(Qt::Key_Backspace), [ed] {
        if (ed->hasSelectedKeys())
            ed->deleteSelectedKeys();
        else
            ed->deleteSelectedLayers();
    }));
    edit->addSeparator();
    act("Duplicate", QKeySequence("Ctrl+D"), [ed] { ed->duplicateSelectedLayers(); }, edit);
    act("Split Layer", QKeySequence("Ctrl+Shift+D"), [ed] { ed->splitSelectedLayers(); }, edit);
    edit->addSeparator();
    act("Select All", QKeySequence::SelectAll, [ed] {
        QList<int> ids;
        if (Composition *c = ed->activeComp())
            for (const auto &l : c->layers)
                ids << l->id;
        ed->setSelection(ids);
    }, edit);
    act("Deselect All", QKeySequence(Qt::Key_F2), [ed] {
        ed->deselectAllKeys();
        ed->clearSelection();
    }, edit);

    // Composition
    QMenu *comp = mb->addMenu("&Composition");
    act("New Composition…", QKeySequence("Ctrl+N"), [this] { newComposition(); }, comp);
    act("Composition Settings…", QKeySequence("Ctrl+K"), [this] { compositionSettings(); }, comp);
    comp->addSeparator();
    act("Add to Render Queue", QKeySequence("Ctrl+M"), [this] {
        if (Composition *c = ed_->activeComp()) {
            renderQueue_->addComp(c->id);
            renderDock_->raise();
        }
    }, comp);
    comp->addSeparator();
    act("Trim Comp to Work Area", {}, [ed] {
        Composition *c = ed->activeComp();
        if (!c)
            return;
        const double s = c->workStart, e = c->workEnd;
        for (auto &l : c->layers)
            ed->shiftLayerTime(*l, -s);
        c->duration = e - s;
        c->workStart = 0;
        c->workEnd = c->duration;
        ed->commit("Trim Comp to Work Area", true);
    }, comp);
    act("Save Frame As…", QKeySequence("Ctrl+Alt+S"), [this] { saveFrameAs(); }, comp);
    comp->addSeparator();
    act("Preview (Play/Stop)", QKeySequence(Qt::Key_Space), [this] { playback_->toggle(); }, comp);
    addAction(act("Preview (Numpad 0)", QKeySequence(Qt::KeypadModifier | Qt::Key_0), [this] { playback_->toggle(); }));

    // Layer
    QMenu *layer = mb->addMenu("&Layer");
    QMenu *lnew = layer->addMenu("New");
    act("Text", QKeySequence("Ctrl+Alt+Shift+T"), [this] {
        if (Layer *l = ed_->newText("Text"))
            showTextEditor(this, ed_, l->id);
    }, lnew);
    act("Solid…", QKeySequence("Ctrl+Y"), [this] { newSolid(); }, lnew);
    act("Null Object", QKeySequence("Ctrl+Alt+Shift+Y"), [ed] { ed->newNull(); }, lnew);
    act("Shape Layer", {}, [ed] { ed->newShape(ShapeKind::Rectangle); }, lnew);
    act("Adjustment Layer", QKeySequence("Ctrl+Alt+Y"), [ed] { ed->newAdjustment(); }, lnew);
    act("Layer Settings…", QKeySequence("Ctrl+Shift+Y"), [this] { layerSettings(); }, layer);
    layer->addSeparator();
    QMenu *sw = layer->addMenu("Switches");
    auto toggleAll = [ed](const char *label, std::function<void(Layer &)> fn) {
        return [ed, label, fn] {
            for (Layer *l : ed->selectedLayers())
                fn(*l);
            ed->commit(label, true);
        };
    };
    act("Hide/Show Video", {}, toggleAll("Toggle Video", [](Layer &l) { l.videoOn = !l.videoOn; }), sw);
    act("Shy", {}, toggleAll("Toggle Shy", [](Layer &l) { l.shy = !l.shy; }), sw);
    act("Lock", QKeySequence("Ctrl+L"), toggleAll("Toggle Lock", [](Layer &l) { l.locked = !l.locked; }), sw);
    act("Motion Blur", {}, toggleAll("Toggle Motion Blur", [](Layer &l) { l.motionBlur = !l.motionBlur; }), sw);
    act("Solo", {}, toggleAll("Toggle Solo", [](Layer &l) { l.solo = !l.solo; }), sw);
    QMenu *tr = layer->addMenu("Transform");
    act("Reset", {}, [ed] {
        for (Layer *l : ed->selectedLayers())
            ed->resetTransform(*l);
    }, tr);
    act("Center Anchor Point in Layer Content", QKeySequence("Ctrl+Alt+Home"), [ed] {
        for (Layer *l : ed->selectedLayers())
            ed->centerAnchor(*l);
    }, tr);
    act("Fit to Comp", QKeySequence("Ctrl+Alt+F"), [ed] {
        for (Layer *l : ed->selectedLayers())
            ed->fitToComp(*l, false);
    }, tr);
    act("Fit to Comp (Keep Aspect, Fill)", {}, [ed] {
        for (Layer *l : ed->selectedLayers())
            ed->fitToComp(*l, true);
    }, tr);
    QMenu *time = layer->addMenu("Time");
    act("Enable Time Remapping", QKeySequence("Ctrl+Alt+T"), [ed] {
        for (Layer *l : ed->selectedLayers())
            if (l->type == LayerType::Footage || l->type == LayerType::Precomp)
                ed->setTimeRemap(*l, !l->timeRemapEnabled);
    }, time);
    act("Time Stretch…", {}, [this] { showTimeStretchDialog(this, ed_); }, time);
    QMenu *blend = layer->addMenu("Blending Mode");
    for (int i = 0; i <= int(BlendMode::Exclusion); ++i)
        act(blendModeName(BlendMode(i)), {}, [ed, i] {
            for (Layer *l : ed->selectedLayers())
                l->blend = BlendMode(i);
            ed->commit("Blending Mode", true);
        }, blend);
    QMenu *matte = layer->addMenu("Track Matte");
    for (int i = 0; i <= int(MatteMode::LumaInverted); ++i)
        act(matteModeName(MatteMode(i)), {}, [ed, i] {
            for (Layer *l : ed->selectedLayers())
                l->matte = MatteMode(i);
            ed->commit("Track Matte", true);
        }, matte);
    layer->addSeparator();
    act("Pre-compose…", QKeySequence("Ctrl+Shift+C"), [this] { precompose(); }, layer);
    QMenu *arrange = layer->addMenu("Arrange");
    act("Bring Layer to Front", QKeySequence("Ctrl+Shift+]"), [ed] { ed->moveSelectedLayersToEdge(true); }, arrange);
    act("Bring Layer Forward", QKeySequence("Ctrl+]"), [ed] { ed->moveSelectedLayers(-1); }, arrange);
    act("Send Layer Backward", QKeySequence("Ctrl+["), [ed] { ed->moveSelectedLayers(1); }, arrange);
    act("Send Layer to Back", QKeySequence("Ctrl+Shift+["), [ed] { ed->moveSelectedLayersToEdge(false); }, arrange);

    // Effect
    QMenu *effect = mb->addMenu("Effec&t");
    act("Effect Controls", QKeySequence(Qt::Key_F3), [this] {
        effectControlsDock_->show();
        effectControlsDock_->raise();
    }, effect);
    act("Remove All", QKeySequence("Ctrl+Shift+E"), [ed] { ed->removeAllEffects(); }, effect);
    effect->addSeparator();
    for (const QString &cat : EffectRegistry::categories()) {
        QMenu *cm = effect->addMenu(cat);
        for (const auto &d : EffectRegistry::all())
            if (d.category == cat) {
                const QString id = d.id;
                act(d.name, {}, [ed, id] { ed->addEffect(id); }, cm);
            }
    }

    // Animation
    QMenu *anim = mb->addMenu("&Animation");
    QMenu *presets = anim->addMenu("Apply Animation Preset");
    for (const auto &p : Editor::presets()) {
        const QString id = p.first;
        act(p.second, {}, [ed, id] { ed->applyPreset(id); }, presets);
    }
    anim->addSeparator();
    act("Add Keyframe to Selected Property", {}, [ed] {
        const PropRef r = ed->selectedProperty();
        if (Property *p = ed->resolve(r))
            ed->setKeyAtCurrentTime(*p, *ed->layerOfRef(r));
    }, anim);
    act("Toggle Hold Keyframe", QKeySequence("Ctrl+Alt+H"), [ed] { ed->toggleHoldSelectedKeys(); }, anim);
    QMenu *ka = anim->addMenu("Keyframe Assistant");
    act("Easy Ease", QKeySequence(Qt::Key_F9), [ed] { ed->easeSelectedKeys(true, true); }, ka);
    act("Easy Ease In", QKeySequence("Shift+F9"), [ed] { ed->easeSelectedKeys(true, false); }, ka);
    act("Easy Ease Out", QKeySequence("Ctrl+Shift+F9"), [ed] { ed->easeSelectedKeys(false, true); }, ka);
    act("Add Expression", QKeySequence("Alt+Shift+="), [this] {
        const PropRef r = ed_->selectedProperty();
        if (r.isValid())
            showExpressionEditor(this, ed_, r);
        else
            statusBar()->showMessage("Select a property in the timeline first (click its name).", 5000);
    }, anim);
    anim->addSeparator();
    act("Reveal Animated Properties", QKeySequence(Qt::Key_U), [ed] { ed->revealProperties("animated", false); }, anim);
    act("Previous Keyframe", QKeySequence(Qt::Key_J), [ed] { ed->gotoKeyframe(false); }, anim);
    act("Next Keyframe", QKeySequence(Qt::Key_K), [ed] { ed->gotoKeyframe(true); }, anim);

    // Property reveal & keyframe shortcuts
    const QList<QPair<char, QString>> reveal = {
        {'P', "position"}, {'S', "scale"}, {'R', "rotation"}, {'T', "opacity"}, {'A', "anchor"}};
    for (const auto &rv : reveal) {
        const QString id = rv.second;
        const QString k(rv.first);
        act("Reveal " + id, QKeySequence(k), [ed, id] { ed->revealProperties(id, false); });
        act("Add Reveal " + id, QKeySequence("Shift+" + k), [ed, id] { ed->revealProperties(id, true); });
        act("Key " + id, QKeySequence("Alt+Shift+" + k), [ed, id] {
            for (Layer *l : ed->selectedLayers())
                for (Property *p : l->allProperties())
                    if (p->id == id)
                        p->addKey(ed->time(), ed->renderer().eval(*p, ed->time(), *l, *ed->activeComp()));
            ed->commit("Add Keyframe", true);
        });
    }
    act("Reveal Effects", QKeySequence(Qt::Key_E), [ed] { ed->revealProperties("effects", false); });
    act("Reveal Audio Levels", QKeySequence(Qt::Key_L), [ed] { ed->revealProperties("audioLevels", false); });
    act("Add Marker", QKeySequence(Qt::Key_Asterisk), [ed] { ed->addMarkerAtCurrentTime(); }, anim);
    act("Add Marker (Numpad)", QKeySequence(Qt::KeypadModifier | Qt::Key_Asterisk), [ed] { ed->addMarkerAtCurrentTime(); });

    // Time navigation
    act("Next Frame", QKeySequence(Qt::Key_PageDown), [ed] { ed->stepFrames(1); });
    act("Previous Frame", QKeySequence(Qt::Key_PageUp), [ed] { ed->stepFrames(-1); });
    act("Next Frame (Ctrl+Right)", QKeySequence("Ctrl+Right"), [ed] { ed->stepFrames(1); });
    act("Previous Frame (Ctrl+Left)", QKeySequence("Ctrl+Left"), [ed] { ed->stepFrames(-1); });
    act("Forward 10 Frames", QKeySequence("Shift+PgDown"), [ed] { ed->stepFrames(10); });
    act("Back 10 Frames", QKeySequence("Shift+PgUp"), [ed] { ed->stepFrames(-10); });
    act("Go to Start", QKeySequence(Qt::Key_Home), [ed] { ed->setTime(0); });
    act("Go to End", QKeySequence(Qt::Key_End), [ed] {
        if (Composition *c = ed->activeComp())
            ed->setTime(c->duration);
    });
    act("Work Area Start", QKeySequence(Qt::Key_B), [ed] {
        if (Composition *c = ed->activeComp(); c && ed->time() < c->workEnd) {
            c->workStart = ed->time();
            ed->commit("Set Work Area", false);
        }
    });
    act("Work Area End", QKeySequence(Qt::Key_N), [ed] {
        if (Composition *c = ed->activeComp(); c && ed->time() + c->frameDuration() > c->workStart) {
            c->workEnd = std::min(c->duration, ed->time() + c->frameDuration());
            ed->commit("Set Work Area", false);
        }
    });
    act("Move In Point to Time", QKeySequence(Qt::Key_BracketLeft), [ed] { ed->moveSelectedToTime(true); });
    act("Move Out Point to Time", QKeySequence(Qt::Key_BracketRight), [ed] { ed->moveSelectedToTime(false); });
    act("Trim In Point", QKeySequence("Alt+["), [ed] { ed->trimSelected(true); });
    act("Trim Out Point", QKeySequence("Alt+]"), [ed] { ed->trimSelected(false); });

    // Tools
    act("Selection Tool", QKeySequence(Qt::Key_V), [this] { setTool(Tool::Select); });
    act("Hand Tool", QKeySequence(Qt::Key_H), [this] { setTool(Tool::Hand); });
    act("Zoom Tool", QKeySequence(Qt::Key_Z), [this] { setTool(Tool::Zoom); });
    act("Rotation Tool", QKeySequence(Qt::Key_W), [this] { setTool(Tool::Rotate); });
    act("Pan Behind Tool", QKeySequence(Qt::Key_Y), [this] { setTool(Tool::Anchor); });
    act("Shape Tools", QKeySequence(Qt::Key_Q), [this] {
        static const Tool shapes[] = {Tool::Rect, Tool::Ellipse, Tool::Polygon, Tool::Star};
        const Tool cur = compPanel_->viewer()->tool();
        bool isShape = std::find(std::begin(shapes), std::end(shapes), cur) != std::end(shapes);
        shapeToolIndex_ = isShape ? (shapeToolIndex_ + 1) % 4 : shapeToolIndex_;
        setTool(shapes[shapeToolIndex_]);
    });
    act("Type Tool", QKeySequence("Ctrl+T"), [this] { setTool(Tool::Text); });

    // View
    QMenu *view = mb->addMenu("&View");
    CompViewer *v = compPanel_->viewer();
    act("Zoom In", QKeySequence(Qt::Key_Period), [v] { v->zoomBy(2); }, view);
    act("Zoom Out", QKeySequence(Qt::Key_Comma), [v] { v->zoomBy(0.5); }, view);
    act("Fit Composition", QKeySequence("Shift+/"), [v] { v->fitToView(); }, view);
    act("Zoom 100%", QKeySequence("Alt+/"), [v] { v->setZoom(1.0); }, view);
    view->addSeparator();
    QMenu *res = view->addMenu("Resolution");
    const QStringList resNames{"Auto", "Full", "Half", "Third", "Quarter"};
    for (int i = 0; i < resNames.size(); ++i)
        act(resNames[i], {}, [v, i] { v->setResolution(i); }, res);
    act("Show Grid", QKeySequence("Ctrl+'"), [v] { v->setShowGrid(!v->showGrid()); }, view);
    act("Transparency Grid", {}, [v] { v->setTransparencyGrid(!v->transparencyGrid()); }, view);

    // Window
    QMenu *win = mb->addMenu("&Window");
    for (QDockWidget *d : docks_)
        win->addAction(d->toggleViewAction());
    win->addSeparator();
    act("Reset Workspace", {}, [this] { resetWorkspace(); }, win);

    // Help
    QMenu *help = mb->addMenu("&Help");
    act("Keyboard Shortcuts", QKeySequence("Ctrl+/"), [this] { showShortcutsDialog(this); }, help);
    act("About MotionForge", {}, [this] {
        QMessageBox::about(this, "About MotionForge",
                           "<h3>MotionForge 0.1</h3>"
                           "<p>Motion graphics and compositing for Linux with an After Effects-style workflow.</p>"
                           "<p>Independent open project, written from scratch. Not affiliated with or endorsed "
                           "by Adobe. After Effects is a trademark of Adobe Inc.</p>"
                           "<p>Built with Qt " QT_VERSION_STR " and FFmpeg.</p>");
    }, help);
}

void MainWindow::fillLayerMenu(QMenu &m)
{
    Editor *ed = ed_;
    QMenu *nw = m.addMenu("New");
    nw->addAction("Text", [this] {
        if (Layer *l = ed_->newText("Text"))
            showTextEditor(this, ed_, l->id);
    });
    nw->addAction("Solid…", [this] { newSolid(); });
    nw->addAction("Null Object", [ed] { ed->newNull(); });
    nw->addAction("Shape Layer", [ed] { ed->newShape(ShapeKind::Rectangle); });
    nw->addAction("Adjustment Layer", [ed] { ed->newAdjustment(); });
    Layer *l = ed_->primaryLayer();
    if (!l)
        return;
    m.addAction("Layer Settings…", [this] { layerSettings(); });
    if (l->type == LayerType::Precomp)
        m.addAction("Open Layer Source", [ed, l] { ed->setActiveComp(l->sourceItemId); });
    if (l->type == LayerType::Text)
        m.addAction("Edit Text…", [this, l] { showTextEditor(this, ed_, l->id); });
    m.addSeparator();
    QMenu *fx = m.addMenu("Effect");
    for (const QString &cat : EffectRegistry::categories()) {
        QMenu *cm = fx->addMenu(cat);
        for (const auto &d : EffectRegistry::all())
            if (d.category == cat) {
                const QString id = d.id;
                cm->addAction(d.name, [ed, id] { ed->addEffect(id); });
            }
    }
    QMenu *pr = m.addMenu("Animation Preset");
    for (const auto &p : Editor::presets()) {
        const QString id = p.first;
        pr->addAction(p.second, [ed, id] { ed->applyPreset(id); });
    }
    QMenu *blend = m.addMenu("Blending Mode");
    for (int i = 0; i <= int(BlendMode::Exclusion); ++i) {
        QAction *a = blend->addAction(blendModeName(BlendMode(i)), [ed, i] {
            for (Layer *s : ed->selectedLayers())
                s->blend = BlendMode(i);
            ed->commit("Blending Mode", true);
        });
        a->setCheckable(true);
        a->setChecked(int(l->blend) == i);
    }
    QMenu *time = m.addMenu("Time");
    if (l->type == LayerType::Footage || l->type == LayerType::Precomp) {
        QAction *tr = time->addAction("Enable Time Remapping", [ed, l] { ed->setTimeRemap(*l, !l->timeRemapEnabled); });
        tr->setCheckable(true);
        tr->setChecked(l->timeRemapEnabled);
    }
    time->addAction("Time Stretch…", [this] { showTimeStretchDialog(this, ed_); });
    QMenu *trf = m.addMenu("Transform");
    trf->addAction("Reset", [ed, l] { ed->resetTransform(*l); });
    trf->addAction("Center Anchor Point", [ed, l] { ed->centerAnchor(*l); });
    trf->addAction("Fit to Comp", [ed, l] { ed->fitToComp(*l, false); });
    m.addSeparator();
    m.addAction("Pre-compose…", [this] { precompose(); });
    m.addAction("Duplicate", [ed] { ed->duplicateSelectedLayers(); });
    m.addAction("Split Layer", [ed] { ed->splitSelectedLayers(); });
    m.addSeparator();
    m.addAction("Delete", [ed] { ed->deleteSelectedLayers(); });
}

void MainWindow::updateTitle()
{
    const QString name = ed_->filePath().isEmpty() ? "Untitled Project" : QFileInfo(ed_->filePath()).fileName();
    setWindowTitle(QString("MotionForge - %1%2").arg(name, ed_->isDirty() ? " *" : ""));
}

void MainWindow::updateActions()
{
    undoAct_->setEnabled(ed_->canUndo());
    undoAct_->setText(ed_->canUndo() ? "Undo " + ed_->undoLabel() : "Undo");
    redoAct_->setEnabled(ed_->canRedo());
    redoAct_->setText(ed_->canRedo() ? "Redo " + ed_->redoLabel() : "Redo");
}

// ------------------------------------------------------------ file handling

void MainWindow::addRecent(const QString &path)
{
    QSettings s;
    QStringList r = s.value("recent").toStringList();
    r.removeAll(path);
    r.prepend(path);
    while (r.size() > 10)
        r.removeLast();
    s.setValue("recent", r);
    rebuildRecentMenu();
}

void MainWindow::rebuildRecentMenu()
{
    recentMenu_->clear();
    const QStringList r = QSettings().value("recent").toStringList();
    for (const QString &p : r)
        recentMenu_->addAction(QFileInfo(p).fileName(), [this, p] {
            if (maybeSave())
                openProject(p);
        })->setToolTip(p);
    recentMenu_->setEnabled(!r.isEmpty());
}

bool MainWindow::maybeSave()
{
    if (!ed_->isDirty() || renderQueue_->isRendering())
        return !renderQueue_->isRendering();
    const auto r = QMessageBox::question(this, "MotionForge", "Save changes to the project before closing?",
                                         QMessageBox::Save | QMessageBox::Discard | QMessageBox::Cancel);
    if (r == QMessageBox::Save)
        return save();
    return r == QMessageBox::Discard;
}

bool MainWindow::save()
{
    if (ed_->filePath().isEmpty())
        return saveAs();
    QString err;
    if (!ed_->save(ed_->filePath(), &err)) {
        QMessageBox::warning(this, "Save failed", err);
        return false;
    }
    statusBar()->showMessage("Saved " + ed_->filePath(), 4000);
    addRecent(ed_->filePath());
    updateTitle();
    return true;
}

bool MainWindow::saveAs()
{
    QString path = QFileDialog::getSaveFileName(this, "Save Project As", QDir::homePath() + "/Untitled.mfproj",
                                                "MotionForge Project (*.mfproj)");
    if (path.isEmpty())
        return false;
    if (!path.endsWith(".mfproj"))
        path += ".mfproj";
    QString err;
    if (!ed_->save(path, &err)) {
        QMessageBox::warning(this, "Save failed", err);
        return false;
    }
    addRecent(path);
    updateTitle();
    return true;
}

void MainWindow::newProject()
{
    if (!maybeSave())
        return;
    ed_->newProject();
    updateTitle();
}

void MainWindow::open()
{
    if (!maybeSave())
        return;
    const QString path = QFileDialog::getOpenFileName(this, "Open Project", QDir::homePath(),
                                                      "MotionForge Project (*.mfproj);;All Files (*)");
    if (!path.isEmpty())
        openProject(path);
}

bool MainWindow::openProject(const QString &path)
{
    QString err;
    if (!ed_->load(path, &err)) {
        QMessageBox::warning(this, "Open failed", QString("Could not open %1:\n%2").arg(path, err));
        return false;
    }
    addRecent(path);
    updateTitle();
    return true;
}

void MainWindow::importFiles()
{
    const QStringList files = QFileDialog::getOpenFileNames(
        this, "Import File", QSettings().value("lastImportDir", QDir::homePath()).toString(),
        "Media (*.mp4 *.mov *.mkv *.webm *.avi *.m4v *.gif *.png *.jpg *.jpeg *.bmp *.tif *.tiff *.webp *.tga "
        "*.mp3 *.wav *.aac *.m4a *.flac *.ogg *.opus);;"
        "Video (*.mp4 *.mov *.mkv *.webm *.avi *.m4v *.gif);;Images (*.png *.jpg *.jpeg *.bmp *.tif *.tiff *.webp *.tga);;"
        "Audio (*.mp3 *.wav *.aac *.m4a *.flac *.ogg *.opus);;All Files (*)");
    if (files.isEmpty())
        return;
    QSettings().setValue("lastImportDir", QFileInfo(files.first()).absolutePath());
    QStringList errors;
    for (const QString &f : files) {
        QString err;
        if (!ed_->importFile(f, &err))
            errors << QFileInfo(f).fileName() + ": " + err;
    }
    if (!errors.isEmpty())
        QMessageBox::warning(this, "Import", errors.join("\n"));
    projectDock_->raise();
}

void MainWindow::newComposition()
{
    CompSettings s;
    s.name = QString("Comp %1").arg(ed_->project().compositions().size() + 1);
    if (Composition *c = ed_->activeComp()) {
        s.width = c->width;
        s.height = c->height;
        s.fps = c->fps;
        s.duration = c->duration;
    }
    CompositionDialog dlg(s, true, this);
    if (dlg.exec() != QDialog::Accepted)
        return;
    s = dlg.settings();
    Composition *c = ed_->newComposition(s.name, s.width, s.height, s.fps, s.duration, s.background);
    c->motionBlurSamples = s.mbSamples;
    c->shutterAngle = s.shutterAngle;
}

void MainWindow::compositionSettings()
{
    Composition *c = ed_->activeComp();
    if (!c)
        return newComposition();
    CompSettings s{c->name, c->width, c->height, c->fps, c->duration, c->background, c->motionBlurEnabled,
                   c->motionBlurSamples, c->shutterAngle};
    CompositionDialog dlg(s, false, this);
    if (dlg.exec() != QDialog::Accepted)
        return;
    s = dlg.settings();
    const bool longer = s.duration > c->duration;
    const double oldDur = c->duration;
    c->name = s.name;
    c->width = s.width;
    c->height = s.height;
    c->fps = s.fps;
    c->duration = s.duration;
    c->background = s.background;
    c->motionBlurSamples = s.mbSamples;
    c->shutterAngle = s.shutterAngle;
    c->workEnd = std::min(c->workEnd >= oldDur - 1e-6 ? c->duration : c->workEnd, c->duration);
    c->workStart = std::min(c->workStart, c->workEnd - c->frameDuration());
    if (longer)   // extend layers that ran to the old end, like AE does for solids & text
        for (auto &l : c->layers)
            if (std::abs(l->outPoint - oldDur) < 1e-6 && l->type != LayerType::Footage)
                l->outPoint = c->duration;
    ed_->commit("Composition Settings", true);
    emit ed_->activeCompChanged();
}

void MainWindow::newSolid()
{
    Composition *c = ed_->activeComp();
    if (!c) {
        statusBar()->showMessage("Create a composition first (Ctrl+N).", 5000);
        return;
    }
    SolidSettings s{QString("Solid %1").arg(c->layers.size() + 1), c->width, c->height, QColor(200, 60, 60)};
    SolidDialog dlg(s, c->width, c->height, this);
    if (dlg.exec() == QDialog::Accepted) {
        s = dlg.settings();
        ed_->newSolid(s.name, s.width, s.height, s.color);
    }
}

void MainWindow::layerSettings()
{
    Composition *c = ed_->activeComp();
    Layer *l = ed_->primaryLayer();
    if (!c || !l)
        return;
    if (l->type == LayerType::Solid) {
        SolidDialog dlg({l->name, l->width, l->height, l->solidColor}, c->width, c->height, this);
        if (dlg.exec() != QDialog::Accepted)
            return;
        const SolidSettings s = dlg.settings();
        const bool resized = s.width != l->width || s.height != l->height;
        l->name = s.name;
        l->solidColor = s.color;
        if (resized) {
            l->width = s.width;
            l->height = s.height;
            l->setDefaultAnchor(s.width, s.height);
        }
        ed_->commit("Solid Settings", true);
        return;
    }
    bool ok = false;
    const QString name = QInputDialog::getText(this, "Layer Settings", "Layer name:", QLineEdit::Normal, l->name, &ok);
    if (ok && !name.trimmed().isEmpty()) {
        l->name = name.trimmed();
        ed_->commit("Rename Layer", true);
    }
}

void MainWindow::precompose()
{
    if (ed_->selectedLayers().empty())
        return;
    bool ok = false;
    const QString name = QInputDialog::getText(this, "Pre-compose", "New composition name:", QLineEdit::Normal,
                                               QString("Pre-comp %1").arg(ed_->project().compositions().size()), &ok);
    if (ok && !name.trimmed().isEmpty())
        ed_->precomposeSelected(name.trimmed());
}

void MainWindow::saveFrameAs()
{
    Composition *c = ed_->activeComp();
    if (!c)
        return;
    QString path = QFileDialog::getSaveFileName(this, "Save Frame As", QDir::homePath() + "/" + c->name + ".png",
                                                "PNG (*.png);;JPEG (*.jpg)");
    if (path.isEmpty())
        return;
    QImage img = path.endsWith(".jpg", Qt::CaseInsensitive) ? ed_->renderer().renderFlattened(*c, ed_->time(), 1.0)
                                                            : ed_->renderer().render(*c, ed_->time(), 1.0);
    if (!img.save(path))
        QMessageBox::warning(this, "Save Frame", "Could not write " + path);
    else
        statusBar()->showMessage("Saved frame to " + path, 5000);
}

void MainWindow::autosave()
{
    if (!ed_->isDirty())
        return;
    const QString dir = QStandardPaths::writableLocation(QStandardPaths::AppDataLocation) + "/Auto-Save";
    QDir().mkpath(dir);
    const QString base = ed_->filePath().isEmpty() ? "Untitled" : QFileInfo(ed_->filePath()).completeBaseName();
    QFile f(dir + "/" + base + " auto-save.mfproj");
    if (f.open(QIODevice::WriteOnly | QIODevice::Truncate)) {
        f.write(QJsonDocument(ed_->project().toJson()).toJson());
        statusBar()->showMessage("Auto-saved to " + f.fileName(), 3000);
    }
}

void MainWindow::closeEvent(QCloseEvent *e)
{
    if (!maybeSave()) {
        e->ignore();
        return;
    }
    playback_->stop();
    QSettings s;
    s.setValue("window/geometry", saveGeometry());
    s.setValue("window/state", saveState(2));
    e->accept();
}

void MainWindow::dragEnterEvent(QDragEnterEvent *e)
{
    if (e->mimeData()->hasUrls())
        e->acceptProposedAction();
}

void MainWindow::dropEvent(QDropEvent *e)
{
    for (const QUrl &u : e->mimeData()->urls()) {
        const QString p = u.toLocalFile();
        if (p.endsWith(".mfproj")) {
            if (maybeSave())
                openProject(p);
            return;
        }
        QString err;
        if (!ed_->importFile(p, &err))
            statusBar()->showMessage(QFileInfo(p).fileName() + ": " + err, 6000);
    }
}

// ------------------------------------------------------------ sample

// Synthesizes a short 120 BPM drum loop (kick, snare, hats) so the sample has music to sync to.
static QString writeSampleBeat()
{
    const QString dir = QStandardPaths::writableLocation(QStandardPaths::AppDataLocation) + "/sample";
    QDir().mkpath(dir);
    const QString path = dir + "/beat-120bpm.wav";
    if (QFileInfo::exists(path))
        return path;
    const int rate = 48000;
    const double seconds = 6.0, beat = 0.5;
    const int n = int(seconds * rate);
    std::vector<float> mix(size_t(n), 0.f);
    quint32 noise = 12345;
    auto rnd = [&] {
        noise ^= noise << 13;
        noise ^= noise >> 17;
        noise ^= noise << 5;
        return (noise & 0xFFFF) / 32768.f - 1.f;
    };
    for (int b = 0; b * beat < seconds; ++b) {
        const int s0 = int(b * beat * rate);
        for (int i = 0; i < rate / 3 && s0 + i < n; ++i) {   // kick: pitch-swept sine
            const double t = double(i) / rate;
            const double f = 50 + 90 * std::exp(-t * 30);
            mix[size_t(s0 + i)] += float(std::sin(2 * M_PI * f * t) * std::exp(-t * 9) * 0.9);
        }
        if (b % 2 == 1)   // snare on 2 and 4
            for (int i = 0; i < rate / 5 && s0 + i < n; ++i) {
                const double t = double(i) / rate;
                mix[size_t(s0 + i)] += float((rnd() * 0.5 + std::sin(2 * M_PI * 190 * t) * 0.3) * std::exp(-t * 18));
            }
        for (int h = 0; h < 2; ++h) {   // eighth-note hats
            const int hs = s0 + h * int(beat * rate / 2);
            for (int i = 0; i < rate / 25 && hs + i < n; ++i)
                mix[size_t(hs + i)] += float(rnd() * 0.18 * std::exp(-double(i) / rate * 90));
        }
    }
    QFile f(path);
    if (!f.open(QIODevice::WriteOnly))
        return {};
    auto u32 = [&](quint32 v) { f.write(reinterpret_cast<const char *>(&v), 4); };
    auto u16 = [&](quint16 v) { f.write(reinterpret_cast<const char *>(&v), 2); };
    f.write("RIFF");
    u32(36 + n * 4);
    f.write("WAVEfmt ");
    u32(16); u16(1); u16(2); u32(rate); u32(rate * 4); u16(4); u16(16);
    f.write("data");
    u32(n * 4);
    for (int i = 0; i < n; ++i) {
        const qint16 v = qint16(std::clamp(mix[size_t(i)], -1.f, 1.f) * 30000);
        f.write(reinterpret_cast<const char *>(&v), 2);
        f.write(reinterpret_cast<const char *>(&v), 2);
    }
    return path;
}

void MainWindow::buildSampleProject()
{
    ed_->newProject();
    Composition *c = ed_->newComposition("Sample Edit", 1920, 1080, 30, 6, QColor(10, 10, 16));
    Project &p = ed_->project();
    auto add = [&](std::unique_ptr<Layer> l) {
        Layer *raw = l.get();
        c->layers.push_back(std::move(l));
        return raw;
    };
    auto fx = [&](Layer *l, const char *id) {
        ed_->addEffectTo(*l, id);
        return l->effects.back().get();
    };
    auto ease = [](Property &pr) {
        for (auto &k : pr.keys)
            k.inInterp = k.outInterp = Interp::Bezier;
    };

    // Top to bottom (index 0 is the top layer).
    auto grade = p.makeLayer(LayerType::Adjustment, *c);
    grade->name = "Grade";
    Layer *gradeL = add(std::move(grade));
    fx(gradeL, "mf.vignette")->param("amount")->staticValue = {55};
    fx(gradeL, "mf.noise")->param("amount")->staticValue = {4};

    auto title = p.makeLayer(LayerType::Text, *c);
    title->name = "MOTIONFORGE";
    title->text = "MOTIONFORGE";
    title->align = 1;
    title->bold = true;
    title->fontFamily = QFont().defaultFamily();
    title->fontSize.staticValue = {170};
    title->tracking.staticValue = {120};
    title->position.staticValue = {960, 600};
    title->scale.addKey(0.2, {0, 0});
    title->scale.addKey(0.7, {112, 112});
    title->scale.addKey(1.0, {100, 100});
    ease(title->scale);
    title->motionBlur = true;
    Layer *titleL = add(std::move(title));
    Effect *split = fx(titleL, "mf.rgbSplit");
    split->param("distance")->addKey(0.2, {40});
    split->param("distance")->addKey(1.0, {3});
    Effect *glow = fx(titleL, "mf.glow");
    glow->param("threshold")->staticValue = {40};
    glow->param("radius")->staticValue = {30};

    auto sub = p.makeLayer(LayerType::Text, *c);
    sub->name = "subtitle";
    sub->text = "motion graphics for linux";
    sub->align = 1;
    sub->fontFamily = QFont().defaultFamily();
    sub->fontSize.staticValue = {54};
    sub->tracking.staticValue = {300};
    sub->fillColor.staticValue = {0.55, 0.8, 1.0, 1.0};
    sub->position.staticValue = {960, 700};
    sub->opacity.addKey(0.9, {0});
    sub->opacity.addKey(1.5, {100});
    sub->inPoint = 0.5;
    add(std::move(sub));

    auto star = p.makeLayer(LayerType::Shape, *c);
    star->name = "Star";
    star->shapeKind = ShapeKind::Star;
    star->shapeSize.staticValue = {260, 260};
    star->shapeFill.staticValue = {1.0, 0.75, 0.2, 1.0};
    star->position.staticValue = {1540, 300};
    star->rotation.expression = "time * 90";
    star->scale.expression = "var s = 100 + Math.sin(time * 4) * 10; [s, s]";
    star->motionBlur = true;
    add(std::move(star));

    auto orb = p.makeLayer(LayerType::Shape, *c);
    orb->name = "Orb";
    orb->shapeKind = ShapeKind::Ellipse;
    orb->shapeSize.staticValue = {220, 220};
    orb->shapeFill.staticValue = {0.2, 0.55, 1.0, 1.0};
    orb->position.addKey(0, {300, 850});
    orb->position.addKey(3, {600, 260});
    orb->position.addKey(6, {300, 850});
    ease(orb->position);
    orb->position.expression = "wiggle(2, 40)";
    orb->motionBlur = true;
    Layer *orbL = add(std::move(orb));
    fx(orbL, "mf.glow")->param("radius")->staticValue = {60};

    auto bg = p.makeLayer(LayerType::Solid, *c);
    bg->name = "Background";
    bg->solidColor = QColor(20, 20, 30);
    Layer *bgL = add(std::move(bg));
    Effect *ramp = fx(bgL, "mf.gradientRamp");
    ramp->param("shape")->staticValue = {1};
    ramp->param("start")->staticValue = {960, 540};
    ramp->param("end")->staticValue = {960, 1400};
    ramp->param("startColor")->staticValue = {0.12, 0.16, 0.32, 1};
    ramp->param("endColor")->staticValue = {0.01, 0.01, 0.03, 1};

    // Music: a generated drum loop with markers on every beat.
    if (const QString beat = writeSampleBeat(); !beat.isEmpty()) {
        QString err;
        if (FootageItem *f = ed_->importFile(beat, &err)) {
            auto music = p.makeLayer(LayerType::Footage, *c);
            music->name = "beat-120bpm.wav";
            music->sourceItemId = f->id;
            music->hasAudio = music->audioOnly = true;
            music->label = 9;
            music->width = music->height = 0;
            music->outPoint = std::min(c->duration, f->duration);
            c->layers.push_back(std::move(music));
            for (double t = 0.5; t < c->duration; t += 0.5)
                c->addMarker(t);
            c->markers[1].comment = "drop";
        }
    }

    ed_->commit("Sample Project", true);
    ed_->setTime(1.5);
    // Leave the sample as an unsaved, clean starting point.
    ed_->setSelection({titleL->id});
    ed_->revealProperties("animated", false);   // like pressing U
    updateTitle();
}

} // namespace mf
