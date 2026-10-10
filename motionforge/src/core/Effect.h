#pragma once
#include "Property.h"

#include <QJsonObject>
#include <memory>
#include <vector>

namespace mf {

// One applied effect on a layer. Its parameter list comes from the effect
// registry (render/Effects.h); only values are stored in project files.
class Effect {
public:
    int uid = 0;
    QString typeId;
    QString name;
    bool enabled = true;
    bool expanded = true;   // twirl state in Effect Controls
    std::vector<Property> params;
    // Set when the effect's plugin isn't installed: the saved data is kept and written back unchanged.
    QJsonObject missingJson;
    bool isMissing() const { return !missingJson.isEmpty(); }

    Property *param(const QString &id);
    const Property *param(const QString &id) const;

    QJsonObject toJson() const;
    // Restores values into a freshly created instance of the same type.
    void applyJson(const QJsonObject &o);
};

} // namespace mf
