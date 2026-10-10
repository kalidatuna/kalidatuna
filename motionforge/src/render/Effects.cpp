#include "Effects.h"

#include "core/Project.h"

#include <QPainter>
#include <algorithm>
#include <cmath>
#include <thread>

namespace mf {

// ---------------------------------------------------------------- helpers

void parallelFor(int n, const std::function<void(int, int)> &fn)
{
    const int threads = std::clamp(int(std::thread::hardware_concurrency()), 1, 16);
    if (n < 64 || threads == 1) {
        fn(0, n);
        return;
    }
    std::vector<std::thread> pool;
    const int chunk = (n + threads - 1) / threads;
    for (int t = 0; t < threads; ++t) {
        const int b = t * chunk, e = std::min(n, b + chunk);
        if (b < e)
            pool.emplace_back(fn, b, e);
    }
    for (auto &th : pool)
        th.join();
}

QImage padImage(const QImage &img, int pad)
{
    if (pad <= 0)
        return img;
    QImage out(img.width() + 2 * pad, img.height() + 2 * pad, QImage::Format_ARGB32_Premultiplied);
    out.fill(Qt::transparent);
    QPainter p(&out);
    p.setCompositionMode(QPainter::CompositionMode_Source);
    p.drawImage(pad, pad, img);
    return out;
}

static inline float clamp01(float v) { return v < 0.f ? 0.f : (v > 1.f ? 1.f : v); }

struct Px {
    float r, g, b, a;
};

static inline Px unpremul(QRgb p)
{
    const int a = qAlpha(p);
    if (a == 0)
        return {0, 0, 0, 0};
    const float inv = 1.f / a;
    return {qRed(p) * inv, qGreen(p) * inv, qBlue(p) * inv, a / 255.f};
}

static inline QRgb premul(float r, float g, float b, float a)
{
    a = clamp01(a);
    const float s = a * 255.f;
    return qRgba(int(clamp01(r) * s + 0.5f), int(clamp01(g) * s + 0.5f), int(clamp01(b) * s + 0.5f),
                 int(a * 255.f + 0.5f));
}

// Applies fn to every unpremultiplied pixel.
static void colorOp(QImage &img, const std::function<void(Px &)> &fn)
{
    const int w = img.width();
    parallelFor(img.height(), [&](int y0, int y1) {
        for (int y = y0; y < y1; ++y) {
            QRgb *row = reinterpret_cast<QRgb *>(img.scanLine(y));
            for (int x = 0; x < w; ++x) {
                if (qAlpha(row[x]) == 0)
                    continue;
                Px p = unpremul(row[x]);
                fn(p);
                row[x] = premul(p.r, p.g, p.b, p.a);
            }
        }
    });
}

static void blendWithOriginal(QImage &img, const QImage &orig, float amount)
{
    // amount: 0 keeps the effect result, 1 restores the original.
    if (amount <= 0.f)
        return;
    const int w = img.width();
    parallelFor(img.height(), [&](int y0, int y1) {
        for (int y = y0; y < y1; ++y) {
            QRgb *d = reinterpret_cast<QRgb *>(img.scanLine(y));
            const QRgb *o = reinterpret_cast<const QRgb *>(orig.constScanLine(y));
            for (int x = 0; x < w; ++x) {
                auto mix = [&](int a, int b) { return int(a + (b - a) * amount + 0.5f); };
                d[x] = qRgba(mix(qRed(d[x]), qRed(o[x])), mix(qGreen(d[x]), qGreen(o[x])),
                             mix(qBlue(d[x]), qBlue(o[x])), mix(qAlpha(d[x]), qAlpha(o[x])));
            }
        }
    });
}

// One horizontal box pass of radius r over all 4 channels.
static void boxH(const QImage &src, QImage &dst, int r, bool clampEdges)
{
    const int w = src.width();
    const int div = 2 * r + 1;
    parallelFor(src.height(), [&](int y0, int y1) {
        std::vector<int> ext((w + 2 * r) * 4);
        for (int y = y0; y < y1; ++y) {
            const uchar *s = src.constScanLine(y);
            uchar *d = dst.scanLine(y);
            for (int x = -r; x < w + r; ++x) {
                const int sx = clampEdges ? std::clamp(x, 0, w - 1) : x;
                for (int c = 0; c < 4; ++c)
                    ext[(x + r) * 4 + c] = (sx >= 0 && sx < w) ? s[sx * 4 + c] : 0;
            }
            int sum[4] = {0, 0, 0, 0};
            for (int i = 0; i < div; ++i)
                for (int c = 0; c < 4; ++c)
                    sum[c] += ext[i * 4 + c];
            for (int x = 0; x < w; ++x) {
                for (int c = 0; c < 4; ++c) {
                    d[x * 4 + c] = uchar((sum[c] + div / 2) / div);
                    if (x + 1 < w)
                        sum[c] += ext[(x + div) * 4 + c] - ext[x * 4 + c];
                }
            }
        }
    });
}

// Vertical box pass using per-column running sums (cache friendly).
static void boxV(const QImage &src, QImage &dst, int r, bool clampEdges)
{
    const int w = src.width(), h = src.height();
    const int div = 2 * r + 1;
    parallelFor(w, [&](int x0, int x1) {
        const int n = (x1 - x0) * 4;
        std::vector<int> sum(n, 0);
        auto row = [&](int y) -> const uchar * {
            if (clampEdges)
                y = std::clamp(y, 0, h - 1);
            return (y >= 0 && y < h) ? src.constScanLine(y) + x0 * 4 : nullptr;
        };
        for (int y = -r; y <= r; ++y)
            if (const uchar *s = row(y))
                for (int i = 0; i < n; ++i)
                    sum[i] += s[i];
        for (int y = 0; y < h; ++y) {
            uchar *d = dst.scanLine(y) + x0 * 4;
            for (int i = 0; i < n; ++i)
                d[i] = uchar((sum[i] + div / 2) / div);
            const uchar *add = row(y + r + 1);
            const uchar *subr = row(y - r);
            for (int i = 0; i < n; ++i)
                sum[i] += (add ? add[i] : 0) - (subr ? subr[i] : 0);
        }
    });
}

static void boxBlur(QImage &img, int rx, int ry, int iterations, bool clampEdges)
{
    if (img.isNull())
        return;
    QImage tmp(img.size(), img.format());
    for (int i = 0; i < iterations; ++i) {
        if (rx > 0) {
            boxH(img, tmp, rx, clampEdges);
            std::swap(img, tmp);
        }
        if (ry > 0) {
            boxV(img, tmp, ry, clampEdges);
            std::swap(img, tmp);
        }
    }
}

void gaussianBlur(QImage &img, double sigmaX, double sigmaY, bool clampEdges)
{
    // Three box passes approximate a Gaussian (Kovesi). Radius per pass from sigma.
    auto radius = [](double sigma) {
        if (sigma < 0.3)
            return 0;
        const double wIdeal = std::sqrt(12.0 * sigma * sigma / 3.0 + 1.0);
        return std::max(1, int(std::round((wIdeal - 1.0) / 2.0)));
    };
    const int rx = radius(sigmaX), ry = radius(sigmaY);
    if (rx == 0 && ry == 0)
        return;
    boxBlur(img, rx, ry, 3, clampEdges);
}

static Px sampleBilinear(const QImage &img, double x, double y)
{
    const int w = img.width(), h = img.height();
    x -= 0.5;
    y -= 0.5;
    const int x0 = int(std::floor(x)), y0 = int(std::floor(y));
    const float fx = float(x - x0), fy = float(y - y0);
    Px out{0, 0, 0, 0};
    for (int j = 0; j < 2; ++j)
        for (int i = 0; i < 2; ++i) {
            const int xx = x0 + i, yy = y0 + j;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h)
                continue;
            const QRgb p = reinterpret_cast<const QRgb *>(img.constScanLine(yy))[xx];
            const float wgt = (i ? fx : 1 - fx) * (j ? fy : 1 - fy);
            out.r += qRed(p) * wgt;
            out.g += qGreen(p) * wgt;
            out.b += qBlue(p) * wgt;
            out.a += qAlpha(p) * wgt;
        }
    return out;   // premultiplied, 0..255
}

static inline QRgb packPremul(const Px &p, float scale = 1.f)
{
    auto c = [&](float v) { return std::clamp(int(v * scale + 0.5f), 0, 255); };
    const int a = c(p.a);
    return qRgba(std::min(c(p.r), a), std::min(c(p.g), a), std::min(c(p.b), a), a);
}

// ---------------------------------------------------------------- params

static double num(const ParamMap &m, const char *id) { return m.value(id).value(0); }
static bool flag(const ParamMap &m, const char *id) { return m.value(id).value(0) > 0.5; }
static QPointF pt(const ParamMap &m, const char *id) { return Property::toPoint(m.value(id)); }
static QColor col(const ParamMap &m, const char *id) { return Property::toColor(m.value(id)); }

static Property P(const char *id, const char *name, double def, double mn, double mx, double stepv = 1.0)
{
    Property p(id, name, PropType::Number, {def});
    p.limits(mn, mx).step(stepv);
    return p;
}
static Property Pct(const char *id, const char *name, double def, double mn = 0, double mx = 100)
{
    Property p(id, name, PropType::Percent, {def});
    p.limits(mn, mx);
    return p;
}
static Property Ang(const char *id, const char *name, double def)
{
    return Property(id, name, PropType::Angle, {def});
}
static Property Col(const char *id, const char *name, QColor c)
{
    return Property(id, name, PropType::Color, Property::fromColor(c));
}
static Property Chk(const char *id, const char *name, bool on)
{
    return Property(id, name, PropType::Checkbox, {on ? 1.0 : 0.0});
}
static Property Pt(const char *id, const char *name, QPointF p)
{
    return Property(id, name, PropType::Point, Property::fromPoint(p));
}
static Property Ch(const char *id, const char *name, QStringList choices, int def = 0)
{
    Property p(id, name, PropType::Choice, {double(def)});
    p.withChoices(std::move(choices));
    p.limits(0, p.choices.size() - 1);
    return p;
}

// ---------------------------------------------------------------- effects

static void applyGaussian(QImage &img, const ParamMap &m, const EffectContext &c)
{
    const double sigma = num(m, "blurriness") * 0.5 * c.pixelScale;
    const int dims = int(num(m, "dimensions"));
    gaussianBlur(img, dims == 2 ? 0 : sigma, dims == 1 ? 0 : sigma, flag(m, "repeatEdge"));
}

static void applyFastBox(QImage &img, const ParamMap &m, const EffectContext &c)
{
    const int r = int(std::round(num(m, "radius") * c.pixelScale));
    const int dims = int(num(m, "dimensions"));
    if (r > 0)
        boxBlur(img, dims == 2 ? 0 : r, dims == 1 ? 0 : r, int(num(m, "iterations")), flag(m, "repeatEdge"));
}

static void applyDirectional(QImage &img, const ParamMap &m, const EffectContext &c)
{
    const double len = num(m, "length") * c.pixelScale;
    if (len < 0.5)
        return;
    const double a = qDegreesToRadians(num(m, "direction"));
    const double dx = std::sin(a), dy = -std::cos(a);
    const int n = std::clamp(int(len), 2, 96);
    const QImage src = img.copy();
    const int w = img.width();
    parallelFor(img.height(), [&](int y0, int y1) {
        for (int y = y0; y < y1; ++y) {
            QRgb *d = reinterpret_cast<QRgb *>(img.scanLine(y));
            for (int x = 0; x < w; ++x) {
                Px acc{0, 0, 0, 0};
                for (int i = 0; i < n; ++i) {
                    const double o = (double(i) / (n - 1) - 0.5) * len;
                    const Px s = sampleBilinear(src, x + 0.5 + dx * o, y + 0.5 + dy * o);
                    acc.r += s.r; acc.g += s.g; acc.b += s.b; acc.a += s.a;
                }
                d[x] = packPremul(acc, 1.f / n);
            }
        }
    });
}

static void applyRadial(QImage &img, const ParamMap &m, const EffectContext &c)
{
    const double amount = num(m, "amount");
    if (amount <= 0)
        return;
    const QPointF center = c.toImage(pt(m, "center"));
    const bool zoom = int(num(m, "type")) == 1;
    const int n = int(num(m, "quality")) == 0 ? 12 : 32;
    const QImage src = img.copy();
    const int w = img.width();
    parallelFor(img.height(), [&](int y0, int y1) {
        for (int y = y0; y < y1; ++y) {
            QRgb *d = reinterpret_cast<QRgb *>(img.scanLine(y));
            for (int x = 0; x < w; ++x) {
                const double px = x + 0.5 - center.x(), py = y + 0.5 - center.y();
                Px acc{0, 0, 0, 0};
                for (int i = 0; i < n; ++i) {
                    const double k = double(i) / (n - 1) - 0.5;
                    double sx, sy;
                    if (zoom) {
                        const double s = 1.0 - k * amount / 100.0;
                        sx = px * s;
                        sy = py * s;
                    } else {
                        const double ang = qDegreesToRadians(k * amount);
                        sx = px * std::cos(ang) - py * std::sin(ang);
                        sy = px * std::sin(ang) + py * std::cos(ang);
                    }
                    const Px s = sampleBilinear(src, sx + center.x(), sy + center.y());
                    acc.r += s.r; acc.g += s.g; acc.b += s.b; acc.a += s.a;
                }
                d[x] = packPremul(acc, 1.f / n);
            }
        }
    });
}

static void applyGlow(QImage &img, const ParamMap &m, const EffectContext &c)
{
    const float threshold = float(num(m, "threshold") / 100.0);
    const float intensity = float(num(m, "intensity"));
    const bool custom = int(num(m, "colors")) == 1;
    const QColor gc = col(m, "color");
    const bool screen = int(num(m, "operation")) == 1;
    QImage bright = img.copy();
    const int w = img.width();
    parallelFor(bright.height(), [&](int y0, int y1) {
        for (int y = y0; y < y1; ++y) {
            QRgb *row = reinterpret_cast<QRgb *>(bright.scanLine(y));
            for (int x = 0; x < w; ++x) {
                const Px p = unpremul(row[x]);
                const float lum = 0.2126f * p.r + 0.7152f * p.g + 0.0722f * p.b;
                const float k = clamp01((lum - threshold) / 0.1f + 0.5f);
                if (custom)
                    row[x] = premul(gc.redF(), gc.greenF(), gc.blueF(), p.a * k * lum);
                else
                    row[x] = premul(p.r, p.g, p.b, p.a * k);
            }
        }
    });
    const double sigma = num(m, "radius") * 0.5 * c.pixelScale;
    gaussianBlur(bright, sigma, sigma);
    parallelFor(img.height(), [&](int y0, int y1) {
        for (int y = y0; y < y1; ++y) {
            QRgb *d = reinterpret_cast<QRgb *>(img.scanLine(y));
            const QRgb *g = reinterpret_cast<const QRgb *>(bright.constScanLine(y));
            for (int x = 0; x < w; ++x) {
                float out[4];
                const float src[4] = {float(qRed(d[x])), float(qGreen(d[x])), float(qBlue(d[x])), float(qAlpha(d[x]))};
                const float add[4] = {qRed(g[x]) * intensity, qGreen(g[x]) * intensity, qBlue(g[x]) * intensity,
                                      qAlpha(g[x]) * intensity};
                for (int i = 0; i < 4; ++i)
                    out[i] = screen ? 255.f - (255.f - src[i]) * (255.f - std::min(add[i], 255.f)) / 255.f
                                    : src[i] + add[i];
                const int a = std::clamp(int(out[3] + 0.5f), 0, 255);
                d[x] = qRgba(std::clamp(int(out[0] + 0.5f), 0, a), std::clamp(int(out[1] + 0.5f), 0, a),
                             std::clamp(int(out[2] + 0.5f), 0, a), a);
            }
        }
    });
}

static void applyBrightnessContrast(QImage &img, const ParamMap &m, const EffectContext &)
{
    const float b = float(num(m, "brightness") / 255.0);
    const float ct = float(num(m, "contrast") / 100.0);
    const float k = ct >= 0 ? 1.f / std::max(0.01f, 1.f - ct * 0.99f) : 1.f + ct;
    colorOp(img, [&](Px &p) {
        p.r = (p.r + b - 0.5f) * k + 0.5f;
        p.g = (p.g + b - 0.5f) * k + 0.5f;
        p.b = (p.b + b - 0.5f) * k + 0.5f;
    });
}

static void rgbToHsl(float r, float g, float b, float &h, float &s, float &l)
{
    const float mx = std::max({r, g, b}), mn = std::min({r, g, b});
    l = (mx + mn) * 0.5f;
    if (mx - mn < 1e-6f) {
        h = s = 0;
        return;
    }
    const float d = mx - mn;
    s = l > 0.5f ? d / (2.f - mx - mn) : d / (mx + mn);
    if (mx == r)
        h = (g - b) / d + (g < b ? 6.f : 0.f);
    else if (mx == g)
        h = (b - r) / d + 2.f;
    else
        h = (r - g) / d + 4.f;
    h /= 6.f;
}

static float hue2rgb(float p, float q, float t)
{
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1.f / 6) return p + (q - p) * 6 * t;
    if (t < 0.5f) return q;
    if (t < 2.f / 3) return p + (q - p) * (2.f / 3 - t) * 6;
    return p;
}

static void hslToRgb(float h, float s, float l, float &r, float &g, float &b)
{
    if (s <= 0) {
        r = g = b = l;
        return;
    }
    const float q = l < 0.5f ? l * (1 + s) : l + s - l * s;
    const float p = 2 * l - q;
    r = hue2rgb(p, q, h + 1.f / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1.f / 3);
}

static void applyHueSat(QImage &img, const ParamMap &m, const EffectContext &)
{
    const float dh = float(num(m, "hue") / 360.0);
    const float ds = float(num(m, "saturation") / 100.0);
    const float dl = float(num(m, "lightness") / 100.0);
    const bool colorize = flag(m, "colorize");
    const float ch = float(num(m, "colorizeHue") / 360.0);
    const float cs = float(num(m, "colorizeSat") / 100.0);
    colorOp(img, [&](Px &p) {
        float h, s, l;
        rgbToHsl(p.r, p.g, p.b, h, s, l);
        if (colorize) {
            h = ch;
            s = cs;
        } else {
            h = std::fmod(h + dh + 1.f, 1.f);
            s = ds >= 0 ? s + (1 - s) * ds * s : s * (1 + ds);
        }
        l = dl >= 0 ? l + (1 - l) * dl : l * (1 + dl);
        hslToRgb(h, clamp01(s), clamp01(l), p.r, p.g, p.b);
    });
}

static void applyTint(QImage &img, const ParamMap &m, const EffectContext &)
{
    const QColor b = col(m, "black"), w = col(m, "white");
    const float amt = float(num(m, "amount") / 100.0);
    colorOp(img, [&](Px &p) {
        const float lum = 0.299f * p.r + 0.587f * p.g + 0.114f * p.b;
        p.r += (b.redF() + (w.redF() - b.redF()) * lum - p.r) * amt;
        p.g += (b.greenF() + (w.greenF() - b.greenF()) * lum - p.g) * amt;
        p.b += (b.blueF() + (w.blueF() - b.blueF()) * lum - p.b) * amt;
    });
}

static void applyFill(QImage &img, const ParamMap &m, const EffectContext &)
{
    const QColor c = col(m, "color");
    const float op = float(num(m, "opacity") / 100.0);
    colorOp(img, [&](Px &p) {
        p.r += (c.redF() - p.r) * op;
        p.g += (c.greenF() - p.g) * op;
        p.b += (c.blueF() - p.b) * op;
    });
}

static void applyInvert(QImage &img, const ParamMap &m, const EffectContext &)
{
    const float blend = float(num(m, "blend") / 100.0);
    const int channel = int(num(m, "channel"));
    colorOp(img, [&](Px &p) {
        Px o = p;
        if (channel == 0) {
            o.r = 1 - p.r; o.g = 1 - p.g; o.b = 1 - p.b;
        } else if (channel == 1) {
            o.r = 1 - p.r;
        } else if (channel == 2) {
            o.g = 1 - p.g;
        } else if (channel == 3) {
            o.b = 1 - p.b;
        } else {
            o.a = 1 - p.a;
        }
        p.r = o.r + (p.r - o.r) * blend;
        p.g = o.g + (p.g - o.g) * blend;
        p.b = o.b + (p.b - o.b) * blend;
        p.a = o.a + (p.a - o.a) * blend;
    });
}

static void applyExposure(QImage &img, const ParamMap &m, const EffectContext &)
{
    const float k = std::pow(2.f, float(num(m, "exposure")));
    const float off = float(num(m, "offset"));
    const float g = 1.f / std::max(0.01f, float(num(m, "gamma")));
    colorOp(img, [&](Px &p) {
        p.r = std::pow(std::max(0.f, p.r * k + off), g);
        p.g = std::pow(std::max(0.f, p.g * k + off), g);
        p.b = std::pow(std::max(0.f, p.b * k + off), g);
    });
}

static void applyLevels(QImage &img, const ParamMap &m, const EffectContext &)
{
    const float ib = float(num(m, "inBlack") / 255.0), iw = float(num(m, "inWhite") / 255.0);
    const float ob = float(num(m, "outBlack") / 255.0), ow = float(num(m, "outWhite") / 255.0);
    const float g = 1.f / std::max(0.01f, float(num(m, "gamma")));
    float lut[256];
    for (int i = 0; i < 256; ++i) {
        const float v = clamp01((i / 255.f - ib) / std::max(1e-4f, iw - ib));
        lut[i] = ob + std::pow(v, g) * (ow - ob);
    }
    colorOp(img, [&](Px &p) {
        p.r = lut[std::clamp(int(p.r * 255.f + 0.5f), 0, 255)];
        p.g = lut[std::clamp(int(p.g * 255.f + 0.5f), 0, 255)];
        p.b = lut[std::clamp(int(p.b * 255.f + 0.5f), 0, 255)];
    });
}

static void applyDropShadow(QImage &img, const ParamMap &m, const EffectContext &c)
{
    const QColor sc = col(m, "color");
    const float op = float(num(m, "opacity") / 100.0);
    const double a = qDegreesToRadians(num(m, "direction"));
    const double dist = num(m, "distance") * c.pixelScale;
    QImage shadow(img.size(), QImage::Format_ARGB32_Premultiplied);
    shadow.fill(Qt::transparent);
    {
        QPainter p(&shadow);
        p.drawImage(QPointF(std::sin(a) * dist, -std::cos(a) * dist), img);
    }
    const int w = img.width();
    parallelFor(shadow.height(), [&](int y0, int y1) {
        for (int y = y0; y < y1; ++y) {
            QRgb *row = reinterpret_cast<QRgb *>(shadow.scanLine(y));
            for (int x = 0; x < w; ++x)
                row[x] = premul(sc.redF(), sc.greenF(), sc.blueF(), qAlpha(row[x]) / 255.f * op);
        }
    });
    const double sigma = num(m, "softness") * 0.5 * c.pixelScale;
    gaussianBlur(shadow, sigma, sigma);
    if (flag(m, "shadowOnly")) {
        img = shadow;
        return;
    }
    QPainter p(&shadow);
    p.drawImage(0, 0, img);
    p.end();
    img = shadow;
}

static void applyRamp(QImage &img, const ParamMap &m, const EffectContext &c)
{
    const QPointF s = c.toImage(pt(m, "start")), e = c.toImage(pt(m, "end"));
    const QColor cs = col(m, "startColor"), ce = col(m, "endColor");
    const bool radial = int(num(m, "shape")) == 1;
    const float blend = float(num(m, "blend") / 100.0);
    const QImage orig = img.copy();
    const double dx = e.x() - s.x(), dy = e.y() - s.y();
    const double len2 = std::max(1e-6, dx * dx + dy * dy);
    const int w = img.width();
    parallelFor(img.height(), [&](int y0, int y1) {
        for (int y = y0; y < y1; ++y) {
            QRgb *row = reinterpret_cast<QRgb *>(img.scanLine(y));
            for (int x = 0; x < w; ++x) {
                const double px = x + 0.5 - s.x(), py = y + 0.5 - s.y();
                const float t = float(radial ? std::sqrt((px * px + py * py) / len2)
                                             : std::clamp((px * dx + py * dy) / len2, 0.0, 1.0));
                const float u = clamp01(t);
                row[x] = premul(cs.redF() + (ce.redF() - cs.redF()) * u, cs.greenF() + (ce.greenF() - cs.greenF()) * u,
                                cs.blueF() + (ce.blueF() - cs.blueF()) * u, 1.f);
            }
        }
    });
    blendWithOriginal(img, orig, blend);
}

static void applyColorKey(QImage &img, const ParamMap &m, const EffectContext &)
{
    const QColor k = col(m, "keyColor");
    const float tol = float(num(m, "tolerance") / 255.0);
    const float feather = float(std::max(1e-3, num(m, "feather") / 255.0));
    const float kr = k.redF(), kg = k.greenF(), kb = k.blueF();
    colorOp(img, [&](Px &p) {
        // Distance in a chroma-weighted space keeps shadows on the screen keyable.
        const float d = std::sqrt((p.r - kr) * (p.r - kr) + (p.g - kg) * (p.g - kg) + (p.b - kb) * (p.b - kb));
        const float keep = clamp01((d - tol) / feather);
        p.a *= keep;
        if (keep < 1.f) {
            // Basic spill suppression on the key's dominant channel.
            if (kg >= kr && kg >= kb)
                p.g = std::min(p.g, std::max(p.r, p.b));
            else if (kb >= kr)
                p.b = std::min(p.b, std::max(p.r, p.g));
        }
    });
}

static void applyNoise(QImage &img, const ParamMap &m, const EffectContext &c)
{
    const float amt = float(num(m, "amount") / 100.0);
    const bool color = flag(m, "colorNoise");
    const quint32 frameSeed = c.seed * 2654435761u + quint32(std::lround(c.time * 1000.0)) * 40503u;
    const int w = img.width();
    parallelFor(img.height(), [&](int y0, int y1) {
        for (int y = y0; y < y1; ++y) {
            QRgb *row = reinterpret_cast<QRgb *>(img.scanLine(y));
            quint32 st = frameSeed ^ (quint32(y) * 0x9E3779B9u);
            auto rnd = [&]() {
                st ^= st << 13; st ^= st >> 17; st ^= st << 5;
                return (st & 0xFFFFFF) / float(0xFFFFFF) - 0.5f;
            };
            for (int x = 0; x < w; ++x) {
                if (qAlpha(row[x]) == 0)
                    continue;
                Px p = unpremul(row[x]);
                const float n = rnd() * amt;
                p.r += color ? rnd() * amt : n;
                p.g += color ? rnd() * amt : n;
                p.b += color ? rnd() * amt : n;
                row[x] = premul(p.r, p.g, p.b, p.a);
            }
        }
    });
}

static void applyVignette(QImage &img, const ParamMap &m, const EffectContext &c)
{
    const float amount = float(num(m, "amount") / 100.0);
    const float mid = float(num(m, "midpoint") / 100.0);
    const float feather = std::max(0.01f, float(num(m, "feather") / 100.0));
    const QPointF ctr = c.toImage(c.layerRect.center());
    const double rx = c.layerRect.width() * 0.5 * c.pixelScale, ry = c.layerRect.height() * 0.5 * c.pixelScale;
    const int w = img.width();
    parallelFor(img.height(), [&](int y0, int y1) {
        for (int y = y0; y < y1; ++y) {
            QRgb *row = reinterpret_cast<QRgb *>(img.scanLine(y));
            for (int x = 0; x < w; ++x) {
                if (qAlpha(row[x]) == 0)
                    continue;
                const double nx = (x + 0.5 - ctr.x()) / rx, ny = (y + 0.5 - ctr.y()) / ry;
                const float d = float(std::sqrt(nx * nx + ny * ny) / 1.4142);
                const float k = clamp01((d - mid) / feather + 0.5f);
                Px p = unpremul(row[x]);
                const float f = amount >= 0 ? 1.f - k * amount : 1.f;
                const float add = amount < 0 ? -amount * k : 0.f;
                p.r = p.r * f + add;
                p.g = p.g * f + add;
                p.b = p.b * f + add;
                row[x] = premul(p.r, p.g, p.b, p.a);
            }
        }
    });
}

static int motionTilePadding(const ParamMap &m, double s, const QRectF &rect)
{
    const double ow = std::max(0.0, num(m, "outputWidth") - 100.0) / 200.0 * rect.width();
    const double oh = std::max(0.0, num(m, "outputHeight") - 100.0) / 200.0 * rect.height();
    return int(std::ceil(std::max(ow, oh) * s));
}

static void applyMotionTile(QImage &img, const ParamMap &m, const EffectContext &c)
{
    const QImage src = img.copy();
    const QRectF r = c.layerRect;
    const QPointF center = pt(m, "tileCenter");
    const double tw = std::max(1.0, r.width() * num(m, "tileWidth") / 100.0);
    const double th = std::max(1.0, r.height() * num(m, "tileHeight") / 100.0);
    const double halfOutW = r.width() * num(m, "outputWidth") / 200.0;
    const double halfOutH = r.height() * num(m, "outputHeight") / 200.0;
    const bool mirror = flag(m, "mirror");
    const int w = img.width();
    auto wrap = [&](double v, bool mir) {
        const double idx = std::floor(v);
        double f = v - idx;
        if (mir && (qint64(idx) & 1))
            f = 1.0 - f;
        return f;
    };
    parallelFor(img.height(), [&](int y0, int y1) {
        for (int y = y0; y < y1; ++y) {
            QRgb *row = reinterpret_cast<QRgb *>(img.scanLine(y));
            for (int x = 0; x < w; ++x) {
                const double lx = c.origin.x() + (x + 0.5) / c.pixelScale;
                const double ly = c.origin.y() + (y + 0.5) / c.pixelScale;
                if (std::abs(lx - r.center().x()) > halfOutW || std::abs(ly - r.center().y()) > halfOutH) {
                    row[x] = 0;
                    continue;
                }
                const double fu = wrap((lx - center.x()) / tw + 0.5, mirror);
                const double fv = wrap((ly - center.y()) / th + 0.5, mirror);
                const QPointF srcPt = c.toImage(QPointF(r.left() + fu * r.width(), r.top() + fv * r.height()));
                row[x] = packPremul(sampleBilinear(src, srcPt.x(), srcPt.y()));
            }
        }
    });
}

static void applySharpen(QImage &img, const ParamMap &m, const EffectContext &c)
{
    const float amt = float(num(m, "amount") / 50.0);
    QImage blur = img.copy();
    gaussianBlur(blur, 1.0 * std::max(0.5, c.pixelScale), 1.0 * std::max(0.5, c.pixelScale), true);
    const int w = img.width();
    parallelFor(img.height(), [&](int y0, int y1) {
        for (int y = y0; y < y1; ++y) {
            QRgb *d = reinterpret_cast<QRgb *>(img.scanLine(y));
            const QRgb *b = reinterpret_cast<const QRgb *>(blur.constScanLine(y));
            for (int x = 0; x < w; ++x) {
                const int a = qAlpha(d[x]);
                auto ch = [&](int o, int bl) { return std::clamp(int(o + (o - bl) * amt), 0, a); };
                d[x] = qRgba(ch(qRed(d[x]), qRed(b[x])), ch(qGreen(d[x]), qGreen(b[x])), ch(qBlue(d[x]), qBlue(b[x])), a);
            }
        }
    });
}

static void applyRgbSplit(QImage &img, const ParamMap &m, const EffectContext &c)
{
    const double dist = num(m, "distance") * c.pixelScale;
    if (dist <= 0)
        return;
    const double a = qDegreesToRadians(num(m, "angle"));
    const double dx = std::cos(a) * dist, dy = std::sin(a) * dist;
    const QImage src = img.copy();
    const int w = img.width();
    parallelFor(img.height(), [&](int y0, int y1) {
        for (int y = y0; y < y1; ++y) {
            QRgb *row = reinterpret_cast<QRgb *>(img.scanLine(y));
            for (int x = 0; x < w; ++x) {
                const Px r = sampleBilinear(src, x + 0.5 - dx, y + 0.5 - dy);
                const Px g = sampleBilinear(src, x + 0.5, y + 0.5);
                const Px b = sampleBilinear(src, x + 0.5 + dx, y + 0.5 + dy);
                const float al = std::max({r.a, g.a, b.a});
                row[x] = packPremul({r.r, g.g, b.b, al});
            }
        }
    });
}

static void applyStrobe(QImage &img, const ParamMap &m, const EffectContext &c)
{
    const double period = std::max(0.01, num(m, "period"));
    const double dur = num(m, "duration");
    if (std::fmod(c.time, period) >= dur)
        return;
    const QColor sc = col(m, "color");
    const float blend = float(num(m, "blend") / 100.0);
    const bool transparent = int(num(m, "type")) == 1;
    colorOp(img, [&](Px &p) {
        if (transparent) {
            p.a = 0;
            return;
        }
        p.r += (sc.redF() - p.r) * (1 - blend);
        p.g += (sc.greenF() - p.g) * (1 - blend);
        p.b += (sc.blueF() - p.b) * (1 - blend);
    });
}

// ---------------------------------------------------------------- registry

static int blurPad(double sigma) { return int(std::ceil(sigma * 3.0)); }

static std::deque<EffectDef> &registry()
{
    static std::deque<EffectDef> defs = [] {
        std::deque<EffectDef> d;
        const QStringList dims{"Horizontal and Vertical", "Horizontal", "Vertical"};
        d.push_back({"mf.gaussianBlur", "Gaussian Blur", "Blur & Sharpen",
                     [dims](const QRectF &) {
                         return std::vector<Property>{P("blurriness", "Blurriness", 10, 0, 2000, 0.5),
                                                      Ch("dimensions", "Blur Dimensions", dims),
                                                      Chk("repeatEdge", "Repeat Edge Pixels", false)};
                     },
                     [](const ParamMap &m, double s, const QRectF &) {
                         return flag(m, "repeatEdge") ? 0 : blurPad(num(m, "blurriness") * 0.5 * s);
                     },
                     applyGaussian});
        d.push_back({"mf.fastBoxBlur", "Fast Box Blur", "Blur & Sharpen",
                     [dims](const QRectF &) {
                         return std::vector<Property>{P("radius", "Blur Radius", 5, 0, 1000, 0.5),
                                                      P("iterations", "Iterations", 3, 1, 5, 0.05),
                                                      Ch("dimensions", "Blur Dimensions", dims),
                                                      Chk("repeatEdge", "Repeat Edge Pixels", false)};
                     },
                     [](const ParamMap &m, double s, const QRectF &) {
                         return flag(m, "repeatEdge") ? 0 : int(std::ceil(num(m, "radius") * num(m, "iterations") * s));
                     },
                     applyFastBox});
        d.push_back({"mf.directionalBlur", "Directional Blur", "Blur & Sharpen",
                     [](const QRectF &) {
                         return std::vector<Property>{Ang("direction", "Direction", 0),
                                                      P("length", "Blur Length", 10, 0, 1000, 0.5)};
                     },
                     [](const ParamMap &m, double s, const QRectF &) { return int(std::ceil(num(m, "length") * 0.5 * s)); },
                     applyDirectional});
        d.push_back({"mf.radialBlur", "Radial Blur", "Blur & Sharpen",
                     [](const QRectF &r) {
                         return std::vector<Property>{P("amount", "Amount", 10, 0, 360, 0.5),
                                                      Pt("center", "Center", r.center()),
                                                      Ch("type", "Type", {"Spin", "Zoom"}, 1),
                                                      Ch("quality", "Antialiasing (Best Quality)", {"Low", "High"}, 1)};
                     },
                     nullptr, applyRadial});
        d.push_back({"mf.sharpen", "Sharpen", "Blur & Sharpen",
                     [](const QRectF &) { return std::vector<Property>{P("amount", "Sharpen Amount", 20, 0, 500)}; },
                     nullptr, applySharpen});
        d.push_back({"mf.glow", "Glow", "Stylize",
                     [](const QRectF &) {
                         return std::vector<Property>{Pct("threshold", "Glow Threshold", 60),
                                                      P("radius", "Glow Radius", 10, 0, 1000, 0.5),
                                                      P("intensity", "Glow Intensity", 1, 0, 20, 0.02),
                                                      Ch("operation", "Glow Operation", {"Add", "Screen"}),
                                                      Ch("colors", "Glow Colors", {"Original Colors", "Custom Color"}),
                                                      Col("color", "Glow Color", QColor(255, 180, 60))};
                     },
                     [](const ParamMap &m, double s, const QRectF &) { return blurPad(num(m, "radius") * 0.5 * s); }, applyGlow});
        d.push_back({"mf.brightnessContrast", "Brightness & Contrast", "Color Correction",
                     [](const QRectF &) {
                         return std::vector<Property>{P("brightness", "Brightness", 0, -150, 150),
                                                      P("contrast", "Contrast", 0, -100, 100)};
                     },
                     nullptr, applyBrightnessContrast});
        d.push_back({"mf.hueSaturation", "Hue/Saturation", "Color Correction",
                     [](const QRectF &) {
                         Property cs = P("colorizeSat", "Colorize Saturation", 25, 0, 100);
                         return std::vector<Property>{Ang("hue", "Master Hue", 0),
                                                      P("saturation", "Master Saturation", 0, -100, 100),
                                                      P("lightness", "Master Lightness", 0, -100, 100),
                                                      Chk("colorize", "Colorize", false), Ang("colorizeHue", "Colorize Hue", 0),
                                                      cs};
                     },
                     nullptr, applyHueSat});
        d.push_back({"mf.tint", "Tint", "Color Correction",
                     [](const QRectF &) {
                         return std::vector<Property>{Col("black", "Map Black To", Qt::black),
                                                      Col("white", "Map White To", Qt::white),
                                                      Pct("amount", "Amount to Tint", 100)};
                     },
                     nullptr, applyTint});
        d.push_back({"mf.exposure", "Exposure", "Color Correction",
                     [](const QRectF &) {
                         return std::vector<Property>{P("exposure", "Exposure", 0, -20, 20, 0.01),
                                                      P("offset", "Offset", 0, -2, 2, 0.001),
                                                      P("gamma", "Gamma Correction", 1, 0.1, 10, 0.01)};
                     },
                     nullptr, applyExposure});
        d.push_back({"mf.levels", "Levels", "Color Correction",
                     [](const QRectF &) {
                         return std::vector<Property>{P("inBlack", "Input Black", 0, 0, 255),
                                                      P("inWhite", "Input White", 255, 0, 255),
                                                      P("gamma", "Gamma", 1, 0.1, 10, 0.01),
                                                      P("outBlack", "Output Black", 0, 0, 255),
                                                      P("outWhite", "Output White", 255, 0, 255)};
                     },
                     nullptr, applyLevels});
        d.push_back({"mf.fill", "Fill", "Generate",
                     [](const QRectF &) {
                         return std::vector<Property>{Col("color", "Color", QColor(255, 0, 0)),
                                                      Pct("opacity", "Opacity", 100)};
                     },
                     nullptr, applyFill});
        d.push_back({"mf.gradientRamp", "Gradient Ramp", "Generate",
                     [](const QRectF &r) {
                         return std::vector<Property>{Pt("start", "Start of Ramp", QPointF(r.center().x(), r.top())),
                                                      Col("startColor", "Start Color", Qt::black),
                                                      Pt("end", "End of Ramp", QPointF(r.center().x(), r.bottom())),
                                                      Col("endColor", "End Color", Qt::white),
                                                      Ch("shape", "Ramp Shape", {"Linear Ramp", "Radial Ramp"}),
                                                      Pct("blend", "Blend With Original", 0)};
                     },
                     nullptr, applyRamp});
        d.push_back({"mf.invert", "Invert", "Channel",
                     [](const QRectF &) {
                         return std::vector<Property>{Ch("channel", "Channel", {"RGB", "Red", "Green", "Blue", "Alpha"}),
                                                      Pct("blend", "Blend With Original", 0)};
                     },
                     nullptr, applyInvert});
        d.push_back({"mf.colorKey", "Color Key", "Keying",
                     [](const QRectF &) {
                         return std::vector<Property>{Col("keyColor", "Key Color", QColor(0, 255, 0)),
                                                      P("tolerance", "Color Tolerance", 80, 0, 255),
                                                      P("feather", "Edge Feather", 40, 0, 255)};
                     },
                     nullptr, applyColorKey});
        d.push_back({"mf.dropShadow", "Drop Shadow", "Perspective",
                     [](const QRectF &) {
                         return std::vector<Property>{Col("color", "Shadow Color", Qt::black),
                                                      Pct("opacity", "Opacity", 50), Ang("direction", "Direction", 135),
                                                      P("distance", "Distance", 5, 0, 4000, 0.5),
                                                      P("softness", "Softness", 0, 0, 1000, 0.5),
                                                      Chk("shadowOnly", "Shadow Only", false)};
                     },
                     [](const ParamMap &m, double s, const QRectF &) {
                         return int(std::ceil((num(m, "distance") + num(m, "softness") * 1.5) * s)) + 1;
                     },
                     applyDropShadow});
        d.push_back({"mf.noise", "Noise", "Noise & Grain",
                     [](const QRectF &) {
                         return std::vector<Property>{Pct("amount", "Amount of Noise", 10),
                                                      Chk("colorNoise", "Use Color Noise", true)};
                     },
                     nullptr, applyNoise});
        d.push_back({"mf.vignette", "Vignette", "Stylize",
                     [](const QRectF &) {
                         return std::vector<Property>{P("amount", "Amount", 50, -100, 100),
                                                      Pct("midpoint", "Midpoint", 50), Pct("feather", "Feather", 50)};
                     },
                     nullptr, applyVignette});
        d.push_back({"mf.motionTile", "Motion Tile", "Stylize",
                     [](const QRectF &r) {
                         return std::vector<Property>{Pt("tileCenter", "Tile Center", r.center()),
                                                      Pct("tileWidth", "Tile Width", 100, 1, 1000),
                                                      Pct("tileHeight", "Tile Height", 100, 1, 1000),
                                                      Pct("outputWidth", "Output Width", 100, 1, 1000),
                                                      Pct("outputHeight", "Output Height", 100, 1, 1000),
                                                      Chk("mirror", "Mirror Edges", false)};
                     },
                     motionTilePadding, applyMotionTile});
        d.push_back({"mf.rgbSplit", "RGB Split", "Stylize",
                     [](const QRectF &) {
                         return std::vector<Property>{P("distance", "Distance", 8, 0, 1000, 0.25),
                                                      Ang("angle", "Angle", 0)};
                     },
                     [](const ParamMap &m, double s, const QRectF &) { return int(std::ceil(num(m, "distance") * s)) + 1; },
                     applyRgbSplit});
        d.push_back({"mf.strobe", "Strobe Light", "Stylize",
                     [](const QRectF &) {
                         return std::vector<Property>{Col("color", "Strobe Color", Qt::white),
                                                      Pct("blend", "Blend With Original", 0),
                                                      P("duration", "Strobe Duration (secs)", 0.05, 0, 100, 0.01),
                                                      P("period", "Strobe Period (secs)", 0.2, 0.01, 100, 0.01),
                                                      Ch("type", "Strobe", {"Operates On Color Only", "Makes Layer Transparent"})};
                     },
                     nullptr, applyStrobe});
        return d;
    }();
    return defs;
}

const std::deque<EffectDef> &EffectRegistry::all()
{
    return registry();
}

void EffectRegistry::registerEffect(EffectDef def)
{
    for (auto &d : registry())
        if (d.id == def.id) {
            d = std::move(def);
            return;
        }
    registry().push_back(std::move(def));
}

const EffectDef *EffectRegistry::find(const QString &id)
{
    for (const auto &d : all())
        if (d.id == id)
            return &d;
    return nullptr;
}

std::unique_ptr<Effect> EffectRegistry::create(const QString &id, int uid, const QRectF &layerRect)
{
    const EffectDef *def = find(id);
    if (!def)
        return nullptr;
    auto e = std::make_unique<Effect>();
    e->uid = uid;
    e->typeId = id;
    e->name = def->name;
    e->params = def->makeParams(layerRect);
    return e;
}

QStringList EffectRegistry::categories()
{
    QStringList c;
    for (const auto &d : all())
        if (!c.contains(d.category))
            c << d.category;
    c.sort();
    return c;
}

void installEffectFactory()
{
    Project::effectFactory = [](const QString &id) {
        return EffectRegistry::create(id, 0, QRectF(0, 0, 1920, 1080));
    };
}

} // namespace mf
