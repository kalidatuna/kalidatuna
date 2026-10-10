#include "ExpressionEngine.h"

#include <QJSValueIterator>
#include <cmath>

namespace mf {

static const char *kPrelude = R"JS(
var __isArr = function(v){ return Array.isArray(v); };
function __map2(a, b, f) {
  if (__isArr(a) || __isArr(b)) {
    var A = __isArr(a) ? a : null, B = __isArr(b) ? b : null;
    var n = Math.max(A ? A.length : 0, B ? B.length : 0), r = [];
    for (var i = 0; i < n; i++) r.push(f(A ? (A[i] || 0) : a, B ? (B[i] || 0) : b));
    return r;
  }
  return f(a, b);
}
function add(a, b) { return __map2(a, b, function(x, y){ return x + y; }); }
function sub(a, b) { return __map2(a, b, function(x, y){ return x - y; }); }
function mul(a, b) { return __map2(a, b, function(x, y){ return x * y; }); }
function div(a, b) { return __map2(a, b, function(x, y){ return x / y; }); }
function clamp(v, lo, hi) { return __map2(v, 0, function(x){ return Math.min(Math.max(x, lo), hi); }); }
function length(a, b) {
  if (b !== undefined) a = sub(a, b);
  if (!__isArr(a)) return Math.abs(a);
  var s = 0; for (var i = 0; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s);
}
function normalize(a) { var l = length(a); return l ? div(a, l) : a; }
function dot(a, b) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
function degreesToRadians(d) { return d * Math.PI / 180; }
function radiansToDegrees(r) { return r * 180 / Math.PI; }
function __interp(shape, args) {
  var t = args[0], tMin, tMax, v1, v2;
  if (args.length <= 3) { tMin = 0; tMax = 1; v1 = args[1]; v2 = args[2]; }
  else { tMin = args[1]; tMax = args[2]; v1 = args[3]; v2 = args[4]; }
  var u;
  if (tMax === tMin) u = t >= tMax ? 1 : 0;
  else u = Math.min(Math.max((t - tMin) / (tMax - tMin), 0), 1);
  if (tMax < tMin) u = 1 - Math.min(Math.max((t - tMax) / (tMin - tMax), 0), 1);
  u = shape(u);
  return __map2(v1, v2, function(a, b){ return a + (b - a) * u; });
}
function linear() { return __interp(function(u){ return u; }, arguments); }
function ease() { return __interp(function(u){ return u * u * (3 - 2 * u); }, arguments); }
function easeIn() { return __interp(function(u){ return 2 * u * u - u * u * u; }, arguments); }
function easeOut() { return __interp(function(u){ return u + u * u - u * u * u; }, arguments); }
function wiggle(freq, amp, octaves, ampMult, t) {
  return __mf.wiggle(freq, amp, octaves === undefined ? 1 : octaves, ampMult === undefined ? 0.5 : ampMult,
                     t === undefined ? time : t);
}
function loopOut(type, n) { return __mf.loop(true, type || "cycle", n || 0); }
function loopIn(type, n) { return __mf.loop(false, type || "cycle", n || 0); }
function loopOutDuration(type) { return loopOut(type, 0); }
function loopInDuration(type) { return loopIn(type, 0); }
function valueAtTime(t) { return __mf.valueAtTime(t); }
function noise(x) { return __mf.noise1(__isArr(x) ? x[0] : x); }
function seedRandom(s, timeless) { __mf.seedRandom(s, !!timeless); }
function random(a, b) {
  if (a === undefined) return __mf.random01();
  if (b === undefined) return __map2(a, 0, function(x){ return __mf.random01() * x; });
  return __map2(a, b, function(x, y){ return x + __mf.random01() * (y - x); });
}
function gaussRandom(a, b) {
  var g = function(){ var u = 1 - __mf.random01(), v = __mf.random01();
    return Math.min(Math.max(0.5 + Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) / 6, 0), 1); };
  if (a === undefined) return g();
  if (b === undefined) return __map2(a, 0, function(x){ return g() * x; });
  return __map2(a, b, function(x, y){ return x + g() * (y - x); });
}
function key(i) { return { time: __mf.keyTime(i - 1), value: __mf.keyValue(i - 1) }; }
function framesToTime(f, fps) { return f / (fps || thisComp.frameRate); }
function timeToFrames(t, fps) { return Math.round((t === undefined ? time : t) * (fps || thisComp.frameRate)); }
)JS";

quint32 hashSeed(const QString &s, int extra)
{
    quint32 h = 2166136261u ^ quint32(extra * 2654435761u);
    for (QChar c : s) {
        h ^= c.unicode();
        h *= 16777619u;
    }
    return h;
}

// Smooth 1D value noise with cosine-free quintic fade; output in [-1, 1].
static double hashUnit(quint32 seed, qint64 i)
{
    quint64 x = quint64(i) * 0x9E3779B97F4A7C15ull ^ (quint64(seed) << 17);
    x ^= x >> 33;
    x *= 0xff51afd7ed558ccdull;
    x ^= x >> 33;
    x *= 0xc4ceb9fe1a85ec53ull;
    x ^= x >> 33;
    return double(x >> 11) / double(1ull << 53) * 2.0 - 1.0;
}

static double valueNoise(quint32 seed, double x)
{
    const double fl = std::floor(x);
    const double f = x - fl;
    const double u = f * f * f * (f * (f * 6 - 15) + 10);
    const double a = hashUnit(seed, qint64(fl));
    const double b = hashUnit(seed, qint64(fl) + 1);
    return a + (b - a) * u;
}

QJSValue ExprApi::toJs(const Value &v) const
{
    if (v.size() == 1)
        return QJSValue(v[0]);
    QJSValue arr = engine->newArray(v.size());
    for (int i = 0; i < v.size(); ++i)
        arr.setProperty(i, v[i]);
    return arr;
}

static Value fromJs(const QJSValue &j, int dims, bool *ok)
{
    *ok = true;
    if (j.isNumber() || j.isBool()) {
        Value v(dims, j.toNumber());
        if (dims > 1) {
            // A plain number for a multi-dimensional property only makes sense as a broadcast.
            for (int i = 0; i < dims; ++i)
                v[i] = j.toNumber();
        }
        return v;
    }
    if (j.isArray()) {
        Value v(dims, 0.0);
        const int n = j.property("length").toInt();
        for (int i = 0; i < std::min(n, dims); ++i)
            v[i] = j.property(i).toNumber();
        if (n < dims && dims == 4 && n == 3)
            v[3] = 1.0;   // RGB array for a color
        return v;
    }
    *ok = false;
    return {};
}

QJSValue ExprApi::wiggle(double freq, QJSValue amp, int octaves, double ampMult, double t)
{
    Value out = value;
    for (int d = 0; d < out.size(); ++d) {
        const double a = amp.isArray() ? amp.property(d).toNumber() : amp.toNumber();
        double sum = 0, amplitude = 1, frequency = freq, norm = 0;
        for (int o = 0; o < std::max(1, octaves); ++o) {
            sum += valueNoise(seed + quint32(d * 7919 + o * 104729), t * frequency) * amplitude;
            norm += amplitude;
            amplitude *= ampMult;
            frequency *= 2;
        }
        out[d] += a * sum / std::max(norm, 1e-9);
    }
    return toJs(out);
}

QJSValue ExprApi::loop(bool out, const QString &type, int n)
{
    const auto &keys = prop->keys;
    if (keys.size() < 2)
        return toJs(value);
    const int count = keys.size();
    const int span = (n <= 0 || n >= count) ? count - 1 : n;
    const double tFirst = keys.first().time, tLast = keys.last().time;
    if (out) {
        if (time <= tLast)
            return toJs(value);
        const double segStart = keys[count - 1 - span].time;
        const double dur = tLast - segStart;
        if (dur <= 0)
            return toJs(value);
        const double elapsed = time - tLast;
        if (type == "continue") {
            const double dt = std::max(1e-3, (tLast - keys[count - 2].time) * 0.01);
            Value v1 = prop->valueAt(tLast), v0 = prop->valueAt(tLast - dt);
            Value r = v1;
            for (int i = 0; i < r.size(); ++i)
                r[i] += (v1[i] - v0[i]) / dt * elapsed;
            return toJs(r);
        }
        const int cycles = int(elapsed / dur);
        double local = std::fmod(elapsed, dur);
        if (type == "pingpong" && (cycles % 2 == 0))
            return toJs(prop->valueAt(tLast - local));
        Value r = prop->valueAt(segStart + local);
        if (type == "offset") {
            const Value a = prop->valueAt(segStart), b = prop->valueAt(tLast);
            for (int i = 0; i < r.size(); ++i)
                r[i] += (b[i] - a[i]) * (cycles + 1);
        }
        return toJs(r);
    }
    if (time >= tFirst)
        return toJs(value);
    const double segEnd = keys[span].time;
    const double dur = segEnd - tFirst;
    if (dur <= 0)
        return toJs(value);
    const double before = tFirst - time;
    if (type == "continue") {
        const double dt = std::max(1e-3, (keys[1].time - tFirst) * 0.01);
        Value v0 = prop->valueAt(tFirst), v1 = prop->valueAt(tFirst + dt);
        Value r = v0;
        for (int i = 0; i < r.size(); ++i)
            r[i] -= (v1[i] - v0[i]) / dt * before;
        return toJs(r);
    }
    const int cycles = int(before / dur);
    const double local = std::fmod(before, dur);
    if (type == "pingpong" && (cycles % 2 == 0))
        return toJs(prop->valueAt(tFirst + local));
    Value r = prop->valueAt(segEnd - local);
    if (type == "offset") {
        Value a = prop->valueAt(tFirst), b = prop->valueAt(segEnd);
        for (int i = 0; i < r.size(); ++i)
            r[i] -= (b[i] - a[i]) * (cycles + 1);
    }
    return toJs(r);
}

QJSValue ExprApi::valueAtTime(double t)
{
    return toJs(prop->valueAt(t));
}

double ExprApi::noise1(double x)
{
    return valueNoise(seed ^ 0x51ed270bu, x);
}

double ExprApi::random01()
{
    // splitmix64
    quint64 z = (rngState_ += 0x9E3779B97F4A7C15ull);
    z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ull;
    z = (z ^ (z >> 27)) * 0x94D049BB133111EBull;
    z ^= z >> 31;
    ++rngCounter_;
    return double(z >> 11) / double(1ull << 53);
}

void ExprApi::seedRandom(double s, bool tl)
{
    timeless = tl;
    const qint64 frame = tl || !comp ? 0 : qint64(std::floor(time * comp->fps + 1e-6));
    rngState_ = quint64(seed) * 31 + quint64(qint64(s) * 1000003) + quint64(frame) * 7777777;
}

int ExprApi::numKeys()
{
    return prop->keys.size();
}

double ExprApi::keyTime(int i)
{
    return (i >= 0 && i < prop->keys.size()) ? prop->keys[i].time : 0.0;
}

QJSValue ExprApi::keyValue(int i)
{
    return (i >= 0 && i < prop->keys.size()) ? toJs(prop->keys[i].value) : toJs(value);
}

ExpressionEngine &ExpressionEngine::instance()
{
    static ExpressionEngine e;
    return e;
}

ExpressionEngine::ExpressionEngine() : engine_(std::make_unique<QJSEngine>())
{
    engine_->installExtensions(QJSEngine::ConsoleExtension);
    api_ = new ExprApi;
    api_->engine = engine_.get();
    engine_->globalObject().setProperty("__mf", engine_->newQObject(api_));
    engine_->evaluate(kPrelude);
}

Value ExpressionEngine::evaluate(const Property &prop, const Value &pre, double time, const Layer *layer,
                                 const Composition *comp, int layerIndex)
{
    if (!prop.hasExpression())
        return pre;
    api_->prop = &prop;
    api_->layer = layer;
    api_->comp = comp;
    api_->time = time;
    api_->value = pre;
    api_->seed = hashSeed(prop.id, layer ? layer->id : 0);
    api_->seedRandom(0, false);

    QJSValue g = engine_->globalObject();
    g.setProperty("time", time);
    g.setProperty("value", api_->toJs(pre));
    g.setProperty("numKeys", int(prop.keys.size()));
    QJSValue c = engine_->newObject();
    if (comp) {
        c.setProperty("width", comp->width);
        c.setProperty("height", comp->height);
        c.setProperty("duration", comp->duration);
        c.setProperty("frameDuration", comp->frameDuration());
        c.setProperty("frameRate", comp->fps);
        c.setProperty("numLayers", int(comp->layers.size()));
        c.setProperty("name", comp->name);
    }
    g.setProperty("thisComp", c);
    QJSValue l = engine_->newObject();
    if (layer) {
        l.setProperty("index", layerIndex + 1);
        l.setProperty("name", layer->name);
        l.setProperty("inPoint", layer->inPoint);
        l.setProperty("outPoint", layer->outPoint);
        l.setProperty("startTime", layer->startTime);
        l.setProperty("width", layer->width);
        l.setProperty("height", layer->height);
        g.setProperty("index", layerIndex + 1);
        g.setProperty("inPoint", layer->inPoint);
        g.setProperty("outPoint", layer->outPoint);
        g.setProperty("startTime", layer->startTime);
        g.setProperty("width", layer->width);
        g.setProperty("height", layer->height);
    }
    g.setProperty("thisLayer", l);
    g.setProperty("thisProperty", engine_->newObject());

    // Like AE, the value of the last evaluated statement is the result.
    const QJSValue result = engine_->evaluate(prop.expression, QStringLiteral("expression"));
    if (result.isError()) {
        prop.expressionError = result.property("message").toString();
        return pre;
    }
    bool ok = false;
    Value v = fromJs(result, pre.size(), &ok);
    if (!ok) {
        prop.expressionError = QString("Expression result must be a number or array of %1 values").arg(pre.size());
        return pre;
    }
    for (double &d : v)
        if (!std::isfinite(d))
            d = 0.0;
    prop.expressionError.clear();
    return prop.clamp(v);
}

} // namespace mf
