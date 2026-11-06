use axum::{extract::State, http::header, response::IntoResponse, Json};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    auth::ClientIp,
    billing::PLANS,
    config::BillingMode,
    error::{ApiError, ApiResult},
    routes::auth::valid_email,
    state::AppState,
};

pub async fn health(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    sqlx::query("SELECT 1").execute(&state.db).await?;
    Ok(Json(json!({ "status": "ok", "version": env!("CARGO_PKG_VERSION"), "lessons": state.content.order.len() })))
}

pub async fn site_config(State(state): State<AppState>) -> Json<Value> {
    let c = &state.content;
    Json(json!({
        "name": "Lumora",
        "billing_mode": if state.config.billing == BillingMode::Demo { "demo" } else { "stripe" },
        "plans": PLANS,
        "stats": {
            "modules": c.modules.len(),
            "lessons": c.order.len(),
            "free_lessons": c.lessons.values().filter(|l| l.free).count(),
            "minutes": c.total_minutes(),
            "prompts": c.prompts.len(),
            "playbooks": c.playbooks.len(),
            "terms": c.glossary.len(),
            "tools": c.tools.len(),
            "quiz_questions": c.modules.iter().map(|m| m.quiz.len()).sum::<usize>(),
        },
        "modules": c.modules.iter().map(|m| json!({
            "slug": m.slug, "title": m.title, "tagline": m.tagline, "model": m.model, "color": m.color,
            "lessons": m.lessons.len(), "free": m.free,
        })).collect::<Vec<_>>(),
    }))
}

#[derive(Deserialize)]
pub struct LeadBody {
    pub email: String,
    pub source: Option<String>,
}

pub async fn lead(State(state): State<AppState>, ClientIp(ip): ClientIp, Json(body): Json<LeadBody>) -> ApiResult<Json<Value>> {
    if !state.limiter.check("lead", &ip) {
        return Err(ApiError::TooManyRequests);
    }
    let email = body.email.trim().to_lowercase();
    if !valid_email(&email) {
        return Err(ApiError::bad("That email address doesn't look right."));
    }
    let source: String =
        body.source.unwrap_or_else(|| "landing".into()).chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(40).collect();
    sqlx::query("INSERT OR IGNORE INTO leads (email, source) VALUES (?, ?)").bind(&email).bind(source).execute(&state.db).await?;
    Ok(Json(json!({ "ok": true, "starter_kit": "/starter-kit" })))
}

pub async fn sitemap(State(state): State<AppState>) -> impl IntoResponse {
    let base = state.config.public_url.trim_end_matches('/');
    let mut urls: Vec<String> =
        ["", "/pricing", "/learn", "/prompts", "/playbooks", "/glossary", "/tools", "/prompt-builder", "/starter-kit"]
            .iter()
            .map(|p| format!("{base}{p}"))
            .collect();
    urls.extend(state.content.order.iter().map(|s| format!("{base}/learn/{s}")));
    urls.extend(state.content.playbooks.iter().map(|p| format!("{base}/playbooks/{}", p.slug)));
    let body = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n{}</urlset>\n",
        urls.iter().map(|u| format!("  <url><loc>{u}</loc></url>\n")).collect::<String>()
    );
    ([(header::CONTENT_TYPE, "application/xml; charset=utf-8")], body)
}

pub async fn robots(State(state): State<AppState>) -> impl IntoResponse {
    let base = state.config.public_url.trim_end_matches('/');
    (
        [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        format!("User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /account\nDisallow: /admin\nSitemap: {base}/sitemap.xml\n"),
    )
}
