#pragma once
#include "Editor.h"

#include <QWidget>

class QFontComboBox;
class QPlainTextEdit;
class QToolButton;

namespace mf {

class ColorButton;
class ScrubField;

// Character & Paragraph controls for selected text layers.
class CharacterPanel : public QWidget {
    Q_OBJECT
public:
    explicit CharacterPanel(Editor *editor, QWidget *parent = nullptr);

protected:
    bool eventFilter(QObject *o, QEvent *e) override;

private:
    void refresh();
    std::vector<Layer *> textLayers() const;
    void setProp(Property Layer::*member, int dim, double v, bool commit);

    Editor *ed_;
    QFontComboBox *font_;
    QToolButton *bold_, *italic_;
    QToolButton *align_[3];
    ScrubField *size_, *stroke_, *tracking_, *leading_;
    ColorButton *fill_, *strokeColor_;
    QPlainTextEdit *text_;
    bool updating_ = false;
};

} // namespace mf
