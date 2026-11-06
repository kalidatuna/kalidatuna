//! Transactional email: every message is written to the `email_outbox` table, then
//! delivered through Resend or Postmark when configured (or just logged otherwise).

use serde_json::json;

use crate::{certificate::escape, config::EmailProvider, state::AppState};

pub struct Email {
    pub to: String,
    pub kind: &'static str,
    pub subject: String,
    /// Plain-text paragraphs; blank lines separate paragraphs.
    pub text: String,
    /// Optional call-to-action button: (label, url).
    pub cta: Option<(String, String)>,
}

/// Branded HTML version of a plain-text email.
pub fn render_html(e: &Email) -> String {
    let paragraphs: String = e
        .text
        .split("\n\n")
        .map(|p| format!("<p style=\"margin:0 0 16px;line-height:1.6\">{}</p>", escape(p).replace('\n', "<br>")))
        .collect();
    let button = e
        .cta
        .as_ref()
        .map(|(label, url)| {
            format!(
                "<p style=\"margin:24px 0\"><a href=\"{}\" style=\"background:linear-gradient(120deg,#ffd27a,#ff7ad9,#8b7bff);color:#1b1640;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:999px;display:inline-block\">{}</a></p>",
                escape(url),
                escape(label)
            )
        })
        .unwrap_or_default();
    format!(
        "<!doctype html><html><body style=\"margin:0;background:#f4f1fb;font-family:Helvetica,Arial,sans-serif;color:#1b1640\">\
<div style=\"max-width:560px;margin:0 auto;padding:32px 20px\"><div style=\"font-family:Georgia,serif;font-size:22px;font-weight:700;margin-bottom:20px\">◆ Lumora</div>\
<div style=\"background:#fff;border-radius:16px;padding:28px\">{paragraphs}{button}</div>\
<p style=\"font-size:12px;color:#6f69a0;margin-top:20px\">Lumora · Practical AI for everyday life. You're receiving this because of activity on your Lumora account or request.</p></div></body></html>"
    )
}

fn plain_body(e: &Email) -> String {
    match &e.cta {
        Some((label, url)) => format!("{}\n\n{}: {}\n\n— The Lumora team", e.text, label, url),
        None => format!("{}\n\n— The Lumora team", e.text),
    }
}

/// Queues an email. Delivery happens in the background so requests stay fast.
pub async fn send(state: &AppState, email: Email) {
    let body = plain_body(&email);
    let provider = state.config.email.provider.clone();
    let initial = if provider == EmailProvider::Log { "logged" } else { "queued" };
    let id = match sqlx::query("INSERT INTO email_outbox (to_email, kind, subject, body_text, status) VALUES (?, ?, ?, ?, ?)")
        .bind(&email.to)
        .bind(email.kind)
        .bind(&email.subject)
        .bind(&body)
        .bind(initial)
        .execute(&state.db)
        .await
    {
        Ok(r) => r.last_insert_rowid(),
        Err(e) => {
            tracing::error!(error = ?e, "could not record email");
            return;
        }
    };
    if provider == EmailProvider::Log {
        tracing::info!(to = %email.to, kind = email.kind, "email logged (no provider configured)");
        return;
    }
    let state = state.clone();
    tokio::spawn(async move {
        let result = deliver(&state, &email, &body).await;
        let (status, error) = match result {
            Ok(()) => ("sent", None),
            Err(e) => {
                tracing::warn!(error = %e, to = %email.to, "email delivery failed");
                ("failed", Some(e.to_string()))
            }
        };
        let _ = sqlx::query("UPDATE email_outbox SET status = ?, error = ? WHERE id = ?")
            .bind(status)
            .bind(error)
            .bind(id)
            .execute(&state.db)
            .await;
    });
}

async fn deliver(state: &AppState, email: &Email, text: &str) -> anyhow::Result<()> {
    let cfg = &state.config.email;
    let html = render_html(email);
    let req = match cfg.provider {
        EmailProvider::Resend => state
            .http
            .post(format!("{}/emails", cfg.api_base))
            .bearer_auth(&cfg.api_key)
            .json(&json!({ "from": cfg.from, "to": [email.to], "subject": email.subject, "text": text, "html": html })),
        EmailProvider::Postmark => state
            .http
            .post(format!("{}/email", cfg.api_base))
            .header("X-Postmark-Server-Token", &cfg.api_key)
            .header("Accept", "application/json")
            .json(&json!({ "From": cfg.from, "To": email.to, "Subject": email.subject, "TextBody": text, "HtmlBody": html, "MessageStream": "outbound" })),
        EmailProvider::Log => return Ok(()),
    };
    let res = req.send().await?;
    if !res.status().is_success() {
        anyhow::bail!("provider returned {}: {}", res.status(), res.text().await.unwrap_or_default());
    }
    Ok(())
}

// ---------- templates ----------

pub fn welcome(to: &str, name: &str, base: &str) -> Email {
    Email {
        to: to.into(),
        kind: "welcome",
        subject: "Welcome to Lumora 👋".into(),
        text: format!(
            "Hi {name},\n\nWelcome to Lumora! You now have free access to the whole AI Foundations module, the first lesson of every module, free prompts and our tools.\n\nA great first step: lesson 1, \"What AI really is (and isn't)\". It takes 7 minutes and ends with a prompt you can try straight away."
        ),
        cta: Some(("Start lesson 1".into(), format!("{base}/learn/what-ai-really-is"))),
    }
}

pub fn password_reset(to: &str, name: &str, link: &str) -> Email {
    Email {
        to: to.into(),
        kind: "password_reset",
        subject: "Reset your Lumora password".into(),
        text: format!("Hi {name},\n\nSomeone (hopefully you) asked to reset your Lumora password. This link works for 1 hour and can be used once.\n\nIf you didn't ask for this, you can safely ignore this email. Your password won't change."),
        cta: Some(("Choose a new password".into(), link.into())),
    }
}

pub fn password_changed(to: &str, name: &str, base: &str) -> Email {
    Email {
        to: to.into(),
        kind: "password_changed",
        subject: "Your Lumora password was changed".into(),
        text: format!("Hi {name},\n\nYour password was just changed and other devices were signed out.\n\nIf this wasn't you, reset your password now and contact us."),
        cta: Some(("Reset password".into(), format!("{base}/forgot-password"))),
    }
}

pub fn purchase(to: &str, name: &str, plan_name: &str, amount: &str, base: &str) -> Email {
    Email {
        to: to.into(),
        kind: "purchase",
        subject: format!("You're in: {plan_name} confirmed"),
        text: format!(
            "Hi {name},\n\nThank you! Your {plan_name} purchase ({amount}) is confirmed and everything in Lumora is now unlocked: all 40 lessons, every quiz and your certificate, the full prompt library and all automation playbooks.\n\nYou can manage your plan any time from your account page. And remember our 14-day money-back guarantee: just reply to this email."
        ),
        cta: Some(("Continue learning".into(), format!("{base}/dashboard"))),
    }
}

pub fn plan_ended(to: &str, name: &str, base: &str) -> Email {
    Email {
        to: to.into(),
        kind: "plan_ended",
        subject: "Your Lumora Pro subscription has ended".into(),
        text: format!("Hi {name},\n\nYour Pro subscription has ended and your account is now on the free plan. Your progress is saved, so you can pick up exactly where you left off if you come back."),
        cta: Some(("See plans".into(), format!("{base}/pricing"))),
    }
}

pub fn payment_failed(to: &str, base: &str) -> Email {
    Email {
        to: to.into(),
        kind: "payment_failed",
        subject: "Action needed: your Lumora payment didn't go through".into(),
        text: "Hi,\n\nWe couldn't process your latest Lumora payment. You still have access for now; please update your card to avoid interruption.".into(),
        cta: Some(("Update billing".into(), format!("{base}/account"))),
    }
}

pub fn starter_kit(to: &str, base: &str) -> Email {
    Email {
        to: to.into(),
        kind: "starter_kit",
        subject: "Your free AI Starter Kit".into(),
        text: "Hi!\n\nHere's your AI Starter Kit: the 10 prompts we'd start with, a privacy checklist and a 7-day plan to build the habit.\n\nWhen you're ready for more, the AI Foundations module is free too.".into(),
        cta: Some(("Open the Starter Kit".into(), format!("{base}/starter-kit"))),
    }
}

pub fn contact_to_support(to: &str, name: &str, from: &str, topic: &str, message: &str) -> Email {
    Email {
        to: to.into(),
        kind: "contact_support",
        subject: format!("[Lumora contact] {topic} from {name}"),
        text: format!("From: {name} <{from}>\nTopic: {topic}\n\n{message}"),
        cta: None,
    }
}

pub fn contact_receipt(to: &str, name: &str) -> Email {
    Email {
        to: to.into(),
        kind: "contact_receipt",
        subject: "We got your message".into(),
        text: format!("Hi {name},\n\nThanks for getting in touch. A real person will reply within one business day."),
        cta: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn html_escapes_content() {
        let e = Email {
            to: "a@b.c".into(),
            kind: "t",
            subject: "s".into(),
            text: "Hi <b>x</b>\n\nLine".into(),
            cta: Some(("Go".into(), "https://x/?a=1&b=2".into())),
        };
        let html = render_html(&e);
        assert!(html.contains("Hi &lt;b&gt;x&lt;/b&gt;"));
        assert!(html.contains("a=1&amp;b=2"));
        assert!(plain_body(&e).contains("Go: https://x/?a=1&b=2"));
    }
}
