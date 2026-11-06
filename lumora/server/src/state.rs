use std::{str::FromStr, sync::Arc, time::Duration};

use anyhow::{Context, Result};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::SqlitePool;

use crate::{config::Config, content::Content, ratelimit::RateLimiter};

#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
    pub config: Arc<Config>,
    pub content: Arc<Content>,
    pub http: reqwest::Client,
    pub limiter: Arc<RateLimiter>,
}

pub async fn connect_db(url: &str) -> Result<SqlitePool> {
    let in_memory = url.contains(":memory:");
    if !in_memory {
        if let Some(path) = url.strip_prefix("sqlite://").or_else(|| url.strip_prefix("sqlite:")) {
            let path = path.split('?').next().unwrap_or(path);
            if let Some(parent) = std::path::Path::new(path).parent() {
                if !parent.as_os_str().is_empty() {
                    std::fs::create_dir_all(parent).with_context(|| format!("creating {}", parent.display()))?;
                }
            }
        }
    }
    let opts = SqliteConnectOptions::from_str(url)?
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(if in_memory { SqliteJournalMode::Memory } else { SqliteJournalMode::Wal })
        .synchronous(SqliteSynchronous::Normal)
        .busy_timeout(Duration::from_secs(5));
    let pool = SqlitePoolOptions::new()
        // Every in-memory connection would be a separate database, so tests use exactly one.
        .max_connections(if in_memory { 1 } else { 16 })
        .min_connections(1)
        .connect_with(opts)
        .await?;
    sqlx::migrate!("./migrations").run(&pool).await?;
    Ok(pool)
}

impl AppState {
    pub async fn init(config: Config) -> Result<AppState> {
        let content =
            Content::load(&config.content_dir).with_context(|| format!("loading content from {}", config.content_dir.display()))?;
        let db = connect_db(&config.database_url).await?;
        let http = reqwest::Client::builder().timeout(Duration::from_secs(20)).user_agent("lumora-server/1.0").build()?;
        let limiter = Arc::new(RateLimiter::new(config.auth_rate_per_minute));
        Ok(AppState { db, config: Arc::new(config), content: Arc::new(content), http, limiter })
    }
}
