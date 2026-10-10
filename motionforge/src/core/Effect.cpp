#include "Effect.h"

#include <QJsonArray>

namespace mf {

Property *Effect::param(const QString &id)
{
    for (auto &p : params)
        if (p.id == id)
            return &p;
    return nullptr;
}

const Property *Effect::param(const QString &id) const
{
    return const_cast<Effect *>(this)->param(id);
}

QJsonObject Effect::toJson() const
{
    QJsonObject o;
    o["type"] = typeId;
    o["uid"] = uid;
    o["name"] = name;
    o["enabled"] = enabled;
    o["expanded"] = expanded;
    QJsonObject ps;
    for (const auto &p : params)
        ps[p.id] = p.toJson();
    o["params"] = ps;
    return o;
}

void Effect::applyJson(const QJsonObject &o)
{
    name = o["name"].toString(name);
    enabled = o["enabled"].toBool(true);
    expanded = o["expanded"].toBool(true);
    const auto ps = o["params"].toObject();
    for (auto &p : params)
        if (ps.contains(p.id))
            p.fromJson(ps[p.id].toObject());
}

} // namespace mf
