#pragma once
#include "Editor.h"

#include <QWidget>

class QLabel;
class QToolButton;

namespace mf {

class CompViewer;
class PlaybackController;

class InfoPanel : public QWidget {
    Q_OBJECT
public:
    InfoPanel(Editor *editor, CompViewer *viewer, QWidget *parent = nullptr);

private:
    void refreshSelection();
    Editor *ed_;
    QLabel *rgba_;
    QLabel *xy_;
    QLabel *details_;
};

class PreviewPanel : public QWidget {
    Q_OBJECT
public:
    PreviewPanel(Editor *editor, PlaybackController *playback, QWidget *parent = nullptr);

private:
    Editor *ed_;
    PlaybackController *pb_;
    QToolButton *play_;
    QLabel *fps_;
};

} // namespace mf
