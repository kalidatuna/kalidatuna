#pragma once
#include "Editor.h"

#include <QDialog>

class QComboBox;
class QDoubleSpinBox;
class QLineEdit;
class QSpinBox;
class QCheckBox;
class QPushButton;

namespace mf {

class ColorButton;

struct CompSettings {
    QString name = "Comp 1";
    int width = 1920;
    int height = 1080;
    double fps = 30.0;
    double duration = 10.0;
    QColor background = Qt::black;
    bool motionBlur = true;
    int mbSamples = 12;
    double shutterAngle = 180.0;
};

class CompositionDialog : public QDialog {
    Q_OBJECT
public:
    explicit CompositionDialog(const CompSettings &s, bool isNew, QWidget *parent = nullptr);
    CompSettings settings() const;

private:
    QLineEdit *name_;
    QComboBox *preset_;
    QSpinBox *w_, *h_, *samples_;
    QCheckBox *lockAspect_;
    QComboBox *fps_;
    QDoubleSpinBox *dur_, *shutter_;
    ColorButton *bg_;
    double aspect_ = 16.0 / 9.0;
};

struct SolidSettings {
    QString name = "Solid";
    int width = 1920;
    int height = 1080;
    QColor color = QColor(200, 60, 60);
};

class SolidDialog : public QDialog {
    Q_OBJECT
public:
    SolidDialog(const SolidSettings &s, int compW, int compH, QWidget *parent = nullptr);
    SolidSettings settings() const;

private:
    QLineEdit *name_;
    QSpinBox *w_, *h_;
    ColorButton *color_;
};

class ColorButton : public QWidget {
    Q_OBJECT
public:
    explicit ColorButton(QColor c = Qt::white, QWidget *parent = nullptr);
    QColor color() const { return color_; }
    void setColor(const QColor &c) { color_ = c; update(); }
    QSize sizeHint() const override { return {40, 18}; }

signals:
    void colorChanging(QColor c);   // live while the picker is open
    void colorPicked(QColor c);     // accepted
    void pickCancelled();

protected:
    void paintEvent(QPaintEvent *) override;
    void mousePressEvent(QMouseEvent *) override;

private:
    QColor color_;
};

void showTextEditor(QWidget *parent, Editor *ed, int layerId);
void showExpressionEditor(QWidget *parent, Editor *ed, const PropRef &ref);
void showTimeStretchDialog(QWidget *parent, Editor *ed);
void showShortcutsDialog(QWidget *parent);

} // namespace mf
