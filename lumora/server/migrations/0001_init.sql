-- Lumora core schema
CREATE TABLE users (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    email                   TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    name                    TEXT    NOT NULL,
    password_hash           TEXT    NOT NULL,
    role                    TEXT    NOT NULL DEFAULT 'member',  -- member | admin
    plan                    TEXT    NOT NULL DEFAULT 'free',    -- free | monthly | yearly | lifetime
    plan_status             TEXT    NOT NULL DEFAULT 'none',    -- none | active | past_due | canceled
    plan_renews_at          TEXT,
    stripe_customer_id      TEXT,
    stripe_subscription_id  TEXT,
    created_at              TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_users_stripe_sub ON users(stripe_subscription_id);
CREATE INDEX idx_users_stripe_cus ON users(stripe_customer_id);

CREATE TABLE sessions (
    token_hash  TEXT    PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    expires_at  TEXT    NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE progress (
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lesson_slug  TEXT    NOT NULL,
    completed_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    PRIMARY KEY (user_id, lesson_slug)
);

CREATE TABLE quiz_attempts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    module_slug  TEXT    NOT NULL,
    score        INTEGER NOT NULL,
    total        INTEGER NOT NULL,
    passed       INTEGER NOT NULL,
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_quiz_user ON quiz_attempts(user_id, module_slug);

CREATE TABLE bookmarks (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT    NOT NULL,   -- lesson | prompt | playbook
    ref        TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    PRIMARY KEY (user_id, kind, ref)
);

CREATE TABLE activity (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day     TEXT    NOT NULL,
    PRIMARY KEY (user_id, day)
);

CREATE TABLE leads (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    source     TEXT    NOT NULL DEFAULT 'landing',
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE payments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reference     TEXT    NOT NULL UNIQUE,
    plan          TEXT    NOT NULL,
    amount_cents  INTEGER NOT NULL,
    currency      TEXT    NOT NULL DEFAULT 'usd',
    provider      TEXT    NOT NULL,   -- stripe | demo
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE webhook_events (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,
    received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
