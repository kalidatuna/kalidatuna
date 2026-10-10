#pragma once
#include <QWidget>

class QLineEdit;

namespace mf {

// AE-style blue number: drag horizontally to scrub (Shift = x10, Ctrl = x0.1),
// click to type a value.
class ScrubField : public QWidget {
    Q_OBJECT
public:
    explicit ScrubField(QWidget *parent = nullptr);

    double value() const { return value_; }
    void setValue(double v);
    void setRange(double mn, double mx) { min_ = mn; max_ = mx; }
    void setStep(double s) { step_ = s; }
    void setDecimals(int d) { decimals_ = d; update(); }
    void setSuffix(const QString &s) { suffix_ = s; updateGeometry(); update(); }
    void setAngleMode(bool on) { angle_ = on; updateGeometry(); update(); }
    QString displayText() const;
    QSize sizeHint() const override;
    QSize minimumSizeHint() const override { return sizeHint(); }

signals:
    void scrubStarted();
    void valueScrubbed(double v);    // live while dragging
    void valueCommitted(double v);   // drag released or text entered

protected:
    void paintEvent(QPaintEvent *) override;
    void mousePressEvent(QMouseEvent *e) override;
    void mouseMoveEvent(QMouseEvent *e) override;
    void mouseReleaseEvent(QMouseEvent *e) override;
    void enterEvent(QEnterEvent *) override { hover_ = true; update(); }
    void leaveEvent(QEvent *) override { hover_ = false; update(); }

private:
    void beginEdit();
    void finishEdit(bool accept);
    double clamp(double v) const;

    double value_ = 0;
    double min_ = -1e9;
    double max_ = 1e9;
    double step_ = 1.0;
    int decimals_ = 1;
    QString suffix_;
    bool angle_ = false;
    bool hover_ = false;
    bool pressed_ = false;
    bool dragging_ = false;
    QPoint pressPos_;
    double pressValue_ = 0;
    double accum_ = 0;
    QLineEdit *edit_ = nullptr;
};

QString formatAngle(double deg);

} // namespace mf
