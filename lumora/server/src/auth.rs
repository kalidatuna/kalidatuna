//! Password hashing, server-side sessions and the `CurrentUser` extractors.

use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use axum::{
    extract::{ConnectInfo, FromRequestParts},
    http::{request::Parts, HeaderMap},
};
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use base64::Engine;
use chrono::{Duration, Utc};
use rand::RngCore;
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::FromRow;
use std::net::SocketAddr;

use crate::{
    error::{ApiError, ApiResult},
    state::AppState,
};

pub const SESSION_COOKIE: &str = "lumora_session";

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct User {
    pub id: i64,
    pub email: String,
    pub name: String,
    pub role: String,
    pub plan: String,
    pub plan_status: String,
    pub plan_renews_at: Option<String>,
    #[serde(skip)]
    pub stripe_customer_id: Option<String>,
    #[serde(skip)]
    pub stripe_subscription_id: Option<String>,
    pub created_at: String,
}

pub const USER_COLUMNS: &str =
    "id, email, name, role, plan, plan_status, plan_renews_at, stripe_customer_id, stripe_subscription_id, created_at";

impl User {
    pub fn is_admin(&self) -> bool {
        self.role == "admin"
    }

    /// Does this member currently have access to Pro content?
    pub fn has_pro(&self) -> bool {
        if self.is_admin() {
            return true;
        }
        matches!(self.plan.as_str(), "monthly" | "yearly" | "lifetime") && matches!(self.plan_status.as_str(), "active" | "past_due")
    }

    pub fn view(&self) -> serde_json::Value {
        serde_json::json!({
            "id": self.id,
            "email": self.email,
            "name": self.name,
            "role": self.role,
            "plan": self.plan,
            "plan_status": self.plan_status,
            "plan_renews_at": self.plan_renews_at,
            "has_pro": self.has_pro(),
            "has_billing_portal": self.stripe_customer_id.is_some(),
            "created_at": self.created_at,
        })
    }
}

pub fn hash_password(password: &str) -> anyhow::Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default().hash_password(password.as_bytes(), &salt).map(|h| h.to_string()).map_err(|e| anyhow::anyhow!("hash error: {e}"))
}

pub fn verify_password(password: &str, hash: &str) -> bool {
    PasswordHash::new(hash).map(|parsed| Argon2::default().verify_password(password.as_bytes(), &parsed).is_ok()).unwrap_or(false)
}

/// Burns roughly the same CPU as a real verification (constant-ish login timing).
pub fn dummy_verify(password: &str) {
    static DUMMY: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| hash_password("lumora-dummy-password").unwrap_or_default());
    let _ = verify_password(password, &DUMMY);
}

pub fn hash_token(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

pub fn new_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// Creates a session row and returns the cookie to set.
pub async fn create_session(state: &AppState, user_id: i64) -> ApiResult<Cookie<'static>> {
    let token = new_token();
    let expires = Utc::now() + Duration::days(state.config.session_days);
    sqlx::query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
        .bind(hash_token(&token))
        .bind(user_id)
        .bind(expires.format("%Y-%m-%dT%H:%M:%SZ").to_string())
        .execute(&state.db)
        .await?;
    Ok(session_cookie(state, token, state.config.session_days))
}

pub fn session_cookie(state: &AppState, value: String, days: i64) -> Cookie<'static> {
    Cookie::build((SESSION_COOKIE, value))
        .http_only(true)
        .secure(state.config.cookie_secure)
        .same_site(SameSite::Lax)
        .path("/")
        .max_age(time_duration(days))
        .build()
}

fn time_duration(days: i64) -> cookie::time::Duration {
    cookie::time::Duration::days(days)
}

pub fn clear_cookie(state: &AppState) -> Cookie<'static> {
    session_cookie(state, String::new(), 0)
}

pub async fn user_from_jar(state: &AppState, jar: &CookieJar) -> ApiResult<Option<User>> {
    let Some(cookie) = jar.get(SESSION_COOKIE) else { return Ok(None) };
    if cookie.value().is_empty() {
        return Ok(None);
    }
    let sql = format!(
        "SELECT {} FROM users WHERE id = (SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > strftime('%Y-%m-%dT%H:%M:%SZ','now'))",
        USER_COLUMNS
    );
    let user = sqlx::query_as::<_, User>(&sql).bind(hash_token(cookie.value())).fetch_optional(&state.db).await?;
    Ok(user)
}

/// A signed-in member. Rejects with 401 otherwise.
pub struct CurrentUser(pub User);

/// Possibly a signed-in member.
pub struct MaybeUser(pub Option<User>);

impl FromRequestParts<AppState> for CurrentUser {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let jar = CookieJar::from_headers(&parts.headers);
        user_from_jar(state, &jar).await?.map(CurrentUser).ok_or(ApiError::Unauthorized)
    }
}

impl FromRequestParts<AppState> for MaybeUser {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let jar = CookieJar::from_headers(&parts.headers);
        Ok(MaybeUser(user_from_jar(state, &jar).await?))
    }
}

/// Signed-in admin. Rejects with 401/403 otherwise.
pub struct AdminUser(pub User);

impl FromRequestParts<AppState> for AdminUser {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let CurrentUser(user) = CurrentUser::from_request_parts(parts, state).await?;
        if !user.is_admin() {
            return Err(ApiError::Forbidden("Admins only.".into()));
        }
        Ok(AdminUser(user))
    }
}

/// Best-effort client IP for rate limiting.
pub struct ClientIp(pub String);

impl FromRequestParts<AppState> for ClientIp {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        Ok(ClientIp(client_ip(&parts.headers, parts.extensions.get::<ConnectInfo<SocketAddr>>(), state.config.trust_proxy)))
    }
}

pub fn client_ip(headers: &HeaderMap, connect: Option<&ConnectInfo<SocketAddr>>, trust_proxy: bool) -> String {
    if trust_proxy {
        if let Some(ip) = headers
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.split(',').next())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
        {
            return ip;
        }
    }
    connect.map(|c| c.0.ip().to_string()).unwrap_or_else(|| "unknown".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn password_roundtrip() {
        let h = hash_password("correct horse battery").unwrap();
        assert!(h.starts_with("$argon2id$"));
        assert!(verify_password("correct horse battery", &h));
        assert!(!verify_password("wrong", &h));
        assert!(!verify_password("x", "not-a-hash"));
    }

    #[test]
    fn tokens_are_unique_and_hashed() {
        let a = new_token();
        let b = new_token();
        assert_ne!(a, b);
        assert_eq!(hash_token(&a).len(), 64);
        assert_eq!(hash_token(&a), hash_token(&a));
    }

    #[test]
    fn pro_access_rules() {
        let mut u = User {
            id: 1,
            email: "a@b.c".into(),
            name: "A".into(),
            role: "member".into(),
            plan: "free".into(),
            plan_status: "none".into(),
            plan_renews_at: None,
            stripe_customer_id: None,
            stripe_subscription_id: None,
            created_at: String::new(),
        };
        assert!(!u.has_pro());
        u.plan = "monthly".into();
        u.plan_status = "active".into();
        assert!(u.has_pro());
        u.plan_status = "canceled".into();
        assert!(!u.has_pro());
        u.plan = "free".into();
        u.role = "admin".into();
        assert!(u.has_pro());
    }
}
