#include "core/Project.h"
#include "expr/ExpressionEngine.h"
#include "media/AudioDecoder.h"
#include "media/Exporter.h"
#include "media/MediaCache.h"
#include "render/AudioMixer.h"
#include "media/VideoDecoder.h"
#include "render/Effects.h"
#include "render/Renderer.h"

#include <QGuiApplication>
#include <QJsonDocument>
#include <QFile>
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

    // Writes a 16-bit stereo sine WAV (44.1 kHz, so decoding also exercises resampling).
    static QString writeSineWav(const QString &path, double seconds, double freq, double amp)
    {
        const int rate = 44100;
        const int n = int(seconds * rate);
        QFile f(path);
        f.open(QIODevice::WriteOnly);
        auto u32 = [&](quint32 v) { f.write(reinterpret_cast<const char *>(&v), 4); };
        auto u16 = [&](quint16 v) { f.write(reinterpret_cast<const char *>(&v), 2); };
        f.write("RIFF");
        u32(36 + n * 4);
        f.write("WAVEfmt ");
        u32(16); u16(1); u16(2); u32(rate); u32(rate * 4); u16(4); u16(16);
        f.write("data");
        u32(n * 4);
        for (int i = 0; i < n; ++i) {
            const qint16 v = qint16(std::sin(2 * M_PI * freq * i / rate) * amp * 32767);
            f.write(reinterpret_cast<const char *>(&v), 2);
            f.write(reinterpret_cast<const char *>(&v), 2);
        }
        return path;
    }
    static double rms(const float *s, int frames)
    {
        double acc = 0;
        for (int i = 0; i < frames * 2; ++i)
            acc += double(s[i]) * s[i];
        return std::sqrt(acc / std::max(1, frames * 2));
    }

private slots:
    void initTestCase() { installEffectFactory(); }

    void audioDecodeMixAndExport()
    {
        QTemporaryDir dir;
        const QString wav = writeSineWav(dir.filePath("tone.wav"), 1.0, 440, 0.5);
        const MediaInfo mi = probeMedia(wav);
        QVERIFY2(mi.ok, qPrintable(mi.error));
        QVERIFY(mi.hasAudio && !mi.hasVideo);
        QVERIFY(qAbs(mi.duration - 1.0) < 0.02);

        auto buf = decodeAudio(wav);
        QVERIFY(buf);
        QVERIFY(qAbs(buf->duration() - 1.0) < 0.01);
        QVERIFY(qAbs(rms(buf->samples.data(), int(buf->frames())) - 0.5 / std::sqrt(2.0)) < 0.01);
        QVERIFY(buf->peakBetween(0.2, 0.3) > 0.45);

        Project proj;
        auto *c = proj.addComposition("A", 64, 64, 30, 2);
        auto f = std::make_unique<FootageItem>();
        f->id = proj.newId();
        f->path = wav;
        f->hasAudio = true;
        f->hasVideo = false;
        f->duration = 1.0;
        const int fid = f->id;
        proj.items.push_back(std::move(f));
        auto l = proj.makeLayer(LayerType::Footage, *c);
        l->sourceItemId = fid;
        l->hasAudio = l->audioOnly = true;
        l->startTime = 0.5;
        l->inPoint = 0.5;
        l->outPoint = 1.5;
        Layer *lr = l.get();
        c->layers.push_back(std::move(l));

        Renderer r(proj);
        AudioMixer mixer(proj, r);
        QVERIFY(mixer.compHasAudio(*c));
        std::vector<float> out(4800 * 2);
        mixer.mix(*c, 0.0, 4800, out.data());   // 0.0 - 0.1 s: before the layer starts
        QCOMPARE(rms(out.data(), 4800), 0.0);
        mixer.mix(*c, 0.8, 4800, out.data());
        const double full = rms(out.data(), 4800);
        QVERIFY(qAbs(full - 0.3536) < 0.01);
        lr->audioLevels.staticValue = {-6.0206};
        mixer.mix(*c, 0.8, 4800, out.data());
        QVERIFY(qAbs(rms(out.data(), 4800) - full / 2) < 0.005);
        lr->audioOn = false;
        QVERIFY(!mixer.compHasAudio(*c));
        lr->audioOn = true;
        lr->audioLevels.staticValue = {0};

        // Nested: the comp inside another comp still sounds, shifted by the precomp layer's start.
        auto *outer = proj.addComposition("B", 64, 64, 30, 3);
        auto pre = proj.makeLayer(LayerType::Precomp, *outer);
        pre->sourceItemId = c->id;
        pre->hasAudio = true;
        pre->startTime = pre->inPoint = 1.0;
        pre->outPoint = 3.0;
        outer->layers.push_back(std::move(pre));
        mixer.mix(*outer, 1.8, 4800, out.data());   // inner time 0.8
        QVERIFY(qAbs(rms(out.data(), 4800) - full) < 0.01);
        mixer.mix(*outer, 0.5, 4800, out.data());
        QCOMPARE(rms(out.data(), 4800), 0.0);

        // Export with audio and read it back.
        const QString mp4 = dir.filePath("a.mp4");
        Exporter ex;
        QString err;
        QVERIFY2(ex.open(mp4, ExportFormat::H264, 64, 64, 30, 50, &err, true), qPrintable(err));
        const int perFrame = kAudioRate / 30;
        std::vector<float> chunk(size_t(perFrame) * 2);
        for (int i = 0; i < 60; ++i) {
            QImage img(64, 64, QImage::Format_ARGB32_Premultiplied);
            img.fill(Qt::black);
            QVERIFY(ex.addFrame(img, &err));
            mixer.mix(*c, i / 30.0, perFrame, chunk.data());
            QVERIFY2(ex.addAudio(chunk.data(), perFrame, &err), qPrintable(err));
        }
        QVERIFY2(ex.finish(&err), qPrintable(err));
        const MediaInfo emi = probeMedia(mp4);
        QVERIFY(emi.ok && emi.hasAudio && emi.hasVideo);
        auto back = decodeAudio(mp4);
        QVERIFY(back);
        QVERIFY(qAbs(back->duration() - 2.0) < 0.1);
        float l0, r0;
        double early = 0, late = 0;
        for (int i = 0; i < 2000; ++i) {
            back->sampleAt(0.1 + i / 48000.0, l0, r0);
            early += std::abs(l0);
            back->sampleAt(1.0 + i / 48000.0, l0, r0);
            late += std::abs(l0);
        }
        QVERIFY(early / 2000 < 0.01);   // silent before the layer starts
        QVERIFY(late / 2000 > 0.2);     // tone while it plays

        // ProRes gets PCM audio; PNG sequences get a WAV next to the frames.
        Exporter png;
        QVERIFY(png.open(dir.filePath("seq/frame.png"), ExportFormat::PngSequence, 8, 8, 30, 50, &err, true));
        QImage tiny(8, 8, QImage::Format_ARGB32_Premultiplied);
        tiny.fill(Qt::transparent);
        QVERIFY(png.addFrame(tiny, &err));
        QVERIFY(png.addAudio(chunk.data(), perFrame, &err));
        QVERIFY(png.finish(&err));
        QVERIFY(QFile::exists(dir.filePath("seq/frame.wav")));
        MediaCache::instance().clear();
    }

    void markersRoundTrip()
    {
        Project proj;
        auto *c = proj.addComposition("M", 10, 10, 30, 2);
        c->addMarker(1.0, "drop");
        c->addMarker(0.5);
        c->addMarker(1.0);   // duplicate ignored
        QCOMPARE(int(c->markers.size()), 2);
        QCOMPARE(c->markers[0].time, 0.5);
        Project copy;
        QVERIFY(copy.fromJson(proj.toJson()));
        QCOMPARE(int(copy.comp(c->id)->markers.size()), 2);
        QCOMPARE(copy.comp(c->id)->markers[1].comment, QString("drop"));
    }

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
