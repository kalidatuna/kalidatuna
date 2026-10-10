#pragma once
#include <QColor>
#include <QJsonObject>
#include <QPointF>
#include <QString>
#include <QStringList>
#include <QVector>

namespace mf {

using Value = QVector<double>;

enum class PropType { Number, Percent, Angle, Point, Color, Checkbox, Choice, Time };
enum class Interp { Linear, Bezier, Hold };

struct Keyframe {
    double time = 0.0;
    Value value;
    Interp inInterp = Interp::Linear;
    Interp outInterp = Interp::Linear;
    double inInfluence = 33.333;   // percent of the segment, like AE's temporal influence
    double outInfluence = 33.333;
    bool selected = false;         // editor state only, never saved
};

// An animatable parameter: either a static value or a list of keyframes,
// optionally post-processed by a JavaScript expression.
class Property {
public:
    Property() = default;
    Property(QString id, QString name, PropType type, Value def);

    QString id;
    QString name;
    PropType type = PropType::Number;
    Value defaultValue;
    Value staticValue;
    QVector<Keyframe> keys;
    QString expression;
    bool expressionEnabled = true;
    double minValue = -1e9;
    double maxValue = 1e9;
    double dragStep = 1.0;          // value change per pixel when scrubbing
    QStringList choices;
    bool animatable = true;
    mutable QString expressionError;

    Property &limits(double mn, double mx) { minValue = mn; maxValue = mx; return *this; }
    Property &step(double s) { dragStep = s; return *this; }
    Property &withChoices(QStringList c) { choices = std::move(c); return *this; }

    int dims() const { return defaultValue.size(); }
    bool isAnimated() const { return !keys.isEmpty(); }
    bool hasExpression() const { return expressionEnabled && !expression.trimmed().isEmpty(); }
    bool isModified() const;

    // Keyframed value at time t (before any expression is applied).
    Value valueAt(double t) const;
    // Sets the value at t: updates or creates a keyframe when animated, else the static value.
    void setValue(double t, Value v);
    void setAnimated(bool on, double t);
    int keyIndexAt(double t, double eps = 1e-4) const;
    int addKey(double t, Value v);
    void sortKeys();
    void reset();
    Value clamp(Value v) const;

    QJsonObject toJson() const;
    void fromJson(const QJsonObject &o);

    static QColor toColor(const Value &v);
    static Value fromColor(const QColor &c);
    static QPointF toPoint(const Value &v) { return v.size() >= 2 ? QPointF(v[0], v[1]) : QPointF(); }
    static Value fromPoint(QPointF p) { return {p.x(), p.y()}; }
    QString formatValue(const Value &v) const;
};

// Temporal interpolation between two keyframes at normalized time u in [0,1].
double easedProgress(const Keyframe &a, const Keyframe &b, double u);
Value lerpValue(const Value &a, const Value &b, double s);

} // namespace mf
