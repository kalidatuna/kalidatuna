#include "ScrubField.h"

#include "Theme.h"

#include <QLineEdit>
#include <QMouseEvent>
#include <QPainter>
#include <cmath>

namespace mf {

QString formatAngle(double deg)
{
    const int turns = int(deg / 360.0);
    const double rest = deg - turns * 360.0;
    return QString("%1x%2%3°").arg(turns).arg(rest < 0 ? "" : "+").arg(rest, 0, 'f', 1);
}

ScrubField::ScrubField(QWidget *parent) : QWidget(parent)
{
    setCursor(Qt::SizeHorCursor);
    setFocusPolicy(Qt::ClickFocus);
    setSizePolicy(QSizePolicy::Fixed, QSizePolicy::Fixed);
}

QString ScrubField::displayText() const
{
    if (angle_)
        return formatAngle(value_);
    return QString::number(value_, 'f', decimals_) + suffix_;
}

QSize ScrubField::sizeHint() const
{
    const int w = fontMetrics().horizontalAdvance(angle_ ? "-00x+000.0°" : QString("-00000.0") + suffix_);
    return QSize(std::max(40, w + 6), fontMetrics().height() + 4);
}

double ScrubField::clamp(double v) const
{
    return std::clamp(v, min_, max_);
}

void ScrubField::setValue(double v)
{
    if (dragging_ || edit_)
        return;
    if (v != value_) {
        value_ = v;
        update();
    }
}

void ScrubField::paintEvent(QPaintEvent *)
{
    QPainter p(this);
    p.setPen(isEnabled() ? theme::value : theme::textDim);
    const QString t = displayText();
    p.drawText(rect().adjusted(2, 0, 0, 0), Qt::AlignVCenter | Qt::AlignLeft, t);
    if (hover_ && isEnabled()) {
        QPen pen(theme::value, 1, Qt::DotLine);
        p.setPen(pen);
        const int w = fontMetrics().horizontalAdvance(t);
        const int y = height() / 2 + fontMetrics().ascent() / 2 + 2;
        p.drawLine(2, y, 2 + w, y);
    }
}

void ScrubField::mousePressEvent(QMouseEvent *e)
{
    if (e->button() != Qt::LeftButton)
        return;
    pressed_ = true;
    dragging_ = false;
    pressPos_ = e->pos();
    pressValue_ = value_;
    accum_ = 0;
}

void ScrubField::mouseMoveEvent(QMouseEvent *e)
{
    if (!pressed_)
        return;
    const int dx = e->pos().x() - pressPos_.x();
    if (!dragging_ && std::abs(dx) > 2) {
        dragging_ = true;
        emit scrubStarted();
    }
    if (!dragging_)
        return;
    double mult = 1.0;
    if (e->modifiers() & Qt::ShiftModifier)
        mult = 10.0;
    else if (e->modifiers() & Qt::ControlModifier)
        mult = 0.1;
    const double nv = clamp(pressValue_ + dx * step_ * mult);
    if (nv != value_) {
        value_ = nv;
        update();
        emit valueScrubbed(value_);
    }
}

void ScrubField::mouseReleaseEvent(QMouseEvent *e)
{
    if (!pressed_)
        return;
    pressed_ = false;
    if (dragging_) {
        dragging_ = false;
        emit valueCommitted(value_);
    } else {
        beginEdit();
    }
}

void ScrubField::beginEdit()
{
    edit_ = new QLineEdit(this);
    edit_->setText(QString::number(value_, 'f', angle_ ? 1 : std::max(decimals_, 2)));
    edit_->setGeometry(rect().adjusted(0, -1, 30, 1));
    edit_->setMinimumWidth(60);
    edit_->selectAll();
    edit_->show();
    edit_->setFocus();
    connect(edit_, &QLineEdit::returnPressed, this, [this] { finishEdit(true); });
    connect(edit_, &QLineEdit::editingFinished, this, [this] { finishEdit(true); });
}

void ScrubField::finishEdit(bool accept)
{
    if (!edit_)
        return;
    QLineEdit *ed = edit_;
    edit_ = nullptr;
    bool ok = false;
    QString txt = ed->text().trimmed();
    txt.remove('%').remove(QChar(0xB0));
    double v = txt.toDouble(&ok);
    ed->deleteLater();
    if (accept && ok) {
        value_ = clamp(v);
        update();
        emit valueCommitted(value_);
    }
}

} // namespace mf
