#include "Property.h"

#include <QJsonArray>
#include <algorithm>
#include <cmath>

namespace mf {

Property::Property(QString id_, QString name_, PropType type_, Value def)
    : id(std::move(id_)), name(std::move(name_)), type(type_), defaultValue(def), staticValue(def)
{
    if (type == PropType::Checkbox || type == PropType::Choice)
        animatable = type == PropType::Checkbox;
    if (type == PropType::Percent)
        dragStep = 1.0;
    if (type == PropType::Color)
        limits(0.0, 1.0);
}

bool Property::isModified() const
{
    return isAnimated() || hasExpression() || staticValue != defaultValue;
}

static double bezier1(double p1, double p2, double s)
{
    const double inv = 1.0 - s;
    return 3 * inv * inv * s * p1 + 3 * inv * s * s * p2 + s * s * s;
}

double easedProgress(const Keyframe &a, const Keyframe &b, double u)
{
    if (a.outInterp == Interp::Hold)
        return 0.0;
    const bool easeOut = a.outInterp == Interp::Bezier;
    const bool easeIn = b.inInterp == Interp::Bezier;
    if (!easeOut && !easeIn)
        return u;
    // Control points of a cubic Bezier in (time, progress) space. An eased side has
    // zero speed and its handle length is the keyframe's influence.
    const double x1 = easeOut ? std::clamp(a.outInfluence / 100.0, 0.01, 1.0) : 1.0 / 3.0;
    const double y1 = easeOut ? 0.0 : x1;
    const double x2 = easeIn ? 1.0 - std::clamp(b.inInfluence / 100.0, 0.01, 1.0) : 2.0 / 3.0;
    const double y2 = easeIn ? 1.0 : x2;
    // Solve x(s) = u by bisection (monotonic since control x values are in [0,1]).
    double lo = 0.0, hi = 1.0, s = u;
    for (int i = 0; i < 40; ++i) {
        s = 0.5 * (lo + hi);
        if (bezier1(x1, x2, s) < u)
            lo = s;
        else
            hi = s;
    }
    return bezier1(y1, y2, s);
}

Value lerpValue(const Value &a, const Value &b, double s)
{
    Value r(a.size());
    for (int i = 0; i < a.size(); ++i)
        r[i] = a[i] + (i < b.size() ? b[i] - a[i] : 0.0) * s;
    return r;
}

Value Property::valueAt(double t) const
{
    if (keys.isEmpty())
        return staticValue;
    if (t <= keys.first().time)
        return keys.first().value;
    if (t >= keys.last().time)
        return keys.last().value;
    auto it = std::upper_bound(keys.begin(), keys.end(), t,
                               [](double tt, const Keyframe &k) { return tt < k.time; });
    const Keyframe &b = *it;
    const Keyframe &a = *(it - 1);
    const double span = b.time - a.time;
    if (span <= 0)
        return b.value;
    return lerpValue(a.value, b.value, easedProgress(a, b, (t - a.time) / span));
}

Value Property::clamp(Value v) const
{
    v.resize(dims());
    if (type == PropType::Point)
        return v;
    for (double &d : v)
        d = std::clamp(d, minValue, maxValue);
    return v;
}

int Property::keyIndexAt(double t, double eps) const
{
    for (int i = 0; i < keys.size(); ++i)
        if (std::abs(keys[i].time - t) < eps)
            return i;
    return -1;
}

void Property::sortKeys()
{
    std::stable_sort(keys.begin(), keys.end(),
                     [](const Keyframe &a, const Keyframe &b) { return a.time < b.time; });
}

int Property::addKey(double t, Value v)
{
    v = clamp(v);
    int idx = keyIndexAt(t);
    if (idx >= 0) {
        keys[idx].value = v;
        return idx;
    }
    Keyframe k;
    k.time = t;
    k.value = v;
    if (type == PropType::Checkbox)
        k.inInterp = k.outInterp = Interp::Hold;
    keys.append(k);
    sortKeys();
    return keyIndexAt(t);
}

void Property::setValue(double t, Value v)
{
    if (isAnimated())
        addKey(t, std::move(v));
    else
        staticValue = clamp(std::move(v));
}

void Property::setAnimated(bool on, double t)
{
    if (on == isAnimated())
        return;
    if (on) {
        addKey(t, staticValue);
    } else {
        staticValue = valueAt(t);
        keys.clear();
    }
}

void Property::reset()
{
    keys.clear();
    staticValue = defaultValue;
}

QColor Property::toColor(const Value &v)
{
    if (v.size() < 3)
        return Qt::black;
    return QColor::fromRgbF(std::clamp(v[0], 0.0, 1.0), std::clamp(v[1], 0.0, 1.0),
                            std::clamp(v[2], 0.0, 1.0), v.size() > 3 ? std::clamp(v[3], 0.0, 1.0) : 1.0);
}

Value Property::fromColor(const QColor &c)
{
    return {c.redF(), c.greenF(), c.blueF(), c.alphaF()};
}

QString Property::formatValue(const Value &v) const
{
    auto num = [](double d, int prec) { return QString::number(d, 'f', prec); };
    switch (type) {
    case PropType::Percent:
        if (v.size() == 1)
            return num(v[0], 1) + "%";
        {
            QStringList parts;
            for (double d : v)
                parts << num(d, 1) + "%";
            return parts.join(", ");
        }
    case PropType::Angle: {
        const double deg = v.value(0);
        const int turns = int(deg / 360.0);
        return QString("%1x%2%3°").arg(turns).arg(deg - turns * 360.0 >= 0 ? "+" : "").arg(num(deg - turns * 360.0, 1));
    }
    case PropType::Checkbox:
        return v.value(0) > 0.5 ? "On" : "Off";
    case PropType::Choice:
        return choices.value(int(v.value(0)));
    case PropType::Color:
        return toColor(v).name();
    case PropType::Time:
        return num(v.value(0), 3) + "s";
    default: {
        QStringList parts;
        for (double d : v)
            parts << num(d, 1);
        return parts.join(", ");
    }
    }
}

static QJsonArray valueToJson(const Value &v)
{
    QJsonArray a;
    for (double d : v)
        a.append(d);
    return a;
}

static Value valueFromJson(const QJsonValue &j, const Value &fallback)
{
    if (!j.isArray())
        return fallback;
    Value v;
    for (const auto &e : j.toArray())
        v.append(e.toDouble());
    if (v.size() != fallback.size())
        v.resize(fallback.size());
    return v;
}

static QString interpName(Interp i)
{
    return i == Interp::Bezier ? "bezier" : i == Interp::Hold ? "hold" : "linear";
}

static Interp interpFromName(const QString &s)
{
    return s == "bezier" ? Interp::Bezier : s == "hold" ? Interp::Hold : Interp::Linear;
}

QJsonObject Property::toJson() const
{
    QJsonObject o;
    o["value"] = valueToJson(staticValue);
    if (!keys.isEmpty()) {
        QJsonArray ks;
        for (const auto &k : keys) {
            QJsonObject ko;
            ko["t"] = k.time;
            ko["v"] = valueToJson(k.value);
            ko["in"] = interpName(k.inInterp);
            ko["out"] = interpName(k.outInterp);
            ko["inInf"] = k.inInfluence;
            ko["outInf"] = k.outInfluence;
            ks.append(ko);
        }
        o["keys"] = ks;
    }
    if (!expression.isEmpty()) {
        o["expr"] = expression;
        o["exprOn"] = expressionEnabled;
    }
    return o;
}

void Property::fromJson(const QJsonObject &o)
{
    staticValue = valueFromJson(o["value"], defaultValue);
    keys.clear();
    for (const auto &kv : o["keys"].toArray()) {
        const auto ko = kv.toObject();
        Keyframe k;
        k.time = ko["t"].toDouble();
        k.value = valueFromJson(ko["v"], defaultValue);
        k.inInterp = interpFromName(ko["in"].toString());
        k.outInterp = interpFromName(ko["out"].toString());
        k.inInfluence = ko["inInf"].toDouble(33.333);
        k.outInfluence = ko["outInf"].toDouble(33.333);
        keys.append(k);
    }
    sortKeys();
    expression = o["expr"].toString();
    expressionEnabled = o["exprOn"].toBool(true);
}

} // namespace mf
