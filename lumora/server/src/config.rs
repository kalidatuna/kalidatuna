//! Runtime configuration, read from environment variables (see `.env.example`).

use std::path::PathBuf;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BillingMode {
    /// Real payments through Stripe Checkout + webhooks.
    Stripe,
    /// Simulated checkout for local development, demos and automated tests.
    Demo,
}

#[derive(Clone, Debug)]
pub struct StripeConfig {
    pub secret_key: String,
    pub webhook_secret: String,
    pub price_monthly: String,
    pub price_yearly: String,
    pub price_lifetime: String,
    pub api_base: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EmailProvider {
    /// Emails are recorded in the outbox table only (development / until configured).
    Log,
    Resend,
    Postmark,
}

#[derive(Clone, Debug)]
pub struct EmailConfig {
    pub provider: EmailProvider,
    pub from: String,
    pub api_key: String,
    pub api_base: String,
    /// Where contact-form messages are delivered.
    pub support_inbox: String,
}

#[derive(Clone, Debug)]
pub struct Config {
    pub bind: String,
    pub database_url: String,
    pub content_dir: PathBuf,
    pub static_dir: PathBuf,
    pub public_url: String,
    pub cookie_secure: bool,
    pub billing: BillingMode,
    pub stripe: Option<StripeConfig>,
    pub admin_emails: Vec<String>,
    pub trust_proxy: bool,
    /// Requests per minute allowed on sensitive endpoints (login, signup, leads) per IP.
    pub auth_rate_per_minute: u32,
    pub session_days: i64,
    pub email: EmailConfig,
}

fn env(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|v| !v.trim().is_empty())
}

impl Config {
    pub fn from_env() -> Self {
        let stripe = match (env("STRIPE_SECRET_KEY"), env("STRIPE_WEBHOOK_SECRET")) {
            (Some(secret_key), Some(webhook_secret)) => Some(StripeConfig {
                secret_key,
                webhook_secret,
                price_monthly: env("STRIPE_PRICE_MONTHLY").unwrap_or_default(),
                price_yearly: env("STRIPE_PRICE_YEARLY").unwrap_or_default(),
                price_lifetime: env("STRIPE_PRICE_LIFETIME").unwrap_or_default(),
                api_base: env("STRIPE_API_BASE").unwrap_or_else(|| "https://api.stripe.com".into()),
            }),
            _ => None,
        };
        let billing = match env("BILLING_MODE").as_deref() {
            Some("demo") => BillingMode::Demo,
            Some("stripe") => BillingMode::Stripe,
            _ if stripe.is_some() => BillingMode::Stripe,
            _ => BillingMode::Demo,
        };
        let public_url = env("PUBLIC_URL").unwrap_or_else(|| "http://localhost:8080".into());
        Config {
            bind: env("BIND").unwrap_or_else(|| "0.0.0.0:8080".into()),
            database_url: env("DATABASE_URL").unwrap_or_else(|| "sqlite://data/lumora.db".into()),
            content_dir: env("CONTENT_DIR").map(PathBuf::from).unwrap_or_else(|| "../content".into()),
            static_dir: env("STATIC_DIR").map(PathBuf::from).unwrap_or_else(|| "../web/dist".into()),
            cookie_secure: env("COOKIE_SECURE").map(|v| v == "true" || v == "1").unwrap_or_else(|| public_url.starts_with("https://")),
            public_url,
            billing,
            stripe,
            admin_emails: env("ADMIN_EMAILS")
                .map(|v| v.split(',').map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty()).collect())
                .unwrap_or_default(),
            trust_proxy: env("TRUST_PROXY").map(|v| v == "true" || v == "1").unwrap_or(false),
            auth_rate_per_minute: env("AUTH_RATE_PER_MINUTE").and_then(|v| v.parse().ok()).unwrap_or(20),
            session_days: env("SESSION_DAYS").and_then(|v| v.parse().ok()).unwrap_or(30),
            email: EmailConfig::from_env(),
        }
    }

    /// A configuration suitable for tests: in-memory DB, demo billing.
    pub fn for_tests(content_dir: PathBuf) -> Self {
        Config {
            bind: "127.0.0.1:0".into(),
            database_url: "sqlite::memory:".into(),
            content_dir,
            static_dir: PathBuf::from("/nonexistent"),
            public_url: "http://localhost:8080".into(),
            cookie_secure: false,
            billing: BillingMode::Demo,
            stripe: None,
            admin_emails: vec!["admin@lumora.test".into()],
            trust_proxy: false,
            auth_rate_per_minute: 1000,
            session_days: 30,
            email: EmailConfig {
                provider: EmailProvider::Log,
                from: "Lumora <hello@lumora.test>".into(),
                api_key: String::new(),
                api_base: String::new(),
                support_inbox: "support@lumora.test".into(),
            },
        }
    }
}

impl EmailConfig {
    pub fn from_env() -> Self {
        let api_key = env("EMAIL_API_KEY").unwrap_or_default();
        let provider = match env("EMAIL_PROVIDER").as_deref() {
            Some("resend") if !api_key.is_empty() => EmailProvider::Resend,
            Some("postmark") if !api_key.is_empty() => EmailProvider::Postmark,
            _ => EmailProvider::Log,
        };
        let default_base = match provider {
            EmailProvider::Resend => "https://api.resend.com",
            EmailProvider::Postmark => "https://api.postmarkapp.com",
            EmailProvider::Log => "",
        };
        EmailConfig {
            provider,
            from: env("EMAIL_FROM").unwrap_or_else(|| "Lumora <hello@lumora.app>".into()),
            api_key,
            api_base: env("EMAIL_API_BASE").unwrap_or_else(|| default_base.into()),
            support_inbox: env("SUPPORT_EMAIL").unwrap_or_else(|| "support@lumora.app".into()),
        }
    }
}
