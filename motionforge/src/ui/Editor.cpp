#include "Editor.h"

#include "media/MediaCache.h"
#include "media/VideoDecoder.h"
#include "render/Effects.h"

#include <QApplication>
#include <QClipboard>
#include <QDir>
#include <QElapsedTimer>
#include <QFile>
#include <QFileInfo>
#include <QFontDatabase>
#include <QJsonArray>
#include <QJsonDocument>
#include <QMimeData>
#include <cmath>

namespace mf {

static const char *kLayersMime = "application/x-motionforge-layers";
static const char *kKeysMime = "application/x-motionforge-keys";

Editor::Editor() : renderer_(project_), mixer_(project_, renderer_)
{
    installEffectFactory();
    newProject();
}

// ------------------------------------------------------------ comp & time

Composition *Editor::activeComp() const
{
    return project_.comp(activeComp_);
}

void Editor::setActiveComp(int id)
{
    if (id == activeComp_)
        return;
    activeComp_ = id;
    selection_.clear();
    selectedProp_ = {};
    emit activeCompChanged();
    emit selectionChanged();
    emit timeChanged(time());
}

double Editor::time() const
{
    return compTime_.value(activeComp_, 0.0);
}

int Editor::currentFrame() const
{
    const Composition *c = activeComp();
    return c ? c->frameAt(time()) : 0;
}

void Editor::setTime(double t)
{
    Composition *c = activeComp();
    if (!c)
        return;
    const int maxFrame = std::max(0, c->frameCount() - 1);
    const int f = std::clamp(int(std::round(t * c->fps)), 0, maxFrame);
    const double nt = c->timeOfFrame(f);
    if (compTime_.contains(activeComp_) && std::abs(compTime_[activeComp_] - nt) < 1e-9)
        return;
    compTime_[activeComp_] = nt;
    emit timeChanged(nt);
}

void Editor::stepFrames(int delta)
{
    if (Composition *c = activeComp())
        setTime(c->timeOfFrame(currentFrame() + delta));
}

// ------------------------------------------------------------ selection

std::vector<Layer *> Editor::selectedLayers() const
{
    std::vector<Layer *> r;
    if (Composition *c = activeComp())
        for (const auto &l : c->layers)
            if (selection_.contains(l->id))
                r.push_back(l.get());
    return r;
}

Layer *Editor::primaryLayer() const
{
    Composition *c = activeComp();
    if (!c || selection_.isEmpty())
        return nullptr;
    return c->layerById(selection_.last());
}

void Editor::selectLayer(int id, bool additive, bool toggle)
{
    if (toggle && selection_.contains(id)) {
        selection_.removeAll(id);
    } else {
        if (!additive && !toggle)
            selection_.clear();
        selection_.removeAll(id);
        selection_.append(id);
    }
    emit selectionChanged();
}

void Editor::setSelection(const QList<int> &ids)
{
    selection_ = ids;
    emit selectionChanged();
}

void Editor::clearSelection()
{
    if (selection_.isEmpty() && !selectedProp_.isValid())
        return;
    selection_.clear();
    selectedProp_ = {};
    emit selectionChanged();
}

void Editor::setSelectedItem(int id)
{
    selectedItem_ = id;
    emit selectionChanged();
}

void Editor::pruneSelection()
{
    Composition *c = activeComp();
    QList<int> keep;
    for (int id : selection_)
        if (c && c->layerById(id))
            keep << id;
    selection_ = keep;
    if (!resolve(selectedProp_))
        selectedProp_ = {};
    if (!project_.item(selectedItem_))
        selectedItem_ = 0;
}

QString Editor::keyFor(const Layer &layer, const Property *p)
{
    for (const auto &e : layer.effects)
        for (const auto &ep : e->params)
            if (&ep == p)
                return QString("fx:%1:%2").arg(e->uid).arg(ep.id);
    return p ? p->id : QString();
}

Property *Editor::resolve(const PropRef &r) const
{
    Layer *l = layerOfRef(r);
    if (!l)
        return nullptr;
    if (r.key.startsWith("fx:")) {
        const QStringList parts = r.key.split(':');
        if (parts.size() != 3)
            return nullptr;
        if (Effect *e = l->effectByUid(parts[1].toInt()))
            return e->param(parts[2]);
        return nullptr;
    }
    for (Property *p : l->allProperties())
        if (p->id == r.key)
            return p;
    return nullptr;
}

Layer *Editor::layerOfRef(const PropRef &r) const
{
    Composition *c = activeComp();
    return c ? c->layerById(r.layerId) : nullptr;
}

void Editor::revealProperties(const QString &which, bool add)
{
    // which: a property id, "animated" or "effects"
    for (Layer *l : selectedLayers()) {
        QSet<QString> set;
        if (which == "animated") {
            l->forEachProperty([&](Property &p) {
                if (p.isAnimated() || p.hasExpression())
                    set.insert(keyFor(*l, &p));
            });
        } else {
            set.insert(which);
        }
        QSet<QString> &cur = reveal_[l->id];
        if (add) {
            cur.unite(set);
        } else if (cur == set) {
            cur.clear();   // pressing the same key again hides it
        } else {
            cur = set;
        }
        if (cur.isEmpty())
            reveal_.remove(l->id);
        l->expanded = false;
    }
    emit projectChanged();
}

// ------------------------------------------------------------ undo

QByteArray Editor::snapshot() const
{
    return QJsonDocument(project_.toJson()).toJson(QJsonDocument::Compact);
}

void Editor::commit(const QString &label, bool structural)
{
    const QByteArray now = snapshot();
    cache_.clear();
    if (now != last_) {
        undo_.push_back({last_, now, label});
        if (undo_.size() > 300)
            undo_.pop_front();
        redo_.clear();
        last_ = now;
        dirty_ = true;
        emit undoStateChanged();
    }
    if (structural)
        emit projectChanged();
    else
        emit valuesChanged();
}

void Editor::touch()
{
    cache_.clear();
    emit valuesChanged();
}

void Editor::restore(const QByteArray &state)
{
    const QString path = project_.filePath;
    project_.fromJson(QJsonDocument::fromJson(state).object());
    project_.filePath = path;
    last_ = state;
    cache_.clear();
    if (!activeComp())
        activeComp_ = project_.compositions().empty() ? 0 : project_.compositions().front()->id;
    pruneSelection();
    dirty_ = true;
    emit projectChanged();
    emit selectionChanged();
    emit undoStateChanged();
    emit timeChanged(time());
}

void Editor::undo()
{
    if (undo_.empty())
        return;
    UndoStep s = undo_.back();
    undo_.pop_back();
    redo_.push_back(s);
    restore(s.before);
    emit message("Undo " + s.label);
}

void Editor::redo()
{
    if (redo_.empty())
        return;
    UndoStep s = redo_.back();
    redo_.pop_back();
    undo_.push_back(s);
    restore(s.after);
    emit message("Redo " + s.label);
}

// ------------------------------------------------------------ files

void Editor::newProject()
{
    project_.clear();
    project_.filePath.clear();
    MediaCache::instance().clear();
    cache_.clear();
    selection_.clear();
    selectedProp_ = {};
    reveal_.clear();
    compTime_.clear();
    activeComp_ = 0;
    undo_.clear();
    redo_.clear();
    last_ = snapshot();
    dirty_ = false;
    emit projectChanged();
    emit activeCompChanged();
    emit selectionChanged();
    emit undoStateChanged();
}

bool Editor::save(const QString &path, QString *error)
{
    QFile f(path);
    if (!f.open(QIODevice::WriteOnly | QIODevice::Truncate)) {
        if (error)
            *error = f.errorString();
        return false;
    }
    f.write(QJsonDocument(project_.toJson()).toJson(QJsonDocument::Indented));
    project_.filePath = path;
    dirty_ = false;
    emit undoStateChanged();
    return true;
}

bool Editor::load(const QString &path, QString *error)
{
    QFile f(path);
    if (!f.open(QIODevice::ReadOnly)) {
        if (error)
            *error = f.errorString();
        return false;
    }
    QJsonParseError pe;
    const QJsonDocument doc = QJsonDocument::fromJson(f.readAll(), &pe);
    if (pe.error != QJsonParseError::NoError) {
        if (error)
            *error = pe.errorString();
        return false;
    }
    Project loaded;
    if (!loaded.fromJson(doc.object(), error))
        return false;
    newProject();
    project_.fromJson(doc.object());
    project_.filePath = path;
    // Relink footage that moved along with the project file.
    const QDir dir = QFileInfo(path).absoluteDir();
    for (auto &i : project_.items)
        if (auto *ft = dynamic_cast<FootageItem *>(i.get()))
            if (!QFileInfo::exists(ft->path)) {
                const QString candidate = dir.filePath(QFileInfo(ft->path).fileName());
                if (QFileInfo::exists(candidate))
                    ft->path = candidate;
            }
    last_ = snapshot();
    dirty_ = false;
    auto comps = project_.compositions();
    activeComp_ = comps.empty() ? 0 : comps.front()->id;
    emit projectChanged();
    emit activeCompChanged();
    emit undoStateChanged();
    emit timeChanged(time());
    return true;
}

// ------------------------------------------------------------ items

Composition *Editor::newComposition(const QString &name, int w, int h, double fps, double duration, QColor bg)
{
    Composition *c = project_.addComposition(name, w, h, fps, duration);
    c->background = bg;
    activeComp_ = c->id;
    selection_.clear();
    commit("New Composition", true);
    emit activeCompChanged();
    emit selectionChanged();
    emit timeChanged(time());
    return c;
}

FootageItem *Editor::importFile(const QString &path, QString *error)
{
    const MediaInfo mi = probeMedia(path);
    if (!mi.ok) {
        if (error)
            *error = mi.error;
        return nullptr;
    }
    auto f = std::make_unique<FootageItem>();
    f->id = project_.newId();
    f->name = QFileInfo(path).fileName();
    f->path = QFileInfo(path).absoluteFilePath();
    f->isStill = mi.isStill;
    f->width = mi.width;
    f->height = mi.height;
    f->fps = mi.fps;
    f->duration = mi.duration;
    f->hasAudio = mi.hasAudio;
    f->hasVideo = mi.hasVideo;
    if (f->hasAudio) {
        emit message("Decoding audio: " + f->name);
        QApplication::processEvents(QEventLoop::ExcludeUserInputEvents);
        MediaCache::instance().audio(f->path);   // decode now so playback starts instantly
    }
    auto *raw = f.get();
    project_.items.push_back(std::move(f));
    commit("Import", true);
    emit message("Imported " + raw->name);
    return raw;
}

Composition *Editor::newCompFromItem(int itemId)
{
    Item *it = project_.item(itemId);
    if (auto *f = dynamic_cast<FootageItem *>(it)) {
        const double dur = f->isStill ? 10.0 : std::max(f->duration, 1.0 / f->fps);
        const bool audioOnly = !f->hasVideo;
        Composition *c = project_.addComposition(QFileInfo(f->name).completeBaseName(), audioOnly ? 1920 : f->width,
                                                 audioOnly ? 1080 : f->height,
                                                 (f->isStill || audioOnly) ? 30.0 : f->fps, dur);
        activeComp_ = c->id;
        selection_.clear();
        addItemLayer(itemId);
        emit activeCompChanged();
        return c;
    }
    return nullptr;
}

void Editor::deleteItem(int itemId)
{
    project_.removeItem(itemId);
    if (!activeComp()) {
        auto comps = project_.compositions();
        activeComp_ = comps.empty() ? 0 : comps.front()->id;
        emit activeCompChanged();
    }
    pruneSelection();
    commit("Delete", true);
}

void Editor::renameItem(int itemId, const QString &name)
{
    if (Item *i = project_.item(itemId)) {
        i->name = name;
        commit("Rename", true);
    }
}

int Editor::newFolder(const QString &name)
{
    auto f = std::make_unique<FolderItem>();
    f->id = project_.newId();
    f->name = name;
    const int id = f->id;
    project_.items.push_back(std::move(f));
    commit("New Folder", true);
    return id;
}

// ------------------------------------------------------------ layers

int Editor::insertIndexForNewLayer() const
{
    // New layers go above the topmost selected layer, like AE.
    Composition *c = activeComp();
    int idx = 0;
    if (c && !selection_.isEmpty()) {
        idx = int(c->layers.size());
        for (int id : selection_)
            idx = std::min(idx, std::max(0, c->indexOf(id)));
    }
    return idx;
}

Layer *Editor::addLayer(std::unique_ptr<Layer> layer, const QString &undoLabel)
{
    Composition *c = activeComp();
    if (!c)
        return nullptr;
    layer->name = project_.uniqueLayerName(*c, layer->name);
    Layer *raw = layer.get();
    const int idx = insertIndexForNewLayer();
    c->layers.insert(c->layers.begin() + idx, std::move(layer));
    selection_ = {raw->id};
    commit(undoLabel, true);
    emit selectionChanged();
    return raw;
}

Layer *Editor::newSolid(const QString &name, int w, int h, QColor color)
{
    Composition *c = activeComp();
    if (!c)
        return nullptr;
    auto l = project_.makeLayer(LayerType::Solid, *c);
    l->name = name;
    l->width = w;
    l->height = h;
    l->solidColor = color;
    l->setDefaultAnchor(w, h);
    return addLayer(std::move(l), "New Solid");
}

static QString defaultFontFamily()
{
    const QStringList prefs{"Montserrat", "Inter", "Roboto", "Noto Sans", "DejaVu Sans", "Liberation Sans"};
    const QStringList fams = QFontDatabase::families();
    for (const QString &p : prefs)
        if (fams.contains(p))
            return p;
    return QApplication::font().family();
}

Layer *Editor::newText(const QString &text, std::optional<QPointF> pos)
{
    Composition *c = activeComp();
    if (!c)
        return nullptr;
    auto l = project_.makeLayer(LayerType::Text, *c);
    l->text = text;
    l->name = text.section('\n', 0, 0).left(40);
    if (l->name.trimmed().isEmpty())
        l->name = "Text";
    l->align = 1;
    l->fontFamily = defaultFontFamily();
    l->bold = true;
    l->fontSize.defaultValue = l->fontSize.staticValue = {std::round(c->height / 10.0)};
    if (pos)
        l->position.staticValue = {pos->x(), pos->y()};
    return addLayer(std::move(l), "New Text Layer");
}

Layer *Editor::newShape(ShapeKind kind, std::optional<QRectF> rect)
{
    Composition *c = activeComp();
    if (!c)
        return nullptr;
    auto l = project_.makeLayer(LayerType::Shape, *c);
    l->shapeKind = kind;
    l->name = "Shape Layer";
    if (rect) {
        l->position.staticValue = {rect->center().x(), rect->center().y()};
        l->shapeSize.staticValue = {rect->width(), rect->height()};
    } else {
        const double s = std::min(c->width, c->height) * 0.4;
        l->shapeSize.staticValue = {s, s};
    }
    return addLayer(std::move(l), "New Shape Layer");
}

Layer *Editor::newNull()
{
    Composition *c = activeComp();
    if (!c)
        return nullptr;
    auto l = project_.makeLayer(LayerType::Null, *c);
    l->name = "Null";
    return addLayer(std::move(l), "New Null Object");
}

Layer *Editor::newAdjustment()
{
    Composition *c = activeComp();
    if (!c)
        return nullptr;
    auto l = project_.makeLayer(LayerType::Adjustment, *c);
    l->name = "Adjustment Layer";
    return addLayer(std::move(l), "New Adjustment Layer");
}

Layer *Editor::addItemLayer(int itemId, std::optional<QPointF> pos)
{
    Composition *c = activeComp();
    Item *it = project_.item(itemId);
    if (!c || !it)
        return nullptr;
    std::unique_ptr<Layer> l;
    if (auto *f = dynamic_cast<FootageItem *>(it)) {
        l = project_.makeLayer(LayerType::Footage, *c);
        l->sourceItemId = f->id;
        l->width = f->width;
        l->height = f->height;
        l->setDefaultAnchor(f->width, f->height);
        l->hasAudio = f->hasAudio;
        l->audioOnly = !f->hasVideo;
        if (l->audioOnly)
            l->label = 9;
        if (!f->isStill)
            l->outPoint = std::min(c->duration, f->duration);
    } else if (auto *sub = dynamic_cast<Composition *>(it)) {
        if (project_.compContains(*sub, c->id)) {
            emit message("Cannot nest a composition inside itself.");
            return nullptr;
        }
        l = project_.makeLayer(LayerType::Precomp, *c);
        l->sourceItemId = sub->id;
        l->width = sub->width;
        l->height = sub->height;
        l->setDefaultAnchor(sub->width, sub->height);
        l->hasAudio = mixer_.compHasAudio(*sub);
        l->outPoint = std::min(c->duration, sub->duration);
    } else {
        return nullptr;
    }
    l->name = it->name;
    if (pos)
        l->position.staticValue = {pos->x(), pos->y()};
    return addLayer(std::move(l), "Add Layer");
}

void Editor::deleteSelectedLayers()
{
    Composition *c = activeComp();
    if (!c || selection_.isEmpty())
        return;
    for (auto &l : c->layers)
        if (selection_.contains(l->parentId))
            l->parentId = 0;
    auto &ls = c->layers;
    ls.erase(std::remove_if(ls.begin(), ls.end(), [&](const auto &l) { return selection_.contains(l->id); }), ls.end());
    selection_.clear();
    pruneSelection();
    commit("Delete Layers", true);
    emit selectionChanged();
}

std::unique_ptr<Layer> Editor::cloneLayer(const Layer &l)
{
    auto copy = Layer::fromJson(l.toJson(), Project::effectFactory);
    copy->id = project_.newId();
    for (auto &e : copy->effects)
        e->uid = project_.newId();
    return copy;
}

void Editor::duplicateSelectedLayers()
{
    Composition *c = activeComp();
    if (!c)
        return;
    QList<int> newSel;
    for (Layer *l : selectedLayers()) {
        auto copy = cloneLayer(*l);
        copy->name = project_.uniqueLayerName(*c, l->name);
        newSel << copy->id;
        c->layers.insert(c->layers.begin() + c->indexOf(l->id), std::move(copy));
    }
    selection_ = newSel;
    commit("Duplicate", true);
    emit selectionChanged();
}

void Editor::splitSelectedLayers()
{
    Composition *c = activeComp();
    if (!c)
        return;
    const double t = time();
    QList<int> newSel;
    for (Layer *l : selectedLayers()) {
        if (t <= l->inPoint || t >= l->outPoint)
            continue;
        auto copy = cloneLayer(*l);
        copy->inPoint = t;
        l->outPoint = t;
        copy->name = project_.uniqueLayerName(*c, l->name);
        newSel << copy->id;
        c->layers.insert(c->layers.begin() + c->indexOf(l->id), std::move(copy));
    }
    if (newSel.isEmpty())
        return;
    selection_ = newSel;
    commit("Split Layer", true);
    emit selectionChanged();
}

void Editor::moveLayerTo(int layerId, int newIndex)
{
    Composition *c = activeComp();
    if (!c)
        return;
    const int from = c->indexOf(layerId);
    if (from < 0)
        return;
    newIndex = std::clamp(newIndex, 0, int(c->layers.size()) - 1);
    if (from == newIndex)
        return;
    auto l = std::move(c->layers[from]);
    c->layers.erase(c->layers.begin() + from);
    c->layers.insert(c->layers.begin() + newIndex, std::move(l));
    commit("Reorder Layers", true);
}

void Editor::moveSelectedLayers(int delta)
{
    Composition *c = activeComp();
    if (!c || selection_.isEmpty())
        return;
    auto &ls = c->layers;
    const int n = int(ls.size());
    if (delta < 0) {
        for (int i = 1; i < n; ++i)
            if (selection_.contains(ls[i]->id) && !selection_.contains(ls[i - 1]->id))
                std::swap(ls[i], ls[i - 1]);
    } else {
        for (int i = n - 2; i >= 0; --i)
            if (selection_.contains(ls[i]->id) && !selection_.contains(ls[i + 1]->id))
                std::swap(ls[i], ls[i + 1]);
    }
    commit("Reorder Layers", true);
}

void Editor::moveSelectedLayersToEdge(bool top)
{
    Composition *c = activeComp();
    if (!c || selection_.isEmpty())
        return;
    auto &ls = c->layers;
    std::stable_partition(ls.begin(), ls.end(), [&](const auto &l) { return selection_.contains(l->id) == top; });
    commit("Reorder Layers", true);
}

void Editor::precomposeSelected(const QString &name)
{
    Composition *c = activeComp();
    if (!c || selection_.isEmpty())
        return;
    Composition *sub = project_.addComposition(name, c->width, c->height, c->fps, c->duration);
    sub->background = c->background;
    int insertAt = int(c->layers.size());
    auto &ls = c->layers;
    for (size_t i = 0; i < ls.size();) {
        if (selection_.contains(ls[i]->id)) {
            insertAt = std::min(insertAt, int(i));
            sub->layers.push_back(std::move(ls[i]));
            ls.erase(ls.begin() + long(i));
        } else {
            ++i;
        }
    }
    // Parent links can't cross composition boundaries.
    for (auto &l : sub->layers)
        if (l->parentId && !sub->layerById(l->parentId))
            l->parentId = 0;
    for (auto &l : ls)
        if (l->parentId && !c->layerById(l->parentId))
            l->parentId = 0;
    auto pre = project_.makeLayer(LayerType::Precomp, *c);
    pre->sourceItemId = sub->id;
    pre->name = name;
    pre->setDefaultAnchor(c->width, c->height);
    pre->hasAudio = mixer_.compHasAudio(*sub);
    const int pid = pre->id;
    ls.insert(ls.begin() + insertAt, std::move(pre));
    selection_ = {pid};
    commit("Pre-compose", true);
    emit selectionChanged();
}

void Editor::shiftLayerTime(Layer &l, double delta)
{
    l.inPoint += delta;
    l.outPoint += delta;
    l.startTime += delta;
    l.forEachProperty([&](Property &p) {
        for (auto &k : p.keys)
            k.time += delta;
    });
}

void Editor::trimSelected(bool inPoint)
{
    const double t = time();
    for (Layer *l : selectedLayers()) {
        if (inPoint && t < l->outPoint)
            l->inPoint = t;
        else if (!inPoint && t > l->inPoint)
            l->outPoint = t + (activeComp() ? activeComp()->frameDuration() : 0);
    }
    commit(inPoint ? "Trim In Point" : "Trim Out Point", true);
}

void Editor::moveSelectedToTime(bool inPoint)
{
    const double t = time();
    for (Layer *l : selectedLayers()) {
        const double fd = activeComp()->frameDuration();
        shiftLayerTime(*l, inPoint ? t - l->inPoint : t + fd - l->outPoint);
    }
    commit("Move Layer", true);
}

void Editor::setTimeRemap(Layer &l, bool on)
{
    Composition *c = activeComp();
    if (!c || on == l.timeRemapEnabled)
        return;
    if (on) {
        const double fd = c->frameDuration();
        double srcEnd = renderer_.sourceTime(l, *c, l.outPoint - fd);
        double maxT = 1e6;
        if (auto *f = project_.footage(l.sourceItemId); f && !f->isStill)
            maxT = f->duration;
        else if (auto *sc = project_.comp(l.sourceItemId))
            maxT = sc->duration;
        l.timeRemap.reset();
        l.timeRemap.limits(0, maxT);
        l.timeRemap.addKey(l.inPoint, {renderer_.sourceTime(l, *c, l.inPoint)});
        l.timeRemap.addKey(l.outPoint - fd, {std::min(srcEnd, maxT)});
        l.timeRemapEnabled = true;
    } else {
        l.timeRemapEnabled = false;
        l.timeRemap.reset();
    }
    commit(on ? "Enable Time Remapping" : "Disable Time Remapping", true);
}

void Editor::setTimeStretch(Layer &l, double percent)
{
    if (percent < 1.0)
        return;
    // Keep the in point fixed and scale the layer's duration, like AE's Time Stretch.
    const double oldStretch = l.stretch;
    const double srcIn = (l.inPoint - l.startTime) * 100.0 / oldStretch;
    const double oldDur = l.outPoint - l.inPoint;
    l.stretch = percent;
    l.startTime = l.inPoint - srcIn * percent / 100.0;
    l.outPoint = l.inPoint + oldDur * percent / oldStretch;
    commit("Time Stretch", true);
}

void Editor::centerAnchor(Layer &l)
{
    Composition *c = activeComp();
    if (!c)
        return;
    const double t = time();
    const QRectF b = renderer_.layerBounds(l, *c, t);
    const QTransform before = renderer_.layerToComp(l, *c, t);
    const QPointF oldWorld = before.map(b.center());
    l.anchor.setValue(t, Property::fromPoint(b.center()));
    // Keep the layer visually in place: move position by the anchor's world offset.
    const QTransform after = renderer_.layerToComp(l, *c, t);
    const QPointF delta = oldWorld - after.map(b.center());
    QPointF pos = Property::toPoint(l.position.valueAt(t)) + delta;
    l.position.setValue(t, Property::fromPoint(pos));
    commit("Center Anchor Point", false);
}

void Editor::fitToComp(Layer &l, bool keepAspect)
{
    Composition *c = activeComp();
    if (!c)
        return;
    const double t = time();
    const QRectF b = renderer_.layerBounds(l, *c, t);
    if (b.isEmpty())
        return;
    double sx = c->width / b.width() * 100.0, sy = c->height / b.height() * 100.0;
    if (keepAspect)
        sx = sy = std::max(sx, sy);
    l.anchor.setValue(t, Property::fromPoint(b.center()));
    l.position.setValue(t, {c->width / 2.0, c->height / 2.0});
    l.scale.setValue(t, {sx, sy});
    l.rotation.setValue(t, {0});
    commit("Fit to Comp", false);
}

void Editor::resetTransform(Layer &l)
{
    for (Property *p : {&l.anchor, &l.position, &l.scale, &l.rotation, &l.opacity})
        p->reset();
    commit("Reset Transform", false);
}

void Editor::copySelection()
{
    auto *mime = new QMimeData;
    if (hasSelectedKeys()) {
        // Keyframes: stored relative to the earliest selected key.
        QJsonArray arr;
        double t0 = 1e18;
        forEachSelectedKey([&](Layer &, Property &, Keyframe &k) { t0 = std::min(t0, k.time); });
        forEachSelectedKey([&](Layer &l, Property &p, Keyframe &k) {
            QJsonObject o;
            QString key = keyFor(l, &p);
            if (key.startsWith("fx:"))   // match by effect type when pasting
                if (Effect *e = l.effectByUid(key.section(':', 1, 1).toInt()))
                    key = "fxType:" + e->typeId + ":" + p.id;
            o["prop"] = key;
            o["t"] = k.time - t0;
            QJsonArray v;
            for (double d : k.value)
                v.append(d);
            o["v"] = v;
            o["in"] = int(k.inInterp);
            o["out"] = int(k.outInterp);
            o["inInf"] = k.inInfluence;
            o["outInf"] = k.outInfluence;
            arr.append(o);
        });
        mime->setData(kKeysMime, QJsonDocument(arr).toJson(QJsonDocument::Compact));
        emit message(QString("Copied %1 keyframes").arg(arr.size()));
    } else {
        auto layers = selectedLayers();
        if (layers.empty()) {
            delete mime;
            return;
        }
        mime->setData(kLayersMime, QJsonDocument(layerListToJson(layers)).toJson(QJsonDocument::Compact));
        emit message(QString("Copied %1 layers").arg(layers.size()));
    }
    QApplication::clipboard()->setMimeData(mime);
}

void Editor::cut()
{
    if (hasSelectedKeys()) {
        copySelection();
        deleteSelectedKeys();
    } else {
        copySelection();
        deleteSelectedLayers();
    }
}

void Editor::paste()
{
    Composition *c = activeComp();
    const QMimeData *mime = QApplication::clipboard()->mimeData();
    if (!c || !mime)
        return;
    if (mime->hasFormat(kKeysMime)) {
        Layer *target = primaryLayer();
        if (!target)
            return;
        const QJsonArray arr = QJsonDocument::fromJson(mime->data(kKeysMime)).array();
        deselectAllKeys();
        int pasted = 0;
        for (const auto &v : arr) {
            const QJsonObject o = v.toObject();
            const QString key = o["prop"].toString();
            Property *p = nullptr;
            if (key.startsWith("fxType:")) {
                const QString type = key.section(':', 1, 1), pid = key.section(':', 2, 2);
                for (auto &e : target->effects)
                    if (e->typeId == type) {
                        p = e->param(pid);
                        break;
                    }
            } else {
                p = resolve({target->id, key});
            }
            if (!p)
                continue;
            Value val;
            for (const auto &d : o["v"].toArray())
                val.append(d.toDouble());
            const int idx = p->addKey(c->snap(time() + o["t"].toDouble()), val);
            Keyframe &k = p->keys[idx];
            k.inInterp = Interp(o["in"].toInt());
            k.outInterp = Interp(o["out"].toInt());
            k.inInfluence = o["inInf"].toDouble(33.333);
            k.outInfluence = o["outInf"].toDouble(33.333);
            k.selected = true;
            ++pasted;
        }
        if (pasted)
            commit("Paste Keyframes", true);
        return;
    }
    if (mime->hasFormat(kLayersMime)) {
        const QJsonArray arr = QJsonDocument::fromJson(mime->data(kLayersMime)).object()["layers"].toArray();
        QList<int> newSel;
        const int at = insertIndexForNewLayer();
        int offset = 0;
        QHash<int, int> idMap;
        std::vector<Layer *> added;
        for (const auto &v : arr) {
            auto l = Layer::fromJson(v.toObject(), Project::effectFactory);
            const int oldId = l->id;
            l->id = project_.newId();
            idMap.insert(oldId, l->id);
            for (auto &e : l->effects)
                e->uid = project_.newId();
            if ((l->type == LayerType::Footage || l->type == LayerType::Precomp) && !project_.item(l->sourceItemId))
                continue;
            if (l->type == LayerType::Precomp)
                if (auto *sub = project_.comp(l->sourceItemId); sub && project_.compContains(*sub, c->id))
                    continue;
            l->name = project_.uniqueLayerName(*c, l->name);
            newSel << l->id;
            added.push_back(l.get());
            c->layers.insert(c->layers.begin() + at + offset++, std::move(l));
        }
        for (Layer *l : added)
            l->parentId = idMap.value(l->parentId, c->layerById(l->parentId) ? l->parentId : 0);
        if (newSel.isEmpty())
            return;
        selection_ = newSel;
        commit("Paste Layers", true);
        emit selectionChanged();
    }
}

// ------------------------------------------------------------ effects

QRectF Editor::layerRectForEffects(const Layer &l) const
{
    Composition *c = activeComp();
    if (!c)
        return {};
    if (l.type == LayerType::Adjustment)
        return QRectF(0, 0, c->width, c->height);
    QRectF r = const_cast<Renderer &>(renderer_).layerBounds(l, *c, time());
    return r.isEmpty() ? QRectF(0, 0, c->width, c->height) : r;
}

void Editor::addEffectTo(Layer &l, const QString &typeId)
{
    auto e = EffectRegistry::create(typeId, project_.newId(), layerRectForEffects(l));
    if (!e)
        return;
    l.effects.push_back(std::move(e));
    l.effectsExpanded = true;
}

void Editor::addEffect(const QString &typeId)
{
    auto layers = selectedLayers();
    if (layers.empty()) {
        emit message("Select a layer to apply an effect.");
        return;
    }
    for (Layer *l : layers)
        addEffectTo(*l, typeId);
    commit("Apply Effect", true);
}

void Editor::removeEffect(int layerId, int uid)
{
    Composition *c = activeComp();
    Layer *l = c ? c->layerById(layerId) : nullptr;
    if (!l)
        return;
    auto &fx = l->effects;
    fx.erase(std::remove_if(fx.begin(), fx.end(), [&](const auto &e) { return e->uid == uid; }), fx.end());
    pruneSelection();
    commit("Remove Effect", true);
}

void Editor::moveEffect(int layerId, int uid, int delta)
{
    Composition *c = activeComp();
    Layer *l = c ? c->layerById(layerId) : nullptr;
    if (!l)
        return;
    auto &fx = l->effects;
    for (int i = 0; i < int(fx.size()); ++i)
        if (fx[i]->uid == uid) {
            const int j = i + delta;
            if (j >= 0 && j < int(fx.size())) {
                std::swap(fx[i], fx[j]);
                commit("Reorder Effects", true);
            }
            return;
        }
}

void Editor::removeAllEffects()
{
    for (Layer *l : selectedLayers())
        l->effects.clear();
    pruneSelection();
    commit("Remove All Effects", true);
}

QList<QPair<QString, QString>> Editor::presets()
{
    return {{"shake", "Camera Shake (wiggle)"},  {"fadeIn", "Fade In"},         {"fadeOut", "Fade Out"},
            {"popIn", "Pop In (overshoot)"},     {"zoomIn", "Zoom In Transition"}, {"zoomOut", "Zoom Out Transition"},
            {"spin", "Continuous Spin"},         {"flash", "Flash Transition"},  {"glowPulse", "Glow Pulse"},
            {"slideIn", "Slide In From Left"},   {"bounce", "Bounce (loop)"},    {"blurIn", "Blur In"}};
}

void Editor::applyPreset(const QString &id)
{
    Composition *c = activeComp();
    auto layers = selectedLayers();
    if (!c || layers.empty()) {
        emit message("Select a layer to apply an animation preset.");
        return;
    }
    const double t = time();
    const double fd = c->frameDuration();
    auto ease = [](Property &p) {
        for (auto &k : p.keys)
            k.inInterp = k.outInterp = Interp::Bezier;
    };
    for (Layer *l : layers) {
        if (id == "shake") {
            l->position.expression = "wiggle(12, 25)";
            l->rotation.expression = "wiggle(8, 1.5)";
            l->motionBlur = true;
        } else if (id == "fadeIn") {
            l->opacity.keys.clear();
            l->opacity.addKey(t, {0});
            l->opacity.addKey(c->snap(t + 0.5), {100});
            ease(l->opacity);
        } else if (id == "fadeOut") {
            l->opacity.keys.clear();
            l->opacity.addKey(c->snap(std::max(l->inPoint, l->outPoint - 0.5 - fd)), {100});
            l->opacity.addKey(l->outPoint - fd, {0});
            ease(l->opacity);
        } else if (id == "popIn") {
            const Value s = l->scale.valueAt(t);
            l->scale.keys.clear();
            l->scale.addKey(t, {0, 0});
            l->scale.addKey(c->snap(t + 0.25), {s[0] * 1.15, s[1] * 1.15});
            l->scale.addKey(c->snap(t + 0.4), s);
            ease(l->scale);
        } else if (id == "zoomIn" || id == "zoomOut") {
            const Value s = l->scale.valueAt(t);
            const double k = id == "zoomIn" ? 3.0 : 0.3;
            l->scale.keys.clear();
            l->scale.addKey(t, s);
            l->scale.addKey(c->snap(t + 0.3), {s[0] * k, s[1] * k});
            for (auto &key : l->scale.keys)
                key.outInterp = key.inInterp = Interp::Bezier;
            l->scale.keys[0].outInfluence = 80;
            l->scale.keys[1].inInfluence = 10;
            l->motionBlur = true;
            addEffectTo(*l, "mf.radialBlur");
            Property *amt = l->effects.back()->param("amount");
            amt->addKey(t, {0});
            amt->addKey(c->snap(t + 0.15), {60});
            amt->addKey(c->snap(t + 0.3), {0});
        } else if (id == "spin") {
            l->rotation.expression = "value + time * 180";
        } else if (id == "flash") {
            addEffectTo(*l, "mf.exposure");
            Property *ex = l->effects.back()->param("exposure");
            ex->addKey(t, {0});
            ex->addKey(c->snap(t + 2 * fd), {4});
            ex->addKey(c->snap(t + 8 * fd), {0});
        } else if (id == "glowPulse") {
            addEffectTo(*l, "mf.glow");
            l->effects.back()->param("intensity")->expression = "1.5 + Math.sin(time * Math.PI * 2) * 1";
        } else if (id == "slideIn") {
            const QPointF p = Property::toPoint(l->position.valueAt(t));
            l->position.keys.clear();
            l->position.addKey(t, {p.x() - c->width, p.y()});
            l->position.addKey(c->snap(t + 0.5), {p.x(), p.y()});
            l->position.keys[0].outInterp = Interp::Bezier;
            l->position.keys[0].outInfluence = 10;
            l->position.keys[1].inInterp = Interp::Bezier;
            l->position.keys[1].inInfluence = 90;
            l->motionBlur = true;
        } else if (id == "bounce") {
            const QPointF p = Property::toPoint(l->position.valueAt(t));
            l->position.keys.clear();
            l->position.addKey(t, {p.x(), p.y()});
            l->position.addKey(c->snap(t + 0.3), {p.x(), p.y() - c->height * 0.1});
            l->position.addKey(c->snap(t + 0.6), {p.x(), p.y()});
            ease(l->position);
            l->position.expression = "loopOut('cycle')";
        } else if (id == "blurIn") {
            addEffectTo(*l, "mf.gaussianBlur");
            Property *b = l->effects.back()->param("blurriness");
            b->addKey(t, {60});
            b->addKey(c->snap(t + 0.4), {0});
            ease(*b);
        }
    }
    commit("Apply Preset", true);
}

// ------------------------------------------------------------ keyframes

void Editor::forEachSelectedKey(const std::function<void(Layer &, Property &, Keyframe &)> &fn)
{
    Composition *c = activeComp();
    if (!c)
        return;
    for (auto &l : c->layers)
        l->forEachProperty([&](Property &p) {
            for (auto &k : p.keys)
                if (k.selected)
                    fn(*l, p, k);
        });
}

bool Editor::hasSelectedKeys()
{
    bool any = false;
    forEachSelectedKey([&](Layer &, Property &, Keyframe &) { any = true; });
    return any;
}

void Editor::deselectAllKeys()
{
    forEachSelectedKey([](Layer &, Property &, Keyframe &k) { k.selected = false; });
}

void Editor::setKeyAtCurrentTime(Property &p, const Layer &l)
{
    Composition *c = activeComp();
    if (!c || !p.animatable)
        return;
    const Value v = renderer_.eval(p, time(), l, *c);
    p.addKey(time(), p.hasExpression() ? p.valueAt(time()) : v);
    commit("Add Keyframe", false);
}

void Editor::toggleStopwatch(Property &p, const Layer &l)
{
    if (!p.animatable)
        return;
    p.setAnimated(!p.isAnimated(), time());
    commit(p.isAnimated() ? "Enable Keyframes" : "Remove Keyframes", true);
}

void Editor::easeSelectedKeys(bool easeIn, bool easeOut)
{
    forEachSelectedKey([&](Layer &, Property &, Keyframe &k) {
        if (easeIn) {
            k.inInterp = Interp::Bezier;
            k.inInfluence = 33.333;
        }
        if (easeOut) {
            k.outInterp = Interp::Bezier;
            k.outInfluence = 33.333;
        }
    });
    commit("Easy Ease", false);
}

void Editor::toggleHoldSelectedKeys()
{
    forEachSelectedKey([](Layer &, Property &, Keyframe &k) {
        k.outInterp = k.outInterp == Interp::Hold ? Interp::Linear : Interp::Hold;
    });
    commit("Toggle Hold Keyframe", false);
}

void Editor::deleteSelectedKeys()
{
    Composition *c = activeComp();
    if (!c)
        return;
    for (auto &l : c->layers)
        l->forEachProperty([&](Property &p) {
            const bool hadKeys = p.isAnimated();
            const Value last = p.isAnimated() ? p.valueAt(time()) : p.staticValue;
            p.keys.erase(std::remove_if(p.keys.begin(), p.keys.end(), [](const Keyframe &k) { return k.selected; }),
                         p.keys.end());
            if (hadKeys && p.keys.isEmpty())
                p.staticValue = last;
        });
    commit("Delete Keyframes", true);
}

std::vector<double> Editor::keyTimesForLayer(Layer &l) const
{
    std::vector<double> times;
    l.forEachProperty([&](Property &p) {
        for (const auto &k : p.keys)
            times.push_back(k.time);
    });
    std::sort(times.begin(), times.end());
    times.erase(std::unique(times.begin(), times.end(), [](double a, double b) { return std::abs(a - b) < 1e-6; }),
                times.end());
    return times;
}

void Editor::addMarkerAtCurrentTime()
{
    Composition *c = activeComp();
    if (!c)
        return;
    c->addMarker(time());
    commit("Add Marker", false);
}

void Editor::removeMarker(int index)
{
    Composition *c = activeComp();
    if (!c || index < 0 || index >= int(c->markers.size()))
        return;
    c->markers.erase(c->markers.begin() + index);
    commit("Delete Marker", false);
}

std::vector<double> Editor::snapTimes() const
{
    std::vector<double> r;
    Composition *c = activeComp();
    if (!c)
        return r;
    r.push_back(time());
    r.push_back(c->workStart);
    r.push_back(c->workEnd);
    for (const auto &m : c->markers)
        r.push_back(m.time);
    return r;
}

void Editor::gotoKeyframe(bool next)
{
    std::vector<double> times;
    if (Composition *c = activeComp())
        for (const auto &m : c->markers)
            times.push_back(m.time);
    for (Layer *l : selectedLayers()) {
        auto t = keyTimesForLayer(*l);
        times.insert(times.end(), t.begin(), t.end());
    }
    if (times.empty())
        return;
    std::sort(times.begin(), times.end());
    const double now = time();
    const double eps = 1e-6;
    if (next) {
        for (double t : times)
            if (t > now + eps) {
                setTime(t);
                return;
            }
    } else {
        for (auto it = times.rbegin(); it != times.rend(); ++it)
            if (*it < now - eps) {
                setTime(*it);
                return;
            }
    }
}

// ------------------------------------------------------------ rendering

QImage Editor::frameImage(double scale, int *renderMs)
{
    Composition *c = activeComp();
    if (!c)
        return {};
    const int f = currentFrame();
    QImage img = cache_.get(c->id, f, scale);
    if (!img.isNull()) {
        if (renderMs)
            *renderMs = 0;
        return img;
    }
    QElapsedTimer timer;
    timer.start();
    img = renderer_.render(*c, c->timeOfFrame(f), scale);
    lastRenderMs_ = int(timer.elapsed());
    if (renderMs)
        *renderMs = lastRenderMs_;
    cache_.put(c->id, f, scale, img);
    return img;
}

} // namespace mf
