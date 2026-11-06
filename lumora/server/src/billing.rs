//! Plans, Stripe Checkout / Portal calls and webhook signature verification.

use anyhow::{anyhow, bail, Result};
use hmac::{Hmac, Mac};
use serde::Serialize;
use sha2::Sha256;

use crate::config::StripeConfig;

#[derive(Debug, Clone, Serialize)]
pub struct Plan {
    pub id: &'static str,
    pub name: &'static str,
    pub price_cents: i64,
    pub interval: &'static str, // month | year | once
    pub blurb: &'static str,
    pub highlight: bool,
}

pub const PLANS: &[Plan] = &[
    Plan {
        id: "monthly",
        name: "Pro Monthly",
        price_cents: 1400,
        interval: "month",
        blurb: "Everything in Lumora. Cancel any time.",
        highlight: false,
    },
    Plan {
        id: "yearly",
        name: "Pro Yearly",
        price_cents: 9900,
        interval: "year",
        blurb: "Two-thirds off the monthly price. Best for steady learners.",
        highlight: true,
    },
    Plan {
        id: "lifetime",
        name: "Lifetime",
        price_cents: 24900,
        interval: "once",
        blurb: "Pay once, keep every future update forever.",
        highlight: false,
    },
];

pub fn plan(id: &str) -> Option<&'static Plan> {
    PLANS.iter().find(|p| p.id == id)
}

/// Days of access a demo purchase grants (None = forever).
pub fn period_days(plan_id: &str) -> Option<i64> {
    match plan_id {
        "monthly" => Some(30),
        "yearly" => Some(365),
        _ => None,
    }
}

type HmacSha256 = Hmac<Sha256>;

/// Verifies a `Stripe-Signature` header (`t=...,v1=...`) against the raw payload.
pub fn verify_stripe_signature(payload: &[u8], header: &str, secret: &str, now_unix: i64, tolerance_secs: i64) -> Result<()> {
    let mut timestamp: Option<i64> = None;
    let mut signatures = Vec::new();
    for part in header.split(',') {
        let mut kv = part.trim().splitn(2, '=');
        match (kv.next(), kv.next()) {
            (Some("t"), Some(v)) => timestamp = v.parse().ok(),
            (Some("v1"), Some(v)) => signatures.push(v.to_string()),
            _ => {}
        }
    }
    let ts = timestamp.ok_or_else(|| anyhow!("missing timestamp"))?;
    if signatures.is_empty() {
        bail!("missing v1 signature");
    }
    if (now_unix - ts).abs() > tolerance_secs {
        bail!("timestamp outside tolerance");
    }
    for sig in signatures {
        let Ok(expected) = hex::decode(&sig) else { continue };
        let mut mac = HmacSha256::new_from_slice(secret.as_bytes())?;
        mac.update(ts.to_string().as_bytes());
        mac.update(b".");
        mac.update(payload);
        if mac.verify_slice(&expected).is_ok() {
            return Ok(());
        }
    }
    bail!("no matching signature")
}

/// Produces a valid signature header; used by tests and the local webhook simulator.
pub fn sign_stripe_payload(payload: &[u8], secret: &str, ts: i64) -> String {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).expect("hmac key");
    mac.update(ts.to_string().as_bytes());
    mac.update(b".");
    mac.update(payload);
    format!("t={},v1={}", ts, hex::encode(mac.finalize().into_bytes()))
}

pub struct CheckoutRequest<'a> {
    pub plan_id: &'a str,
    pub user_id: i64,
    pub email: &'a str,
    pub customer_id: Option<&'a str>,
    pub public_url: &'a str,
}

fn price_for<'a>(cfg: &'a StripeConfig, plan_id: &str) -> Result<&'a str> {
    let price = match plan_id {
        "monthly" => &cfg.price_monthly,
        "yearly" => &cfg.price_yearly,
        "lifetime" => &cfg.price_lifetime,
        _ => bail!("unknown plan"),
    };
    if price.is_empty() {
        bail!("Stripe price for plan {plan_id} is not configured");
    }
    Ok(price)
}

pub fn checkout_form(cfg: &StripeConfig, req: &CheckoutRequest) -> Result<Vec<(String, String)>> {
    let price = price_for(cfg, req.plan_id)?;
    let subscription = req.plan_id != "lifetime";
    let mut f: Vec<(String, String)> = vec![
        ("mode".into(), if subscription { "subscription" } else { "payment" }.into()),
        ("line_items[0][price]".into(), price.into()),
        ("line_items[0][quantity]".into(), "1".into()),
        ("success_url".into(), format!("{}/welcome?session_id={{CHECKOUT_SESSION_ID}}", req.public_url)),
        ("cancel_url".into(), format!("{}/pricing?canceled=1", req.public_url)),
        ("client_reference_id".into(), req.user_id.to_string()),
        ("metadata[plan]".into(), req.plan_id.into()),
        ("metadata[user_id]".into(), req.user_id.to_string()),
        ("allow_promotion_codes".into(), "true".into()),
    ];
    match req.customer_id {
        Some(c) => f.push(("customer".into(), c.into())),
        None => {
            f.push(("customer_email".into(), req.email.into()));
            if !subscription {
                f.push(("customer_creation".into(), "always".into()));
            }
        }
    }
    if subscription {
        f.push(("subscription_data[metadata][user_id]".into(), req.user_id.to_string()));
        f.push(("subscription_data[metadata][plan]".into(), req.plan_id.into()));
    }
    Ok(f)
}

async fn stripe_post(http: &reqwest::Client, cfg: &StripeConfig, path: &str, form: &[(String, String)]) -> Result<serde_json::Value> {
    let body = serde_urlencoded::to_string(form)?;
    let res = http
        .post(format!("{}{}", cfg.api_base, path))
        .basic_auth(&cfg.secret_key, None::<&str>)
        .header("content-type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await?;
    let status = res.status();
    let json: serde_json::Value = res.json().await.unwrap_or(serde_json::Value::Null);
    if !status.is_success() {
        let msg = json.pointer("/error/message").and_then(|v| v.as_str()).unwrap_or("unknown error");
        bail!("Stripe error ({status}): {msg}");
    }
    Ok(json)
}

pub async fn create_checkout(http: &reqwest::Client, cfg: &StripeConfig, req: &CheckoutRequest<'_>) -> Result<String> {
    let form = checkout_form(cfg, req)?;
    let json = stripe_post(http, cfg, "/v1/checkout/sessions", &form).await?;
    json.get("url").and_then(|v| v.as_str()).map(String::from).ok_or_else(|| anyhow!("Stripe response had no url"))
}

pub async fn create_portal(http: &reqwest::Client, cfg: &StripeConfig, customer: &str, return_url: &str) -> Result<String> {
    let form = vec![("customer".to_string(), customer.to_string()), ("return_url".to_string(), return_url.to_string())];
    let json = stripe_post(http, cfg, "/v1/billing_portal/sessions", &form).await?;
    json.get("url").and_then(|v| v.as_str()).map(String::from).ok_or_else(|| anyhow!("Stripe response had no url"))
}

/// Maps a Stripe subscription status to our plan_status vocabulary.
pub fn map_subscription_status(s: &str) -> &'static str {
    match s {
        "active" | "trialing" => "active",
        "past_due" => "past_due",
        _ => "canceled",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signature_roundtrip() {
        let payload = br#"{"id":"evt_1"}"#;
        let header = sign_stripe_payload(payload, "whsec_test", 1_700_000_000);
        assert!(verify_stripe_signature(payload, &header, "whsec_test", 1_700_000_010, 300).is_ok());
        // wrong secret
        assert!(verify_stripe_signature(payload, &header, "whsec_other", 1_700_000_010, 300).is_err());
        // tampered payload
        assert!(verify_stripe_signature(b"{}", &header, "whsec_test", 1_700_000_010, 300).is_err());
        // replay outside tolerance
        assert!(verify_stripe_signature(payload, &header, "whsec_test", 1_700_001_000, 300).is_err());
        // garbage
        assert!(verify_stripe_signature(payload, "nonsense", "whsec_test", 0, 300).is_err());
    }

    #[test]
    fn checkout_form_shapes() {
        let cfg = StripeConfig {
            secret_key: "sk".into(),
            webhook_secret: "wh".into(),
            price_monthly: "price_m".into(),
            price_yearly: "price_y".into(),
            price_lifetime: "price_l".into(),
            api_base: "http://x".into(),
        };
        let req = CheckoutRequest { plan_id: "lifetime", user_id: 7, email: "a@b.c", customer_id: None, public_url: "https://lumora.app" };
        let f = checkout_form(&cfg, &req).unwrap();
        assert!(f.contains(&("mode".into(), "payment".into())));
        assert!(f.contains(&("line_items[0][price]".into(), "price_l".into())));
        assert!(f.contains(&("customer_creation".into(), "always".into())));
        let req = CheckoutRequest { plan_id: "monthly", customer_id: Some("cus_1"), ..req };
        let f = checkout_form(&cfg, &req).unwrap();
        assert!(f.contains(&("mode".into(), "subscription".into())));
        assert!(f.contains(&("customer".into(), "cus_1".into())));
        assert!(checkout_form(&cfg, &CheckoutRequest { plan_id: "nope", ..req }).is_err());
    }

    #[test]
    fn status_mapping() {
        assert_eq!(map_subscription_status("trialing"), "active");
        assert_eq!(map_subscription_status("past_due"), "past_due");
        assert_eq!(map_subscription_status("unpaid"), "canceled");
    }
}
