#include "core/Project.h"
#include "media/Exporter.h"
#include "render/Effects.h"
#include "render/Renderer.h"
#include "ui/MainWindow.h"
#include "ui/Theme.h"

#include <QFile>
#include <QJsonDocument>
#include <cstdio>

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
    mf::Exporter ex;
    if (!ex.open(output, fmt, comp->width, comp->height, comp->fps, 80, &err)) {
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
        std::fprintf(stderr, "\rRendering %s: frame %d/%d", qPrintable(comp->name), i + 1, n);
    }
    std::fprintf(stderr, "\n");
    return ex.finish(&err) ? 0 : 1;
}

int main(int argc, char **argv)
{
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
    parser.addOptions({render, compOpt, outOpt, fmtOpt, frameOpt, saveSample});
    parser.addPositionalArgument("project", "A .mfproj project to open");
    parser.process(app);

    if (parser.isSet(render))
        return batchRender(parser.value(render), parser.value(compOpt), parser.value(outOpt), parser.value(fmtOpt),
                           parser.isSet(frameOpt) ? parser.value(frameOpt).toDouble() : -1.0);

    mf::MainWindow w;
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
