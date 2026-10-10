#pragma once
#include "Editor.h"
#include "media/Exporter.h"

#include <QWidget>
#include <deque>

class QTableWidget;
class QPushButton;
class QLabel;

namespace mf {

struct RenderJob {
    int compId = 0;
    QString path;
    ExportFormat format = ExportFormat::H264;
    int quality = 80;
    int resolution = 0;      // 0 full, 1 half, 2 third, 3 quarter
    bool workAreaOnly = true;
    QString status = "Queued";
    int progress = 0;
};

class RenderQueuePanel : public QWidget {
    Q_OBJECT
public:
    explicit RenderQueuePanel(Editor *editor, QWidget *parent = nullptr);
    void addComp(int compId, const QString &outputPath = {});
    void renderAll();
    bool isRendering() const { return rendering_; }

signals:
    void renderFinished(const QString &summary);

private:
    void rebuild();
    bool renderJob(RenderJob &job, int row);

    Editor *ed_;
    QTableWidget *table_;
    QPushButton *renderBtn_;
    QPushButton *stopBtn_;
    QLabel *status_;
    std::deque<RenderJob> jobs_;   // deque: references stay valid if jobs are added mid-render
    bool rendering_ = false;
    bool stopRequested_ = false;
};

} // namespace mf
