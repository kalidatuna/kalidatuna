#pragma once
#include "core/Project.h"
#include "render/AudioMixer.h"
#include "render/FrameCache.h"
#include "render/Renderer.h"

#include <QHash>
#include <QObject>
#include <QSet>
#include <deque>
#include <functional>
#include <optional>

namespace mf {

// Reference to one property of a layer: a built-in property id, or "fx:<uid>:<param>".
struct PropRef {
    int layerId = 0;
    QString key;
    bool isValid() const { return layerId != 0 && !key.isEmpty(); }
    bool operator==(const PropRef &o) const { return layerId == o.layerId && key == o.key; }
};

// Application controller: owns the project, the current composition and time,
// selection, undo history and every editing operation the panels invoke.
class Editor : public QObject {
    Q_OBJECT
public:
    Editor();

    Project &project() { return project_; }
    Renderer &renderer() { return renderer_; }
    AudioMixer &mixer() { return mixer_; }
    FrameCache &cache() { return cache_; }

    // ---- composition & time
    Composition *activeComp() const;
    void setActiveComp(int id);
    double time() const;
    int currentFrame() const;
    void setTime(double t);
    void stepFrames(int delta);

    // ---- selection
    QList<int> selectedLayerIds() const { return selection_; }
    std::vector<Layer *> selectedLayers() const;
    Layer *primaryLayer() const;
    bool isSelected(int layerId) const { return selection_.contains(layerId); }
    void selectLayer(int id, bool additive = false, bool toggle = false);
    void setSelection(const QList<int> &ids);
    void clearSelection();
    int selectedItemId() const { return selectedItem_; }
    void setSelectedItem(int id);
    PropRef selectedProperty() const { return selectedProp_; }
    void setSelectedProperty(const PropRef &r) { selectedProp_ = r; emit selectionChanged(); }

    Property *resolve(const PropRef &r) const;
    Layer *layerOfRef(const PropRef &r) const;
    static QString keyFor(const Layer &layer, const Property *p);

    // ---- property reveal (P/S/R/T/A/U/E shortcuts)
    QSet<QString> revealed(int layerId) const { return reveal_.value(layerId); }
    void revealProperties(const QString &which, bool add);
    void clearReveal(int layerId) { reveal_.remove(layerId); emit projectChanged(); }

    // ---- undo
    void commit(const QString &label, bool structural = false);
    void touch();   // live, uncommitted change (scrubbing)
    void undo();
    void redo();
    bool canUndo() const { return !undo_.empty(); }
    bool canRedo() const { return !redo_.empty(); }
    QString undoLabel() const { return undo_.empty() ? QString() : undo_.back().label; }
    QString redoLabel() const { return redo_.empty() ? QString() : redo_.back().label; }

    // ---- files
    void newProject();
    bool save(const QString &path, QString *error);
    bool load(const QString &path, QString *error);
    bool isDirty() const { return dirty_; }
    QString filePath() const { return project_.filePath; }

    // ---- items
    Composition *newComposition(const QString &name, int w, int h, double fps, double duration, QColor bg);
    FootageItem *importFile(const QString &path, QString *error);
    Composition *newCompFromItem(int itemId);
    void deleteItem(int itemId);
    void renameItem(int itemId, const QString &name);
    int newFolder(const QString &name);

    // ---- layers
    Layer *addLayer(std::unique_ptr<Layer> layer, const QString &undoLabel);
    Layer *newSolid(const QString &name, int w, int h, QColor color);
    Layer *newText(const QString &text, std::optional<QPointF> pos = std::nullopt);
    Layer *newShape(ShapeKind kind, std::optional<QRectF> compRect = std::nullopt);
    Layer *newNull();
    Layer *newAdjustment();
    Layer *addItemLayer(int itemId, std::optional<QPointF> pos = std::nullopt);
    void deleteSelectedLayers();
    void duplicateSelectedLayers();
    void splitSelectedLayers();
    void moveSelectedLayers(int delta);             // -1 = up (towards top)
    void moveSelectedLayersToEdge(bool top);
    void moveLayerTo(int layerId, int newIndex);
    void precomposeSelected(const QString &name);
    void shiftLayerTime(Layer &l, double delta);   // moves in/out/start and keyframes
    void trimSelected(bool inPoint);                // Alt+[ / Alt+]
    void moveSelectedToTime(bool inPoint);          // [ / ]
    void setTimeRemap(Layer &l, bool on);
    void setTimeStretch(Layer &l, double percent);
    void centerAnchor(Layer &l);
    void fitToComp(Layer &l, bool keepAspect);
    void resetTransform(Layer &l);
    void copySelection();
    void cut();
    void paste();

    // ---- effects
    void addEffect(const QString &typeId);
    void addEffectTo(Layer &l, const QString &typeId);
    void removeEffect(int layerId, int uid);
    void moveEffect(int layerId, int uid, int delta);
    void removeAllEffects();
    void applyPreset(const QString &presetId);
    static QList<QPair<QString, QString>> presets();   // id, display name

    // ---- keyframes
    void forEachSelectedKey(const std::function<void(Layer &, Property &, Keyframe &)> &fn);
    bool hasSelectedKeys();
    void deselectAllKeys();
    void setKeyAtCurrentTime(Property &p, const Layer &l);
    void toggleStopwatch(Property &p, const Layer &l);
    void easeSelectedKeys(bool easeIn, bool easeOut);
    void toggleHoldSelectedKeys();
    void deleteSelectedKeys();
    void gotoKeyframe(bool next);
    std::vector<double> keyTimesForLayer(Layer &l) const;

    // ---- composition markers
    void addMarkerAtCurrentTime();
    void removeMarker(int index);
    std::vector<double> snapTimes() const;   // markers, CTI, work area: targets for Shift-snapping

    // ---- rendering for viewers
    QImage frameImage(double scale, int *renderMs = nullptr);
    int lastRenderMs() const { return lastRenderMs_; }

    QRectF layerRectForEffects(const Layer &l) const;

signals:
    void projectChanged();   // structure changed: rebuild views
    void valuesChanged();    // property values changed: repaint / refresh values
    void timeChanged(double t);
    void selectionChanged();
    void activeCompChanged();
    void undoStateChanged();
    void message(const QString &text);

private:
    struct UndoStep {
        QByteArray before, after;
        QString label;
    };
    QByteArray snapshot() const;
    void restore(const QByteArray &state);
    void pruneSelection();
    std::unique_ptr<Layer> cloneLayer(const Layer &l);
    int insertIndexForNewLayer() const;

    Project project_;
    Renderer renderer_;
    AudioMixer mixer_;
    FrameCache cache_;
    int activeComp_ = 0;
    QHash<int, double> compTime_;
    QList<int> selection_;
    int selectedItem_ = 0;
    PropRef selectedProp_;
    QHash<int, QSet<QString>> reveal_;
    std::deque<UndoStep> undo_, redo_;
    QByteArray last_;
    bool dirty_ = false;
    int lastRenderMs_ = 0;
};

} // namespace mf
