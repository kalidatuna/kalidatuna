CREATE TABLE password_resets (
    token_hash TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT    NOT NULL,
    used       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_resets_user ON password_resets(user_id);

CREATE TABLE email_outbox (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    to_email   TEXT    NOT NULL,
    kind       TEXT    NOT NULL,
    subject    TEXT    NOT NULL,
    body_text  TEXT    NOT NULL,
    status     TEXT    NOT NULL DEFAULT 'queued',  -- queued | sent | logged | failed
    error      TEXT,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_outbox_to ON email_outbox(to_email);

CREATE TABLE contact_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    name       TEXT    NOT NULL,
    email      TEXT    NOT NULL,
    topic      TEXT    NOT NULL,
    message    TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE certificates (
    code      TEXT    PRIMARY KEY,
    user_id   INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    name      TEXT    NOT NULL,
    issued_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
