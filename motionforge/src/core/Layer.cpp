#include "Layer.h"

#include <QJsonArray>
#include <algorithm>

namespace mf {

QString layerTypeName(LayerType t)
{
    switch (t) {
    case LayerType::Solid: return "Solid";
    case LayerType::Footage: return "Footage";
    case LayerType::Text: return "Text";
    case LayerType::Shape: return "Shape";
    case LayerType::Null: return "Null";
    case LayerType::Adjustment: return "Adjustment";
    case LayerType::Precomp: return "Precomp";
    }
    return {};
}

QString blendModeName(BlendMode m)
{
    static const char *names[] = {"Normal", "Add", "Multiply", "Screen", "Overlay", "Darken", "Lighten",
                                  "Color Dodge", "Color Burn", "Hard Light", "Soft Light", "Difference",
                                  "Exclusion"};
    return names[int(m)];
}

QString matteModeName(MatteMode m)
{
    static const char *names[] = {"No Track Matte", "Alpha Matte", "Alpha Inverted Matte", "Luma Matte",
                                  "Luma Inverted Matte"};
    return names[int(m)];
}

static const struct { const char *name; QRgb rgb; } kLabels[] = {
    {"None", 0x808080},     {"Red", 0xB53838},      {"Yellow", 0xE4D84C},   {"Aqua", 0xA9CBC7},
    {"Pink", 0xE5BCC9},     {"Lavender", 0xA9A9CA}, {"Peach", 0xE7C19E},    {"Sea Foam", 0xB3C7B3},
    {"Blue", 0x677DE0},     {"Green", 0x4AA44C},    {"Purple", 0x8E2C9A},   {"Orange", 0xE8920D},
    {"Brown", 0x7F452A},    {"Fuchsia", 0xF46DD6},  {"Cyan", 0x3DA2A5},     {"Sandstone", 0xA89677},
    {"Dark Green", 0x1E401E},
};

QColor labelColor(int label)
{
    return QColor(kLabels[std::clamp(label, 0, kLabelCount)].rgb);
}

QString labelName(int label)
{
    return kLabels[std::clamp(label, 0, kLabelCount)].name;
}

Layer::Layer(LayerType t) : type(t)
{
    anchor = Property("anchor", "Anchor Point", PropType::Point, {0, 0});
    position = Property("position", "Position", PropType::Point, {960, 540});
    scale = Property("scale", "Scale", PropType::Percent, {100, 100});
    rotation = Property("rotation", "Rotation", PropType::Angle, {0});
    opacity = Property("opacity", "Opacity", PropType::Percent, {100});
    opacity.limits(0, 100);

    audioLevels = Property("audioLevels", "Audio Levels", PropType::Number, {0});
    audioLevels.limits(-96, 24).step(0.1);

    timeRemap = Property("timeRemap", "Time Remap", PropType::Time, {0});
    timeRemap.limits(0, 1e6).step(1.0 / 30.0);

    fontSize = Property("fontSize", "Font Size", PropType::Number, {96});
    fontSize.limits(1, 4000);
    fillColor = Property("fillColor", "Fill Color", PropType::Color, {1, 1, 1, 1});
    strokeColor = Property("strokeColor", "Stroke Color", PropType::Color, {0, 0, 0, 1});
    strokeWidth = Property("strokeWidth", "Stroke Width", PropType::Number, {0});
    strokeWidth.limits(0, 1000).step(0.5);
    tracking = Property("tracking", "Tracking", PropType::Number, {0});
    tracking.limits(-1000, 10000);
    leading = Property("leading", "Leading (0 = Auto)", PropType::Number, {0});
    leading.limits(0, 10000);

    shapeSize = Property("shapeSize", "Size", PropType::Number, {400, 400});
    shapeSize.limits(0, 100000);
    shapeRoundness = Property("shapeRoundness", "Roundness", PropType::Number, {0});
    shapeRoundness.limits(0, 100000);
    shapeOffset = Property("shapeOffset", "Shape Position", PropType::Point, {0, 0});
    shapePoints = Property("shapePoints", "Points", PropType::Number, {5});
    shapePoints.limits(3, 200).step(0.1);
    shapeInnerRatio = Property("shapeInnerRatio", "Inner Radius", PropType::Percent, {45});
    shapeInnerRatio.limits(1, 100);
    shapeFillOn = Property("shapeFillOn", "Fill", PropType::Checkbox, {1});
    shapeFill = Property("shapeFill", "Fill Color", PropType::Color, {0.18, 0.55, 1.0, 1.0});
    shapeStrokeOn = Property("shapeStrokeOn", "Stroke", PropType::Checkbox, {0});
    shapeStroke = Property("shapeStroke", "Stroke Color", PropType::Color, {1, 1, 1, 1});
    shapeStrokeWidth = Property("shapeStrokeWidth", "Stroke Width", PropType::Number, {6});
    shapeStrokeWidth.limits(0, 2000).step(0.5);

    switch (t) {
    case LayerType::Footage: label = 3; break;
    case LayerType::Precomp: label = 15; break;
    case LayerType::Shape: label = 8; break;
    case LayerType::Adjustment: label = 5; break;
    default: label = 1; break;
    }
}

std::vector<PropGroup> Layer::propertyGroups()
{
    std::vector<PropGroup> groups;
    if (type == LayerType::Text)
        groups.push_back({"Text", {&fontSize, &fillColor, &strokeColor, &strokeWidth, &tracking, &leading}});
    if (type == LayerType::Shape) {
        PropGroup g{"Contents", {}};
        g.props.push_back(&shapeSize);
        if (shapeKind == ShapeKind::Rectangle)
            g.props.push_back(&shapeRoundness);
        if (shapeKind == ShapeKind::Polygon || shapeKind == ShapeKind::Star)
            g.props.push_back(&shapePoints);
        if (shapeKind == ShapeKind::Star)
            g.props.push_back(&shapeInnerRatio);
        for (Property *p : {&shapeOffset, &shapeFillOn, &shapeFill, &shapeStrokeOn, &shapeStroke, &shapeStrokeWidth})
            g.props.push_back(p);
        groups.push_back(g);
    }
    if (timeRemapEnabled)
        groups.push_back({"Time Remap", {&timeRemap}});
    if (!audioOnly)
        groups.push_back({"Transform", {&anchor, &position, &scale, &rotation, &opacity}});
    if (hasAudio)
        groups.push_back({"Audio", {&audioLevels}});
    return groups;
}

std::vector<Property *> Layer::allProperties()
{
    return {&anchor, &position, &scale, &rotation, &opacity, &timeRemap, &audioLevels,
            &fontSize, &fillColor, &strokeColor, &strokeWidth, &tracking, &leading,
            &shapeSize, &shapeRoundness, &shapeOffset, &shapePoints, &shapeInnerRatio,
            &shapeFillOn, &shapeFill, &shapeStrokeOn, &shapeStroke, &shapeStrokeWidth};
}

void Layer::forEachProperty(const std::function<void(Property &)> &fn)
{
    for (Property *p : allProperties())
        fn(*p);
    for (auto &e : effects)
        for (auto &p : e->params)
            fn(p);
}

Effect *Layer::effectByUid(int uid)
{
    for (auto &e : effects)
        if (e->uid == uid)
            return e.get();
    return nullptr;
}

void Layer::setDefaultAnchor(double w, double h)
{
    anchor.defaultValue = anchor.staticValue = {w / 2.0, h / 2.0};
}

QJsonObject Layer::toJson() const
{
    QJsonObject o;
    o["id"] = id;
    o["type"] = layerTypeName(type);
    o["name"] = name;
    o["label"] = label;
    o["in"] = inPoint;
    o["out"] = outPoint;
    o["start"] = startTime;
    o["stretch"] = stretch;
    o["video"] = videoOn;
    o["audio"] = audioOn;
    o["hasAudio"] = hasAudio;
    o["audioOnly"] = audioOnly;
    o["solo"] = solo;
    o["locked"] = locked;
    o["shy"] = shy;
    o["motionBlur"] = motionBlur;
    o["blend"] = int(blend);
    o["matte"] = int(matte);
    o["parent"] = parentId;
    o["source"] = sourceItemId;
    o["solidColor"] = solidColor.name(QColor::HexArgb);
    o["width"] = width;
    o["height"] = height;
    o["text"] = text;
    o["font"] = fontFamily;
    o["bold"] = bold;
    o["italic"] = italic;
    o["align"] = align;
    o["shapeKind"] = int(shapeKind);
    o["timeRemapOn"] = timeRemapEnabled;
    o["expanded"] = expanded;
    QJsonObject props;
    for (Property *p : const_cast<Layer *>(this)->allProperties()) {
        QJsonObject po = p->toJson();
        po["default"] = QJsonArray::fromVariantList([&] {
            QVariantList l;
            for (double d : p->defaultValue)
                l << d;
            return l;
        }());
        props[p->id] = po;
    }
    o["props"] = props;
    QJsonArray fx;
    for (const auto &e : effects)
        fx.append(e->toJson());
    o["effects"] = fx;
    return o;
}

static LayerType layerTypeFromName(const QString &s)
{
    for (int i = 0; i <= int(LayerType::Precomp); ++i)
        if (layerTypeName(LayerType(i)) == s)
            return LayerType(i);
    return LayerType::Solid;
}

std::unique_ptr<Layer> Layer::fromJson(const QJsonObject &o,
                                       const std::function<std::unique_ptr<Effect>(const QString &)> &effectFactory)
{
    auto l = std::make_unique<Layer>(layerTypeFromName(o["type"].toString()));
    l->id = o["id"].toInt();
    l->name = o["name"].toString();
    l->label = o["label"].toInt(l->label);
    l->inPoint = o["in"].toDouble();
    l->outPoint = o["out"].toDouble(10);
    l->startTime = o["start"].toDouble();
    l->stretch = o["stretch"].toDouble(100);
    l->videoOn = o["video"].toBool(true);
    l->audioOn = o["audio"].toBool(true);
    l->hasAudio = o["hasAudio"].toBool();
    l->audioOnly = o["audioOnly"].toBool();
    l->solo = o["solo"].toBool();
    l->locked = o["locked"].toBool();
    l->shy = o["shy"].toBool();
    l->motionBlur = o["motionBlur"].toBool();
    l->blend = BlendMode(std::clamp(o["blend"].toInt(), 0, int(BlendMode::Exclusion)));
    l->matte = MatteMode(std::clamp(o["matte"].toInt(), 0, int(MatteMode::LumaInverted)));
    l->parentId = o["parent"].toInt();
    l->sourceItemId = o["source"].toInt();
    l->solidColor = QColor(o["solidColor"].toString("#ffc83c3c"));
    l->width = o["width"].toInt(1920);
    l->height = o["height"].toInt(1080);
    l->text = o["text"].toString();
    l->fontFamily = o["font"].toString("Sans Serif");
    l->bold = o["bold"].toBool();
    l->italic = o["italic"].toBool();
    l->align = o["align"].toInt();
    l->shapeKind = ShapeKind(std::clamp(o["shapeKind"].toInt(), 0, int(ShapeKind::Star)));
    l->timeRemapEnabled = o["timeRemapOn"].toBool();
    l->expanded = o["expanded"].toBool();
    const auto props = o["props"].toObject();
    for (Property *p : l->allProperties()) {
        if (!props.contains(p->id))
            continue;
        const auto po = props[p->id].toObject();
        if (po.contains("default")) {
            Value d;
            for (const auto &v : po["default"].toArray())
                d.append(v.toDouble());
            if (d.size() == p->defaultValue.size())
                p->defaultValue = d;
        }
        p->fromJson(po);
    }
    for (const auto &fv : o["effects"].toArray()) {
        const auto fo = fv.toObject();
        auto e = effectFactory ? effectFactory(fo["type"].toString()) : nullptr;
        if (!e) {
            e = std::make_unique<Effect>();
            e->typeId = fo["type"].toString();
            e->name = "Missing: " + fo["name"].toString(e->typeId);
            e->uid = fo["uid"].toInt();
            e->enabled = false;
            e->missingJson = fo;
            l->effects.push_back(std::move(e));
            continue;
        }
        e->applyJson(fo);
        e->uid = fo["uid"].toInt(e->uid);
        l->effects.push_back(std::move(e));
    }
    return l;
}

} // namespace mf
