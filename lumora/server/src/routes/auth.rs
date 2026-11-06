use axum::{extract::State, Json};
use axum_extra::extract::CookieJar;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    auth::{self, ClientIp, CurrentUser, MaybeUser, User, USER_COLUMNS},
    email,
    error::{ApiError, ApiResult},
    state::AppState,
};

#[derive(Deserialize)]
pub struct SignupBody {
    pub name: String,
    pub email: String,
    pub password: String,
}

#[derive(Deserialize)]
pub struct LoginBody {
    pub email: String,
    pub password: String,
}

pub fn valid_email(email: &str) -> bool {
    let email = email.trim();
    if email.len() > 254 || email.contains(char::is_whitespace) {
        return false;
    }
    let Some((local, domain)) = email.split_once('@') else { return false };
    !local.is_empty() && domain.contains('.') && !domain.starts_with('.') && !domain.ends_with('.') && !domain.contains('@')
}

pub fn validate_password(p: &str) -> ApiResult<()> {
    if p.chars().count() < 8 {
        return Err(ApiError::bad("Use a password with at least 8 characters."));
    }
    if p.len() > 128 {
        return Err(ApiError::bad("That password is too long (128 characters max)."));
    }
    Ok(())
}

pub async fn load_user(state: &AppState, id: i64) -> ApiResult<User> {
    let sql = format!("SELECT {USER_COLUMNS} FROM users WHERE id = ?");
    sqlx::query_as::<_, User>(&sql).bind(id).fetch_optional(&state.db).await?.ok_or(ApiError::NotFound)
}

pub async fn signup(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    jar: CookieJar,
    Json(body): Json<SignupBody>,
) -> ApiResult<(CookieJar, Json<Value>)> {
    if !state.limiter.check("signup", &ip) {
        return Err(ApiError::TooManyRequests);
    }
    let name = body.name.trim();
    let email = body.email.trim().to_lowercase();
    if name.is_empty() || name.chars().count() > 80 {
        return Err(ApiError::bad("Please tell us your name (up to 80 characters)."));
    }
    if !valid_email(&email) {
        return Err(ApiError::bad("That email address doesn't look right."));
    }
    validate_password(&body.password)?;
    let exists: Option<(i64,)> = sqlx::query_as("SELECT id FROM users WHERE email = ?").bind(&email).fetch_optional(&state.db).await?;
    if exists.is_some() {
        return Err(ApiError::Conflict("An account with this email already exists. Try signing in.".into()));
    }
    let hash = auth::hash_password(&body.password)?;
    let role = if state.config.admin_emails.contains(&email) { "admin" } else { "member" };
    let res = sqlx::query("INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)")
        .bind(&email)
        .bind(name)
        .bind(hash)
        .bind(role)
        .execute(&state.db)
        .await?;
    let id = res.last_insert_rowid();
    // A signup is also a lead we no longer need to nurture separately.
    sqlx::query("INSERT OR IGNORE INTO leads (email, source) VALUES (?, 'signup')").bind(&email).execute(&state.db).await?;
    let cookie = auth::create_session(&state, id).await?;
    let user = load_user(&state, id).await?;
    email::send(&state, email::welcome(&user.email, &user.name, &state.config.public_url)).await;
    Ok((jar.add(cookie), Json(json!({ "user": user.view() }))))
}

pub async fn login(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    jar: CookieJar,
    Json(body): Json<LoginBody>,
) -> ApiResult<(CookieJar, Json<Value>)> {
    if !state.limiter.check("login", &ip) {
        return Err(ApiError::TooManyRequests);
    }
    let email = body.email.trim().to_lowercase();
    let row: Option<(i64, String)> =
        sqlx::query_as("SELECT id, password_hash FROM users WHERE email = ?").bind(&email).fetch_optional(&state.db).await?;
    let Some((id, hash)) = row else {
        // Spend comparable time so response timing doesn't reveal which emails exist.
        auth::dummy_verify(&body.password);
        return Err(ApiError::bad("Email or password is incorrect."));
    };
    if !auth::verify_password(&body.password, &hash) {
        return Err(ApiError::bad("Email or password is incorrect."));
    }
    let cookie = auth::create_session(&state, id).await?;
    let user = load_user(&state, id).await?;
    Ok((jar.add(cookie), Json(json!({ "user": user.view() }))))
}

pub async fn logout(State(state): State<AppState>, jar: CookieJar) -> ApiResult<(CookieJar, Json<Value>)> {
    if let Some(c) = jar.get(auth::SESSION_COOKIE) {
        sqlx::query("DELETE FROM sessions WHERE token_hash = ?").bind(auth::hash_token(c.value())).execute(&state.db).await?;
    }
    Ok((jar.add(auth::clear_cookie(&state)), Json(json!({ "ok": true }))))
}

pub async fn me(MaybeUser(user): MaybeUser) -> Json<Value> {
    Json(json!({ "user": user.map(|u| u.view()) }))
}

#[derive(Deserialize)]
pub struct UpdateMe {
    pub name: String,
}

pub async fn update_me(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(body): Json<UpdateMe>,
) -> ApiResult<Json<Value>> {
    let name = body.name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err(ApiError::bad("Please use a name between 1 and 80 characters."));
    }
    sqlx::query("UPDATE users SET name = ? WHERE id = ?").bind(name).bind(user.id).execute(&state.db).await?;
    Ok(Json(json!({ "user": load_user(&state, user.id).await?.view() })))
}

#[derive(Deserialize)]
pub struct ChangePassword {
    pub current: String,
    pub new: String,
}

pub async fn change_password(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    jar: CookieJar,
    Json(body): Json<ChangePassword>,
) -> ApiResult<(CookieJar, Json<Value>)> {
    let (hash,): (String,) = sqlx::query_as("SELECT password_hash FROM users WHERE id = ?").bind(user.id).fetch_one(&state.db).await?;
    if !auth::verify_password(&body.current, &hash) {
        return Err(ApiError::bad("Your current password is incorrect."));
    }
    validate_password(&body.new)?;
    let new_hash = auth::hash_password(&body.new)?;
    sqlx::query("UPDATE users SET password_hash = ? WHERE id = ?").bind(new_hash).bind(user.id).execute(&state.db).await?;
    // Sign out every other device, then issue a fresh session for this one.
    sqlx::query("DELETE FROM sessions WHERE user_id = ?").bind(user.id).execute(&state.db).await?;
    let cookie = auth::create_session(&state, user.id).await?;
    email::send(&state, email::password_changed(&user.email, &user.name, &state.config.public_url)).await;
    Ok((jar.add(cookie), Json(json!({ "ok": true }))))
}

#[derive(Deserialize)]
pub struct DeleteMe {
    pub password: String,
}

pub async fn delete_me(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    jar: CookieJar,
    Json(body): Json<DeleteMe>,
) -> ApiResult<(CookieJar, Json<Value>)> {
    let (hash,): (String,) = sqlx::query_as("SELECT password_hash FROM users WHERE id = ?").bind(user.id).fetch_one(&state.db).await?;
    if !auth::verify_password(&body.password, &hash) {
        return Err(ApiError::bad("Password is incorrect."));
    }
    sqlx::query("DELETE FROM users WHERE id = ?").bind(user.id).execute(&state.db).await?;
    Ok((jar.add(auth::clear_cookie(&state)), Json(json!({ "ok": true }))))
}

pub async fn export_me(State(state): State<AppState>, CurrentUser(user): CurrentUser) -> ApiResult<Json<Value>> {
    let progress: Vec<(String, String)> =
        sqlx::query_as("SELECT lesson_slug, completed_at FROM progress WHERE user_id = ? ORDER BY completed_at")
            .bind(user.id)
            .fetch_all(&state.db)
            .await?;
    let quizzes: Vec<(String, i64, i64, i64, String)> =
        sqlx::query_as("SELECT module_slug, score, total, passed, created_at FROM quiz_attempts WHERE user_id = ? ORDER BY created_at")
            .bind(user.id)
            .fetch_all(&state.db)
            .await?;
    let bookmarks: Vec<(String, String, String)> =
        sqlx::query_as("SELECT kind, ref, created_at FROM bookmarks WHERE user_id = ?").bind(user.id).fetch_all(&state.db).await?;
    let payments: Vec<(String, i64, String, String)> =
        sqlx::query_as("SELECT plan, amount_cents, currency, created_at FROM payments WHERE user_id = ?")
            .bind(user.id)
            .fetch_all(&state.db)
            .await?;
    Ok(Json(json!({
        "exported_at": chrono::Utc::now().to_rfc3339(),
        "account": user.view(),
        "progress": progress.into_iter().map(|(l, at)| json!({"lesson": l, "completed_at": at})).collect::<Vec<_>>(),
        "quiz_attempts": quizzes.into_iter().map(|(m, s, t, p, at)| json!({"module": m, "score": s, "total": t, "passed": p == 1, "at": at})).collect::<Vec<_>>(),
        "bookmarks": bookmarks.into_iter().map(|(k, r, at)| json!({"kind": k, "ref": r, "at": at})).collect::<Vec<_>>(),
        "payments": payments.into_iter().map(|(p, a, c, at)| json!({"plan": p, "amount_cents": a, "currency": c, "at": at})).collect::<Vec<_>>(),
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn email_validation() {
        assert!(valid_email("sam@example.com"));
        assert!(valid_email("a.b+c@sub.domain.org"));
        assert!(!valid_email("sam"));
        assert!(!valid_email("sam@localhost"));
        assert!(!valid_email("sam @x.com"));
        assert!(!valid_email("@x.com"));
        assert!(!valid_email("a@b@c.com"));
    }

    #[test]
    fn password_rules() {
        assert!(validate_password("short").is_err());
        assert!(validate_password("long enough").is_ok());
        assert!(validate_password(&"x".repeat(200)).is_err());
    }
}
