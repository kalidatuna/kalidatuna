//! Lumora: the plain-English AI academy.
//!
//! A single Rust binary serves the JSON API, Stripe webhooks and the compiled
//! single-page frontend. All course content is loaded into memory at startup.

pub mod auth;
pub mod billing;
pub mod certificate;
pub mod config;
pub mod content;
pub mod email;
pub mod error;
pub mod ratelimit;
pub mod routes;
pub mod security;
pub mod state;

use std::time::Duration;

use axum::{
    extract::DefaultBodyLimit,
    http::StatusCode,
    middleware,
    routing::{get, post},
    Json, Router,
};
use serde_json::json;
use tower_http::{
    compression::CompressionLayer,
    services::{ServeDir, ServeFile},
    timeout::TimeoutLayer,
    trace::TraceLayer,
};

use routes::{admin, auth as a, billing as b, learn, library, misc, support};
pub use state::AppState;

pub fn api_router() -> Router<AppState> {
    Router::new()
        .route("/health", get(misc::health))
        .route("/config", get(misc::site_config))
        .route("/leads", post(misc::lead))
        // auth & account
        .route("/auth/signup", post(a::signup))
        .route("/auth/login", post(a::login))
        .route("/auth/logout", post(a::logout))
        .route("/auth/forgot", post(support::forgot))
        .route("/auth/reset", post(support::reset))
        .route("/contact", post(support::contact))
        .route("/verify/{code}", get(support::verify))
        .route("/me", get(a::me).patch(a::update_me).delete(a::delete_me))
        .route("/me/password", post(a::change_password))
        .route("/me/export", get(a::export_me))
        // learning
        .route("/curriculum", get(learn::curriculum))
        .route("/lessons/{slug}", get(learn::lesson))
        .route("/lessons/{slug}/complete", post(learn::complete_lesson).delete(learn::uncomplete_lesson))
        .route("/modules/{slug}/quiz", get(learn::quiz).post(learn::submit_quiz))
        .route("/dashboard", get(learn::dashboard))
        .route("/bookmarks", get(learn::list_bookmarks).post(learn::add_bookmark).delete(learn::remove_bookmark))
        .route("/certificate", get(learn::certificate))
        // library
        .route("/prompts", get(library::prompts))
        .route("/glossary", get(library::glossary))
        .route("/tools", get(library::tools))
        .route("/playbooks", get(library::playbooks))
        .route("/playbooks/{slug}", get(library::playbook))
        .route("/search", get(library::search))
        // billing
        .route("/billing/plans", get(b::plans))
        .route("/billing/checkout", post(b::checkout))
        .route("/billing/portal", post(b::portal))
        .route("/billing/demo/complete", post(b::demo_complete))
        .route("/billing/demo/cancel", post(b::demo_cancel))
        .route("/stripe/webhook", post(b::stripe_webhook))
        // admin
        .route("/admin/stats", get(admin::stats))
        .route("/admin/users", get(admin::users))
        .route("/admin/leads.csv", get(admin::leads_csv))
        .route("/admin/messages", get(support::admin_messages))
        .route("/admin/emails", get(support::admin_emails))
        .fallback(|| async { (StatusCode::NOT_FOUND, Json(json!({ "error": { "code": "not_found", "message": "Not found." } }))) })
}

pub fn build_router(state: AppState) -> Router {
    let static_dir = state.config.static_dir.clone();
    let index = static_dir.join("index.html");
    let spa = ServeDir::new(&static_dir).precompressed_br().precompressed_gzip().fallback(ServeFile::new(index));

    Router::new()
        .nest("/api", api_router())
        .route("/sitemap.xml", get(misc::sitemap))
        .route("/robots.txt", get(misc::robots))
        .fallback_service(spa)
        .layer(middleware::from_fn_with_state(state.clone(), security::csrf_guard))
        .layer(middleware::from_fn_with_state(state.clone(), security::headers))
        .layer(DefaultBodyLimit::max(256 * 1024))
        .layer(CompressionLayer::new())
        .layer(TimeoutLayer::with_status_code(StatusCode::REQUEST_TIMEOUT, Duration::from_secs(30)))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
