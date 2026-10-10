#pragma once
#include "core/Project.h"

#include <QJSEngine>
#include <QObject>
#include <memory>

namespace mf {

// Bridge object exposed to scripts as `__mf`. Holds the evaluation context.
class ExprApi : public QObject {
    Q_OBJECT
public:
    const Property *prop = nullptr;
    const Layer *layer = nullptr;
    const Composition *comp = nullptr;
    double time = 0.0;
    Value value;
    quint32 seed = 0;
    bool timeless = false;

    Q_INVOKABLE QJSValue wiggle(double freq, QJSValue amp, int octaves, double ampMult, double t);
    Q_INVOKABLE QJSValue loop(bool out, const QString &type, int numKeys);
    Q_INVOKABLE QJSValue valueAtTime(double t);
    Q_INVOKABLE double noise1(double x);
    Q_INVOKABLE double random01();
    Q_INVOKABLE void seedRandom(double s, bool timeless);
    Q_INVOKABLE int numKeys();
    Q_INVOKABLE double keyTime(int i);
    Q_INVOKABLE QJSValue keyValue(int i);

    QJSEngine *engine = nullptr;
    QJSValue toJs(const Value &v) const;

private:
    quint64 rngState_ = 1;
    quint64 rngCounter_ = 0;
};

class ExpressionEngine {
public:
    static ExpressionEngine &instance();

    // Returns the post-expression value; on error returns `pre` and sets prop.expressionError.
    Value evaluate(const Property &prop, const Value &pre, double time, const Layer *layer,
                   const Composition *comp, int layerIndex);
    QJSEngine &engine() { return *engine_; }

private:
    ExpressionEngine();
    std::unique_ptr<QJSEngine> engine_;
    ExprApi *api_ = nullptr;
};

quint32 hashSeed(const QString &s, int extra);

} // namespace mf
