// Minimal OpenFX plugins written for MotionForge's host tests (BSD-3, same as the SDK examples).
//  - org.motionforge.test.TimeOffset: outputs the source from `offset` frames away (temporal access)
//  - org.motionforge.test.Crasher:    segfaults while rendering (crash-guard test)
#include "ofxImageEffect.h"
#include "ofxMemory.h"

#include <cstring>

static OfxHost *gHost = nullptr;
static OfxImageEffectSuiteV1 *gEffect = nullptr;
static OfxPropertySuiteV1 *gProp = nullptr;
static OfxParameterSuiteV1 *gParam = nullptr;

static void setHost(OfxHost *h) { gHost = h; }

static OfxStatus load()
{
    gEffect = (OfxImageEffectSuiteV1 *)gHost->fetchSuite(gHost->host, kOfxImageEffectSuite, 1);
    gProp = (OfxPropertySuiteV1 *)gHost->fetchSuite(gHost->host, kOfxPropertySuite, 1);
    gParam = (OfxParameterSuiteV1 *)gHost->fetchSuite(gHost->host, kOfxParameterSuite, 1);
    int temporal = 0;
    gProp->propGetInt(gHost->host, kOfxImageEffectPropTemporalClipAccess, 0, &temporal);
    return (gEffect && gProp && gParam && temporal) ? kOfxStatOK : kOfxStatErrMissingHostFeature;
}

static OfxStatus describe(OfxImageEffectHandle effect, const char *label)
{
    OfxPropertySetHandle props;
    gEffect->getPropertySet(effect, &props);
    gProp->propSetString(props, kOfxPropLabel, 0, label);
    gProp->propSetString(props, kOfxImageEffectPluginPropGrouping, 0, "MotionForge Tests");
    gProp->propSetString(props, kOfxImageEffectPropSupportedContexts, 0, kOfxImageEffectContextFilter);
    gProp->propSetString(props, kOfxImageEffectPropSupportedPixelDepths, 0, kOfxBitDepthFloat);
    gProp->propSetInt(props, kOfxImageEffectPropTemporalClipAccess, 0, 1);
    return kOfxStatOK;
}

static OfxStatus describeInContext(OfxImageEffectHandle effect)
{
    OfxPropertySetHandle props;
    gEffect->clipDefine(effect, kOfxImageEffectOutputClipName, &props);
    gProp->propSetString(props, kOfxImageEffectPropSupportedComponents, 0, kOfxImageComponentRGBA);
    gEffect->clipDefine(effect, kOfxImageEffectSimpleSourceClipName, &props);
    gProp->propSetString(props, kOfxImageEffectPropSupportedComponents, 0, kOfxImageComponentRGBA);
    gProp->propSetInt(props, kOfxImageEffectPropTemporalClipAccess, 0, 1);
    OfxParamSetHandle params;
    gEffect->getParamSet(effect, &params);
    gParam->paramDefine(params, kOfxParamTypeInteger, "offset", &props);
    gProp->propSetInt(props, kOfxParamPropDefault, 0, -5);
    gProp->propSetString(props, kOfxPropLabel, 0, "Frame Offset");
    return kOfxStatOK;
}

static OfxStatus render(OfxImageEffectHandle instance, OfxPropertySetHandle inArgs, bool crash)
{
    if (crash) {
        volatile int *p = nullptr;
        *p = 42;   // deliberate segfault
    }
    double time;
    gProp->propGetDouble(inArgs, kOfxPropTime, 0, &time);
    OfxParamSetHandle params;
    gEffect->getParamSet(instance, &params);
    OfxParamHandle offset;
    gParam->paramGetHandle(params, "offset", &offset, nullptr);
    int off = 0;
    gParam->paramGetValueAtTime(offset, time, &off);

    OfxImageClipHandle outClip, srcClip;
    gEffect->clipGetHandle(instance, kOfxImageEffectOutputClipName, &outClip, nullptr);
    gEffect->clipGetHandle(instance, kOfxImageEffectSimpleSourceClipName, &srcClip, nullptr);
    OfxPropertySetHandle outImg = nullptr, srcImg = nullptr;
    if (gEffect->clipGetImage(outClip, time, nullptr, &outImg) != kOfxStatOK)
        return kOfxStatFailed;
    if (gEffect->clipGetImage(srcClip, time + off, nullptr, &srcImg) != kOfxStatOK) {
        gEffect->clipReleaseImage(outImg);
        return kOfxStatOK;   // nothing there: leave black
    }
    int ob[4], sb[4], orb, srb;
    void *od, *sd;
    gProp->propGetIntN(outImg, kOfxImagePropBounds, 4, ob);
    gProp->propGetIntN(srcImg, kOfxImagePropBounds, 4, sb);
    gProp->propGetInt(outImg, kOfxImagePropRowBytes, 0, &orb);
    gProp->propGetInt(srcImg, kOfxImagePropRowBytes, 0, &srb);
    gProp->propGetPointer(outImg, kOfxImagePropData, 0, &od);
    gProp->propGetPointer(srcImg, kOfxImagePropData, 0, &sd);
    for (int y = ob[1]; y < ob[3]; ++y)
        for (int x = ob[0]; x < ob[2]; ++x) {
            float *o = (float *)((char *)od + (y - ob[1]) * orb) + (x - ob[0]) * 4;
            if (x >= sb[0] && x < sb[2] && y >= sb[1] && y < sb[3])
                std::memcpy(o, (float *)((char *)sd + (y - sb[1]) * srb) + (x - sb[0]) * 4, 16);
            else
                std::memset(o, 0, 16);
        }
    gEffect->clipReleaseImage(srcImg);
    gEffect->clipReleaseImage(outImg);
    return kOfxStatOK;
}

static OfxStatus mainCommon(const char *action, const void *h, OfxPropertySetHandle in, const char *label, bool crash)
{
    auto effect = (OfxImageEffectHandle)h;
    if (!std::strcmp(action, kOfxActionLoad))
        return load();
    if (!std::strcmp(action, kOfxActionDescribe))
        return describe(effect, label);
    if (!std::strcmp(action, kOfxImageEffectActionDescribeInContext))
        return describeInContext(effect);
    if (!std::strcmp(action, kOfxImageEffectActionRender))
        return render(effect, in, crash);
    return kOfxStatReplyDefault;
}

static OfxStatus mainOffset(const char *a, const void *h, OfxPropertySetHandle in, OfxPropertySetHandle)
{
    return mainCommon(a, h, in, "Test Time Offset", false);
}
static OfxStatus mainCrash(const char *a, const void *h, OfxPropertySetHandle in, OfxPropertySetHandle)
{
    return mainCommon(a, h, in, "Test Crasher", true);
}

static OfxPlugin gPlugins[] = {
    {kOfxImageEffectPluginApi, 1, "org.motionforge.test.TimeOffset", 1, 0, setHost, mainOffset},
    {kOfxImageEffectPluginApi, 1, "org.motionforge.test.Crasher", 1, 0, setHost, mainCrash},
};

extern "C" {
OfxExport int OfxGetNumberOfPlugins(void) { return 2; }
OfxExport OfxPlugin *OfxGetPlugin(int nth) { return (nth >= 0 && nth < 2) ? &gPlugins[nth] : nullptr; }
}
