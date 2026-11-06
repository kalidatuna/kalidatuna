# ---------- 1. Frontend ----------
FROM node:22-bookworm-slim AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---------- 2. Rust server ----------
FROM rust:1-bookworm AS server
WORKDIR /app/server
COPY server/ ./
RUN cargo build --release --locked

# ---------- 3. Runtime ----------
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --home /app lumora
WORKDIR /app
COPY --from=server /app/server/target/release/lumora /app/lumora
COPY --from=web /app/web/dist /app/web
COPY content /app/content
RUN mkdir -p /data && chown lumora /data
USER lumora
ENV BIND=0.0.0.0:8080 \
    DATABASE_URL=sqlite:///data/lumora.db \
    CONTENT_DIR=/app/content \
    STATIC_DIR=/app/web \
    RUST_LOG=info,tower_http=warn,sqlx=warn
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD ["/bin/sh", "-c", "exec 3<>/dev/tcp/127.0.0.1/8080 && printf 'GET /api/health HTTP/1.0\\r\\n\\r\\n' >&3 && grep -q '\"ok\"' <&3"]
CMD ["/app/lumora"]
