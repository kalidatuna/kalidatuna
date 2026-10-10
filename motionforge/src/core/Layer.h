#pragma once
#include "Effect.h"
#include "Property.h"

#include <QColor>
#include <QJsonObject>
#include <functional>
#include <memory>
#include <vector>

namespace mf {

enum class LayerType { Solid, Footage, Text, Shape, Null, Adjustment, Precomp };
enum class BlendMode { Normal, Add, Multiply, Screen, Overlay, Darken, Lighten, ColorDodge,
                       ColorBurn, HardLight, SoftLight, Difference, Exclusion };
enum class MatteMode { None, Alpha, AlphaInverted, Luma, LumaInverted };
enum class ShapeKind { Rectangle, Ellipse, Polygon, Star };

QString layerTypeName(LayerType t);
QString blendModeName(BlendMode m);
QString matteModeName(MatteMode m);
QColor labelColor(int label);
QString labelName(int label);
constexpr int kLabelCount = 16;

// A titled set of properties, shown as a twirl-down group in the timeline.
struct PropGroup {
    QString name;
    std::vector<Property *> props;
};

class Layer {
public:
    explicit Layer(LayerType type = LayerType::Solid);

    int id = 0;
    LayerType type;
    QString name;
    int label = 0;

    // Timing, in composition seconds. startTime is where source time 0 sits.
    double inPoint = 0.0;
    double outPoint = 10.0;
    double startTime = 0.0;
    double stretch = 100.0;   // percent

    // Switches
    bool videoOn = true;
    bool audioOn = true;
    bool solo = false;
    bool locked = false;
    bool shy = false;
    bool motionBlur = false;
    BlendMode blend = BlendMode::Normal;
    MatteMode matte = MatteMode::None;   // uses the layer directly above as matte
    int parentId = 0;

    // Source
    int sourceItemId = 0;      // footage item or composition for Footage/Precomp
    bool hasAudio = false;     // source carries sound (set when the layer is created)
    bool audioOnly = false;    // source has no picture (e.g. an MP3)
    QColor solidColor = QColor(200, 60, 60);
    int width = 1920;          // solid / adjustment / null dimensions
    int height = 1080;

    // Text
    QString text = "Text";
    QString fontFamily = "Sans Serif";
    bool bold = false;
    bool italic = false;
    int align = 0;             // 0 left, 1 center, 2 right
    Property fontSize, fillColor, strokeColor, strokeWidth, tracking, leading;

    // Shape
    ShapeKind shapeKind = ShapeKind::Rectangle;
    Property shapeSize, shapeRoundness, shapeOffset, shapePoints, shapeInnerRatio;
    Property shapeFillOn, shapeFill, shapeStrokeOn, shapeStroke, shapeStrokeWidth;

    // Transform
    Property anchor, position, scale, rotation, opacity;

    // Audio
    Property audioLevels;      // dB

    // Time remapping (source seconds as a function of comp time)
    bool timeRemapEnabled = false;
    Property timeRemap;

    std::vector<std::unique_ptr<Effect>> effects;

    // UI twirl state
    bool expanded = false;
    bool transformExpanded = true;
    bool contentsExpanded = true;
    bool effectsExpanded = true;
    bool audioExpanded = true;

    bool activeAt(double t) const { return t >= inPoint - 1e-9 && t < outPoint - 1e-9; }
    bool hasVisual() const { return type != LayerType::Null && !audioOnly; }
    bool isTwoDimensionalSource() const { return type == LayerType::Footage || type == LayerType::Precomp; }

    std::vector<PropGroup> propertyGroups();
    std::vector<Property *> allProperties();
    Effect *effectByUid(int uid);
    void setDefaultAnchor(double w, double h);
    void forEachProperty(const std::function<void(Property &)> &fn);

    QJsonObject toJson() const;
    // effectFactory creates a blank effect of the given type (from the registry).
    static std::unique_ptr<Layer> fromJson(const QJsonObject &o,
                                           const std::function<std::unique_ptr<Effect>(const QString &)> &effectFactory);
};

} // namespace mf
