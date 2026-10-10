#include "Icons.h"

#include <QHash>
#include <QPainter>
#include <QPainterPath>
#include <cmath>

namespace mf {

static QPixmap draw(const QString &name, const QColor &c, int size)
{
    QPixmap pm(size, size);
    pm.fill(Qt::transparent);
    QPainter p(&pm);
    p.setRenderHint(QPainter::Antialiasing);
    p.scale(size / 24.0, size / 24.0);
    QPen pen(c, 1.7, Qt::SolidLine, Qt::RoundCap, Qt::RoundJoin);
    p.setPen(pen);
    p.setBrush(Qt::NoBrush);
    auto fill = [&](const QPainterPath &path) {
        p.setBrush(c);
        p.setPen(Qt::NoPen);
        p.drawPath(path);
        p.setPen(pen);
        p.setBrush(Qt::NoBrush);
    };
    if (name == "select") {
        QPainterPath a;
        a.moveTo(6, 3);
        a.lineTo(6, 19);
        a.lineTo(10, 15);
        a.lineTo(13, 21);
        a.lineTo(15.5, 20);
        a.lineTo(12.5, 14);
        a.lineTo(18, 14);
        a.closeSubpath();
        fill(a);
    } else if (name == "hand") {
        QPainterPath h;
        h.addRoundedRect(QRectF(6, 9, 12, 11), 4, 4);
        for (int i = 0; i < 4; ++i)
            h.addRoundedRect(QRectF(6.2 + i * 3, 3.5 + (i == 0 || i == 3 ? 2 : 0), 2.6, 8), 1.3, 1.3);
        fill(h.simplified());
    } else if (name == "zoom") {
        p.drawEllipse(QPointF(10, 10), 6, 6);
        p.drawLine(QPointF(14.5, 14.5), QPointF(20, 20));
    } else if (name == "rotate") {
        p.drawArc(QRectF(4, 4, 16, 16), 30 * 16, 280 * 16);
        QPainterPath a;
        a.moveTo(19, 4);
        a.lineTo(19.5, 10);
        a.lineTo(14, 8);
        a.closeSubpath();
        fill(a);
    } else if (name == "anchor") {
        p.drawEllipse(QPointF(12, 12), 4, 4);
        p.drawLine(QPointF(12, 2), QPointF(12, 22));
        p.drawLine(QPointF(2, 12), QPointF(22, 12));
    } else if (name == "rect") {
        p.drawRect(QRectF(4, 6, 16, 12));
    } else if (name == "ellipse") {
        p.drawEllipse(QRectF(3.5, 5.5, 17, 13));
    } else if (name == "star" || name == "polygon") {
        const bool star = name == "star";
        QPolygonF poly;
        const int n = star ? 10 : 5;
        for (int i = 0; i < n; ++i) {
            const double a = -M_PI / 2 + i * 2 * M_PI / n;
            const double r = star && (i & 1) ? 4.0 : 9.0;
            poly << QPointF(12 + std::cos(a) * r, 12.5 + std::sin(a) * r);
        }
        p.drawPolygon(poly);
    } else if (name == "text") {
        QFont f("Sans Serif");
        f.setPixelSize(19);
        f.setBold(true);
        p.setFont(f);
        p.drawText(QRectF(0, 0, 24, 24), Qt::AlignCenter, "T");
    } else if (name == "play") {
        QPainterPath a;
        a.moveTo(7, 4);
        a.lineTo(19, 12);
        a.lineTo(7, 20);
        a.closeSubpath();
        fill(a);
    } else if (name == "pause") {
        QPainterPath a;
        a.addRect(QRectF(6, 4, 4, 16));
        a.addRect(QRectF(14, 4, 4, 16));
        fill(a);
    } else if (name == "first" || name == "last") {
        p.save();
        if (name == "last") {
            p.translate(24, 0);
            p.scale(-1, 1);
        }
        QPainterPath a;
        a.addRect(QRectF(5, 5, 2.5, 14));
        a.moveTo(19, 5);
        a.lineTo(9, 12);
        a.lineTo(19, 19);
        a.closeSubpath();
        fill(a);
        p.restore();
    } else if (name == "prev" || name == "next") {
        p.save();
        if (name == "next") {
            p.translate(24, 0);
            p.scale(-1, 1);
        }
        QPainterPath a;
        a.moveTo(15, 5);
        a.lineTo(6, 12);
        a.lineTo(15, 19);
        a.closeSubpath();
        a.addRect(QRectF(16, 5, 2.5, 14));
        fill(a);
        p.restore();
    } else if (name == "loop") {
        p.drawRoundedRect(QRectF(4, 7, 16, 10), 5, 5);
        QPainterPath a;
        a.moveTo(13, 4);
        a.lineTo(17, 7);
        a.lineTo(13, 10);
        a.closeSubpath();
        fill(a);
    } else if (name == "stopwatch" || name == "stopwatch-on") {
        p.drawEllipse(QPointF(12, 13.5), 7, 7);
        p.drawLine(QPointF(12, 13.5), QPointF(12, 9));
        p.drawLine(QPointF(10, 3.5), QPointF(14, 3.5));
        if (name == "stopwatch-on") {
            QPainterPath a;
            a.moveTo(12, 13.5);
            a.arcTo(QRectF(5, 6.5, 14, 14), 90, -120);
            a.closeSubpath();
            fill(a);
        }
    } else if (name == "eye") {
        QPainterPath e;
        e.moveTo(2, 12);
        e.quadTo(12, 2, 22, 12);
        e.quadTo(12, 22, 2, 12);
        p.drawPath(e);
        QPainterPath d;
        d.addEllipse(QPointF(12, 12), 3.2, 3.2);
        fill(d);
    } else if (name == "audio") {
        QPainterPath sp;
        sp.moveTo(3, 9);
        sp.lineTo(7, 9);
        sp.lineTo(12, 4);
        sp.lineTo(12, 20);
        sp.lineTo(7, 15);
        sp.lineTo(3, 15);
        sp.closeSubpath();
        fill(sp);
        p.drawArc(QRectF(10, 7, 6, 10), -60 * 16, 120 * 16);
        p.drawArc(QRectF(10, 3.5, 11, 17), -60 * 16, 120 * 16);
    } else if (name == "solo") {
        QPainterPath d;
        d.addEllipse(QPointF(12, 12), 5, 5);
        fill(d);
        p.drawEllipse(QPointF(12, 12), 8.5, 8.5);
    } else if (name == "lock") {
        p.drawArc(QRectF(7, 3, 10, 12), 0, 180 * 16);
        p.drawLine(QPointF(7, 9), QPointF(7, 11));
        p.drawLine(QPointF(17, 9), QPointF(17, 11));
        QPainterPath b;
        b.addRoundedRect(QRectF(5, 11, 14, 10), 2, 2);
        fill(b);
    } else if (name == "shy") {
        p.drawEllipse(QPointF(12, 10), 6, 6);
        p.drawLine(QPointF(4, 21), QPointF(20, 21));
        p.drawLine(QPointF(9, 9), QPointF(10.5, 10));
        p.drawLine(QPointF(15, 9), QPointF(13.5, 10));
    } else if (name == "motionblur") {
        QPainterPath d;
        d.addEllipse(QPointF(16, 12), 5, 5);
        fill(d);
        p.drawLine(QPointF(2, 9), QPointF(9, 9));
        p.drawLine(QPointF(4, 12), QPointF(10, 12));
        p.drawLine(QPointF(2, 15), QPointF(9, 15));
    } else if (name == "fx") {
        QFont f("Serif");
        f.setPixelSize(15);
        f.setItalic(true);
        f.setBold(true);
        p.setFont(f);
        p.drawText(QRectF(0, 0, 24, 24), Qt::AlignCenter, "fx");
    } else if (name == "adjust") {
        p.drawEllipse(QPointF(12, 12), 8, 8);
        QPainterPath h;
        h.moveTo(12, 4);
        h.arcTo(QRectF(4, 4, 16, 16), 90, 180);
        h.closeSubpath();
        fill(h);
    } else if (name == "grid") {
        p.drawRect(QRectF(3, 3, 18, 18));
        p.drawLine(QPointF(9, 3), QPointF(9, 21));
        p.drawLine(QPointF(15, 3), QPointF(15, 21));
        p.drawLine(QPointF(3, 9), QPointF(21, 9));
        p.drawLine(QPointF(3, 15), QPointF(21, 15));
    } else if (name == "checker") {
        QPainterPath a;
        for (int y = 0; y < 3; ++y)
            for (int x = 0; x < 3; ++x)
                if ((x + y) % 2 == 0)
                    a.addRect(QRectF(3 + x * 6, 3 + y * 6, 6, 6));
        fill(a);
        p.drawRect(QRectF(3, 3, 18, 18));
    } else if (name == "folder") {
        QPainterPath a;
        a.moveTo(2, 6);
        a.lineTo(9, 6);
        a.lineTo(11, 8);
        a.lineTo(22, 8);
        a.lineTo(22, 19);
        a.lineTo(2, 19);
        a.closeSubpath();
        fill(a);
    } else if (name == "comp") {
        p.drawRect(QRectF(3, 5, 18, 14));
        QPainterPath a;
        a.addRect(QRectF(6, 8, 5, 4));
        a.addRect(QRectF(13, 12, 5, 4));
        fill(a);
    } else if (name == "footage") {
        p.drawRect(QRectF(3, 5, 18, 14));
        for (int i = 0; i < 4; ++i) {
            p.drawLine(QPointF(5 + i * 4.5, 5), QPointF(5 + i * 4.5, 8));
            p.drawLine(QPointF(5 + i * 4.5, 16), QPointF(5 + i * 4.5, 19));
        }
    } else if (name == "image") {
        p.drawRect(QRectF(3, 5, 18, 14));
        QPainterPath m;
        m.moveTo(5, 17);
        m.lineTo(10, 10);
        m.lineTo(14, 15);
        m.lineTo(16, 12.5);
        m.lineTo(19, 17);
        m.closeSubpath();
        fill(m);
    } else if (name == "plus") {
        p.drawLine(QPointF(12, 5), QPointF(12, 19));
        p.drawLine(QPointF(5, 12), QPointF(19, 12));
    } else if (name == "trash") {
        p.drawRect(QRectF(6, 7, 12, 14));
        p.drawLine(QPointF(4, 7), QPointF(20, 7));
        p.drawLine(QPointF(10, 4), QPointF(14, 4));
        p.drawLine(QPointF(10, 10), QPointF(10, 18));
        p.drawLine(QPointF(14, 10), QPointF(14, 18));
    } else if (name == "render") {
        QPainterPath a;
        a.moveTo(4, 4);
        a.lineTo(20, 12);
        a.lineTo(4, 20);
        a.closeSubpath();
        p.drawPath(a);
        p.drawLine(QPointF(4, 12), QPointF(13, 12));
    } else if (name == "graph") {
        QPainterPath a;
        a.moveTo(3, 19);
        a.cubicTo(10, 19, 14, 5, 21, 5);
        p.drawPath(a);
        p.drawLine(QPointF(3, 3), QPointF(3, 21));
        p.drawLine(QPointF(3, 21), QPointF(21, 21));
    } else if (name == "snapshot") {
        p.drawRoundedRect(QRectF(3, 7, 18, 13), 2, 2);
        p.drawEllipse(QPointF(12, 13.5), 3.5, 3.5);
        p.drawLine(QPointF(8, 7), QPointF(10, 4));
        p.drawLine(QPointF(10, 4), QPointF(14, 4));
        p.drawLine(QPointF(14, 4), QPointF(16, 7));
    } else {
        p.drawRect(QRectF(5, 5, 14, 14));
    }
    return pm;
}

QIcon icon(const QString &name, const QColor &color)
{
    static QHash<QString, QIcon> cache;
    const QString key = name + color.name();
    auto it = cache.find(key);
    if (it != cache.end())
        return *it;
    QIcon ic;
    for (int s : {16, 24, 32, 48})
        ic.addPixmap(draw(name, color, s));
    ic.addPixmap(draw(name, QColor(0x5a, 0x5a, 0x5a), 24), QIcon::Disabled);
    cache.insert(key, ic);
    return ic;
}

} // namespace mf
