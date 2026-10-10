// Drives the real main window through common editing flows to catch crashes and
// broken wiring in the interactive paths.
#include "render/Effects.h"
#include "ui/MainWindow.h"
#include "ui/PlaybackController.h"
#include "ui/RenderQueuePanel.h"
#include "ui/TimelinePanel.h"
#include "media/VideoDecoder.h"

#include <QApplication>
#include <QTemporaryDir>
#include <QtTest>

using namespace mf;

class GuiTests : public QObject {
    Q_OBJECT
    MainWindow *w = nullptr;
    Editor *ed = nullptr;

private slots:
    void init()
    {
        w = new MainWindow(false);   // don't scan for OpenFX plugins in tests
        w->resize(1600, 960);
        w->show();
        QVERIFY(QTest::qWaitForWindowExposed(w));
        w->buildSampleProject();
        ed = w->editor();
        QApplication::processEvents();
    }
    void cleanup()
    {
        // Discard changes without prompting.
        ed->newProject();
        delete w;
        w = nullptr;
    }

    void sampleLoadsAndPaints()
    {
        QVERIFY(ed->activeComp());
        QCOMPARE(int(ed->activeComp()->layers.size()), 7);
        QVERIFY(ed->mixer().compHasAudio(*ed->activeComp()));
        QVERIFY(ed->activeComp()->markers.size() >= 10);
        const QImage shot = w->grab().toImage();
        QVERIFY(!shot.isNull());
        QVERIFY(!w->viewer()->currentFrame().isNull());
    }

    void selectExpandRevealEveryLayer()
    {
        Composition *c = ed->activeComp();
        for (auto &l : c->layers) {
            ed->selectLayer(l->id);
            l->expanded = true;
            emit ed->projectChanged();
            for (const char *k : {"position", "scale", "rotation", "opacity", "anchor", "animated", "effects"})
                ed->revealProperties(k, false);
            w->grab();
        }
    }

    void applyEveryEffectAndPreset()
    {
        Layer *l = ed->activeComp()->layers[1].get();
        ed->selectLayer(l->id);
        for (const auto &d : EffectRegistry::all())
            ed->addEffect(d.id);
        QCOMPARE(int(l->effects.size()), int(EffectRegistry::all().size()) + 2);   // sample already had 2
        for (const auto &p : Editor::presets())
            ed->applyPreset(p.first);
        w->grab();
        ed->removeAllEffects();
        QVERIFY(l->effects.empty());
        // Undo restores them all.
        ed->undo();
        QVERIFY(!ed->primaryLayer()->effects.empty());
    }

    void keyframeWorkflow()
    {
        Layer *l = ed->activeComp()->layers[3].get();   // star
        ed->selectLayer(l->id);
        ed->setTime(0);
        ed->toggleStopwatch(l->opacity, *l);
        QVERIFY(l->opacity.isAnimated());
        ed->setTime(1);
        l->opacity.setValue(ed->time(), {20});
        ed->commit("test");
        QCOMPARE(l->opacity.keys.size(), 2);
        for (auto &k : l->opacity.keys)
            k.selected = true;
        ed->easeSelectedKeys(true, true);
        QCOMPARE(l->opacity.keys[0].outInterp, Interp::Bezier);
        ed->toggleHoldSelectedKeys();
        ed->copySelection();
        ed->setTime(3);
        ed->paste();
        QCOMPARE(l->opacity.keys.size(), 4);
        ed->gotoKeyframe(false);
        QVERIFY(ed->time() < 3.0 + 1e-6);
        ed->deleteSelectedKeys();
        QVERIFY(l->opacity.keys.size() < 4);
    }

    void layerOperations()
    {
        Composition *c = ed->activeComp();
        const int n = int(c->layers.size());
        ed->selectLayer(c->layers[2]->id);
        ed->duplicateSelectedLayers();
        QCOMPARE(int(c->layers.size()), n + 1);
        ed->setTime(2.0);
        ed->splitSelectedLayers();
        QCOMPARE(int(c->layers.size()), n + 2);
        ed->copySelection();
        ed->paste();
        QCOMPARE(int(c->layers.size()), n + 3);
        ed->setSelection({c->layers[0]->id, c->layers[1]->id});
        ed->precomposeSelected("Pre");
        QCOMPARE(int(c->layers.size()), n + 2);
        QCOMPARE(c->layers[0]->type, LayerType::Precomp);
        ed->moveSelectedLayers(1);
        ed->moveSelectedLayersToEdge(true);
        ed->trimSelected(true);
        ed->moveSelectedToTime(false);
        ed->deleteSelectedLayers();
        w->grab();
        // Undo everything, then redo everything.
        int undos = 0;
        while (ed->canUndo() && undos < 100) {
            ed->undo();
            ++undos;
        }
        QVERIFY(undos > 5);
        while (ed->canRedo())
            ed->redo();
        w->grab();
    }

    void newLayersOfEveryKind()
    {
        ed->newSolid("S", 100, 100, Qt::red);
        ed->newText("Hello\nWorld");
        ed->newShape(ShapeKind::Star, QRectF(100, 100, 200, 200));
        ed->newNull();
        ed->newAdjustment();
        Layer *a = ed->primaryLayer();
        ed->addEffect("mf.gaussianBlur");
        QCOMPARE(int(a->effects.size()), 1);
        ed->centerAnchor(*ed->activeComp()->layers[2]);
        ed->fitToComp(*ed->activeComp()->layers[2], true);
        w->grab();
    }

    void viewerDragMovesLayer()
    {
        Composition *c = ed->activeComp();
        Layer *star = c->layers[3].get();
        c->layers[0]->locked = true;   // the full-frame adjustment layer would otherwise catch the click
        ed->setTime(0);
        // Freeze the star so hit testing is predictable.
        star->rotation.expression.clear();
        star->scale.expression.clear();
        ed->touch();
        CompViewer *v = w->viewer();
        v->setZoom(0.5);
        const double t = ed->time();
        const QPointF compPt = ed->renderer().layerToComp(*star, *c, t).map(QPointF(0, 0));
        QTransform view;
        view.translate(v->width() / 2.0, v->height() / 2.0);
        view.scale(0.5, 0.5);
        view.translate(-c->width / 2.0, -c->height / 2.0);
        const QPoint start = view.map(compPt).toPoint();
        const QPointF before = Property::toPoint(star->position.valueAt(t));
        QTest::mousePress(v, Qt::LeftButton, {}, start);
        QTest::mouseMove(v, start + QPoint(20, 10));
        QTest::mouseMove(v, start + QPoint(40, 20));
        QTest::mouseRelease(v, Qt::LeftButton, {}, start + QPoint(40, 20));
        QVERIFY(ed->isSelected(star->id));
        const QPointF after = Property::toPoint(star->position.valueAt(t));
        QVERIFY2(std::abs(after.x() - before.x() - 80) < 2 && std::abs(after.y() - before.y() - 40) < 2,
                 qPrintable(QString("moved by %1,%2").arg(after.x() - before.x()).arg(after.y() - before.y())));
        ed->undo();
        QCOMPARE(Property::toPoint(ed->activeComp()->layers[3]->position.valueAt(t)), before);
    }

    void timelineRulerSetsTime()
    {
        TimelineView *tv = w->timeline()->view();
        ed->setTime(0);
        QTest::mouseClick(tv, Qt::LeftButton, {}, QPoint(tv->width() - 40, 25));
        QVERIFY(ed->time() > 0.5);
        // Clicking layer rows and twirls should not crash.
        for (int y = 40; y < tv->height(); y += 11)
            QTest::mouseClick(tv, Qt::LeftButton, {}, QPoint(150, y));
        w->grab();
    }

    void audioAndMarkers()
    {
        Composition *c = ed->activeComp();
        Layer *music = c->layers.back().get();
        QVERIFY(music->audioOnly && music->hasAudio);
        ed->selectLayer(music->id);
        ed->revealProperties("audioLevels", false);
        w->grab();   // paints the waveform
        const size_t before = c->markers.size();
        ed->setTime(0.25);   // snaps to frame 8 at 30 fps
        const double markerTime = ed->time();
        ed->addMarkerAtCurrentTime();
        QCOMPARE(c->markers.size(), before + 1);
        ed->setTime(0);
        ed->gotoKeyframe(true);   // markers are navigation stops too
        QVERIFY(std::abs(ed->time() - markerTime) < 1e-6);
        ed->removeMarker(0);
        QCOMPARE(c->markers.size(), before);
        // Audio-only layers never draw and can't be hit in the viewer.
        music->audioOn = false;
        ed->commit("mute");
        QVERIFY(!ed->mixer().compHasAudio(*c));
        ed->undo();
        QVERIFY(ed->mixer().compHasAudio(*ed->activeComp()));
    }

    void playback()
    {
        ed->setTime(0);
        w->playback()->play();
        QTest::qWait(600);
        w->playback()->stop();
        QVERIFY(ed->currentFrame() > 0);
    }

    void renderQueueAndSave()
    {
        QTemporaryDir dir;
        Composition *c = ed->activeComp();
        c->workStart = 0;
        c->workEnd = 0.3;
        const QString out = dir.filePath("render.mp4");
        w->renderQueue()->addComp(c->id, out);
        w->renderQueue()->renderAll();
        QVERIFY(!w->renderQueue()->isRendering());
        const MediaInfo mi = probeMedia(out);
        QVERIFY2(mi.ok, qPrintable(mi.error));
        QCOMPARE(mi.width, 1920);
        QVERIFY(mi.hasAudio);   // the sample's beat is mixed into the export
        QVERIFY(mi.duration > 0.2 && mi.duration < 0.5);

        const QString path = dir.filePath("p.mfproj");
        QString err;
        QVERIFY(ed->save(path, &err));
        QVERIFY(ed->load(path, &err));
        QCOMPARE(int(ed->activeComp()->layers.size()), 7);
    }
};

int main(int argc, char **argv)
{
    QApplication app(argc, argv);
    QApplication::setApplicationName("MotionForgeTest");
    GuiTests t;
    return QTest::qExec(&t, argc, argv);
}

#include "test_gui.moc"
