use axum::{body::Bytes, extract::State, http::HeaderMap, Json};
use chrono::{Duration, Utc};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    auth::{CurrentUser, User},
    billing::{self, PLANS},
    config::BillingMode,
    error::{ApiError, ApiResult},
    routes::auth::load_user,
    state::AppState,
};

#[derive(Deserialize)]
pub struct CheckoutBody {
    pub plan: String,
}

pub async fn checkout(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(body): Json<CheckoutBody>,
) -> ApiResult<Json<Value>> {
    let plan = billing::plan(&body.plan).ok_or_else(|| ApiError::bad("Unknown plan."))?;
    if user.plan == "lifetime" && user.has_pro() {
        return Err(ApiError::Conflict("You already have lifetime access.".into()));
    }
    match state.config.billing {
        BillingMode::Demo => Ok(Json(json!({ "url": format!("/checkout/demo?plan={}", plan.id), "mode": "demo" }))),
        BillingMode::Stripe => {
            let cfg = state.config.stripe.as_ref().ok_or_else(|| anyhow::anyhow!("Stripe is not configured"))?;
            let req = billing::CheckoutRequest {
                plan_id: plan.id,
                user_id: user.id,
                email: &user.email,
                customer_id: user.stripe_customer_id.as_deref(),
                public_url: &state.config.public_url,
            };
            let url = billing::create_checkout(&state.http, cfg, &req).await?;
            Ok(Json(json!({ "url": url, "mode": "stripe" })))
        }
    }
}

pub async fn portal(State(state): State<AppState>, CurrentUser(user): CurrentUser) -> ApiResult<Json<Value>> {
    match (&state.config.billing, state.config.stripe.as_ref(), user.stripe_customer_id.as_deref()) {
        (BillingMode::Stripe, Some(cfg), Some(customer)) => {
            let url = billing::create_portal(&state.http, cfg, customer, &format!("{}/account", state.config.public_url)).await?;
            Ok(Json(json!({ "url": url })))
        }
        _ => Err(ApiError::bad("There is no billing account to manage yet.")),
    }
}

async fn activate(state: &AppState, user_id: i64, plan_id: &str, reference: &str, amount: i64, provider: &str) -> ApiResult<()> {
    let renews = billing::period_days(plan_id).map(|d| (Utc::now() + Duration::days(d)).format("%Y-%m-%dT%H:%M:%SZ").to_string());
    sqlx::query("UPDATE users SET plan = ?, plan_status = 'active', plan_renews_at = ? WHERE id = ?")
        .bind(plan_id)
        .bind(renews)
        .bind(user_id)
        .execute(&state.db)
        .await?;
    sqlx::query("INSERT OR IGNORE INTO payments (user_id, reference, plan, amount_cents, provider) VALUES (?, ?, ?, ?, ?)")
        .bind(user_id)
        .bind(reference)
        .bind(plan_id)
        .bind(amount)
        .bind(provider)
        .execute(&state.db)
        .await?;
    Ok(())
}

fn require_demo(state: &AppState) -> ApiResult<()> {
    if state.config.billing != BillingMode::Demo {
        return Err(ApiError::NotFound);
    }
    Ok(())
}

pub async fn demo_complete(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(body): Json<CheckoutBody>,
) -> ApiResult<Json<Value>> {
    require_demo(&state)?;
    let plan = billing::plan(&body.plan).ok_or_else(|| ApiError::bad("Unknown plan."))?;
    let reference = format!("demo_{}", uuid::Uuid::new_v4().simple());
    activate(&state, user.id, plan.id, &reference, plan.price_cents, "demo").await?;
    Ok(Json(json!({ "user": load_user(&state, user.id).await?.view(), "receipt": reference })))
}

pub async fn demo_cancel(State(state): State<AppState>, CurrentUser(user): CurrentUser) -> ApiResult<Json<Value>> {
    require_demo(&state)?;
    sqlx::query("UPDATE users SET plan = 'free', plan_status = 'canceled', plan_renews_at = NULL WHERE id = ?")
        .bind(user.id)
        .execute(&state.db)
        .await?;
    Ok(Json(json!({ "user": load_user(&state, user.id).await?.view() })))
}

pub async fn plans(State(state): State<AppState>) -> Json<Value> {
    Json(json!({ "plans": PLANS, "billing_mode": if state.config.billing == BillingMode::Demo { "demo" } else { "stripe" } }))
}

async fn user_by(state: &AppState, column: &str, value: &str) -> ApiResult<Option<User>> {
    let sql = format!("SELECT {} FROM users WHERE {} = ?", crate::auth::USER_COLUMNS, column);
    Ok(sqlx::query_as::<_, User>(&sql).bind(value).fetch_optional(&state.db).await?)
}

/// Stripe webhook. Verifies the signature, de-duplicates by event id and updates the member's plan.
pub async fn stripe_webhook(State(state): State<AppState>, headers: HeaderMap, body: Bytes) -> ApiResult<Json<Value>> {
    let cfg = state.config.stripe.as_ref().ok_or(ApiError::NotFound)?;
    let sig = headers.get("stripe-signature").and_then(|v| v.to_str().ok()).ok_or_else(|| ApiError::bad("Missing signature."))?;
    billing::verify_stripe_signature(&body, sig, &cfg.webhook_secret, Utc::now().timestamp(), 300)
        .map_err(|_| ApiError::bad("Invalid signature."))?;
    let event: Value = serde_json::from_slice(&body).map_err(|_| ApiError::bad("Invalid JSON."))?;
    let id = event.get("id").and_then(|v| v.as_str()).ok_or_else(|| ApiError::bad("Missing event id."))?;
    let kind = event.get("type").and_then(|v| v.as_str()).unwrap_or_default();
    let inserted = sqlx::query("INSERT OR IGNORE INTO webhook_events (id, kind) VALUES (?, ?)")
        .bind(id)
        .bind(kind)
        .execute(&state.db)
        .await?
        .rows_affected();
    if inserted == 0 {
        return Ok(Json(json!({ "received": true, "duplicate": true })));
    }
    let obj = event.pointer("/data/object").cloned().unwrap_or(Value::Null);
    let s = |p: &str| obj.pointer(p).and_then(|v| v.as_str()).map(String::from);

    match kind {
        "checkout.session.completed" => {
            let user_id: Option<i64> = s("/client_reference_id").or_else(|| s("/metadata/user_id")).and_then(|v| v.parse().ok());
            let plan_id = s("/metadata/plan").unwrap_or_else(|| "monthly".into());
            if let (Some(uid), Some(_)) = (user_id, billing::plan(&plan_id)) {
                let amount = obj.get("amount_total").and_then(|v| v.as_i64()).unwrap_or(0);
                let reference = s("/id").unwrap_or_else(|| id.to_string());
                activate(&state, uid, &plan_id, &reference, amount, "stripe").await?;
                sqlx::query("UPDATE users SET stripe_customer_id = COALESCE(?, stripe_customer_id), stripe_subscription_id = COALESCE(?, stripe_subscription_id) WHERE id = ?")
                    .bind(s("/customer"))
                    .bind(s("/subscription"))
                    .bind(uid)
                    .execute(&state.db)
                    .await?;
            }
        }
        "customer.subscription.updated" | "customer.subscription.created" | "customer.subscription.deleted" => {
            let Some(sub_id) = s("/id") else { return Ok(Json(json!({ "received": true }))) };
            let user = match user_by(&state, "stripe_subscription_id", &sub_id).await? {
                Some(u) => Some(u),
                None => match s("/customer") {
                    Some(c) => user_by(&state, "stripe_customer_id", &c).await?,
                    None => None,
                },
            };
            if let Some(u) = user {
                if u.plan == "lifetime" {
                    return Ok(Json(json!({ "received": true })));
                }
                let status = if kind == "customer.subscription.deleted" {
                    "canceled"
                } else {
                    billing::map_subscription_status(&s("/status").unwrap_or_default())
                };
                let period_end = obj
                    .get("current_period_end")
                    .or_else(|| obj.pointer("/items/data/0/current_period_end"))
                    .and_then(|v| v.as_i64())
                    .and_then(|t| chrono::DateTime::from_timestamp(t, 0))
                    .map(|d| d.format("%Y-%m-%dT%H:%M:%SZ").to_string());
                let plan = if status == "canceled" {
                    "free".to_string()
                } else {
                    s("/metadata/plan").filter(|p| billing::plan(p).is_some()).unwrap_or(u.plan.clone())
                };
                sqlx::query("UPDATE users SET plan = ?, plan_status = ?, plan_renews_at = COALESCE(?, plan_renews_at), stripe_subscription_id = ? WHERE id = ?")
                    .bind(plan)
                    .bind(status)
                    .bind(period_end)
                    .bind(&sub_id)
                    .bind(u.id)
                    .execute(&state.db)
                    .await?;
            }
        }
        "invoice.payment_failed" => {
            if let Some(c) = s("/customer") {
                sqlx::query("UPDATE users SET plan_status = 'past_due' WHERE stripe_customer_id = ? AND plan IN ('monthly','yearly')")
                    .bind(c)
                    .execute(&state.db)
                    .await?;
            }
        }
        "invoice.paid" => {
            if let (Some(c), Some(inv)) = (s("/customer"), s("/id")) {
                if let Some(u) = user_by(&state, "stripe_customer_id", &c).await? {
                    let amount = obj.get("amount_paid").and_then(|v| v.as_i64()).unwrap_or(0);
                    if amount > 0 && obj.get("billing_reason").and_then(|v| v.as_str()) != Some("subscription_create") {
                        sqlx::query("INSERT OR IGNORE INTO payments (user_id, reference, plan, amount_cents, provider) VALUES (?, ?, ?, ?, 'stripe')")
                            .bind(u.id)
                            .bind(inv)
                            .bind(&u.plan)
                            .bind(amount)
                            .execute(&state.db)
                            .await?;
                    }
                    if u.plan_status == "past_due" {
                        sqlx::query("UPDATE users SET plan_status = 'active' WHERE id = ?").bind(u.id).execute(&state.db).await?;
                    }
                }
            }
        }
        _ => {}
    }
    Ok(Json(json!({ "received": true })))
}
