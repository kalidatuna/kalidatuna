use std::net::SocketAddr;

use lumora::{build_router, config::Config, AppState};
use tracing_subscriber::{fmt, EnvFilter};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _ = dotenvy::dotenv();
    fmt().with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,tower_http=warn,sqlx=warn"))).init();

    let config = Config::from_env();
    let bind = config.bind.clone();
    tracing::info!(billing = ?config.billing, content = %config.content_dir.display(), "starting Lumora");
    let state = AppState::init(config).await?;
    tracing::info!(lessons = state.content.order.len(), prompts = state.content.prompts.len(), "content loaded");

    // Periodically remove expired sessions.
    let db = state.db.clone();
    tokio::spawn(async move {
        loop {
            let _ = sqlx::query("DELETE FROM sessions WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%SZ','now')").execute(&db).await;
            tokio::time::sleep(std::time::Duration::from_secs(3600)).await;
        }
    });

    let app = build_router(state);
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!("listening on http://{}", listener.local_addr()?);
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
