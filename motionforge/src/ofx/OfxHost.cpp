// OpenFX host implementation.
//
// Coordinates: each effect sees its layer as the OFX "project". Canonical x runs right from the
// layer's left edge and canonical y runs *up* from its bottom edge (OFX is y-up). Point parameters
// are stored in layer coordinates (like built-in effects) and converted when a plugin reads them.
// Time is in frames, as most hosts do.

#include "OfxHost.h"

#include "core/Project.h"
#include "render/Effects.h"

#include "ofxCore.h"
#include "ofxGPURender.h"
#include "ofxParametricParam.h"
#include "ofxImageEffect.h"
#include "ofxMemory.h"
#include "ofxMessage.h"
#include "ofxMultiThread.h"
#include "ofxOld.h"
#include "ofxParam.h"
#include "ofxProgress.h"
#include "ofxProperty.h"
#include "ofxTimeLine.h"

#include <QDir>
#include <QDirIterator>
#include <QFileInfo>
#include <QImage>
#include <QStandardPaths>

#include <array>
#include <atomic>
#include <cfloat>
#include <climits>
#include <cmath>
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <csetjmp>
#include <csignal>
#include <dlfcn.h>
#include <map>
#include <mutex>
#include <string>
#include <thread>

namespace mf::ofx {

// ============================================================ property sets

namespace {

constexpr quint32 kPropMagic = 0x4f465850;   // "OFXP"

struct PropVal {
    char type = 'i';   // i int, d double, s string, p pointer
    std::vector<int> i;
    std::vector<double> d;
    std::vector<std::string> s;
    std::vector<void *> p;
    int dim() const
    {
        switch (type) {
        case 'i': return int(i.size());
        case 'd': return int(d.size());
        case 's': return int(s.size());
        default: return int(p.size());
        }
    }
};

struct PropSet {
    quint32 magic = kPropMagic;
    std::map<std::string, PropVal> props;
    void *owner = nullptr;

    PropVal &slot(const char *name, char type)
    {
        PropVal &v = props[name];
        if (v.dim() == 0)
            v.type = type;
        return v;
    }
    void setInts(const char *n, std::vector<int> v) { auto &pv = props[n]; pv = {}; pv.type = 'i'; pv.i = std::move(v); }
    void setDoubles(const char *n, std::vector<double> v) { auto &pv = props[n]; pv = {}; pv.type = 'd'; pv.d = std::move(v); }
    void setStrings(const char *n, std::vector<std::string> v) { auto &pv = props[n]; pv = {}; pv.type = 's'; pv.s = std::move(v); }
    void setInt(const char *n, int v) { setInts(n, {v}); }
    void setDouble(const char *n, double v) { setDoubles(n, {v}); }
    void setString(const char *n, const std::string &v) { setStrings(n, {v}); }
    void setPtr(const char *n, void *v) { auto &pv = props[n]; pv = {}; pv.type = 'p'; pv.p = {v}; }
    void declareStrings(const char *n) { if (!props.count(n)) setStrings(n, {}); }

    const PropVal *find(const char *n) const
    {
        auto it = props.find(n);
        return it == props.end() ? nullptr : &it->second;
    }
    double getDouble(const char *n, int idx, double def) const
    {
        const PropVal *v = find(n);
        if (!v)
            return def;
        if (v->type == 'd' && idx < int(v->d.size()))
            return v->d[size_t(idx)];
        if (v->type == 'i' && idx < int(v->i.size()))
            return v->i[size_t(idx)];
        return def;
    }
    int getInt(const char *n, int idx, int def) const { return int(std::lround(getDouble(n, idx, def))); }
    std::string getString(const char *n, int idx = 0, const std::string &def = {}) const
    {
        const PropVal *v = find(n);
        return (v && v->type == 's' && idx < int(v->s.size())) ? v->s[size_t(idx)] : def;
    }
    std::vector<std::string> getStrings(const char *n) const
    {
        const PropVal *v = find(n);
        return (v && v->type == 's') ? v->s : std::vector<std::string>{};
    }
    void *getPtr(const char *n) const
    {
        const PropVal *v = find(n);
        return (v && v->type == 'p' && !v->p.empty()) ? v->p[0] : nullptr;
    }
};

PropSet *asProps(OfxPropertySetHandle h)
{
    auto *p = reinterpret_cast<PropSet *>(h);
    return (p && p->magic == kPropMagic) ? p : nullptr;
}
OfxPropertySetHandle handle(PropSet *p) { return reinterpret_cast<OfxPropertySetHandle>(p); }

// ---- property suite

template <typename T>
OfxStatus propSet(OfxPropertySetHandle h, const char *name, int index, T value)
{
    PropSet *ps = asProps(h);
    if (!ps)
        return kOfxStatErrBadHandle;
    if (index < 0)
        return kOfxStatErrBadIndex;
    PropVal &v = ps->props[name];
    if constexpr (std::is_same_v<T, int>) {
        if (v.type == 'd' && !v.d.empty()) {   // be lenient: int into a double property
            if (int(v.d.size()) <= index)
                v.d.resize(size_t(index) + 1);
            v.d[size_t(index)] = value;
            return kOfxStatOK;
        }
        v.type = 'i';
        if (int(v.i.size()) <= index)
            v.i.resize(size_t(index) + 1);
        v.i[size_t(index)] = value;
    } else if constexpr (std::is_same_v<T, double>) {
        if (v.type == 'i' && !v.i.empty()) {
            if (int(v.i.size()) <= index)
                v.i.resize(size_t(index) + 1);
            v.i[size_t(index)] = int(value);
            return kOfxStatOK;
        }
        v.type = 'd';
        if (int(v.d.size()) <= index)
            v.d.resize(size_t(index) + 1);
        v.d[size_t(index)] = value;
    } else if constexpr (std::is_same_v<T, const char *>) {
        v.type = 's';
        if (int(v.s.size()) <= index)
            v.s.resize(size_t(index) + 1);
        v.s[size_t(index)] = value ? value : "";
    } else {
        v.type = 'p';
        if (int(v.p.size()) <= index)
            v.p.resize(size_t(index) + 1);
        v.p[size_t(index)] = value;
    }
    return kOfxStatOK;
}

OfxStatus propSetPointer(OfxPropertySetHandle h, const char *n, int i, void *v) { return propSet<void *>(h, n, i, v); }
OfxStatus propSetString(OfxPropertySetHandle h, const char *n, int i, const char *v) { return propSet<const char *>(h, n, i, v); }
OfxStatus propSetDouble(OfxPropertySetHandle h, const char *n, int i, double v) { return propSet<double>(h, n, i, v); }
OfxStatus propSetInt(OfxPropertySetHandle h, const char *n, int i, int v) { return propSet<int>(h, n, i, v); }
OfxStatus propSetPointerN(OfxPropertySetHandle h, const char *n, int c, void *const *v)
{
    for (int i = 0; i < c; ++i)
        if (OfxStatus s = propSetPointer(h, n, i, v[i]); s != kOfxStatOK)
            return s;
    return kOfxStatOK;
}
OfxStatus propSetStringN(OfxPropertySetHandle h, const char *n, int c, const char *const *v)
{
    for (int i = 0; i < c; ++i)
        if (OfxStatus s = propSetString(h, n, i, v[i]); s != kOfxStatOK)
            return s;
    return kOfxStatOK;
}
OfxStatus propSetDoubleN(OfxPropertySetHandle h, const char *n, int c, const double *v)
{
    for (int i = 0; i < c; ++i)
        if (OfxStatus s = propSetDouble(h, n, i, v[i]); s != kOfxStatOK)
            return s;
    return kOfxStatOK;
}
OfxStatus propSetIntN(OfxPropertySetHandle h, const char *n, int c, const int *v)
{
    for (int i = 0; i < c; ++i)
        if (OfxStatus s = propSetInt(h, n, i, v[i]); s != kOfxStatOK)
            return s;
    return kOfxStatOK;
}

const PropVal *lookup(OfxPropertySetHandle h, const char *name, OfxStatus &st)
{
    PropSet *ps = asProps(h);
    if (!ps) {
        st = kOfxStatErrBadHandle;
        return nullptr;
    }
    const PropVal *v = ps->find(name);
    st = v ? kOfxStatOK : kOfxStatErrUnknown;
    return v;
}

OfxStatus propGetPointer(OfxPropertySetHandle h, const char *n, int i, void **out)
{
    OfxStatus st;
    const PropVal *v = lookup(h, n, st);
    if (!v)
        return st;
    if (v->type != 'p')
        return kOfxStatErrValue;
    if (i < 0 || i >= int(v->p.size()))
        return kOfxStatErrBadIndex;
    *out = v->p[size_t(i)];
    return kOfxStatOK;
}
OfxStatus propGetString(OfxPropertySetHandle h, const char *n, int i, char **out)
{
    OfxStatus st;
    const PropVal *v = lookup(h, n, st);
    if (!v)
        return st;
    if (v->type != 's')
        return kOfxStatErrValue;
    if (i < 0 || i >= int(v->s.size()))
        return kOfxStatErrBadIndex;
    *out = const_cast<char *>(v->s[size_t(i)].c_str());
    return kOfxStatOK;
}
OfxStatus propGetDouble(OfxPropertySetHandle h, const char *n, int i, double *out)
{
    OfxStatus st;
    const PropVal *v = lookup(h, n, st);
    if (!v)
        return st;
    if (v->type == 'd') {
        if (i < 0 || i >= int(v->d.size()))
            return kOfxStatErrBadIndex;
        *out = v->d[size_t(i)];
    } else if (v->type == 'i') {
        if (i < 0 || i >= int(v->i.size()))
            return kOfxStatErrBadIndex;
        *out = v->i[size_t(i)];
    } else {
        return kOfxStatErrValue;
    }
    return kOfxStatOK;
}
OfxStatus propGetInt(OfxPropertySetHandle h, const char *n, int i, int *out)
{
    OfxStatus st;
    const PropVal *v = lookup(h, n, st);
    if (!v)
        return st;
    if (v->type == 'i') {
        if (i < 0 || i >= int(v->i.size()))
            return kOfxStatErrBadIndex;
        *out = v->i[size_t(i)];
    } else if (v->type == 'd') {
        if (i < 0 || i >= int(v->d.size()))
            return kOfxStatErrBadIndex;
        *out = int(v->d[size_t(i)]);
    } else {
        return kOfxStatErrValue;
    }
    return kOfxStatOK;
}
OfxStatus propGetPointerN(OfxPropertySetHandle h, const char *n, int c, void **v)
{
    for (int i = 0; i < c; ++i)
        if (OfxStatus s = propGetPointer(h, n, i, &v[i]); s != kOfxStatOK)
            return s;
    return kOfxStatOK;
}
OfxStatus propGetStringN(OfxPropertySetHandle h, const char *n, int c, char **v)
{
    for (int i = 0; i < c; ++i)
        if (OfxStatus s = propGetString(h, n, i, &v[i]); s != kOfxStatOK)
            return s;
    return kOfxStatOK;
}
OfxStatus propGetDoubleN(OfxPropertySetHandle h, const char *n, int c, double *v)
{
    for (int i = 0; i < c; ++i)
        if (OfxStatus s = propGetDouble(h, n, i, &v[i]); s != kOfxStatOK)
            return s;
    return kOfxStatOK;
}
OfxStatus propGetIntN(OfxPropertySetHandle h, const char *n, int c, int *v)
{
    for (int i = 0; i < c; ++i)
        if (OfxStatus s = propGetInt(h, n, i, &v[i]); s != kOfxStatOK)
            return s;
    return kOfxStatOK;
}
OfxStatus propReset(OfxPropertySetHandle h, const char *n)
{
    OfxStatus st;
    lookup(h, n, st);
    return st;
}
OfxStatus propGetDimension(OfxPropertySetHandle h, const char *n, int *count)
{
    OfxStatus st;
    const PropVal *v = lookup(h, n, st);
    if (!v)
        return st;
    *count = v->dim();
    return kOfxStatOK;
}

OfxPropertySuiteV1 gPropSuite = {propSetPointer, propSetString, propSetDouble, propSetInt, propSetPointerN,
                                 propSetStringN, propSetDoubleN, propSetIntN, propGetPointer, propGetString,
                                 propGetDouble, propGetInt, propGetPointerN, propGetStringN, propGetDoubleN,
                                 propGetIntN, propReset, propGetDimension};

// ============================================================ host objects

constexpr quint32 kEffectMagic = 0x4f465845, kClipMagic = 0x4f465843, kParamMagic = 0x4f465852,
                  kParamSetMagic = 0x4f465853;

struct EffectObj;
struct ParamSet;

struct Param {
    quint32 magic = kParamMagic;
    std::string name, type;
    PropSet props;
    ParamSet *set = nullptr;
    std::vector<double> current;   // plugin-unit value when no layer is bound
    std::string currentString;
    std::string stringCache;       // keeps returned char* valid
};

struct ParamSet {
    quint32 magic = kParamSetMagic;
    PropSet props;
    std::vector<std::unique_ptr<Param>> params;
    EffectObj *owner = nullptr;
    Param *find(const char *n)
    {
        for (auto &p : params)
            if (p->name == n)
                return p.get();
        return nullptr;
    }
};

struct Clip {
    quint32 magic = kClipMagic;
    std::string name;
    PropSet props;
    EffectObj *owner = nullptr;
};

struct PluginRec;

// Per-render state an instance reads while the plugin runs.
struct RenderState {
    EffectContext *ctx = nullptr;
    double frame = 0;        // OFX time
    double fps = 30;
    double scale = 1;        // render scale
    QRectF project;          // layer rect (layer space)
    std::vector<unsigned char> src, dst;
    int bounds[4] = {0, 0, 0, 0};   // pixel bounds of both buffers
    int rowBytes = 0;
    std::thread::id mainThread;
    std::map<std::string, std::vector<double>> cache;   // param values at `frame`
    bool isFloat = true;
    // Source images at other frames (temporal plugins), rendered on demand.
    struct Frame {
        std::vector<unsigned char> data;
        int bounds[4];
        int rowBytes;
    };
    std::map<double, std::unique_ptr<Frame>> otherFrames;
};

void toBuffer(const QImage &img, std::vector<unsigned char> &buf, bool isFloat);

struct EffectObj {
    quint32 magic = kEffectMagic;
    PropSet props;
    ParamSet params;
    std::map<std::string, std::unique_ptr<Clip>> clips;
    std::vector<std::string> clipOrder;
    PluginRec *plugin = nullptr;
    bool isInstance = false;
    int effectUid = 0;
    RenderState *rs = nullptr;
    EffectObj() { params.owner = this; }
};

struct ParamSpec {
    std::string name, type, label, doubleType, coords, hint;
    int dims = 1;
    bool isInt = false, secret = false;
    std::vector<double> def, mn, mx, dmn, dmx;
    double increment = 0;
    std::vector<std::string> options, enums;
    std::string defString;
};

struct PluginRec {
    OfxPlugin *plugin = nullptr;
    QString binary, bundle;
    std::unique_ptr<EffectObj> descriptor;
    std::unique_ptr<EffectObj> contextDescriptor;
    std::string context, depth;
    std::vector<ParamSpec> params;
    PluginInfo info;
    bool crashed = false;
};

std::vector<std::unique_ptr<PluginRec>> gPlugins;
std::map<int, std::unique_ptr<EffectObj>> gInstances;   // effect uid -> instance
std::mutex gMessageMutex;
QStringList gMessages;
// MF_OFX_TRACE=1 prints every plugin action and image fetch to stderr (plugin debugging aid).
const bool gTrace = qEnvironmentVariableIntValue("MF_OFX_TRACE") != 0;
thread_local int tThreadIndex = 0;
thread_local bool tSpawned = false;
extern thread_local sigjmp_buf *tGuardJump;
extern std::atomic<bool> gWorkerCrashed;

EffectObj *asEffect(OfxImageEffectHandle h)
{
    auto *e = reinterpret_cast<EffectObj *>(h);
    return (e && e->magic == kEffectMagic) ? e : nullptr;
}
Clip *asClip(OfxImageClipHandle h)
{
    auto *c = reinterpret_cast<Clip *>(h);
    return (c && c->magic == kClipMagic) ? c : nullptr;
}
Param *asParam(OfxParamHandle h)
{
    auto *p = reinterpret_cast<Param *>(h);
    return (p && p->magic == kParamMagic) ? p : nullptr;
}
ParamSet *asParamSet(OfxParamSetHandle h)
{
    auto *p = reinterpret_cast<ParamSet *>(h);
    return (p && p->magic == kParamSetMagic) ? p : nullptr;
}

void pushMessage(const QString &m)
{
    std::lock_guard<std::mutex> lock(gMessageMutex);
    gMessages << m;
    if (gMessages.size() > 50)
        gMessages.removeFirst();
}

// ============================================================ default property sets

PropSet gHostProps;

void initHostProps()
{
    PropSet &h = gHostProps;
    h.setString(kOfxPropAPIVersion, "1");
    h.setInts(kOfxPropAPIVersion, {1, 4});
    h.setString(kOfxPropType, kOfxTypeImageEffectHost);
    h.setString(kOfxPropName, "org.motionforge.MotionForge");
    h.setString(kOfxPropLabel, "MotionForge");
    h.setInts(kOfxPropVersion, {0, 3, 0});
    h.setString(kOfxPropVersionLabel, "0.3.0");
    h.setInt(kOfxImageEffectHostPropIsBackground, 0);
    h.setInt(kOfxImageEffectPropSupportsOverlays, 0);
    h.setInt(kOfxImageEffectPropSupportsMultiResolution, 1);
    h.setInt(kOfxImageEffectPropSupportsTiles, 0);
    h.setInt(kOfxImageEffectPropTemporalClipAccess, 1);
    h.setStrings(kOfxImageEffectPropSupportedComponents, {kOfxImageComponentRGBA});
    h.setStrings(kOfxImageEffectPropSupportedContexts,
                 {kOfxImageEffectContextFilter, kOfxImageEffectContextGeneral, kOfxImageEffectContextGenerator});
    h.setStrings(kOfxImageEffectPropSupportedPixelDepths, {kOfxBitDepthFloat, kOfxBitDepthByte});
    h.setInt(kOfxImageEffectPropSupportsMultipleClipDepths, 0);
    h.setInt(kOfxImageEffectPropSupportsMultipleClipPARs, 0);
    h.setInt(kOfxImageEffectPropSetableFrameRate, 0);
    h.setInt(kOfxImageEffectPropSetableFielding, 0);
    h.setInt(kOfxParamHostPropSupportsCustomInteract, 0);
    h.setInt(kOfxParamHostPropSupportsStringAnimation, 0);
    h.setInt(kOfxParamHostPropSupportsChoiceAnimation, 0);
    h.setInt(kOfxParamHostPropSupportsBooleanAnimation, 1);
    h.setInt(kOfxParamHostPropSupportsCustomAnimation, 0);
    h.setInt(kOfxParamHostPropSupportsParametricAnimation, 0);
    h.setInt(kOfxParamHostPropMaxParameters, -1);
    h.setInt(kOfxParamHostPropMaxPages, 0);
    h.setInts(kOfxParamHostPropPageRowColumnCount, {0, 0});
    h.setPtr(kOfxPropHostOSHandle, nullptr);
    h.setString(kOfxImageEffectPropOpenGLRenderSupported, "false");
    h.setInt(kOfxImageEffectInstancePropSequentialRender, 0);
    h.setString(kOfxImageEffectHostPropNativeOrigin, kOfxHostNativeOriginBottomLeft);
    h.setInt(kOfxImageEffectPropRenderQualityDraft, 0);
}

void initEffectDescriptor(PropSet &p, const PluginRec &rec)
{
    p.setString(kOfxPropType, kOfxTypeImageEffect);
    p.setString(kOfxPropLabel, rec.plugin->pluginIdentifier);
    p.setString(kOfxPropShortLabel, "");
    p.setString(kOfxPropLongLabel, "");
    p.setInts(kOfxPropVersion, {int(rec.plugin->pluginVersionMajor), int(rec.plugin->pluginVersionMinor)});
    p.setString(kOfxPropVersionLabel, "");
    p.setString(kOfxPropPluginDescription, "");
    p.declareStrings(kOfxImageEffectPropSupportedContexts);
    p.setString(kOfxImageEffectPluginPropGrouping, "");
    p.setInt(kOfxImageEffectPluginPropSingleInstance, 0);
    p.setString(kOfxImageEffectPluginRenderThreadSafety, kOfxImageEffectRenderInstanceSafe);
    p.setInt(kOfxImageEffectPluginPropHostFrameThreading, 0);
    p.setPtr(kOfxImageEffectPluginPropOverlayInteractV1, nullptr);
    p.setInt(kOfxImageEffectPropSupportsMultiResolution, 1);
    p.setInt(kOfxImageEffectPropSupportsTiles, 1);
    p.setInt(kOfxImageEffectPropTemporalClipAccess, 0);
    p.declareStrings(kOfxImageEffectPropSupportedPixelDepths);
    p.setInt(kOfxImageEffectPluginPropFieldRenderTwiceAlways, 1);
    p.setInt(kOfxImageEffectPropSupportsMultipleClipDepths, 0);
    p.setInt(kOfxImageEffectPropSupportsMultipleClipPARs, 0);
    p.declareStrings(kOfxImageEffectPropClipPreferencesSlaveParam);
    p.setString(kOfxPluginPropFilePath, rec.bundle.toStdString());
    p.setString(kOfxImageEffectPropOpenGLRenderSupported, "false");
}

void initClipDescriptor(PropSet &p, const std::string &name)
{
    p.setString(kOfxPropType, kOfxTypeClip);
    p.setString(kOfxPropName, name);
    p.setString(kOfxPropLabel, name);
    p.setString(kOfxPropShortLabel, name);
    p.setString(kOfxPropLongLabel, name);
    p.declareStrings(kOfxImageEffectPropSupportedComponents);
    p.setInt(kOfxImageEffectPropTemporalClipAccess, 0);
    p.setInt(kOfxImageClipPropOptional, 0);
    p.setString(kOfxImageClipPropFieldExtraction, kOfxImageFieldDoubled);
    p.setInt(kOfxImageClipPropIsMask, 0);
    p.setInt(kOfxImageEffectPropSupportsTiles, 1);
}

bool isIntType(const std::string &t)
{
    return t == kOfxParamTypeInteger || t == kOfxParamTypeInteger2D || t == kOfxParamTypeInteger3D ||
           t == kOfxParamTypeBoolean || t == kOfxParamTypeChoice;
}

int dimsOf(const std::string &t)
{
    if (t == kOfxParamTypeDouble2D || t == kOfxParamTypeInteger2D)
        return 2;
    if (t == kOfxParamTypeDouble3D || t == kOfxParamTypeInteger3D || t == kOfxParamTypeRGB)
        return 3;
    if (t == kOfxParamTypeRGBA)
        return 4;
    return 1;
}

bool isStringType(const std::string &t)
{
    return t == kOfxParamTypeString || t == kOfxParamTypeCustom || t == kOfxParamTypeStrChoice;
}

bool hasValue(const std::string &t)
{
    return t != kOfxParamTypeGroup && t != kOfxParamTypePage && t != kOfxParamTypePushButton &&
           t != kOfxParamTypeBytes && t != kOfxParamTypeParametric && t != std::string("OfxParamTypeCamera");
}

void initParamDescriptor(PropSet &p, const std::string &type, const std::string &name)
{
    p.setString(kOfxPropType, kOfxTypeParameter);
    p.setString(kOfxPropName, name);
    p.setString(kOfxPropLabel, name);
    p.setString(kOfxPropShortLabel, name);
    p.setString(kOfxPropLongLabel, name);
    p.setString(kOfxParamPropType, type);
    p.setInt(kOfxParamPropSecret, 0);
    p.setString(kOfxParamPropHint, "");
    p.setString(kOfxParamPropScriptName, name);
    p.setString(kOfxParamPropParent, "");
    p.setInt(kOfxParamPropEnabled, 1);
    p.setPtr(kOfxParamPropDataPtr, nullptr);
    if (type == kOfxParamTypeGroup) {
        p.setInt(kOfxParamPropGroupOpen, 1);
        return;
    }
    if (type == kOfxParamTypePage) {
        p.declareStrings(kOfxParamPropPageChild);
        return;
    }
    if (type == kOfxParamTypePushButton)
        return;
    p.setPtr(kOfxParamPropInteractV1, nullptr);
    p.setDoubles(kOfxParamPropInteractSize, {0, 0});
    p.setDouble(kOfxParamPropInteractSizeAspect, 1);
    p.setInts(kOfxParamPropInteractMinimumSize, {10, 10});
    p.setInts(kOfxParamPropInteractPreferedSize, {10, 10});
    p.setInt(kOfxParamPropAnimates, !isStringType(type));
    p.setInt(kOfxParamPropCanUndo, 1);
    p.setInt(kOfxParamPropPersistant, 1);
    p.setInt(kOfxParamPropEvaluateOnChange, 1);
    p.setInt(kOfxParamPropPluginMayWrite, 0);
    p.setString(kOfxParamPropCacheInvalidation, kOfxParamInvalidateValueChange);
    const int n = dimsOf(type);
    if (isStringType(type)) {
        p.setString(kOfxParamPropDefault, "");
        p.setString(kOfxParamPropStringMode, kOfxParamStringIsSingleLine);
        p.setInt(kOfxParamPropStringFilePathExists, 1);
        if (type == kOfxParamTypeStrChoice) {
            p.declareStrings(kOfxParamPropChoiceOption);
            p.declareStrings(kOfxParamPropChoiceEnum);
        }
        return;
    }
    if (isIntType(type)) {
        p.setInts(kOfxParamPropDefault, std::vector<int>(size_t(n), 0));
        p.setInts(kOfxParamPropMin, std::vector<int>(size_t(n), INT_MIN));
        p.setInts(kOfxParamPropMax, std::vector<int>(size_t(n), INT_MAX));
        p.setInts(kOfxParamPropDisplayMin, std::vector<int>(size_t(n), INT_MIN));
        p.setInts(kOfxParamPropDisplayMax, std::vector<int>(size_t(n), INT_MAX));
        if (type == kOfxParamTypeChoice) {
            p.declareStrings(kOfxParamPropChoiceOption);
            p.setInts(kOfxParamPropChoiceOrder, {});
        }
    } else {
        std::vector<double> d(size_t(n), 0.0);
        if (type == kOfxParamTypeRGBA)
            d[3] = 1.0;
        p.setDoubles(kOfxParamPropDefault, d);
        const double lo = type == kOfxParamTypeRGB || type == kOfxParamTypeRGBA ? 0.0 : -DBL_MAX;
        const double hi = type == kOfxParamTypeRGB || type == kOfxParamTypeRGBA ? 1.0 : DBL_MAX;
        p.setDoubles(kOfxParamPropMin, std::vector<double>(size_t(n), lo));
        p.setDoubles(kOfxParamPropMax, std::vector<double>(size_t(n), hi));
        p.setDoubles(kOfxParamPropDisplayMin, std::vector<double>(size_t(n), lo));
        p.setDoubles(kOfxParamPropDisplayMax, std::vector<double>(size_t(n), hi));
        p.setDouble(kOfxParamPropIncrement, 1);
        p.setInt(kOfxParamPropDigits, 2);
        p.setString(kOfxParamPropDoubleType, kOfxParamDoubleTypePlain);
        p.setString(kOfxParamPropDefaultCoordinateSystem, kOfxParamCoordinatesCanonical);
        if (n >= 2)
            p.setStrings(kOfxParamPropDimensionLabel, n == 2 ? std::vector<std::string>{"x", "y"}
                                                             : std::vector<std::string>{"r", "g", "b", "a"});
    }
}

// ============================================================ parameter value conversion

bool isPointType(const ParamSpec &s)
{
    return s.dims == 2 && !s.isInt &&
           (s.doubleType == kOfxParamDoubleTypeXYAbsolute || s.doubleType == kOfxParamDoubleTypeNormalisedXYAbsolute);
}
bool isOldNormalised(const ParamSpec &s)
{
    return s.doubleType.rfind("OfxParamDoubleTypeNormalised", 0) == 0;
}

// Default value in plugin (canonical) units, given the project size.
std::vector<double> canonicalDefault(const ParamSpec &s, const QRectF &project)
{
    std::vector<double> d = s.def;
    d.resize(size_t(s.dims), 0.0);
    const bool normalisedDefault = s.coords == kOfxParamCoordinatesNormalised || isOldNormalised(s);
    if (normalisedDefault && !s.isInt) {
        const std::string &t = s.doubleType;
        auto isX = [&](const std::string &a) { return a.find("XY") != std::string::npos || a.find("X") != std::string::npos; };
        if (s.dims == 2 && t.find("XY") != std::string::npos) {
            d[0] *= project.width();
            d[1] *= project.height();
        } else if (s.dims == 1 && t.find("Y") != std::string::npos && t.find("XY") == std::string::npos) {
            d[0] *= project.height();
        } else if (s.dims == 1 && isX(t)) {
            d[0] *= project.width();
        }
    }
    return d;
}

// Our stored Value -> plugin units.
std::vector<double> toPlugin(const ParamSpec &s, const Value &v, const QRectF &project)
{
    std::vector<double> out(size_t(s.dims), 0.0);
    for (int i = 0; i < s.dims; ++i)
        out[size_t(i)] = v.value(i);
    if (isPointType(s)) {
        out[0] = v.value(0) - project.left();
        out[1] = project.bottom() - v.value(1);
    }
    if (isOldNormalised(s)) {   // old-style normalised params speak 0..1 to the plugin
        if (s.dims == 2) {
            out[0] /= std::max(1.0, project.width());
            out[1] /= std::max(1.0, project.height());
        } else if (s.doubleType.find('Y') != std::string::npos) {
            out[0] /= std::max(1.0, project.height());
        } else {
            out[0] /= std::max(1.0, project.width());
        }
    }
    return out;
}

Value fromPlugin(const ParamSpec &s, const std::vector<double> &v, const QRectF &project)
{
    Value out;
    for (int i = 0; i < s.dims; ++i)
        out.append(i < int(v.size()) ? v[size_t(i)] : 0.0);
    if (isOldNormalised(s)) {
        if (s.dims == 2) {
            out[0] *= project.width();
            out[1] *= project.height();
        } else {
            out[0] *= s.doubleType.find('Y') != std::string::npos ? project.height() : project.width();
        }
    }
    if (isPointType(s)) {
        out[0] = project.left() + out[0];
        out[1] = project.bottom() - out[1];
    }
    if (s.type == kOfxParamTypeRGB)
        out.append(1.0);
    return out;
}

const ParamSpec *specFor(const PluginRec &rec, const std::string &name)
{
    for (const auto &s : rec.params)
        if (s.name == name)
            return &s;
    return nullptr;
}

// Value of a param at OFX time `frame`, in plugin units.
std::vector<double> paramValue(Param *p, double frame, bool *ok)
{
    *ok = true;
    EffectObj *inst = p->set->owner;
    const ParamSpec *spec = inst->plugin ? specFor(*inst->plugin, p->name) : nullptr;
    RenderState *rs = inst->rs;
    if (!spec || !rs || !rs->ctx || !rs->ctx->effect)
        return p->current;
    if (std::abs(frame - rs->frame) < 1e-9) {
        auto it = rs->cache.find(p->name);
        if (it != rs->cache.end())
            return it->second;
    }
    const Property *prop = rs->ctx->effect->param(QString::fromStdString(p->name));
    if (!prop)
        return p->current;
    if (std::this_thread::get_id() != rs->mainThread || !rs->ctx->evalAt) {
        auto it = rs->cache.find(p->name);   // worker threads only get the render-time value
        return it != rs->cache.end() ? it->second : p->current;
    }
    return toPlugin(*spec, rs->ctx->evalAt(*prop, frame / rs->fps), rs->project);
}

std::string paramString(Param *p)
{
    EffectObj *inst = p->set->owner;
    RenderState *rs = inst->rs;
    if (rs && rs->ctx && rs->ctx->effect)
        if (const Property *prop = rs->ctx->effect->param(QString::fromStdString(p->name))) {
            if (p->type == kOfxParamTypeStrChoice) {
                const ParamSpec *spec = specFor(*inst->plugin, p->name);
                const int idx = int(prop->staticValue.value(0));
                if (spec && idx >= 0 && idx < int(spec->enums.size()))
                    return spec->enums[size_t(idx)];
            }
            return prop->text.toStdString();
        }
    return p->currentString;
}

// ---- parameter suite

OfxStatus paramDefine(OfxParamSetHandle h, const char *type, const char *name, OfxPropertySetHandle *props)
{
    ParamSet *set = asParamSet(h);
    if (!set)
        return kOfxStatErrBadHandle;
    if (set->find(name))
        return kOfxStatErrExists;
    auto p = std::make_unique<Param>();
    p->name = name;
    p->type = type;
    p->set = set;
    initParamDescriptor(p->props, type, name);
    if (props)
        *props = handle(&p->props);
    set->params.push_back(std::move(p));
    return kOfxStatOK;
}
OfxStatus paramGetHandle(OfxParamSetHandle h, const char *name, OfxParamHandle *param, OfxPropertySetHandle *props)
{
    ParamSet *set = asParamSet(h);
    if (!set)
        return kOfxStatErrBadHandle;
    Param *p = set->find(name);
    if (!p)
        return kOfxStatErrUnknown;
    *param = reinterpret_cast<OfxParamHandle>(p);
    if (props)
        *props = handle(&p->props);
    return kOfxStatOK;
}
OfxStatus paramSetGetPropertySet(OfxParamSetHandle h, OfxPropertySetHandle *props)
{
    ParamSet *set = asParamSet(h);
    if (!set)
        return kOfxStatErrBadHandle;
    *props = handle(&set->props);
    return kOfxStatOK;
}
OfxStatus paramGetPropertySet(OfxParamHandle h, OfxPropertySetHandle *props)
{
    Param *p = asParam(h);
    if (!p)
        return kOfxStatErrBadHandle;
    *props = handle(&p->props);
    return kOfxStatOK;
}

OfxStatus writeOut(Param *p, const std::vector<double> &v, va_list ap)
{
    const int n = dimsOf(p->type);
    if (isStringType(p->type)) {
        p->stringCache = paramString(p);
        *va_arg(ap, const char **) = p->stringCache.c_str();
        return kOfxStatOK;
    }
    if (!hasValue(p->type))
        return kOfxStatErrUnsupported;
    for (int i = 0; i < n; ++i) {
        const double d = i < int(v.size()) ? v[size_t(i)] : 0.0;
        if (isIntType(p->type))
            *va_arg(ap, int *) = int(std::lround(d));
        else
            *va_arg(ap, double *) = d;
    }
    return kOfxStatOK;
}

OfxStatus paramGetValue(OfxParamHandle h, ...)
{
    Param *p = asParam(h);
    if (!p)
        return kOfxStatErrBadHandle;
    RenderState *rs = p->set->owner->rs;
    bool ok;
    const auto v = paramValue(p, rs ? rs->frame : 0.0, &ok);
    va_list ap;
    va_start(ap, h);
    const OfxStatus st = writeOut(p, v, ap);
    va_end(ap);
    return st;
}
OfxStatus paramGetValueAtTime(OfxParamHandle h, OfxTime time, ...)
{
    Param *p = asParam(h);
    if (!p)
        return kOfxStatErrBadHandle;
    bool ok;
    const auto v = paramValue(p, time, &ok);
    va_list ap;
    va_start(ap, time);
    const OfxStatus st = writeOut(p, v, ap);
    va_end(ap);
    return st;
}
OfxStatus paramGetDerivative(OfxParamHandle h, OfxTime time, ...)
{
    Param *p = asParam(h);
    if (!p)
        return kOfxStatErrBadHandle;
    bool ok;
    const auto a = paramValue(p, time - 0.5, &ok), b = paramValue(p, time + 0.5, &ok);
    std::vector<double> d(a.size());
    for (size_t i = 0; i < a.size() && i < b.size(); ++i)
        d[i] = b[i] - a[i];
    va_list ap;
    va_start(ap, time);
    const OfxStatus st = writeOut(p, d, ap);
    va_end(ap);
    return st;
}
OfxStatus paramGetIntegral(OfxParamHandle h, OfxTime t1, OfxTime t2, ...)
{
    Param *p = asParam(h);
    if (!p)
        return kOfxStatErrBadHandle;
    bool ok;
    std::vector<double> sum(size_t(dimsOf(p->type)), 0.0);
    const int steps = 32;
    for (int i = 0; i < steps; ++i) {
        const auto v = paramValue(p, t1 + (t2 - t1) * (i + 0.5) / steps, &ok);
        for (size_t k = 0; k < sum.size() && k < v.size(); ++k)
            sum[k] += v[k] * (t2 - t1) / steps;
    }
    va_list ap;
    va_start(ap, t2);
    const OfxStatus st = writeOut(p, sum, ap);
    va_end(ap);
    return st;
}
OfxStatus readIn(Param *p, va_list ap)
{
    const int n = dimsOf(p->type);
    if (isStringType(p->type)) {
        const char *s = va_arg(ap, const char *);
        p->currentString = s ? s : "";
        return kOfxStatOK;
    }
    if (!hasValue(p->type))
        return kOfxStatErrUnsupported;
    p->current.resize(size_t(n));
    for (int i = 0; i < n; ++i)
        p->current[size_t(i)] = isIntType(p->type) ? double(va_arg(ap, int)) : va_arg(ap, double);
    return kOfxStatOK;
}
// Values a plugin sets itself are kept for the instance; the user's keyframes always win at render time.
OfxStatus paramSetValue(OfxParamHandle h, ...)
{
    Param *p = asParam(h);
    if (!p)
        return kOfxStatErrBadHandle;
    va_list ap;
    va_start(ap, h);
    const OfxStatus st = readIn(p, ap);
    va_end(ap);
    return st;
}
OfxStatus paramSetValueAtTime(OfxParamHandle h, OfxTime time, ...)
{
    Param *p = asParam(h);
    if (!p)
        return kOfxStatErrBadHandle;
    va_list ap;
    va_start(ap, time);
    const OfxStatus st = readIn(p, ap);
    va_end(ap);
    return st;
}
const Property *boundProperty(Param *p, RenderState **rsOut)
{
    RenderState *rs = p->set->owner->rs;
    *rsOut = rs;
    if (!rs || !rs->ctx || !rs->ctx->effect)
        return nullptr;
    return rs->ctx->effect->param(QString::fromStdString(p->name));
}
OfxStatus paramGetNumKeys(OfxParamHandle h, unsigned int *n)
{
    Param *p = asParam(h);
    if (!p)
        return kOfxStatErrBadHandle;
    RenderState *rs;
    const Property *prop = boundProperty(p, &rs);
    *n = prop ? unsigned(prop->keys.size()) : 0u;
    return kOfxStatOK;
}
OfxStatus paramGetKeyTime(OfxParamHandle h, unsigned int nth, OfxTime *time)
{
    Param *p = asParam(h);
    if (!p)
        return kOfxStatErrBadHandle;
    RenderState *rs;
    const Property *prop = boundProperty(p, &rs);
    if (!prop || nth >= unsigned(prop->keys.size()))
        return kOfxStatErrBadIndex;
    *time = prop->keys[int(nth)].time * rs->fps;
    return kOfxStatOK;
}
OfxStatus paramGetKeyIndex(OfxParamHandle h, OfxTime time, int direction, int *index)
{
    Param *p = asParam(h);
    if (!p)
        return kOfxStatErrBadHandle;
    RenderState *rs;
    const Property *prop = boundProperty(p, &rs);
    if (!prop)
        return kOfxStatFailed;
    for (int i = 0; i < prop->keys.size(); ++i) {
        const double kt = prop->keys[i].time * rs->fps;
        if ((direction == 0 && std::abs(kt - time) < 1e-6) || (direction > 0 && kt > time + 1e-6)) {
            *index = i;
            return kOfxStatOK;
        }
    }
    if (direction < 0)
        for (int i = prop->keys.size() - 1; i >= 0; --i)
            if (prop->keys[i].time * rs->fps < time - 1e-6) {
                *index = i;
                return kOfxStatOK;
            }
    return kOfxStatFailed;
}
OfxStatus paramNoOpTime(OfxParamHandle h, OfxTime) { return asParam(h) ? kOfxStatOK : kOfxStatErrBadHandle; }
OfxStatus paramNoOp(OfxParamHandle h) { return asParam(h) ? kOfxStatOK : kOfxStatErrBadHandle; }
OfxStatus paramCopy(OfxParamHandle, OfxParamHandle, OfxTime, const OfxRangeD *) { return kOfxStatErrUnsupported; }
OfxStatus paramEditBegin(OfxParamSetHandle, const char *) { return kOfxStatOK; }
OfxStatus paramEditEnd(OfxParamSetHandle) { return kOfxStatOK; }

OfxParameterSuiteV1 gParamSuite = {paramDefine,        paramGetHandle,  paramSetGetPropertySet, paramGetPropertySet,
                                   paramGetValue,      paramGetValueAtTime, paramGetDerivative,  paramGetIntegral,
                                   paramSetValue,      paramSetValueAtTime, paramGetNumKeys,     paramGetKeyTime,
                                   paramGetKeyIndex,   paramNoOpTime,   paramNoOp,             paramCopy,
                                   paramEditBegin,     paramEditEnd};

// ============================================================ image effect suite

struct ImageObj {
    PropSet props;
};

struct ImageMemory {
    std::vector<unsigned char> data;
};

OfxStatus getPropertySet(OfxImageEffectHandle h, OfxPropertySetHandle *props)
{
    EffectObj *e = asEffect(h);
    if (!e)
        return kOfxStatErrBadHandle;
    *props = handle(&e->props);
    return kOfxStatOK;
}
OfxStatus getParamSet(OfxImageEffectHandle h, OfxParamSetHandle *set)
{
    EffectObj *e = asEffect(h);
    if (!e)
        return kOfxStatErrBadHandle;
    *set = reinterpret_cast<OfxParamSetHandle>(&e->params);
    return kOfxStatOK;
}
OfxStatus clipDefine(OfxImageEffectHandle h, const char *name, OfxPropertySetHandle *props)
{
    EffectObj *e = asEffect(h);
    if (!e)
        return kOfxStatErrBadHandle;
    auto &slot = e->clips[name];
    if (!slot) {
        slot = std::make_unique<Clip>();
        slot->name = name;
        slot->owner = e;
        initClipDescriptor(slot->props, name);
        e->clipOrder.push_back(name);
    }
    if (props)
        *props = handle(&slot->props);
    return kOfxStatOK;
}
OfxStatus clipGetHandle(OfxImageEffectHandle h, const char *name, OfxImageClipHandle *clip, OfxPropertySetHandle *props)
{
    EffectObj *e = asEffect(h);
    if (!e)
        return kOfxStatErrBadHandle;
    auto it = e->clips.find(name);
    if (it == e->clips.end())
        return kOfxStatErrUnknown;
    *clip = reinterpret_cast<OfxImageClipHandle>(it->second.get());
    if (props)
        *props = handle(&it->second->props);
    return kOfxStatOK;
}
OfxStatus clipGetPropertySet(OfxImageClipHandle h, OfxPropertySetHandle *props)
{
    Clip *c = asClip(h);
    if (!c)
        return kOfxStatErrBadHandle;
    *props = handle(&c->props);
    return kOfxStatOK;
}
OfxStatus clipGetImage(OfxImageClipHandle h, OfxTime time, const OfxRectD *, OfxPropertySetHandle *imageHandle)
{
    Clip *c = asClip(h);
    if (!c)
        return kOfxStatErrBadHandle;
    RenderState *rs = c->owner->rs;
    const bool isOutput = c->name == kOfxImageEffectOutputClipName;
    if (gTrace)
        std::fprintf(stderr, "[ofx] clipGetImage %s t=%g (render t=%g)\n", c->name.c_str(), time, rs ? rs->frame : -1.0);
    if (!rs || (!isOutput && !c->props.getInt(kOfxImageClipPropConnected, 0, 0)))
        return kOfxStatFailed;
    unsigned char *data = isOutput ? rs->dst.data() : rs->src.data();
    const int *bounds = rs->bounds;
    int rowBytes = rs->rowBytes;
    if (!isOutput && std::abs(time - rs->frame) > 1e-6) {
        // Temporal access: render the layer's input at the requested frame. Only the main thread
        // may render; worker threads get the current frame.
        if (std::this_thread::get_id() == rs->mainThread && rs->ctx && rs->ctx->inputAt) {
            auto &slot = rs->otherFrames[time];
            if (!slot) {
                QPointF origin;
                const QImage other = rs->ctx->inputAt(time / rs->fps, &origin);
                slot = std::make_unique<RenderState::Frame>();
                const int w = std::max(1, other.width()), h = std::max(1, other.height());
                const int x1 = int(std::lround((origin.x() - rs->project.left()) * rs->scale));
                const int y2 = int(std::lround((rs->project.bottom() - origin.y()) * rs->scale));
                slot->bounds[0] = x1;
                slot->bounds[1] = y2 - h;
                slot->bounds[2] = x1 + w;
                slot->bounds[3] = y2;
                slot->rowBytes = w * (rs->isFloat ? 16 : 4);
                if (other.isNull())
                    slot->data.assign(size_t(slot->rowBytes) * h, 0);
                else
                    toBuffer(other, slot->data, rs->isFloat);
            }
            data = slot->data.data();
            bounds = slot->bounds;
            rowBytes = slot->rowBytes;
        }
    }
    auto *img = new ImageObj;
    PropSet &p = img->props;
    p.owner = img;
    const std::string depth = c->owner->plugin->depth;
    p.setString(kOfxPropType, kOfxTypeImage);
    p.setString(kOfxImageEffectPropPixelDepth, depth);
    p.setString(kOfxImageEffectPropComponents, kOfxImageComponentRGBA);
    p.setString(kOfxImageEffectPropPreMultiplication, kOfxImagePreMultiplied);
    p.setDoubles(kOfxImageEffectPropRenderScale, {rs->scale, rs->scale});
    p.setDouble(kOfxImagePropPixelAspectRatio, 1.0);
    p.setPtr(kOfxImagePropData, data);
    p.setInts(kOfxImagePropBounds, {bounds[0], bounds[1], bounds[2], bounds[3]});
    p.setInts(kOfxImagePropRegionOfDefinition, {bounds[0], bounds[1], bounds[2], bounds[3]});
    p.setInt(kOfxImagePropRowBytes, rowBytes);
    p.setString(kOfxImagePropField, kOfxImageFieldNone);
    p.setString(kOfxImagePropUniqueIdentifier, (isOutput ? "out@" : "src@") + std::to_string(time));
    *imageHandle = handle(&p);
    return kOfxStatOK;
}
OfxStatus clipReleaseImage(OfxPropertySetHandle h)
{
    PropSet *p = asProps(h);
    if (!p || !p->owner)
        return kOfxStatErrBadHandle;
    delete static_cast<ImageObj *>(p->owner);
    return kOfxStatOK;
}
OfxStatus clipGetRegionOfDefinition(OfxImageClipHandle h, OfxTime, OfxRectD *bounds)
{
    Clip *c = asClip(h);
    if (!c)
        return kOfxStatErrBadHandle;
    RenderState *rs = c->owner->rs;
    if (!rs) {
        *bounds = {0, 0, 0, 0};
        return kOfxStatFailed;
    }
    *bounds = {rs->bounds[0] / rs->scale, rs->bounds[1] / rs->scale, rs->bounds[2] / rs->scale,
               rs->bounds[3] / rs->scale};
    return kOfxStatOK;
}
int effectAbort(OfxImageEffectHandle) { return 0; }
OfxStatus imageMemoryAlloc(OfxImageEffectHandle, size_t n, OfxImageMemoryHandle *mem)
{
    auto *m = new (std::nothrow) ImageMemory;
    if (!m)
        return kOfxStatErrMemory;
    try {
        m->data.resize(n);
    } catch (...) {
        delete m;
        return kOfxStatErrMemory;
    }
    *mem = reinterpret_cast<OfxImageMemoryHandle>(m);
    return kOfxStatOK;
}
OfxStatus imageMemoryFree(OfxImageMemoryHandle mem)
{
    delete reinterpret_cast<ImageMemory *>(mem);
    return kOfxStatOK;
}
OfxStatus imageMemoryLock(OfxImageMemoryHandle mem, void **ptr)
{
    *ptr = reinterpret_cast<ImageMemory *>(mem)->data.data();
    return kOfxStatOK;
}
OfxStatus imageMemoryUnlock(OfxImageMemoryHandle) { return kOfxStatOK; }

OfxImageEffectSuiteV1 gEffectSuite = {getPropertySet,  getParamSet,     clipDefine,       clipGetHandle,
                                      clipGetPropertySet, clipGetImage, clipReleaseImage, clipGetRegionOfDefinition,
                                      effectAbort,     imageMemoryAlloc, imageMemoryFree, imageMemoryLock,
                                      imageMemoryUnlock};

// ============================================================ memory, threads, messages, progress, timeline

OfxStatus memoryAlloc(void *, size_t n, void **out)
{
    *out = std::malloc(n);
    return *out ? kOfxStatOK : kOfxStatErrMemory;
}
OfxStatus memoryFree(void *p)
{
    std::free(p);
    return kOfxStatOK;
}
OfxMemorySuiteV1 gMemorySuite = {memoryAlloc, memoryFree};

OfxStatus multiThread(OfxThreadFunctionV1 func, unsigned int n, void *arg)
{
    if (n == 0)
        n = std::max(1u, std::thread::hardware_concurrency());
    if (n == 1) {
        func(0, 1, arg);
        return kOfxStatOK;
    }
    std::vector<std::thread> threads;
    for (unsigned i = 0; i < n; ++i)
        threads.emplace_back([=] {
            tThreadIndex = int(i);
            tSpawned = true;
            sigjmp_buf jump;
            if (sigsetjmp(jump, 1) != 0) {
                tGuardJump = nullptr;
                gWorkerCrashed = true;
                return;
            }
            tGuardJump = &jump;
            func(i, n, arg);
            tGuardJump = nullptr;
        });
    for (auto &t : threads)
        t.join();
    return kOfxStatOK;
}
OfxStatus multiThreadNumCPUs(unsigned int *n)
{
    *n = std::max(1u, std::thread::hardware_concurrency());
    return kOfxStatOK;
}
OfxStatus multiThreadIndex(unsigned int *i)
{
    *i = unsigned(tThreadIndex);
    return kOfxStatOK;
}
int multiThreadIsSpawnedThread() { return tSpawned ? 1 : 0; }
OfxStatus mutexCreate(OfxMutexHandle *m, int lockCount)
{
    auto *mx = new std::recursive_mutex;
    for (int i = 0; i < lockCount; ++i)
        mx->lock();
    *m = reinterpret_cast<OfxMutexHandle>(mx);
    return kOfxStatOK;
}
OfxStatus mutexDestroy(const OfxMutexHandle m)
{
    delete reinterpret_cast<std::recursive_mutex *>(m);
    return kOfxStatOK;
}
OfxStatus mutexLock(const OfxMutexHandle m)
{
    reinterpret_cast<std::recursive_mutex *>(m)->lock();
    return kOfxStatOK;
}
OfxStatus mutexUnLock(const OfxMutexHandle m)
{
    reinterpret_cast<std::recursive_mutex *>(m)->unlock();
    return kOfxStatOK;
}
OfxStatus mutexTryLock(const OfxMutexHandle m)
{
    return reinterpret_cast<std::recursive_mutex *>(m)->try_lock() ? kOfxStatOK : kOfxStatFailed;
}
OfxMultiThreadSuiteV1 gThreadSuite = {multiThread, multiThreadNumCPUs, multiThreadIndex, multiThreadIsSpawnedThread,
                                      mutexCreate, mutexDestroy,       mutexLock,        mutexUnLock,
                                      mutexTryLock};

OfxStatus vmessage(const char *type, const char *format, va_list ap)
{
    char buf[2048];
    std::vsnprintf(buf, sizeof buf, format ? format : "", ap);
    pushMessage(QString("[%1] %2").arg(type ? type : "message", QString::fromUtf8(buf)));
    if (type && std::strcmp(type, kOfxMessageQuestion) == 0)
        return kOfxStatReplyYes;
    return kOfxStatOK;
}
OfxStatus message(void *, const char *type, const char *, const char *format, ...)
{
    va_list ap;
    va_start(ap, format);
    const OfxStatus st = vmessage(type, format, ap);
    va_end(ap);
    return st;
}
OfxStatus setPersistentMessage(void *, const char *type, const char *, const char *format, ...)
{
    va_list ap;
    va_start(ap, format);
    const OfxStatus st = vmessage(type, format, ap);
    va_end(ap);
    return st;
}
OfxStatus clearPersistentMessage(void *) { return kOfxStatOK; }
OfxMessageSuiteV1 gMessageSuiteV1 = {message};
OfxMessageSuiteV2 gMessageSuiteV2 = {message, setPersistentMessage, clearPersistentMessage};

OfxStatus progressStart1(void *, const char *) { return kOfxStatOK; }
OfxStatus progressStart2(void *, const char *, const char *) { return kOfxStatOK; }
OfxStatus progressUpdate(void *, double) { return kOfxStatOK; }
OfxStatus progressEnd(void *) { return kOfxStatOK; }
OfxProgressSuiteV1 gProgressV1 = {progressStart1, progressUpdate, progressEnd};
OfxProgressSuiteV2 gProgressV2 = {progressStart2, progressUpdate, progressEnd};

OfxStatus tlGetTime(void *instance, double *time)
{
    EffectObj *e = asEffect(reinterpret_cast<OfxImageEffectHandle>(instance));
    *time = (e && e->rs) ? e->rs->frame : 0.0;
    return kOfxStatOK;
}
OfxStatus tlGotoTime(void *, double) { return kOfxStatOK; }
OfxStatus tlBounds(void *instance, double *first, double *last)
{
    EffectObj *e = asEffect(reinterpret_cast<OfxImageEffectHandle>(instance));
    *first = 0;
    *last = (e && e->rs && e->rs->ctx && e->rs->ctx->comp) ? e->rs->ctx->comp->frameCount() : 0.0;
    return kOfxStatOK;
}
OfxTimeLineSuiteV1 gTimeLine = {tlGetTime, tlGotoTime, tlBounds};

const void *fetchSuite(OfxPropertySetHandle, const char *name, int version)
{
    if (!name)
        return nullptr;
    if (!std::strcmp(name, kOfxPropertySuite) && version == 1)
        return &gPropSuite;
    if (!std::strcmp(name, kOfxImageEffectSuite) && version == 1)
        return &gEffectSuite;
    if (!std::strcmp(name, kOfxParameterSuite) && version == 1)
        return &gParamSuite;
    if (!std::strcmp(name, kOfxMemorySuite) && version == 1)
        return &gMemorySuite;
    if (!std::strcmp(name, kOfxMultiThreadSuite) && version == 1)
        return &gThreadSuite;
    if (!std::strcmp(name, kOfxMessageSuite))
        return version == 2 ? static_cast<const void *>(&gMessageSuiteV2) : static_cast<const void *>(&gMessageSuiteV1);
    if (!std::strcmp(name, kOfxProgressSuite))
        return version == 2 ? static_cast<const void *>(&gProgressV2) : static_cast<const void *>(&gProgressV1);
    if (!std::strcmp(name, kOfxTimeLineSuite) && version == 1)
        return &gTimeLine;
    return nullptr;   // interact, OpenGL, parametric parameters, … are not provided
}

OfxHost gHost = {nullptr, fetchSuite};

// ============================================================ crash guard
//
// A plugin that crashes (segfault, bus error, illegal instruction, divide by zero) inside a call
// shouldn't take the whole editor and the user's unsaved work with it. While a plugin call is
// running, fatal signals jump back to the call site; the plugin is then disabled for the session.

thread_local sigjmp_buf *tGuardJump = nullptr;
std::atomic<bool> gWorkerCrashed{false};
struct sigaction gOldHandlers[32];
std::once_flag gGuardOnce;

void crashHandler(int sig, siginfo_t *info, void *uctx)
{
    if (tGuardJump)
        siglongjmp(*tGuardJump, sig);
    // Not inside a plugin call: behave as if we weren't here.
    struct sigaction &old = gOldHandlers[sig];
    if (old.sa_flags & SA_SIGINFO) {
        if (old.sa_sigaction) {
            old.sa_sigaction(sig, info, uctx);
            return;
        }
    } else if (old.sa_handler != SIG_DFL && old.sa_handler != SIG_IGN) {
        old.sa_handler(sig);
        return;
    }
    signal(sig, SIG_DFL);
    raise(sig);
}

void installCrashGuard()
{
    std::call_once(gGuardOnce, [] {
        struct sigaction sa;
        std::memset(&sa, 0, sizeof sa);
        sa.sa_sigaction = crashHandler;
        sa.sa_flags = SA_SIGINFO | SA_NODEFER;
        sigemptyset(&sa.sa_mask);
        for (int sig : {SIGSEGV, SIGBUS, SIGILL, SIGFPE})
            sigaction(sig, &sa, &gOldHandlers[sig]);
    });
}

const char *signalName(int sig)
{
    switch (sig) {
    case SIGSEGV: return "segmentation fault";
    case SIGBUS: return "bus error";
    case SIGILL: return "illegal instruction";
    case SIGFPE: return "arithmetic error";
    }
    return "crash";
}

// ============================================================ plugin calls

OfxStatus callAction(PluginRec &rec, const char *action, void *h, PropSet *in, PropSet *out)
{
    if (rec.crashed)
        return kOfxStatFailed;
    installCrashGuard();
    sigjmp_buf jump;
    sigjmp_buf *outer = tGuardJump;
    OfxStatus result = kOfxStatFailed;
    if (const int sig = sigsetjmp(jump, 1); sig != 0) {
        tGuardJump = outer;
        rec.crashed = true;
        rec.info.error = QString("crashed (%1) during %2; disabled until restart").arg(signalName(sig), action);
        pushMessage(rec.info.label + " " + rec.info.error);
        return kOfxStatFailed;
    }
    tGuardJump = &jump;
    gWorkerCrashed = false;
    if (gTrace)
        std::fprintf(stderr, "[ofx] %s %s\n", qPrintable(rec.info.identifier), action);
    try {
        result = rec.plugin->mainEntry(action, h, in ? handle(in) : nullptr, out ? handle(out) : nullptr);
    } catch (const std::exception &e) {
        pushMessage(QString("%1 threw during %2: %3").arg(rec.info.label, action, e.what()));
    } catch (...) {
        pushMessage(QString("%1 threw during %2").arg(rec.info.label, action));
    }
    tGuardJump = outer;
    if (gTrace)
        std::fprintf(stderr, "[ofx]   -> %d\n", result);
    if (gWorkerCrashed) {
        rec.crashed = true;
        rec.info.error = QString("crashed in a worker thread during %1; disabled until restart").arg(action);
        pushMessage(rec.info.label + " " + rec.info.error);
        return kOfxStatFailed;
    }
    return result;
}

bool ok(OfxStatus s) { return s == kOfxStatOK || s == kOfxStatReplyDefault; }

QString reasonFor(OfxStatus s, const char *what)
{
    switch (s) {
    case kOfxStatErrMissingHostFeature:
    case kOfxStatErrUnsupported:
        return QString("needs a host feature MotionForge doesn't provide yet (curve parameters, stereo views, "
                       "multi-plane images or a GPU render suite)");
    case kOfxStatFailed:
        return QString("refused to start (%1 failed); it probably needs a host extension such as Natron's "
                       "multi-plane support").arg(what);
    case kOfxStatErrMemory:
        return QString("%1: out of memory").arg(what);
    default:
        return QString("%1 failed (status %2)").arg(what).arg(s);
    }
}

ParamSpec readSpec(const Param &p)
{
    ParamSpec s;
    const PropSet &pp = p.props;
    s.name = p.name;
    s.type = p.type;
    s.label = pp.getString(kOfxPropLabel, 0, p.name);
    if (s.label.empty())
        s.label = p.name;
    s.hint = pp.getString(kOfxParamPropHint);
    s.dims = dimsOf(p.type);
    s.isInt = isIntType(p.type);
    s.secret = pp.getInt(kOfxParamPropSecret, 0, 0);
    s.doubleType = pp.getString(kOfxParamPropDoubleType, 0, kOfxParamDoubleTypePlain);
    s.coords = pp.getString(kOfxParamPropDefaultCoordinateSystem, 0, kOfxParamCoordinatesCanonical);
    auto vec = [&](const char *n, double def) {
        std::vector<double> v(size_t(s.dims));
        for (int i = 0; i < s.dims; ++i)
            v[size_t(i)] = pp.getDouble(n, i, def);
        return v;
    };
    if (isStringType(p.type)) {
        s.defString = pp.getString(kOfxParamPropDefault);
    } else if (hasValue(p.type)) {
        s.def = vec(kOfxParamPropDefault, 0);
        s.mn = vec(kOfxParamPropMin, -DBL_MAX);
        s.mx = vec(kOfxParamPropMax, DBL_MAX);
        s.dmn = vec(kOfxParamPropDisplayMin, -DBL_MAX);
        s.dmx = vec(kOfxParamPropDisplayMax, DBL_MAX);
        s.increment = pp.getDouble(kOfxParamPropIncrement, 0, 0);
    }
    s.options = pp.getStrings(kOfxParamPropChoiceOption);
    s.enums = pp.getStrings(kOfxParamPropChoiceEnum);
    if (p.type == kOfxParamTypeStrChoice) {
        if (s.enums.empty())
            s.enums = s.options;
        const auto it = std::find(s.enums.begin(), s.enums.end(), s.defString);
        s.def = {double(it == s.enums.end() ? 0 : it - s.enums.begin())};
    }
    return s;
}

Property makeProperty(const ParamSpec &s, const QRectF &rect)
{
    const QString id = QString::fromStdString(s.name);
    const QString label = QString::fromStdString(s.label);
    if (s.type == kOfxParamTypeString || s.type == kOfxParamTypeCustom) {
        Property p(id, label, PropType::String, {0});
        p.text = p.defaultText = QString::fromStdString(s.defString);
        p.hidden = s.secret || s.type == kOfxParamTypeCustom;
        return p;
    }
    if (s.type == kOfxParamTypeChoice || s.type == kOfxParamTypeStrChoice) {
        QStringList opts;
        for (const auto &o : s.options)
            opts << QString::fromStdString(o);
        Property p(id, label, PropType::Choice, {s.def.empty() ? 0.0 : s.def[0]});
        p.withChoices(opts);
        p.limits(0, std::max(0, int(opts.size()) - 1));
        p.hidden = s.secret;
        return p;
    }
    if (s.type == kOfxParamTypeBoolean) {
        Property p(id, label, PropType::Checkbox, {s.def.empty() ? 0.0 : s.def[0]});
        p.hidden = s.secret;
        return p;
    }
    const auto canon = canonicalDefault(s, rect);
    Value def = fromPlugin(s, canon, rect);
    if (isOldNormalised(s)) {   // canonicalDefault already scaled it; undo the double scaling
        def.clear();
        for (double d : canon)
            def.append(d);
        if (isPointType(s)) {
            def[0] = rect.left() + def[0];
            def[1] = rect.bottom() - def[1];
        }
    }
    PropType type = PropType::Number;
    if (s.type == kOfxParamTypeRGB || s.type == kOfxParamTypeRGBA)
        type = PropType::Color;
    else if (isPointType(s))
        type = PropType::Point;
    else if (s.dims == 1 && s.doubleType == kOfxParamDoubleTypeAngle)
        type = PropType::Angle;
    Property p(id, label, type, def);
    if (type == PropType::Number) {
        const double mn = s.mn.empty() ? -DBL_MAX : *std::min_element(s.mn.begin(), s.mn.end());
        const double mx = s.mx.empty() ? DBL_MAX : *std::max_element(s.mx.begin(), s.mx.end());
        p.limits(std::max(mn, -1e9), std::min(mx, 1e9));
        const double dmn = s.dmn.empty() ? -DBL_MAX : s.dmn[0], dmx = s.dmx.empty() ? DBL_MAX : s.dmx[0];
        double step = s.isInt ? 0.2 : (s.increment > 0 ? s.increment / 5.0 : 0.1);
        if (dmn > -1e8 && dmx < 1e8 && dmx > dmn && !s.isInt)
            step = std::max(1e-4, (dmx - dmn) / 250.0);
        p.step(step);
    }
    p.hidden = s.secret;
    return p;
}

// ---- pixels

void toBuffer(const QImage &img, std::vector<unsigned char> &buf, bool isFloat)
{
    const int w = img.width(), h = img.height();
    const int bpp = isFloat ? 16 : 4;
    buf.assign(size_t(w) * h * bpp, 0);
    parallelFor(h, [&](int y0, int y1) {
        for (int y = y0; y < y1; ++y) {
            const QRgb *s = reinterpret_cast<const QRgb *>(img.constScanLine(h - 1 - y));   // OFX rows go up
            unsigned char *row = buf.data() + size_t(y) * w * bpp;
            for (int x = 0; x < w; ++x) {
                const QRgb p = s[x];
                if (isFloat) {
                    float *f = reinterpret_cast<float *>(row) + x * 4;
                    f[0] = qRed(p) / 255.f;
                    f[1] = qGreen(p) / 255.f;
                    f[2] = qBlue(p) / 255.f;
                    f[3] = qAlpha(p) / 255.f;
                } else {
                    unsigned char *b = row + x * 4;
                    b[0] = uchar(qRed(p));
                    b[1] = uchar(qGreen(p));
                    b[2] = uchar(qBlue(p));
                    b[3] = uchar(qAlpha(p));
                }
            }
        }
    });
}

QImage fromBuffer(const std::vector<unsigned char> &buf, int w, int h, bool isFloat)
{
    QImage img(w, h, QImage::Format_ARGB32_Premultiplied);
    const int bpp = isFloat ? 16 : 4;
    parallelFor(h, [&](int y0, int y1) {
        for (int y = y0; y < y1; ++y) {
            QRgb *d = reinterpret_cast<QRgb *>(img.scanLine(h - 1 - y));
            const unsigned char *row = buf.data() + size_t(y) * w * bpp;
            for (int x = 0; x < w; ++x) {
                int r, g, b, a;
                if (isFloat) {
                    const float *f = reinterpret_cast<const float *>(row) + x * 4;
                    auto c = [](float v) { return std::isfinite(v) ? std::clamp(int(v * 255.f + 0.5f), 0, 255) : 0; };
                    r = c(f[0]);
                    g = c(f[1]);
                    b = c(f[2]);
                    a = c(f[3]);
                } else {
                    const unsigned char *px = row + x * 4;
                    r = px[0];
                    g = px[1];
                    b = px[2];
                    a = px[3];
                }
                d[x] = qRgba(std::min(r, a), std::min(g, a), std::min(b, a), a);
            }
        }
    });
    return img;
}

void setClipRenderProps(Clip &c, const PluginRec &rec, double fps, double frames, bool connected)
{
    PropSet &p = c.props;
    p.setString(kOfxImageEffectPropPixelDepth, connected ? rec.depth : kOfxBitDepthNone);
    p.setString(kOfxImageEffectPropComponents, connected ? kOfxImageComponentRGBA : kOfxImageComponentNone);
    p.setString(kOfxImageClipPropUnmappedPixelDepth, connected ? rec.depth : kOfxBitDepthNone);
    p.setString(kOfxImageClipPropUnmappedComponents, connected ? kOfxImageComponentRGBA : kOfxImageComponentNone);
    p.setString(kOfxImageEffectPropPreMultiplication, kOfxImagePreMultiplied);
    p.setDouble(kOfxImagePropPixelAspectRatio, 1.0);
    p.setDouble(kOfxImageEffectPropFrameRate, fps);
    p.setDoubles(kOfxImageEffectPropFrameRange, {0, frames});
    p.setDoubles(kOfxImageEffectPropUnmappedFrameRange, {0, frames});
    p.setDouble(kOfxImageEffectPropUnmappedFrameRate, fps);
    p.setString(kOfxImageClipPropFieldOrder, kOfxImageFieldNone);
    p.setInt(kOfxImageClipPropConnected, connected ? 1 : 0);
    p.setInt(kOfxImageClipPropContinuousSamples, 0);
    p.setInt(kOfxImageEffectFrameVarying, 1);
}

void setInstanceProjectProps(EffectObj &inst, const QRectF &project, double fps, double frames)
{
    PropSet &p = inst.props;
    p.setDoubles(kOfxImageEffectPropProjectSize, {project.width(), project.height()});
    p.setDoubles(kOfxImageEffectPropProjectExtent, {project.width(), project.height()});
    p.setDoubles(kOfxImageEffectPropProjectOffset, {0, 0});
    p.setDouble(kOfxImageEffectPropProjectPixelAspectRatio, 1.0);
    p.setDouble(kOfxImageEffectInstancePropEffectDuration, frames);
    p.setDouble(kOfxImageEffectPropFrameRate, fps);
    for (auto &[name, clip] : inst.clips)
        setClipRenderProps(*clip, *inst.plugin, fps, frames,
                           name == kOfxImageEffectOutputClipName || name == kOfxImageEffectSimpleSourceClipName);
}

EffectObj *instanceFor(PluginRec &rec, int uid, RenderState &rs)
{
    auto it = gInstances.find(uid);
    if (it != gInstances.end() && it->second->plugin == &rec)
        return it->second.get();
    if (it != gInstances.end()) {
        callAction(*it->second->plugin, kOfxActionDestroyInstance, it->second.get(), nullptr, nullptr);
        gInstances.erase(it);
    }
    auto inst = std::make_unique<EffectObj>();
    inst->isInstance = true;
    inst->plugin = &rec;
    inst->effectUid = uid;
    inst->props = rec.contextDescriptor->props;
    inst->props.owner = nullptr;
    inst->props.setString(kOfxPropType, kOfxTypeImageEffectInstance);
    inst->props.setString(kOfxImageEffectPropContext, rec.context);
    inst->props.setPtr(kOfxPropInstanceData, nullptr);
    inst->props.setInt(kOfxPropIsInteractive, 1);
    inst->props.setInt(kOfxImageEffectInstancePropSequentialRender, 0);
    inst->props.setInt(kOfxImageEffectPropInAnalysis, 0);
    for (const std::string &name : rec.contextDescriptor->clipOrder) {
        auto c = std::make_unique<Clip>();
        c->name = name;
        c->owner = inst.get();
        c->props = rec.contextDescriptor->clips[name]->props;
        inst->clipOrder.push_back(name);
        inst->clips[name] = std::move(c);
    }
    inst->params.props = rec.contextDescriptor->params.props;
    for (const auto &dp : rec.contextDescriptor->params.params) {
        auto p = std::make_unique<Param>();
        p->name = dp->name;
        p->type = dp->type;
        p->props = dp->props;
        p->set = &inst->params;
        if (const ParamSpec *s = specFor(rec, p->name)) {
            p->current = canonicalDefault(*s, rs.project);
            p->currentString = s->defString;
        }
        inst->params.params.push_back(std::move(p));
    }
    setInstanceProjectProps(*inst, rs.project, rs.fps, rs.ctx && rs.ctx->comp ? rs.ctx->comp->frameCount() : 0);
    inst->rs = &rs;
    const OfxStatus st = callAction(rec, kOfxActionCreateInstance, inst.get(), nullptr, nullptr);
    inst->rs = nullptr;
    if (!ok(st)) {
        if (rs.ctx)
            rs.ctx->error = "the plugin refused to create an instance";
        return nullptr;
    }
    EffectObj *raw = inst.get();
    gInstances[uid] = std::move(inst);
    return raw;
}

void renderPlugin(PluginRec &rec, QImage &img, EffectContext &ctx)
{
    if (!ctx.effect || !ctx.comp || img.isNull())
        return;
    if (rec.crashed) {
        ctx.error = rec.info.error;
        return;
    }
    const bool isFloat = rec.depth == kOfxBitDepthFloat;
    RenderState rs;
    rs.ctx = &ctx;
    rs.fps = ctx.comp->fps;
    rs.frame = std::round(ctx.time * rs.fps * 1000.0) / 1000.0;
    rs.scale = ctx.pixelScale;
    rs.project = ctx.layerRect.isEmpty() ? QRectF(0, 0, ctx.comp->width, ctx.comp->height) : ctx.layerRect;
    rs.mainThread = std::this_thread::get_id();
    rs.isFloat = isFloat;
    EffectObj *inst = instanceFor(rec, ctx.effect->uid, rs);
    if (!inst)
        return;
    setInstanceProjectProps(*inst, rs.project, rs.fps, ctx.comp->frameCount());

    // Snapshot every parameter at this frame (plugins may read them from worker threads).
    for (const auto &p : inst->params.params) {
        if (!hasValue(p->type) || isStringType(p->type))
            continue;
        const ParamSpec *spec = specFor(rec, p->name);
        const Property *prop = ctx.effect->param(QString::fromStdString(p->name));
        if (spec && prop)
            rs.cache[p->name] = toPlugin(*spec, ctx.evalAt ? ctx.evalAt(*prop, ctx.time) : prop->valueAt(ctx.time), rs.project);
    }

    // Pixel bounds of the layer image in OFX (y-up) pixel coordinates.
    auto pixelBounds = [&](const QImage &im, QPointF origin) {
        const int x1 = int(std::lround((origin.x() - rs.project.left()) * rs.scale));
        const int y2 = int(std::lround((rs.project.bottom() - origin.y()) * rs.scale));
        return std::array<int, 4>{x1, y2 - im.height(), x1 + im.width(), y2};
    };
    auto b = pixelBounds(img, ctx.origin);
    std::copy(b.begin(), b.end(), rs.bounds);
    inst->rs = &rs;

    // Let the plugin grow the frame (glows, shadows…) up to a sane limit.
    PropSet in, out;
    in.setDouble(kOfxPropTime, rs.frame);
    in.setDoubles(kOfxImageEffectPropRenderScale, {rs.scale, rs.scale});
    const bool generator = rec.context == kOfxImageEffectContextGenerator;
    out.setDoubles(kOfxImageEffectPropRegionOfDefinition,
                   {b[0] / rs.scale, b[1] / rs.scale, b[2] / rs.scale, b[3] / rs.scale});
    if (callAction(rec, kOfxImageEffectActionGetRegionOfDefinition, inst, &in, &out) == kOfxStatOK && !generator) {
        const int limit = int(1024 * std::max(0.25, rs.scale));
        auto px = [&](int i) { return out.getDouble(kOfxImageEffectPropRegionOfDefinition, i, 0) * rs.scale; };
        const int padL = std::clamp(int(std::ceil(b[0] - px(0))), 0, limit);
        const int padB = std::clamp(int(std::ceil(b[1] - px(1))), 0, limit);
        const int padR = std::clamp(int(std::ceil(px(2) - b[2])), 0, limit);
        const int padT = std::clamp(int(std::ceil(px(3) - b[3])), 0, limit);
        if (padL || padB || padR || padT) {
            QImage grown(img.width() + padL + padR, img.height() + padT + padB, QImage::Format_ARGB32_Premultiplied);
            grown.fill(Qt::transparent);
            for (int y = 0; y < img.height(); ++y)
                std::memcpy(grown.scanLine(y + padT) + padL * 4, img.constScanLine(y), size_t(img.width()) * 4);
            img = grown;
            const QPointF shift(-padL / rs.scale, -padT / rs.scale);
            ctx.originShift += shift;
            b = pixelBounds(img, ctx.origin + ctx.originShift);
            std::copy(b.begin(), b.end(), rs.bounds);
        }
    }

    const int w = img.width(), h = img.height();
    rs.rowBytes = w * (isFloat ? 16 : 4);
    if (!generator)
        toBuffer(img, rs.src, isFloat);
    else
        rs.src.assign(size_t(rs.rowBytes) * h, 0);
    rs.dst.assign(size_t(rs.rowBytes) * h, 0);

    PropSet rin;
    rin.setDouble(kOfxPropTime, rs.frame);
    rin.setString(kOfxImageEffectPropFieldToRender, kOfxImageFieldNone);
    rin.setInts(kOfxImageEffectPropRenderWindow, {b[0], b[1], b[2], b[3]});
    rin.setDoubles(kOfxImageEffectPropRenderScale, {rs.scale, rs.scale});
    rin.setInt(kOfxImageEffectPropSequentialRenderStatus, 0);
    rin.setInt(kOfxImageEffectPropInteractiveRenderStatus, 1);
    rin.setInt(kOfxImageEffectPropRenderQualityDraft, 0);
    PropSet seq;
    seq.setDoubles(kOfxImageEffectPropFrameRange, {rs.frame, rs.frame});
    seq.setDouble(kOfxImageEffectPropFrameStep, 1.0);
    seq.setInt(kOfxPropIsInteractive, 1);
    seq.setDoubles(kOfxImageEffectPropRenderScale, {rs.scale, rs.scale});
    seq.setInt(kOfxImageEffectPropSequentialRenderStatus, 0);
    seq.setInt(kOfxImageEffectPropInteractiveRenderStatus, 1);
    seq.setInt(kOfxImageEffectPropRenderQualityDraft, 0);
    callAction(rec, kOfxImageEffectActionBeginSequenceRender, inst, &seq, nullptr);
    const OfxStatus st = callAction(rec, kOfxImageEffectActionRender, inst, &rin, nullptr);
    callAction(rec, kOfxImageEffectActionEndSequenceRender, inst, &seq, nullptr);
    inst->rs = nullptr;
    if (rec.crashed) {
        ctx.error = rec.info.error;
        gInstances.erase(ctx.effect->uid);   // its state can't be trusted any more
        return;
    }
    if (!ok(st)) {
        ctx.error = "render failed";
        return;
    }
    img = fromBuffer(rs.dst, w, h, isFloat);
}

QString ofxEffectId(const PluginRec &rec)
{
    return "ofx:" + QString::fromUtf8(rec.plugin->pluginIdentifier);
}

void registerPlugin(PluginRec &rec)
{
    EffectDef d;
    d.id = ofxEffectId(rec);
    d.name = rec.info.label;
    d.category = rec.info.grouping.isEmpty() ? QString("OpenFX") : "OpenFX: " + rec.info.grouping;
    d.external = true;
    d.description = QString::fromStdString(rec.contextDescriptor->props.getString(kOfxPropPluginDescription));
    PluginRec *r = &rec;
    d.makeParams = [r](const QRectF &rect) {
        std::vector<Property> props;
        for (const auto &s : r->params)
            if (hasValue(s.type))
                props.push_back(makeProperty(s, rect));
        return props;
    };
    d.apply = [r](QImage &img, const ParamMap &, EffectContext &ctx) { renderPlugin(*r, img, ctx); };
    EffectRegistry::registerEffect(std::move(d));
}

// Loads, describes and picks a context for one plugin. Returns an error message or empty.
QString describePlugin(PluginRec &rec)
{
    rec.plugin->setHost(&gHost);
    if (OfxStatus st = callAction(rec, kOfxActionLoad, nullptr, nullptr, nullptr); !ok(st))
        return reasonFor(st, "loading");
    rec.descriptor = std::make_unique<EffectObj>();
    rec.descriptor->plugin = &rec;
    initEffectDescriptor(rec.descriptor->props, rec);
    if (OfxStatus st = callAction(rec, kOfxActionDescribe, rec.descriptor.get(), nullptr, nullptr); !ok(st))
        return reasonFor(st, "describing");
    const auto contexts = rec.descriptor->props.getStrings(kOfxImageEffectPropSupportedContexts);
    auto has = [&](const char *c) { return std::find(contexts.begin(), contexts.end(), c) != contexts.end(); };
    if (has(kOfxImageEffectContextFilter))
        rec.context = kOfxImageEffectContextFilter;
    else if (has(kOfxImageEffectContextGeneral))
        rec.context = kOfxImageEffectContextGeneral;
    else if (has(kOfxImageEffectContextGenerator))
        rec.context = kOfxImageEffectContextGenerator;
    else
        return "only supports contexts MotionForge doesn't host yet (transition, retimer or paint)";
    const auto depths = rec.descriptor->props.getStrings(kOfxImageEffectPropSupportedPixelDepths);
    auto hasDepth = [&](const char *d) { return std::find(depths.begin(), depths.end(), d) != depths.end(); };
    if (hasDepth(kOfxBitDepthFloat) || depths.empty())
        rec.depth = kOfxBitDepthFloat;
    else if (hasDepth(kOfxBitDepthByte))
        rec.depth = kOfxBitDepthByte;
    else
        return "needs a 16-bit pixel format, which isn't supported yet";

    rec.contextDescriptor = std::make_unique<EffectObj>();
    rec.contextDescriptor->plugin = &rec;
    rec.contextDescriptor->props = rec.descriptor->props;
    PropSet in;
    in.setString(kOfxImageEffectPropContext, rec.context);
    if (OfxStatus st = callAction(rec, kOfxImageEffectActionDescribeInContext, rec.contextDescriptor.get(), &in, nullptr);
        !ok(st))
        return reasonFor(st, "describing");
    if (!rec.contextDescriptor->clips.count(kOfxImageEffectOutputClipName))
        return "defines no output clip";
    for (const auto &p : rec.contextDescriptor->params.params)
        rec.params.push_back(readSpec(*p));

    const PropSet &dp = rec.contextDescriptor->props;
    rec.info.identifier = QString::fromUtf8(rec.plugin->pluginIdentifier);
    rec.info.label = QString::fromStdString(dp.getString(kOfxPropLabel, 0, rec.plugin->pluginIdentifier));
    if (rec.info.label.isEmpty())
        rec.info.label = rec.info.identifier;
    rec.info.grouping = QString::fromStdString(dp.getString(kOfxImageEffectPluginPropGrouping));
    rec.info.context = QString::fromStdString(rec.context).remove("OfxImageEffectContext");
    rec.info.pixelDepth = rec.depth == kOfxBitDepthFloat ? "float" : "8-bit";
    rec.info.versionMajor = int(rec.plugin->pluginVersionMajor);
    rec.info.versionMinor = int(rec.plugin->pluginVersionMinor);
    return {};
}

std::once_flag gInitOnce;
void initHost()
{
    std::call_once(gInitOnce, [] {
        initHostProps();
        gHost.host = handle(&gHostProps);
    });
}

} // namespace

// ============================================================ Manager

Manager &Manager::instance()
{
    static Manager m;
    return m;
}

Manager::Manager()
{
    initHost();
}

QStringList Manager::defaultSearchPaths()
{
    QStringList paths;
    for (const QString &p : qEnvironmentVariable("OFX_PLUGIN_PATH").split(':', Qt::SkipEmptyParts))
        paths << p;
    paths << QStandardPaths::writableLocation(QStandardPaths::GenericDataLocation) + "/MotionForge/OFX/Plugins";
    paths << "/usr/OFX/Plugins" << "/usr/local/OFX/Plugins";
    // Natron ships its plugins (openfx-misc, openfx-io, …) inside its install folder.
    for (const QString &base : {QString("/opt"), QDir::homePath()}) {
        const QDir d(base);
        for (const QString &n : d.entryList({"Natron*"}, QDir::Dirs))
            paths << d.filePath(n + "/Plugins/OFX/Natron");
    }
    paths.removeDuplicates();
    return paths;
}

QStringList Manager::findBundles(const QStringList &paths)
{
    QStringList bundles;
    for (const QString &root : paths) {
        if (!QFileInfo(root).isDir())
            continue;
        QDirIterator it(root, {"*.ofx.bundle"}, QDir::Dirs | QDir::NoDotAndDotDot, QDirIterator::Subdirectories);
        while (it.hasNext())
            bundles << QFileInfo(it.next()).canonicalFilePath();
    }
    bundles.removeDuplicates();
    return bundles;
}

QString Manager::binaryForBundle(const QString &bundle)
{
    const QString name = QFileInfo(bundle).fileName().chopped(QString(".bundle").size());   // Foo.ofx
#if defined(__aarch64__)
    const QStringList arch{"Linux-arm-64", "Linux-aarch64"};
#else
    const QStringList arch{"Linux-x86-64"};
#endif
    for (const QString &a : arch) {
        const QString p = bundle + "/Contents/" + a + "/" + name;
        if (QFileInfo::exists(p))
            return p;
    }
    return {};
}

int Manager::loadBinary(const QString &binaryPath, const QString &bundlePath, QString *error)
{
    initHost();
    if (loadedBinaries_.contains(binaryPath))
        return 0;
    void *lib = dlopen(binaryPath.toUtf8().constData(), RTLD_NOW | RTLD_LOCAL);
    if (!lib) {
        if (error)
            *error = QString::fromUtf8(dlerror());
        return 0;
    }
    loadedBinaries_.insert(binaryPath);   // libraries stay loaded for the life of the process
    using SetHostFn = OfxStatus (*)(const OfxHost *);
    using CountFn = int (*)();
    using GetFn = OfxPlugin *(*)(int);
    if (auto setHost = reinterpret_cast<SetHostFn>(dlsym(lib, "OfxSetHost")))
        setHost(&gHost);
    auto count = reinterpret_cast<CountFn>(dlsym(lib, "OfxGetNumberOfPlugins"));
    auto get = reinterpret_cast<GetFn>(dlsym(lib, "OfxGetPlugin"));
    if (!count || !get) {
        if (error)
            *error = "not an OpenFX plugin (missing OfxGetNumberOfPlugins/OfxGetPlugin)";
        return 0;
    }
    int registered = 0;
    QStringList problems;
    const int n = count();
    for (int i = 0; i < n; ++i) {
        OfxPlugin *p = get(i);
        if (!p || !p->pluginApi || std::strcmp(p->pluginApi, kOfxImageEffectPluginApi) != 0 || p->apiVersion < 1)
            continue;
        auto rec = std::make_unique<PluginRec>();
        rec->plugin = p;
        rec->binary = binaryPath;
        rec->bundle = bundlePath;
        rec->info.identifier = QString::fromUtf8(p->pluginIdentifier);
        rec->info.label = rec->info.identifier;
        rec->info.binaryPath = binaryPath;
        rec->info.bundlePath = bundlePath;
        const QString err = describePlugin(*rec);
        if (!err.isEmpty()) {
            rec->info.error = err;
            problems << rec->info.identifier + ": " + err;
            gPlugins.push_back(std::move(rec));   // keep: the plugin may hold pointers to our host
            continue;
        }
        // Bundles often ship several major versions of a plugin under one identifier: keep the newest.
        PluginRec *older = nullptr;
        bool newerExists = false;
        for (auto &other : gPlugins)
            if (other->info.loaded && other->info.identifier == rec->info.identifier) {
                const auto mine = std::make_pair(rec->info.versionMajor, rec->info.versionMinor);
                const auto theirs = std::make_pair(other->info.versionMajor, other->info.versionMinor);
                if (theirs >= mine)
                    newerExists = true;
                else
                    older = other.get();
            }
        if (newerExists) {
            rec->info.error = "superseded: a newer or equal version is already loaded";
            gPlugins.push_back(std::move(rec));
            continue;
        }
        if (older) {
            older->info.loaded = false;
            older->info.error = QString("superseded by version %1.%2").arg(rec->info.versionMajor).arg(rec->info.versionMinor);
            --registered;
        }
        rec->info.loaded = true;
        registerPlugin(*rec);
        gPlugins.push_back(std::move(rec));
        ++registered;
    }
    if (error && registered == 0 && !problems.isEmpty())
        *error = problems.join("; ");
    return registered;
}

ScanResult Manager::scan(const QStringList &paths, const std::function<bool(const QString &, QString *)> &probe)
{
    ScanResult r;
    for (const QString &bundle : findBundles(paths)) {
        ++r.bundles;
        const QString bin = binaryForBundle(bundle);
        if (bin.isEmpty()) {
            r.failed << bundle + ": no Linux binary inside the bundle";
            continue;
        }
        QString err;
        if (probe && !probe(bin, &err)) {
            r.failed << bundle + ": " + err;
            PluginInfo info;
            info.identifier = QFileInfo(bundle).fileName();
            info.label = info.identifier;
            info.binaryPath = bin;
            info.bundlePath = bundle;
            info.error = err;
            probeFailures_.push_back(info);
            continue;
        }
        const int n = loadBinary(bin, bundle, &err);
        r.plugins += n;
        if (n == 0 && !err.isEmpty())
            r.failed << bundle + ": " + err;
    }
    return r;
}

std::vector<PluginInfo> Manager::plugins() const
{
    std::vector<PluginInfo> r = probeFailures_;
    for (const auto &p : gPlugins) {
        if (p->info.error.startsWith("superseded"))
            continue;   // older copies of a plugin that is loaded in a newer version
        PluginInfo i = p->info;
        i.loaded = i.loaded && !p->crashed;
        r.push_back(i);
    }
    return r;
}

void Manager::pruneInstances(const QSet<int> &live)
{
    for (auto it = gInstances.begin(); it != gInstances.end();) {
        if (!live.contains(it->first)) {
            callAction(*it->second->plugin, kOfxActionDestroyInstance, it->second.get(), nullptr, nullptr);
            it = gInstances.erase(it);
        } else {
            ++it;
        }
    }
}

void Manager::destroyAllInstances()
{
    pruneInstances({});
}

QString Manager::takeMessages()
{
    std::lock_guard<std::mutex> lock(gMessageMutex);
    const QString m = gMessages.join("\n");
    gMessages.clear();
    return m;
}

int Manager::probeMain(const QString &binaryPath)
{
    QString err;
    Manager &m = instance();
    const int n = m.loadBinary(binaryPath, QFileInfo(binaryPath).absolutePath(), &err);
    std::printf("plugins=%d\n", n);
    if (!err.isEmpty())
        std::printf("error=%s\n", qPrintable(err));
    m.destroyAllInstances();
    return n > 0 ? 0 : 2;
}

} // namespace mf::ofx
