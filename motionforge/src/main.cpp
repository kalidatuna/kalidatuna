#include "core/Project.h"
#include "media/Exporter.h"
#include "media/AudioDecoder.h"
#include "render/AudioMixer.h"
#include "render/Effects.h"
#include "render/Renderer.h"
#include "ofx/OfxHost.h"
#include "ui/MainWindow.h"
#include "ui/PluginsDialog.h"
#include "ui/Theme.h"

#include <QFile>
#include <QJsonDocument>
#include <cmath>
#include <cstdio>
#include <cstring>

#include <QApplication>
#include <QCommandLineParser>
#include <QFileInfo>
#include <QTimer>

// Headless batch render, in the spirit of aerender:
//   motionforge --render project.mfproj --comp "Comp 1" --output out.mp4 [--format h264]
static int batchRender(const QString &projectPath, const QString &compName, const QString &output,
                       const QString &formatName, double frameTime)
{
    mf::installEffectFactory();
    QFile f(projectPath);
    if (!f.open(QIODevice::ReadOnly)) {
        std::fprintf(stderr, "Cannot open %s\n", qPrintable(projectPath));
        return 1;
    }
    mf::Project project;
    QString err;
    if (!project.fromJson(QJsonDocument::fromJson(f.readAll()).object(), &err)) {
        std::fprintf(stderr, "%s\n", qPrintable(err));
        return 1;
    }
    mf::Composition *comp = nullptr;
    for (auto *c : project.compositions())
        if (compName.isEmpty() || c->name == compName) {
            comp = c;
            break;
        }
    if (!comp) {
        std::fprintf(stderr, "Composition not found: %s\n", qPrintable(compName));
        return 1;
    }
    mf::Renderer renderer(project);
    if (frameTime >= 0) {   // single still frame
        const QImage img = output.endsWith(".png", Qt::CaseInsensitive) ? renderer.render(*comp, frameTime)
                                                                         : renderer.renderFlattened(*comp, frameTime);
        return img.save(output) ? 0 : 1;
    }
    mf::ExportFormat fmt = mf::ExportFormat::H264;
    if (formatName == "prores")
        fmt = mf::ExportFormat::ProRes422HQ;
    else if (formatName == "prores4444")
        fmt = mf::ExportFormat::ProRes4444;
    else if (formatName == "png")
        fmt = mf::ExportFormat::PngSequence;
    mf::AudioMixer mixer(project, renderer);
    const bool withAudio = mixer.compHasAudio(*comp);
    std::vector<float> audio;
    mf::Exporter ex;
    if (!ex.open(output, fmt, comp->width, comp->height, comp->fps, 80, &err, withAudio)) {
        std::fprintf(stderr, "%s\n", qPrintable(err));
        return 1;
    }
    const int n = comp->frameCount();
    for (int i = 0; i < n; ++i) {
        const double t = comp->timeOfFrame(i);
        const QImage img = mf::exportFormatHasAlpha(fmt) ? renderer.render(*comp, t) : renderer.renderFlattened(*comp, t);
        if (!ex.addFrame(img, &err)) {
            std::fprintf(stderr, "%s\n", qPrintable(err));
            return 1;
        }
        if (withAudio) {
            const qint64 a0 = std::llround(i * double(mf::kAudioRate) / comp->fps);
            const qint64 a1 = std::llround((i + 1) * double(mf::kAudioRate) / comp->fps);
            audio.resize(size_t(a1 - a0) * 2);
            mixer.mix(*comp, double(a0) / mf::kAudioRate, int(a1 - a0), audio.data());
            ex.addAudio(audio.data(), int(a1 - a0), &err);
        }
        std::fprintf(stderr, "\rRendering %s: frame %d/%d", qPrintable(comp->name), i + 1, n);
    }
    std::fprintf(stderr, "\n");
    return ex.finish(&err) ? 0 : 1;
}

int main(int argc, char **argv)
{
    // Command-line modes work without a display (e.g. over SSH or on a render box).
    for (int i = 1; i < argc; ++i)
        for (const char *opt : {"--render", "--ofx-probe", "--ofx-list", "--save-sample"})
            if (std::strcmp(argv[i], opt) == 0 && qEnvironmentVariableIsEmpty("QT_QPA_PLATFORM"))
                qputenv("QT_QPA_PLATFORM", "offscreen");
    QApplication app(argc, argv);
    QApplication::setApplicationName("MotionForge");
    QApplication::setOrganizationName("MotionForge");
    QApplication::setApplicationVersion("0.1.0");
    QApplication::setDesktopFileName("motionforge");
    mf::theme::apply(app);

    QCommandLineParser parser;
    parser.setApplicationDescription("Motion graphics and compositing with an After Effects-style workflow");
    parser.addHelpOption();
    parser.addVersionOption();
    QCommandLineOption sample("sample", "Open the built-in sample project");
    parser.addOption(sample);
    QCommandLineOption shot("screenshot", "Save a screenshot of the main window to <file> and quit", "file");
    parser.addOption(shot);
    QCommandLineOption render("render", "Render <project> without a window (like aerender)", "project");
    QCommandLineOption compOpt("comp", "Composition to render (default: first)", "name");
    QCommandLineOption outOpt("output", "Output file for --render", "file");
    QCommandLineOption fmtOpt("format", "h264 (default), prores, prores4444 or png", "format", "h264");
    QCommandLineOption frameOpt("frame", "Render a single frame at <seconds> instead of a movie", "seconds");
    QCommandLineOption saveSample("save-sample", "Write the sample project to <file> and quit", "file");
    QCommandLineOption probe("ofx-probe", "Internal: test-load an OpenFX plugin binary", "binary");
    QCommandLineOption list("ofx-list", "List the OpenFX plugins MotionForge can load, and why others can't");
    QCommandLineOption noPlugins("no-plugins", "Start without loading OpenFX plugins");
    parser.addOptions({render, compOpt, outOpt, fmtOpt, frameOpt, saveSample, probe, list, noPlugins});
    parser.addPositionalArgument("project", "A .mfproj project to open");
    parser.process(app);

    if (parser.isSet(probe))
        return mf::ofx::Manager::probeMain(parser.value(probe));
    if (parser.isSet(list)) {
        mf::scanOpenFxPlugins();
        for (const QString &p : mf::openFxSearchPaths())
            std::printf("search path: %s%s\n", qPrintable(p), QFileInfo(p).isDir() ? "" : "  (missing)");
        int ok = 0;
        for (const auto &p : mf::ofx::Manager::instance().plugins()) {
            ok += p.loaded;
            std::printf("%-8s %-40s %s\n", p.loaded ? "OK" : "SKIP", qPrintable(p.identifier),
                        qPrintable(p.loaded ? p.grouping + " / " + p.label : p.error));
        }
        std::printf("%d plugins available\n", ok);
        return 0;
    }
    if (parser.isSet(render)) {
        if (!parser.isSet(noPlugins))
            mf::scanOpenFxPlugins();
        return batchRender(parser.value(render), parser.value(compOpt), parser.value(outOpt), parser.value(fmtOpt),
                           parser.isSet(frameOpt) ? parser.value(frameOpt).toDouble() : -1.0);
    }

    mf::MainWindow w(!parser.isSet(noPlugins) && !parser.isSet(saveSample));
    if (parser.isSet(saveSample)) {
        w.buildSampleProject();
        return w.saveProjectTo(parser.value(saveSample)) ? 0 : 1;
    }
    w.show();
    const QStringList args = parser.positionalArguments();
    if (!args.isEmpty())
        w.openProject(QFileInfo(args.first()).absoluteFilePath());
    else if (parser.isSet(sample))
        w.buildSampleProject();
    if (parser.isSet(shot)) {
        const QString path = parser.value(shot);
        QTimer::singleShot(1500, &w, [&w, path] {
            w.grab().save(path);
            QCoreApplication::exit(0);   // skip the save prompt
        });
    }
    return app.exec();
}
