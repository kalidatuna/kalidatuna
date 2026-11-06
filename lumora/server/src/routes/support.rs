use axum::{
    extract::{Path, State},
    Json,
};
use axum_extra::extract::CookieJar;
use chrono::{Duration, Utc};
use rand::Rng;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    auth::{self, AdminUser, ClientIp, MaybeUser},
    email,
    error::{ApiError, ApiResult},
    routes::auth::{load_user, valid_email, validate_password},
    state::AppState,
};

#[derive(Deserialize)]
pub struct ForgotBody {
    pub email: String,
}

/// Always answers the same way, so it can't be used to discover which emails have accounts.
pub async fn forgot(State(state): State<AppState>, ClientIp(ip): ClientIp, Json(body): Json<ForgotBody>) -> ApiResult<Json<Value>> {
    if !state.limiter.check("forgot", &ip) {
        return Err(ApiError::TooManyRequests);
    }
    let email_addr = body.email.trim().to_lowercase();
    let row: Option<(i64, String)> =
        sqlx::query_as("SELECT id, name FROM users WHERE email = ?").bind(&email_addr).fetch_optional(&state.db).await?;
    if let Some((user_id, name)) = row {
        let token = auth::new_token();
        let expires = (Utc::now() + Duration::hours(1)).format("%Y-%m-%dT%H:%M:%SZ").to_string();
        sqlx::query("INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
            .bind(auth::hash_token(&token))
            .bind(user_id)
            .bind(expires)
            .execute(&state.db)
            .await?;
        let link = format!("{}/reset-password?token={}", state.config.public_url.trim_end_matches('/'), token);
        email::send(&state, email::password_reset(&email_addr, &name, &link)).await;
    }
    Ok(Json(json!({ "ok": true, "message": "If an account exists for that email, a reset link is on its way." })))
}

#[derive(Deserialize)]
pub struct ResetBody {
    pub token: String,
    pub password: String,
}

pub async fn reset(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    jar: CookieJar,
    Json(body): Json<ResetBody>,
) -> ApiResult<(CookieJar, Json<Value>)> {
    if !state.limiter.check("reset", &ip) {
        return Err(ApiError::TooManyRequests);
    }
    validate_password(&body.password)?;
    let row: Option<(i64,)> = sqlx::query_as(
        "SELECT user_id FROM password_resets WHERE token_hash = ? AND used = 0 AND expires_at > strftime('%Y-%m-%dT%H:%M:%SZ','now')",
    )
    .bind(auth::hash_token(&body.token))
    .fetch_optional(&state.db)
    .await?;
    let Some((user_id,)) = row else {
        return Err(ApiError::bad("This reset link is invalid or has expired. Please request a new one."));
    };
    let hash = auth::hash_password(&body.password)?;
    let mut tx = state.db.begin().await?;
    sqlx::query("UPDATE users SET password_hash = ? WHERE id = ?").bind(hash).bind(user_id).execute(&mut *tx).await?;
    // One use only; also invalidate any other outstanding links and every existing session.
    sqlx::query("UPDATE password_resets SET used = 1 WHERE user_id = ?").bind(user_id).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM sessions WHERE user_id = ?").bind(user_id).execute(&mut *tx).await?;
    tx.commit().await?;
    let user = load_user(&state, user_id).await?;
    email::send(&state, email::password_changed(&user.email, &user.name, &state.config.public_url)).await;
    let cookie = auth::create_session(&state, user_id).await?;
    Ok((jar.add(cookie), Json(json!({ "user": user.view() }))))
}

#[derive(Deserialize)]
pub struct ContactBody {
    pub name: String,
    pub email: String,
    pub topic: String,
    pub message: String,
}

pub const TOPICS: &[&str] =
    &["Question about the course", "Billing & refunds", "Teams & companies", "Technical problem", "Feedback", "Other"];

pub async fn contact(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    MaybeUser(user): MaybeUser,
    Json(body): Json<ContactBody>,
) -> ApiResult<Json<Value>> {
    if !state.limiter.check("contact", &ip) {
        return Err(ApiError::TooManyRequests);
    }
    let name = body.name.trim();
    let from = body.email.trim().to_lowercase();
    let message = body.message.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err(ApiError::bad("Please tell us your name."));
    }
    if !valid_email(&from) {
        return Err(ApiError::bad("That email address doesn't look right."));
    }
    if !TOPICS.contains(&body.topic.as_str()) {
        return Err(ApiError::bad("Please choose a topic."));
    }
    if message.chars().count() < 10 || message.chars().count() > 5000 {
        return Err(ApiError::bad("Please write a message between 10 and 5,000 characters."));
    }
    sqlx::query("INSERT INTO contact_messages (user_id, name, email, topic, message) VALUES (?, ?, ?, ?, ?)")
        .bind(user.as_ref().map(|u| u.id))
        .bind(name)
        .bind(&from)
        .bind(&body.topic)
        .bind(message)
        .execute(&state.db)
        .await?;
    email::send(&state, email::contact_to_support(&state.config.email.support_inbox, name, &from, &body.topic, message)).await;
    email::send(&state, email::contact_receipt(&from, name)).await;
    Ok(Json(json!({ "ok": true })))
}

pub fn new_certificate_code() -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut rng = rand::thread_rng();
    let mut part = || (0..4).map(|_| ALPHABET[rng.gen_range(0..ALPHABET.len())] as char).collect::<String>();
    format!("LUM-{}-{}", part(), part())
}

/// Returns the member's certificate code, issuing one the first time.
pub async fn issue_certificate(state: &AppState, user_id: i64, name: &str) -> ApiResult<(String, String)> {
    if let Some(row) = sqlx::query_as::<_, (String, String)>("SELECT code, issued_at FROM certificates WHERE user_id = ?")
        .bind(user_id)
        .fetch_optional(&state.db)
        .await?
    {
        return Ok(row);
    }
    let code = new_certificate_code();
    sqlx::query("INSERT OR IGNORE INTO certificates (code, user_id, name) VALUES (?, ?, ?)")
        .bind(&code)
        .bind(user_id)
        .bind(name)
        .execute(&state.db)
        .await?;
    let row: (String, String) =
        sqlx::query_as("SELECT code, issued_at FROM certificates WHERE user_id = ?").bind(user_id).fetch_one(&state.db).await?;
    Ok(row)
}

pub async fn verify(State(state): State<AppState>, Path(code): Path<String>) -> ApiResult<Json<Value>> {
    let code = code.trim().to_uppercase();
    let row: Option<(String, String)> =
        sqlx::query_as("SELECT name, issued_at FROM certificates WHERE code = ?").bind(&code).fetch_optional(&state.db).await?;
    Ok(Json(match row {
        Some((name, issued_at)) => json!({
            "valid": true, "code": code, "name": name, "issued_at": issued_at,
            "course": "Practical AI for Everyday Life", "lessons": state.content.order.len(),
        }),
        None => json!({ "valid": false, "code": code }),
    }))
}

pub async fn admin_messages(State(state): State<AppState>, AdminUser(_): AdminUser) -> ApiResult<Json<Value>> {
    let rows: Vec<(i64, String, String, String, String, String)> =
        sqlx::query_as("SELECT id, name, email, topic, message, created_at FROM contact_messages ORDER BY id DESC LIMIT 100")
            .fetch_all(&state.db)
            .await?;
    Ok(Json(json!({ "messages": rows.into_iter().map(|(id, name, email, topic, message, at)| json!({
        "id": id, "name": name, "email": email, "topic": topic, "message": message, "created_at": at,
    })).collect::<Vec<_>>() })))
}

/// id, to, kind, subject, body, status, error, created_at
type OutboxRow = (i64, String, String, String, String, String, Option<String>, String);

#[derive(Deserialize)]
pub struct OutboxQuery {
    pub to: Option<String>,
}

pub async fn admin_emails(
    State(state): State<AppState>,
    AdminUser(_): AdminUser,
    axum::extract::Query(q): axum::extract::Query<OutboxQuery>,
) -> ApiResult<Json<Value>> {
    let to = q.to.unwrap_or_default().trim().to_lowercase();
    let rows: Vec<OutboxRow> = sqlx::query_as(
        "SELECT id, to_email, kind, subject, body_text, status, error, created_at FROM email_outbox
         WHERE (?1 = '' OR to_email = ?1) ORDER BY id DESC LIMIT 100",
    )
    .bind(to)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(
        json!({ "provider": format!("{:?}", state.config.email.provider).to_lowercase(), "emails": rows.into_iter().map(|(id, to, kind, subject, body, status, error, at)| json!({
        "id": id, "to": to, "kind": kind, "subject": subject, "body": body, "status": status, "error": error, "created_at": at,
    })).collect::<Vec<_>>() }),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn certificate_codes_are_readable_and_unique() {
        let a = new_certificate_code();
        let b = new_certificate_code();
        assert_ne!(a, b);
        assert_eq!(a.len(), 13);
        assert!(a.starts_with("LUM-"));
        assert!(!a.contains('O') && !a.contains('0') && !a.contains('I') && !a.contains('1'));
    }
}
