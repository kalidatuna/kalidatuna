#include "core/Project.h"
#include "expr/ExpressionEngine.h"
#include "media/Exporter.h"
#include "media/VideoDecoder.h"
#include "render/Effects.h"
#include "render/Renderer.h"

#include <QGuiApplication>
#include <QJsonDocument>
#include <QTemporaryDir>
#include <QtTest>

using namespace mf;

class CoreTests : public QObject {
    Q_OBJECT

    static Composition *makeComp(Project &p, int w = 200, int h = 100)
    {
        return p.addComposition("Comp 1", w, h, 30, 2);
    }
    static Layer *addSolid(Project &p, Composition *c, QColor color, int w, int h)
    {
        auto l = p.makeLayer(LayerType::Solid, *c);
        l->solidColor = color;
        l->width = w;
        l->height = h;
        l->setDefaultAnchor(w, h);
        l->name = "Solid";
        auto *raw = l.get();
        c->layers.insert(c->layers.begin(), std::move(l));
        return raw;
    }

private slots:
    void initTestCase() { installEffectFactory(); }

    void linearKeyframes()
    {
        Property p("x", "X", PropType::Number, {0});
        p.setAnimated(true, 0);
        p.addKey(1.0, {100});
        QCOMPARE(p.valueAt(0.5).value(0), 50.0);
        QCOMPARE(p.valueAt(-1).value(0), 0.0);
        QCOMPARE(p.valueAt(5).value(0), 100.0);
    }

    void easyEaseIsSymmetricAndSlowAtEnds()
    {
        Property p("x", "X", PropType::Number, {0});
        p.addKey(0, {0});
        p.addKey(1, {100});
        for (auto &k : p.keys)
            k.inInterp = k.outInterp = Interp::Bezier;
        QVERIFY(qAbs(p.valueAt(0.5).value(0) - 50.0) < 0.5);
        QVERIFY(p.valueAt(0.1).value(0) < 10.0);   // slower than linear at the start
        QVERIFY(p.valueAt(0.9).value(0) > 90.0);
    }

    void holdKeyframes()
    {
        Property p("x", "X", PropType::Number, {0});
        p.addKey(0, {0});
        p.addKey(1, {100});
        p.keys[0].outInterp = Interp::Hold;
        QCOMPARE(p.valueAt(0.99).value(0), 0.0);
        QCOMPARE(p.valueAt(1.0).value(0), 100.0);
    }

    void expressions()
    {
        Project proj;
        auto *c = makeComp(proj);
        auto *l = addSolid(proj, c, Qt::red, 10, 10);
        Renderer r(proj);
        l->rotation.expression = "time * 360";
        QCOMPARE(r.eval(l->rotation, 0.5, *l, *c).value(0), 180.0);
        l->position.expression = "[value[0] + 10, thisComp.height / 2]";
        const Value pos = r.eval(l->position, 0, *l, *c);
        QCOMPARE(pos.value(0), 110.0);
        QCOMPARE(pos.value(1), 50.0);
        l->opacity.expression = "linear(time, 0, 1, 0, 100)";
        QCOMPARE(r.eval(l->opacity, 0.25, *l, *c).value(0), 25.0);

        // wiggle is deterministic and bounded by its amplitude
        l->scale.expression = "wiggle(5, 20)";
        const Value a = r.eval(l->scale, 0.3, *l, *c), b = r.eval(l->scale, 0.3, *l, *c);
        QCOMPARE(a, b);
        QVERIFY(qAbs(a[0] - 100) <= 20.0 && qAbs(a[1] - 100) <= 20.0);
        QVERIFY(r.eval(l->scale, 0.3, *l, *c) != r.eval(l->scale, 0.7, *l, *c));

        // loopOut cycles keyframes
        l->rotation.expression = "loopOut()";
        l->rotation.addKey(0, {0});
        l->rotation.addKey(1, {90});
        QCOMPARE(r.eval(l->rotation, 1.5, *l, *c).value(0), 45.0);

        // errors fall back to the keyframed value and report a message
        l->opacity.expression = "thisIsNotDefined + 1";
        QCOMPARE(r.eval(l->opacity, 0, *l, *c).value(0), 100.0);
        QVERIFY(!l->opacity.expressionError.isEmpty());
    }

    void renderSolidWithTransform()
    {
        Project proj;
        auto *c = makeComp(proj);
        auto *l = addSolid(proj, c, QColor(255, 0, 0), 50, 50);
        l->position.staticValue = {25, 25};
        Renderer r(proj);
        QImage img = r.render(*c, 0, 1.0);
        QCOMPARE(img.size(), QSize(200, 100));
        QCOMPARE(QColor(img.pixel(10, 10)).red(), 255);
        QCOMPARE(qAlpha(img.pixel(100, 50)), 0);

        // half resolution
        QImage half = r.render(*c, 0, 0.5);
        QCOMPARE(half.size(), QSize(100, 50));
        QCOMPARE(QColor(half.pixel(5, 5)).red(), 255);

        // scale 200% around the anchor covers more
        l->scale.staticValue = {200, 200};
        img = r.render(*c, 0, 1.0);
        QCOMPARE(qAlpha(img.pixel(60, 60)), 255);
    }

    void parenting()
    {
        Project proj;
        auto *c = makeComp(proj);
        auto *child = addSolid(proj, c, Qt::green, 10, 10);
        auto *parent = addSolid(proj, c, Qt::transparent, 10, 10);
        parent->position.staticValue = {100, 50};
        child->parentId = parent->id;
        child->position.staticValue = {5 + 50, 5};   // relative to parent's layer space
        Renderer r(proj);
        const QPointF p = r.layerToComp(*child, *c, 0).map(QPointF(5, 5));
        QCOMPARE(p, QPointF(150, 50));
    }

    void blendAndMatte()
    {
        Project proj;
        auto *c = makeComp(proj, 100, 100);
        addSolid(proj, c, QColor(100, 100, 100), 100, 100);          // bottom
        auto *fill = addSolid(proj, c, QColor(255, 255, 255), 100, 100);
        auto *matte = addSolid(proj, c, QColor(255, 255, 255), 50, 100);   // top: left half
        matte->position.staticValue = {25, 50};
        fill->matte = MatteMode::Alpha;
        Renderer r(proj);
        QImage img = r.render(*c, 0, 1.0);
        QCOMPARE(QColor(img.pixel(10, 50)).red(), 255);   // inside matte: white
        QCOMPARE(QColor(img.pixel(90, 50)).red(), 100);   // outside: background shows
        fill->matte = MatteMode::None;
        matte->videoOn = false;
        fill->blend = BlendMode::Multiply;
        fill->solidColor = QColor(128, 128, 128);
        img = r.render(*c, 0, 1.0);
        QVERIFY(qAbs(QColor(img.pixel(50, 50)).red() - 50) <= 2);
    }

    void motionBlurSmearsMovingLayer()
    {
        Project proj;
        auto *c = makeComp(proj, 200, 20);
        auto *l = addSolid(proj, c, Qt::white, 10, 20);
        l->position.addKey(0, {0, 10});
        l->position.addKey(1, {300, 10});   // 10 px per frame
        Renderer r(proj);
        QImage sharp = r.render(*c, 0.5, 1.0);
        l->motionBlur = true;
        QImage blurred = r.render(*c, 0.5, 1.0);
        auto coverage = [](const QImage &img) {
            int n = 0;
            for (int x = 0; x < img.width(); ++x)
                n += qAlpha(img.pixel(x, 10)) > 0;
            return n;
        };
        QVERIFY(coverage(blurred) > coverage(sharp));
    }

    void allEffectsRun()
    {
        Project proj;
        auto *c = makeComp(proj, 64, 64);
        auto *l = addSolid(proj, c, QColor(200, 120, 40), 32, 32);
        Renderer r(proj);
        for (const auto &def : EffectRegistry::all()) {
            l->effects.clear();
            l->effects.push_back(EffectRegistry::create(def.id, proj.newId(), QRectF(0, 0, 32, 32)));
            QImage img = r.render(*c, 0.1, 1.0);
            QVERIFY2(!img.isNull(), qPrintable(def.name));
        }
        // Gaussian blur spreads alpha outside the layer bounds
        l->effects.clear();
        l->effects.push_back(EffectRegistry::create("mf.gaussianBlur", proj.newId(), QRectF(0, 0, 32, 32)));
        QImage img = r.render(*c, 0, 1.0);
        QVERIFY(qAlpha(img.pixel(15, 32)) > 0);
        QVERIFY(qAlpha(img.pixel(32, 32)) == 255);
    }

    void textAndShapeLayers()
    {
        Project proj;
        auto *c = makeComp(proj, 400, 200);
        auto t = proj.makeLayer(LayerType::Text, *c);
        t->text = "Hello";
        t->fontSize.staticValue = {80};
        auto s = proj.makeLayer(LayerType::Shape, *c);
        s->shapeKind = ShapeKind::Ellipse;
        s->shapeSize.staticValue = {50, 50};
        s->position.staticValue = {350, 100};
        c->layers.push_back(std::move(t));
        c->layers.push_back(std::move(s));
        Renderer r(proj);
        QImage img = r.render(*c, 0, 1.0);
        QCOMPARE(qAlpha(img.pixel(350, 100)), 255);
        const QRectF tb = r.layerBounds(*c->layers[0], *c, 0);
        QVERIFY(tb.width() > 100 && tb.bottom() > 0 && tb.top() < -40);
    }

    void precompAndTimeRemap()
    {
        Project proj;
        auto *inner = proj.addComposition("Inner", 100, 100, 30, 2);
        auto *sq = addSolid(proj, inner, Qt::blue, 10, 10);
        sq->position.addKey(0, {5, 50});
        sq->position.addKey(1, {95, 50});
        auto *outer = makeComp(proj, 100, 100);
        auto pre = proj.makeLayer(LayerType::Precomp, *outer);
        pre->sourceItemId = inner->id;
        pre->setDefaultAnchor(100, 100);
        pre->timeRemapEnabled = true;
        pre->timeRemap.addKey(0, {1.0});   // freeze inner time at 1s
        auto *preRaw = pre.get();
        outer->layers.push_back(std::move(pre));
        Renderer r(proj);
        QImage img = r.render(*outer, 0, 1.0);
        QCOMPARE(qAlpha(img.pixel(94, 50)), 255);
        QCOMPARE(qAlpha(img.pixel(5, 50)), 0);
        QVERIFY(proj.compContains(*inner, inner->id));
        QVERIFY(!proj.compContains(*inner, outer->id));
        Q_UNUSED(preRaw);
    }

    void projectRoundTrip()
    {
        Project proj;
        auto *c = makeComp(proj);
        auto *l = addSolid(proj, c, QColor(1, 2, 3), 20, 30);
        l->position.addKey(0.5, {1, 2});
        l->position.keys[0].outInterp = Interp::Bezier;
        l->opacity.expression = "50";
        l->effects.push_back(EffectRegistry::create("mf.glow", proj.newId(), QRectF(0, 0, 20, 30)));
        l->effects.back()->param("radius")->staticValue = {33};
        const QByteArray json = QJsonDocument(proj.toJson()).toJson();

        Project copy;
        QVERIFY(copy.fromJson(QJsonDocument::fromJson(json).object()));
        auto *c2 = copy.comp(c->id);
        QVERIFY(c2);
        auto *l2 = c2->layerById(l->id);
        QVERIFY(l2);
        QCOMPARE(l2->solidColor, QColor(1, 2, 3));
        QCOMPARE(l2->anchor.defaultValue, (Value{10, 15}));
        QCOMPARE(l2->position.keys.size(), 1);
        QCOMPARE(l2->position.keys[0].outInterp, Interp::Bezier);
        QCOMPARE(l2->opacity.expression, QString("50"));
        QCOMPARE(l2->effects.size(), size_t(1));
        QCOMPARE(l2->effects[0]->param("radius")->staticValue.value(0), 33.0);
        QCOMPARE(QJsonDocument(copy.toJson()).toJson(), json);
    }

    void exportAndDecode()
    {
        QTemporaryDir dir;
        const QString path = dir.filePath("out.mp4");
        Exporter ex;
        QString err;
        QVERIFY2(ex.open(path, ExportFormat::H264, 64, 48, 30, 80, &err), qPrintable(err));
        for (int i = 0; i < 30; ++i) {
            QImage f(64, 48, QImage::Format_ARGB32_Premultiplied);
            f.fill(i < 15 ? Qt::red : Qt::blue);
            QVERIFY2(ex.addFrame(f, &err), qPrintable(err));
        }
        QVERIFY2(ex.finish(&err), qPrintable(err));

        const MediaInfo mi = probeMedia(path);
        QVERIFY2(mi.ok, qPrintable(mi.error));
        QCOMPARE(mi.width, 64);
        QCOMPARE(mi.height, 48);
        QVERIFY(qAbs(mi.fps - 30.0) < 0.01);
        QVERIFY(qAbs(mi.duration - 1.0) < 0.05);

        VideoDecoder d;
        QVERIFY(d.open(path));
        QColor early = d.frameAt(0.1).pixelColor(32, 24);
        QColor late = d.frameAt(0.8).pixelColor(32, 24);
        QColor back = d.frameAt(0.2).pixelColor(32, 24);   // backwards seek
        QVERIFY(early.red() > 200 && early.blue() < 60);
        QVERIFY(late.blue() > 200 && late.red() < 60);
        QVERIFY(back.red() > 200);
    }
};

int main(int argc, char **argv)
{
    QGuiApplication app(argc, argv);
    CoreTests t;
    return QTest::qExec(&t, argc, argv);
}

#include "test_main.moc"
