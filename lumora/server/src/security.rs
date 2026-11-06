//! Security headers, CSRF defence and cache policy.

use axum::{
    body::Body,
    extract::{Request, State},
    http::{header, HeaderValue, Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

use crate::state::AppState;

const CSP: &str = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; \
connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; \
form-action 'self' https://checkout.stripe.com https://billing.stripe.com";

/// Rejects cross-site state-changing API requests.
///
/// Session cookies are `SameSite=Lax`, and mutating requests must carry a JSON
/// content type (which cross-site HTML forms cannot send without a CORS preflight),
/// plus a same-origin `Origin` header when the browser provides one.
pub async fn csrf_guard(State(state): State<AppState>, req: Request, next: Next) -> Response {
    let path = req.uri().path();
    let mutating = !matches!(*req.method(), Method::GET | Method::HEAD | Method::OPTIONS);
    if mutating && path.starts_with("/api/") && path != "/api/stripe/webhook" {
        let headers = req.headers();
        let json_ct = headers.get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).is_some_and(|v| v.starts_with("application/json"));
        if !json_ct {
            return reject("Requests must be sent as JSON.");
        }
        if let Some(origin) = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) {
            let host = headers.get(header::HOST).and_then(|v| v.to_str().ok()).unwrap_or_default();
            let origin_host = origin.split("://").nth(1).unwrap_or_default();
            let public_host = state.config.public_url.split("://").nth(1).unwrap_or_default().trim_end_matches('/');
            if origin != "null" && origin_host != host && origin_host != public_host {
                return reject("Cross-site request blocked.");
            }
        }
    }
    next.run(req).await
}

fn reject(msg: &str) -> Response {
    (StatusCode::FORBIDDEN, Json(json!({ "error": { "code": "csrf", "message": msg } }))).into_response()
}

pub async fn headers(State(state): State<AppState>, req: Request<Body>, next: Next) -> Response {
    let path = req.uri().path().to_string();
    let mut res = next.run(req).await;
    let h = res.headers_mut();
    h.insert("x-content-type-options", HeaderValue::from_static("nosniff"));
    h.insert("x-frame-options", HeaderValue::from_static("DENY"));
    h.insert("referrer-policy", HeaderValue::from_static("strict-origin-when-cross-origin"));
    h.insert("permissions-policy", HeaderValue::from_static("camera=(), microphone=(), geolocation=(), payment=()"));
    h.insert("cross-origin-opener-policy", HeaderValue::from_static("same-origin"));
    h.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static(CSP));
    if state.config.cookie_secure {
        h.insert(header::STRICT_TRANSPORT_SECURITY, HeaderValue::from_static("max-age=63072000; includeSubDomains"));
    }
    if !h.contains_key(header::CACHE_CONTROL) {
        let policy = if path.starts_with("/api/") {
            "no-store"
        } else if path.starts_with("/assets/") {
            "public, max-age=31536000, immutable"
        } else if path.starts_with("/fonts/") || path.ends_with(".svg") || path.ends_with(".png") || path.ends_with(".webp") {
            "public, max-age=604800"
        } else {
            "no-cache"
        };
        h.insert(header::CACHE_CONTROL, HeaderValue::from_static(policy));
    }
    res
}
