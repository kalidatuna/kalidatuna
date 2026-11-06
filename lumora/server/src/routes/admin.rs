use axum::{
    extract::{Query, State},
    http::header,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{auth::AdminUser, error::ApiResult, state::AppState};

pub async fn stats(State(state): State<AppState>, AdminUser(_): AdminUser) -> ApiResult<Json<Value>> {
    let db = &state.db;
    let (users,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users").fetch_one(db).await?;
    let (leads,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM leads").fetch_one(db).await?;
    let plan_rows: Vec<(String, i64)> =
        sqlx::query_as("SELECT plan, COUNT(*) FROM users WHERE plan_status IN ('active','past_due') AND plan != 'free' GROUP BY plan")
            .fetch_all(db)
            .await?;
    let (revenue,): (i64,) = sqlx::query_as("SELECT COALESCE(SUM(amount_cents),0) FROM payments").fetch_one(db).await?;
    let (completions,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM progress").fetch_one(db).await?;
    let signups: Vec<(String, i64)> = sqlx::query_as(
        "SELECT substr(created_at,1,10) d, COUNT(*) FROM users WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-30 days') GROUP BY d ORDER BY d",
    )
    .fetch_all(db)
    .await?;
    let top: Vec<(String, i64)> =
        sqlx::query_as("SELECT lesson_slug, COUNT(*) c FROM progress GROUP BY lesson_slug ORDER BY c DESC LIMIT 5").fetch_all(db).await?;

    let count = |p: &str| plan_rows.iter().find(|(k, _)| k == p).map(|(_, c)| *c).unwrap_or(0);
    let monthly = count("monthly");
    let yearly = count("yearly");
    let lifetime = count("lifetime");
    let price = |id: &str| crate::billing::plan(id).map(|p| p.price_cents).unwrap_or(0);
    let mrr_cents = monthly * price("monthly") + yearly * price("yearly") / 12;
    let paying = monthly + yearly + lifetime;
    Ok(Json(json!({
        "users": users,
        "leads": leads,
        "paying": paying,
        "plans": { "monthly": monthly, "yearly": yearly, "lifetime": lifetime },
        "conversion_percent": if users == 0 { 0.0 } else { (paying as f64 * 1000.0 / users as f64).round() / 10.0 },
        "mrr_cents": mrr_cents,
        "revenue_cents": revenue,
        "lesson_completions": completions,
        "signups_30d": signups.into_iter().map(|(d, c)| json!({"day": d, "count": c})).collect::<Vec<_>>(),
        "top_lessons": top.into_iter().map(|(s, c)| json!({
            "slug": s.clone(), "count": c,
            "title": state.content.lesson(&s).map(|l| l.title.clone()).unwrap_or(s),
        })).collect::<Vec<_>>(),
    })))
}

#[derive(Deserialize)]
pub struct UserQuery {
    pub q: Option<String>,
}

pub async fn users(State(state): State<AppState>, AdminUser(_): AdminUser, Query(q): Query<UserQuery>) -> ApiResult<Json<Value>> {
    let needle = format!("%{}%", q.q.unwrap_or_default().trim());
    let rows: Vec<(i64, String, String, String, String, String, i64)> = sqlx::query_as(
        "SELECT u.id, u.email, u.name, u.plan, u.plan_status, u.created_at,
                (SELECT COUNT(*) FROM progress p WHERE p.user_id = u.id)
         FROM users u WHERE u.email LIKE ?1 OR u.name LIKE ?1 ORDER BY u.id DESC LIMIT 200",
    )
    .bind(needle)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({ "users": rows.into_iter().map(|(id, email, name, plan, status, created, done)| json!({
        "id": id, "email": email, "name": name, "plan": plan, "plan_status": status, "created_at": created, "lessons_completed": done,
    })).collect::<Vec<_>>() })))
}

pub async fn leads_csv(State(state): State<AppState>, AdminUser(_): AdminUser) -> ApiResult<impl IntoResponse> {
    let rows: Vec<(String, String, String)> =
        sqlx::query_as("SELECT email, source, created_at FROM leads ORDER BY id DESC").fetch_all(&state.db).await?;
    let mut csv = String::from("email,source,created_at\n");
    for (e, s, c) in rows {
        let esc = |v: &str| {
            // Neutralise spreadsheet formula injection and quote every field.
            let v = if v.starts_with(['=', '+', '-', '@']) { format!("'{v}") } else { v.to_string() };
            format!("\"{}\"", v.replace('"', "\"\""))
        };
        csv.push_str(&format!("{},{},{}\n", esc(&e), esc(&s), esc(&c)));
    }
    Ok((
        [(header::CONTENT_TYPE, "text/csv; charset=utf-8"), (header::CONTENT_DISPOSITION, "attachment; filename=\"lumora-leads.csv\"")],
        csv,
    ))
}
