#pragma once
#include "Editor.h"

#include <QWidget>
#include <functional>

class QLabel;
class QScrollArea;
class QVBoxLayout;

namespace mf {

class EffectControlsPanel : public QWidget {
    Q_OBJECT
public:
    explicit EffectControlsPanel(Editor *editor, QWidget *parent = nullptr);

private:
    void rebuild();
    void refreshValues();
    QWidget *paramRow(Layer *l, Effect *e, Property *p);

    Editor *ed_;
    QLabel *header_;
    QScrollArea *scroll_;
    std::vector<std::function<void()>> refreshers_;
    int shownLayer_ = -1;
};

} // namespace mf
