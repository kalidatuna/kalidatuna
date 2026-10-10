#include "RenderQueuePanel.h"

#include "CompViewer.h"

#include <QApplication>
#include <QComboBox>
#include <QDir>
#include <QElapsedTimer>
#include <QFileDialog>
#include <QFileInfo>
#include <QHBoxLayout>
#include <QHeaderView>
#include <QLabel>
#include <QProgressBar>
#include <QPushButton>
#include <QRegularExpression>
#include <QSpinBox>
#include <QStandardPaths>
#include <QTableWidget>
#include <QVBoxLayout>

namespace mf {

RenderQueuePanel::RenderQueuePanel(Editor *editor, QWidget *parent) : QWidget(parent), ed_(editor)
{
    auto *v = new QVBoxLayout(this);
    v->setContentsMargins(6, 6, 6, 6);
    auto *top = new QHBoxLayout;
    status_ = new QLabel("Add compositions with Composition ▸ Add to Render Queue (Ctrl+M).");
    status_->setStyleSheet("color:#8a8a8a;");
    renderBtn_ = new QPushButton("Render");
    renderBtn_->setStyleSheet("QPushButton { background:#2d8ceb; color:white; font-weight:bold; padding:4px 18px; }");
    stopBtn_ = new QPushButton("Stop");
    stopBtn_->setEnabled(false);
    top->addWidget(status_, 1);
    top->addWidget(stopBtn_);
    top->addWidget(renderBtn_);
    v->addLayout(top);
    table_ = new QTableWidget(0, 8);
    table_->setHorizontalHeaderLabels({"Composition", "Format", "Quality", "Resolution", "Range", "Output To", "Progress", ""});
    table_->verticalHeader()->hide();
    table_->horizontalHeader()->setSectionResizeMode(5, QHeaderView::Stretch);
    table_->setSelectionMode(QAbstractItemView::NoSelection);
    v->addWidget(table_, 1);
    connect(renderBtn_, &QPushButton::clicked, this, &RenderQueuePanel::renderAll);
    connect(stopBtn_, &QPushButton::clicked, this, [this] { stopRequested_ = true; });
    connect(ed_, &Editor::projectChanged, this, [this] {
        if (rendering_)
            return;
        // Drop jobs whose composition was deleted.
        jobs_.erase(std::remove_if(jobs_.begin(), jobs_.end(),
                                   [this](const RenderJob &j) { return !ed_->project().comp(j.compId); }),
                    jobs_.end());
        rebuild();
    });
}

void RenderQueuePanel::addComp(int compId, const QString &outputPath)
{
    Composition *c = ed_->project().comp(compId);
    if (!c)
        return;
    RenderJob j;
    j.compId = compId;
    QString dir = ed_->filePath().isEmpty() ? QStandardPaths::writableLocation(QStandardPaths::MoviesLocation)
                                            : QFileInfo(ed_->filePath()).absolutePath();
    if (dir.isEmpty())
        dir = QDir::homePath();
    QString base = c->name;
    base.replace(QRegularExpression("[^A-Za-z0-9 _.-]"), "_");
    j.path = outputPath.isEmpty() ? QDir(dir).filePath(base + ".mp4") : outputPath;
    j.workAreaOnly = c->workStart > 0 || c->workEnd < c->duration;
    jobs_.push_back(j);
    rebuild();
}

void RenderQueuePanel::rebuild()
{
    table_->setRowCount(int(jobs_.size()));
    for (int i = 0; i < int(jobs_.size()); ++i) {
        RenderJob &j = jobs_[i];
        Composition *c = ed_->project().comp(j.compId);
        table_->setItem(i, 0, new QTableWidgetItem(c ? c->name : "?"));
        auto *fmt = new QComboBox;
        for (int f = 0; f <= int(ExportFormat::PngSequence); ++f)
            fmt->addItem(exportFormatName(ExportFormat(f)));
        fmt->setCurrentIndex(int(j.format));
        connect(fmt, &QComboBox::activated, this, [this, i](int f) {
            RenderJob &jj = jobs_[i];
            jj.format = ExportFormat(f);
            const QFileInfo fi(jj.path);
            jj.path = fi.absolutePath() + "/" + fi.completeBaseName() + "." + exportFormatExtension(jj.format);
            rebuild();
        });
        table_->setCellWidget(i, 1, fmt);
        auto *q = new QSpinBox;
        q->setRange(1, 100);
        q->setValue(j.quality);
        q->setEnabled(j.format == ExportFormat::H264);
        q->setToolTip("H.264 quality (higher = bigger file, better image)");
        connect(q, &QSpinBox::valueChanged, this, [this, i](int v) { jobs_[i].quality = v; });
        table_->setCellWidget(i, 2, q);
        auto *res = new QComboBox;
        res->addItems({"Full", "Half", "Third", "Quarter"});
        res->setCurrentIndex(j.resolution);
        connect(res, &QComboBox::activated, this, [this, i](int r) { jobs_[i].resolution = r; });
        table_->setCellWidget(i, 3, res);
        auto *range = new QComboBox;
        range->addItems({"Work Area Only", "Length of Comp"});
        range->setCurrentIndex(j.workAreaOnly ? 0 : 1);
        connect(range, &QComboBox::activated, this, [this, i](int r) { jobs_[i].workAreaOnly = r == 0; });
        table_->setCellWidget(i, 4, range);
        auto *out = new QPushButton(QFileInfo(j.path).fileName());
        out->setToolTip(j.path);
        out->setStyleSheet("text-align:left; color:#3d9df2;");
        connect(out, &QPushButton::clicked, this, [this, i] {
            RenderJob &jj = jobs_[i];
            const QString ext = exportFormatExtension(jj.format);
            QString p = QFileDialog::getSaveFileName(this, "Output To", jj.path, QString("*.%1").arg(ext));
            if (p.isEmpty())
                return;
            if (QFileInfo(p).suffix().toLower() != ext)
                p += "." + ext;
            jj.path = p;
            rebuild();
        });
        table_->setCellWidget(i, 5, out);
        auto *bar = new QProgressBar;
        bar->setRange(0, 100);
        bar->setValue(j.progress);
        bar->setFormat(j.status + (j.progress > 0 && j.progress < 100 ? " %p%" : ""));
        table_->setCellWidget(i, 6, bar);
        auto *rm = new QPushButton("✕");
        rm->setFixedWidth(28);
        rm->setEnabled(!rendering_);
        connect(rm, &QPushButton::clicked, this, [this, i] {
            jobs_.erase(jobs_.begin() + i);
            rebuild();
        });
        table_->setCellWidget(i, 7, rm);
    }
    table_->resizeColumnsToContents();
    table_->horizontalHeader()->setSectionResizeMode(5, QHeaderView::Stretch);
}

void RenderQueuePanel::renderAll()
{
    if (rendering_)
        return;
    rendering_ = true;
    stopRequested_ = false;
    renderBtn_->setEnabled(false);
    stopBtn_->setEnabled(true);
    int done = 0, failed = 0;
    QElapsedTimer total;
    total.start();
    for (int i = 0; i < int(jobs_.size()); ++i) {
        if (jobs_[i].status == "Done")
            continue;
        if (renderJob(jobs_[i], i))
            ++done;
        else
            ++failed;
        if (stopRequested_)
            break;
    }
    rendering_ = false;
    renderBtn_->setEnabled(true);
    stopBtn_->setEnabled(false);
    const QString summary = QString("Rendered %1 item(s)%2 in %3 s")
                                .arg(done)
                                .arg(failed ? QString(", %1 failed or stopped").arg(failed) : QString())
                                .arg(total.elapsed() / 1000.0, 0, 'f', 1);
    status_->setText(summary);
    rebuild();
    emit renderFinished(summary);
}

bool RenderQueuePanel::renderJob(RenderJob &job, int row)
{
    Composition *c = ed_->project().comp(job.compId);
    auto *bar = qobject_cast<QProgressBar *>(table_->cellWidget(row, 6));
    auto setStatus = [&](const QString &s, int prog) {
        job.status = s;
        job.progress = prog;
        if (bar) {
            bar->setValue(prog);
            bar->setFormat(s + (prog > 0 && prog < 100 ? " %p%" : ""));
        }
    };
    if (!c) {
        setStatus("Missing comp", 0);
        return false;
    }
    const double scale = job.resolution == 0 ? 1.0 : job.resolution == 1 ? 0.5 : job.resolution == 2 ? 1.0 / 3.0 : 0.25;
    const int w = std::max(2, int(std::ceil(c->width * scale)));
    const int h = std::max(2, int(std::ceil(c->height * scale)));
    const int f0 = job.workAreaOnly ? c->frameAt(c->workStart) : 0;
    const int f1 = job.workAreaOnly ? std::max(f0 + 1, c->frameAt(c->workEnd)) : c->frameCount();
    Exporter ex;
    QString err;
    const bool withAudio = ed_->mixer().compHasAudio(*c);
    std::vector<float> audio;
    if (!ex.open(job.path, job.format, w, h, c->fps, job.quality, &err, withAudio)) {
        setStatus("Failed", 0);
        status_->setText(err);
        return false;
    }
    const bool alpha = exportFormatHasAlpha(job.format);
    QElapsedTimer timer;
    timer.start();
    for (int f = f0; f < f1; ++f) {
        if (stopRequested_) {
            ex.finish(&err);
            setStatus("Stopped", job.progress);
            return false;
        }
        const double t = c->timeOfFrame(f);
        QImage img = alpha ? ed_->renderer().render(*c, t, scale) : ed_->renderer().renderFlattened(*c, t, scale);
        if (!ex.addFrame(img, &err)) {
            setStatus("Failed", job.progress);
            status_->setText(err);
            return false;
        }
        if (withAudio) {
            // Cumulative sample positions avoid drift at fractional frame rates.
            const qint64 a0 = std::llround((f - f0) * double(kAudioRate) / c->fps);
            const qint64 a1 = std::llround((f - f0 + 1) * double(kAudioRate) / c->fps);
            audio.resize(size_t(a1 - a0) * 2);
            ed_->mixer().mix(*c, c->timeOfFrame(f0) + double(a0) / kAudioRate, int(a1 - a0), audio.data());
            if (!ex.addAudio(audio.data(), int(a1 - a0), &err)) {
                setStatus("Failed", job.progress);
                status_->setText(err);
                return false;
            }
        }
        const int prog = int(100.0 * (f - f0 + 1) / (f1 - f0));
        const double perFrame = timer.elapsed() / 1000.0 / (f - f0 + 1);
        setStatus("Rendering", prog);
        status_->setText(QString("Rendering “%1”: frame %2 of %3 · %4 s remaining")
                             .arg(c->name)
                             .arg(f - f0 + 1)
                             .arg(f1 - f0)
                             .arg(perFrame * (f1 - f - 1), 0, 'f', 0));
        QApplication::processEvents(QEventLoop::ExcludeUserInputEvents);
        QApplication::processEvents();
    }
    if (!ex.finish(&err)) {
        setStatus("Failed", 100);
        status_->setText(err);
        return false;
    }
    setStatus("Done", 100);
    return true;
}

} // namespace mf
