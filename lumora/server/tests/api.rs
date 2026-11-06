//! End-to-end API tests: every request goes through the real router, middleware,
//! database migrations and the real course content.

use std::path::PathBuf;

use axum::{
    body::Body,
    http::{header, Method, Request, StatusCode},
    Router,
};
use http_body_util::BodyExt;
use lumora::{
    billing::sign_stripe_payload,
    build_router,
    config::{BillingMode, Config, StripeConfig},
    AppState,
};
use serde_json::{json, Value};
use tower::ServiceExt;

fn content_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../content")
}

async fn app_with(config: Config) -> (Router, AppState) {
    let state = AppState::init(config).await.expect("state");
    (build_router(state.clone()), state)
}

async fn app() -> (Router, AppState) {
    app_with(Config::for_tests(content_dir())).await
}

/// A tiny cookie-keeping client.
struct Client {
    app: Router,
    cookie: Option<String>,
}

struct Res {
    status: StatusCode,
    headers: axum::http::HeaderMap,
    text: String,
}

impl Res {
    fn json(&self) -> Value {
        serde_json::from_str(&self.text).unwrap_or_else(|_| panic!("not json: {}", self.text))
    }
}

impl Client {
    fn new(app: &Router) -> Self {
        Client { app: app.clone(), cookie: None }
    }

    async fn send(&mut self, method: Method, uri: &str, body: Option<Value>) -> Res {
        let mut req = Request::builder().method(method).uri(uri);
        if let Some(c) = &self.cookie {
            req = req.header(header::COOKIE, c);
        }
        let req = match body {
            Some(b) => req.header(header::CONTENT_TYPE, "application/json").body(Body::from(b.to_string())).unwrap(),
            None => req.body(Body::empty()).unwrap(),
        };
        let res = self.app.clone().oneshot(req).await.unwrap();
        let status = res.status();
        let headers = res.headers().clone();
        for v in headers.get_all(header::SET_COOKIE) {
            let s = v.to_str().unwrap();
            let pair = s.split(';').next().unwrap().to_string();
            if pair.ends_with('=') {
                self.cookie = None;
            } else {
                self.cookie = Some(pair);
            }
        }
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        Res { status, headers, text: String::from_utf8_lossy(&bytes).to_string() }
    }

    async fn get(&mut self, uri: &str) -> Res {
        self.send(Method::GET, uri, None).await
    }
    async fn post(&mut self, uri: &str, body: Value) -> Res {
        self.send(Method::POST, uri, Some(body)).await
    }
    async fn delete(&mut self, uri: &str, body: Value) -> Res {
        self.send(Method::DELETE, uri, Some(body)).await
    }

    async fn signup(&mut self, name: &str, email: &str) -> Value {
        let r = self.post("/api/auth/signup", json!({"name": name, "email": email, "password": "correct horse 42"})).await;
        assert_eq!(r.status, StatusCode::OK, "{}", r.text);
        r.json()
    }
}

#[tokio::test]
async fn content_is_complete_and_valid() {
    let (_, state) = app().await;
    let c = &state.content;
    assert_eq!(c.modules.len(), 10, "ten modules");
    assert_eq!(c.order.len(), 40, "forty lessons");
    for m in &c.modules {
        assert_eq!(m.lessons.len(), 4, "module {} has 4 lessons", m.slug);
        assert_eq!(m.quiz.len(), 5, "module {} has a 5-question quiz", m.slug);
        let first = c.lesson(&m.lessons[0]).unwrap();
        assert!(first.free, "first lesson of {} is free", m.slug);
        for slug in &m.lessons {
            let l = c.lesson(slug).unwrap();
            assert!(l.html.len() > 1500, "lesson {slug} has substance");
            assert!(!l.toc.is_empty(), "lesson {slug} has sections");
            assert!(l.minutes >= 5 && l.minutes <= 15, "lesson {slug} duration");
        }
    }
    assert!(c.prompts.len() >= 60, "prompt library size {}", c.prompts.len());
    assert!(c.prompts.iter().filter(|p| p.free).count() >= 15);
    assert!(c.glossary.len() >= 50);
    assert!(c.tools.len() >= 25);
    assert_eq!(c.playbooks.len(), 10);
    assert!(c.total_minutes() > 300);
}

#[tokio::test]
async fn health_config_and_public_pages() {
    let (app, _) = app().await;
    let mut c = Client::new(&app);
    let r = c.get("/api/health").await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.json()["status"], "ok");

    let cfg = c.get("/api/config").await.json();
    assert_eq!(cfg["billing_mode"], "demo");
    assert_eq!(cfg["plans"].as_array().unwrap().len(), 3);
    assert_eq!(cfg["stats"]["lessons"], 40);

    let r = c.get("/api/does-not-exist").await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    assert_eq!(r.json()["error"]["code"], "not_found");

    let r = c.get("/sitemap.xml").await;
    assert!(r.text.contains("/learn/what-ai-really-is"));
    assert!(r.text.contains("/playbooks/receipt-tracker"));
    let r = c.get("/robots.txt").await;
    assert!(r.text.contains("Sitemap:"));
}

#[tokio::test]
async fn security_headers_are_set() {
    let (app, _) = app().await;
    let r = Client::new(&app).get("/api/health").await;
    let h = &r.headers;
    assert_eq!(h["x-content-type-options"], "nosniff");
    assert_eq!(h["x-frame-options"], "DENY");
    assert!(h[header::CONTENT_SECURITY_POLICY].to_str().unwrap().contains("default-src 'self'"));
    assert_eq!(h[header::CACHE_CONTROL], "no-store");
}

#[tokio::test]
async fn signup_login_logout_flow() {
    let (app, _) = app().await;
    let mut c = Client::new(&app);
    assert!(c.get("/api/me").await.json()["user"].is_null());

    let body = c.signup("Ada", "Ada@Example.com").await;
    assert_eq!(body["user"]["email"], "ada@example.com");
    assert_eq!(body["user"]["has_pro"], false);
    assert!(c.cookie.is_some());
    let me = c.get("/api/me").await.json();
    assert_eq!(me["user"]["name"], "Ada");

    // duplicate email
    let mut other = Client::new(&app);
    let r = other.post("/api/auth/signup", json!({"name": "X", "email": "ada@example.com", "password": "another pass"})).await;
    assert_eq!(r.status, StatusCode::CONFLICT);
    // weak password / bad email
    let r = other.post("/api/auth/signup", json!({"name": "X", "email": "x@example.com", "password": "short"})).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    let r = other.post("/api/auth/signup", json!({"name": "X", "email": "nope", "password": "long enough"})).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);

    // logout clears the session server-side
    let old_cookie = c.cookie.clone();
    c.post("/api/auth/logout", json!({})).await;
    assert!(c.get("/api/me").await.json()["user"].is_null());
    c.cookie = old_cookie;
    assert!(c.get("/api/me").await.json()["user"].is_null(), "old session token is revoked");

    // login
    let r = c.post("/api/auth/login", json!({"email": "ada@example.com", "password": "wrong password"})).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    let r = c.post("/api/auth/login", json!({"email": "ADA@example.com", "password": "correct horse 42"})).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(c.get("/api/me").await.json()["user"]["name"], "Ada");
}

#[tokio::test]
async fn session_cookie_is_http_only() {
    let (app, _) = app().await;
    let mut c = Client::new(&app);
    let r = c.post("/api/auth/signup", json!({"name": "Bo", "email": "bo@example.com", "password": "correct horse 42"})).await;
    let cookie = r.headers[header::SET_COOKIE].to_str().unwrap();
    assert!(cookie.contains("HttpOnly"));
    assert!(cookie.contains("SameSite=Lax"));
    assert!(cookie.contains("Path=/"));
}

#[tokio::test]
async fn csrf_guard_blocks_cross_site_writes() {
    let (app, _) = app().await;
    // form-encoded POST (what a hostile cross-site form would send)
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/auth/logout")
        .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
        .body(Body::from("a=b"))
        .unwrap();
    assert_eq!(app.clone().oneshot(req).await.unwrap().status(), StatusCode::FORBIDDEN);
    // JSON but from another origin
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/auth/logout")
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::HOST, "localhost:8080")
        .header(header::ORIGIN, "https://evil.example")
        .body(Body::from("{}"))
        .unwrap();
    assert_eq!(app.clone().oneshot(req).await.unwrap().status(), StatusCode::FORBIDDEN);
    // same origin is fine
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/auth/logout")
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::HOST, "localhost:8080")
        .header(header::ORIGIN, "http://localhost:8080")
        .body(Body::from("{}"))
        .unwrap();
    assert_eq!(app.clone().oneshot(req).await.unwrap().status(), StatusCode::OK);
}

#[tokio::test]
async fn paywall_is_enforced_server_side() {
    let (app, _) = app().await;
    let mut anon = Client::new(&app);

    let free = anon.get("/api/lessons/what-ai-really-is").await.json();
    assert_eq!(free["lesson"]["locked"], false);
    assert!(free["lesson"]["html"].as_str().unwrap().contains("<h2"));
    assert_eq!(free["next"]["slug"], "how-chatbots-think");
    assert!(free["prev"].is_null());

    let pro = anon.get("/api/lessons/iterate-dont-restart").await.json();
    assert_eq!(pro["lesson"]["locked"], true);
    assert!(pro["lesson"]["html"].is_null(), "pro html must not leak");
    assert!(pro["lesson"]["preview_html"].as_str().unwrap().len() > 50);
    assert!(pro["lesson"]["toc"].as_array().unwrap().is_empty());

    let cur = anon.get("/api/curriculum").await.json();
    let modules = cur["modules"].as_array().unwrap();
    assert_eq!(modules.len(), 10);
    assert_eq!(modules[0]["lessons"][3]["locked"], false, "foundations fully free");
    assert_eq!(modules[1]["lessons"][0]["locked"], false, "first lesson free");
    assert_eq!(modules[1]["lessons"][1]["locked"], true);

    assert_eq!(anon.get("/api/lessons/nope").await.status, StatusCode::NOT_FOUND);

    // Signed in, free plan: still locked, and can't mark it complete.
    let mut user = Client::new(&app);
    user.signup("Cy", "cy@example.com").await;
    assert_eq!(user.post("/api/lessons/iterate-dont-restart/complete", json!({})).await.status, StatusCode::PAYMENT_REQUIRED);
    let r = user.post("/api/billing/checkout", json!({"plan": "yearly"})).await.json();
    assert_eq!(r["url"], "/checkout/demo?plan=yearly");

    // Demo purchase unlocks everything.
    let r = user.post("/api/billing/demo/complete", json!({"plan": "yearly"})).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text);
    let u = r.json();
    assert_eq!(u["user"]["has_pro"], true);
    assert_eq!(u["user"]["plan"], "yearly");
    assert!(u["user"]["plan_renews_at"].is_string());
    let pro = user.get("/api/lessons/iterate-dont-restart").await.json();
    assert_eq!(pro["lesson"]["locked"], false);
    assert!(pro["lesson"]["html"].as_str().unwrap().len() > 1000);

    // Cancel returns to free.
    let r = user.post("/api/billing/demo/cancel", json!({})).await.json();
    assert_eq!(r["user"]["has_pro"], false);
    assert_eq!(user.get("/api/lessons/iterate-dont-restart").await.json()["lesson"]["locked"], true);

    // Unknown plan
    assert_eq!(user.post("/api/billing/checkout", json!({"plan": "platinum"})).await.status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn lifetime_purchase_blocks_repeat_checkout() {
    let (app, _) = app().await;
    let mut u = Client::new(&app);
    u.signup("Li", "li@example.com").await;
    u.post("/api/billing/demo/complete", json!({"plan": "lifetime"})).await;
    let me = u.get("/api/me").await.json();
    assert_eq!(me["user"]["plan"], "lifetime");
    assert!(me["user"]["plan_renews_at"].is_null());
    assert_eq!(u.post("/api/billing/checkout", json!({"plan": "monthly"})).await.status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn progress_dashboard_and_streak() {
    let (app, _) = app().await;
    let mut u = Client::new(&app);
    assert_eq!(u.get("/api/dashboard").await.status, StatusCode::UNAUTHORIZED);
    u.signup("Di", "di@example.com").await;

    let d = u.get("/api/dashboard").await.json();
    assert_eq!(d["totals"]["completed"], 0);
    assert_eq!(d["streak"], 0);
    assert_eq!(d["next_lesson"]["slug"], "what-ai-really-is");

    for slug in ["what-ai-really-is", "how-chatbots-think"] {
        let r = u.post(&format!("/api/lessons/{slug}/complete"), json!({})).await;
        assert_eq!(r.status, StatusCode::OK);
    }
    // idempotent
    let r = u.post("/api/lessons/what-ai-really-is/complete", json!({})).await.json();
    assert_eq!(r["total_completed"], 2);

    let d = u.get("/api/dashboard").await.json();
    assert_eq!(d["totals"]["completed"], 2);
    assert_eq!(d["totals"]["percent"], 5);
    assert_eq!(d["streak"], 1);
    assert_eq!(d["next_lesson"]["slug"], "choosing-your-assistant");
    assert_eq!(d["modules"][0]["completed"], 2);
    assert_eq!(d["active_days"].as_array().unwrap().len(), 14);
    assert_eq!(d["certificate_ready"], false);

    let cur = u.get("/api/curriculum").await.json();
    assert_eq!(cur["modules"][0]["completed_count"], 2);
    assert_eq!(cur["modules"][0]["lessons"][0]["completed"], true);

    u.delete("/api/lessons/how-chatbots-think/complete", json!({})).await;
    assert_eq!(u.get("/api/dashboard").await.json()["totals"]["completed"], 1);
}

#[tokio::test]
async fn quizzes_grade_without_leaking_answers() {
    let (app, state) = app().await;
    let mut u = Client::new(&app);
    assert_eq!(u.get("/api/modules/foundations/quiz").await.status, StatusCode::UNAUTHORIZED);
    u.signup("Ed", "ed@example.com").await;

    let q = u.get("/api/modules/foundations/quiz").await;
    assert_eq!(q.status, StatusCode::OK);
    let q = q.json();
    assert_eq!(q["locked"], false);
    assert_eq!(q["questions"].as_array().unwrap().len(), 5);
    assert!(!q.to_string().contains("\"answer\""), "answers must not be sent before submission");

    let module = state.content.module("foundations").unwrap();
    let correct: Vec<Value> = module.quiz.iter().map(|q| json!(q.answer)).collect();
    let wrong: Vec<Value> = module.quiz.iter().map(|q| json!((q.answer + 1) % q.options.len())).collect();

    let r = u.post("/api/modules/foundations/quiz", json!({"answers": wrong})).await.json();
    assert_eq!(r["score"], 0);
    assert_eq!(r["passed"], false);
    assert!(r["results"][0]["why"].as_str().unwrap().len() > 10);

    let r = u.post("/api/modules/foundations/quiz", json!({"answers": correct})).await.json();
    assert_eq!(r["score"], 5);
    assert_eq!(r["passed"], true);

    let q = u.get("/api/modules/foundations/quiz").await.json();
    assert_eq!(q["best"]["score"], 5);
    assert_eq!(q["best"]["passed"], true);

    // wrong answer count
    assert_eq!(u.post("/api/modules/foundations/quiz", json!({"answers": [0]})).await.status, StatusCode::BAD_REQUEST);
    // pro module quiz is locked for free members
    let q = u.get("/api/modules/automation/quiz").await.json();
    assert_eq!(q["locked"], true);
    assert!(q["questions"].as_array().unwrap().is_empty());
    assert_eq!(u.post("/api/modules/automation/quiz", json!({"answers": [0, 0, 0, 0, 0]})).await.status, StatusCode::PAYMENT_REQUIRED);
}

#[tokio::test]
async fn library_prompts_playbooks_glossary_tools_search() {
    let (app, _) = app().await;
    let mut anon = Client::new(&app);
    let p = anon.get("/api/prompts").await.json();
    let prompts = p["prompts"].as_array().unwrap();
    assert!(prompts.len() >= 60);
    let locked = prompts.iter().find(|p| p["locked"] == true).unwrap();
    assert!(locked["prompt"].is_null(), "locked prompt text must not leak");
    let free = prompts.iter().find(|p| p["free"] == true).unwrap();
    assert!(free["prompt"].as_str().unwrap().len() > 20);

    let filtered = anon.get("/api/prompts?category=Money").await.json();
    assert!(filtered["prompts"].as_array().unwrap().iter().all(|p| p["category"] == "Money"));
    let searched = anon.get("/api/prompts?q=meal").await.json();
    assert!(searched["prompts"].as_array().unwrap().iter().any(|p| p["slug"] == "meal-plan"));

    let pbs = anon.get("/api/playbooks").await.json();
    assert_eq!(pbs["playbooks"].as_array().unwrap().len(), 10);
    let pb = anon.get("/api/playbooks/receipt-tracker").await.json();
    assert_eq!(pb["playbook"]["locked"], false);
    let pb = anon.get("/api/playbooks/enquiry-handler").await.json();
    assert_eq!(pb["playbook"]["locked"], true);
    assert!(pb["playbook"]["html"].is_null());

    let g = anon.get("/api/glossary").await.json();
    assert!(g["terms"].as_array().unwrap().len() >= 50);
    let t = anon.get("/api/tools").await.json();
    assert!(t["categories"].as_array().unwrap().len() >= 5);

    let s = anon.get("/api/search?q=hallucination").await.json();
    let results = s["results"].as_array().unwrap();
    assert!(!results.is_empty());
    assert!(results.iter().any(|r| r["kind"] == "lesson" && r["slug"] == "hallucinations-and-verification"));
    assert!(results.iter().any(|r| r["kind"] == "term"));
    assert!(anon.get("/api/search?q=zzzxqv").await.json()["results"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn bookmarks_roundtrip() {
    let (app, _) = app().await;
    let mut u = Client::new(&app);
    u.signup("Fa", "fa@example.com").await;
    assert_eq!(u.post("/api/bookmarks", json!({"kind": "prompt", "ref": "meal-plan"})).await.status, StatusCode::OK);
    assert_eq!(u.post("/api/bookmarks", json!({"kind": "lesson", "ref": "what-ai-really-is"})).await.status, StatusCode::OK);
    assert_eq!(u.post("/api/bookmarks", json!({"kind": "lesson", "ref": "missing"})).await.status, StatusCode::NOT_FOUND);
    let b = u.get("/api/bookmarks").await.json();
    assert_eq!(b["bookmarks"].as_array().unwrap().len(), 2);
    u.delete("/api/bookmarks", json!({"kind": "prompt", "ref": "meal-plan"})).await;
    assert_eq!(u.get("/api/bookmarks").await.json()["bookmarks"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn certificate_unlocks_after_full_completion() {
    let (app, state) = app().await;
    let mut u = Client::new(&app);
    u.signup("Grace <Hopper>", "grace@example.com").await;
    assert_eq!(u.get("/api/certificate").await.status, StatusCode::FORBIDDEN);
    u.post("/api/billing/demo/complete", json!({"plan": "monthly"})).await;
    for slug in &state.content.order {
        assert_eq!(u.post(&format!("/api/lessons/{slug}/complete"), json!({})).await.status, StatusCode::OK);
    }
    assert_eq!(u.get("/api/dashboard").await.json()["certificate_ready"], true);
    let r = u.get("/api/certificate").await;
    assert_eq!(r.status, StatusCode::OK);
    assert!(r.headers[header::CONTENT_TYPE].to_str().unwrap().starts_with("image/svg+xml"));
    assert!(r.text.contains("Grace &lt;Hopper&gt;"));
    assert!(r.text.contains("40 lessons"));
}

#[tokio::test]
async fn account_management() {
    let (app, _) = app().await;
    let mut u = Client::new(&app);
    u.signup("Hal", "hal@example.com").await;
    u.post("/api/lessons/what-ai-really-is/complete", json!({})).await;

    let r = u.send(Method::PATCH, "/api/me", Some(json!({"name": "Hal 9000"}))).await.json();
    assert_eq!(r["user"]["name"], "Hal 9000");

    let ex = u.get("/api/me/export").await.json();
    assert_eq!(ex["account"]["email"], "hal@example.com");
    assert_eq!(ex["progress"].as_array().unwrap().len(), 1);

    // change password signs out other devices
    let mut other_device = Client::new(&app);
    other_device.post("/api/auth/login", json!({"email": "hal@example.com", "password": "correct horse 42"})).await;
    assert!(!other_device.get("/api/me").await.json()["user"].is_null());
    let r = u.post("/api/me/password", json!({"current": "nope nope", "new": "new password 1"})).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    let r = u.post("/api/me/password", json!({"current": "correct horse 42", "new": "new password 1"})).await;
    assert_eq!(r.status, StatusCode::OK);
    assert!(other_device.get("/api/me").await.json()["user"].is_null());
    assert!(!u.get("/api/me").await.json()["user"].is_null(), "current device stays signed in");

    // delete account
    assert_eq!(u.delete("/api/me", json!({"password": "wrong"})).await.status, StatusCode::BAD_REQUEST);
    assert_eq!(u.delete("/api/me", json!({"password": "new password 1"})).await.status, StatusCode::OK);
    assert!(u.get("/api/me").await.json()["user"].is_null());
    let r = u.post("/api/auth/login", json!({"email": "hal@example.com", "password": "new password 1"})).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn leads_and_admin() {
    let (app, _) = app().await;
    let mut anon = Client::new(&app);
    assert_eq!(anon.post("/api/leads", json!({"email": "lead@example.com", "source": "hero"})).await.status, StatusCode::OK);
    assert_eq!(anon.post("/api/leads", json!({"email": "lead@example.com"})).await.status, StatusCode::OK, "duplicates are fine");
    assert_eq!(anon.post("/api/leads", json!({"email": "bad"})).await.status, StatusCode::BAD_REQUEST);
    assert_eq!(anon.get("/api/admin/stats").await.status, StatusCode::UNAUTHORIZED);

    let mut member = Client::new(&app);
    member.signup("Ivy", "ivy@example.com").await;
    member.post("/api/billing/demo/complete", json!({"plan": "monthly"})).await;
    assert_eq!(member.get("/api/admin/stats").await.status, StatusCode::FORBIDDEN);

    let mut admin = Client::new(&app);
    let a = admin.signup("Admin", "admin@lumora.test").await;
    assert_eq!(a["user"]["role"], "admin");
    assert_eq!(a["user"]["has_pro"], true);
    let s = admin.get("/api/admin/stats").await.json();
    assert_eq!(s["users"], 2);
    assert_eq!(s["paying"], 1);
    assert_eq!(s["plans"]["monthly"], 1);
    assert_eq!(s["mrr_cents"], 1400);
    assert_eq!(s["revenue_cents"], 1400);
    assert!(s["leads"].as_i64().unwrap() >= 3);

    let users = admin.get("/api/admin/users?q=ivy").await.json();
    assert_eq!(users["users"].as_array().unwrap().len(), 1);
    let csv = admin.get("/api/admin/leads.csv").await;
    assert!(csv.text.starts_with("email,source,created_at"));
    assert!(csv.text.contains("\"lead@example.com\",\"hero\""));
}

#[tokio::test]
async fn auth_rate_limit() {
    let mut cfg = Config::for_tests(content_dir());
    cfg.auth_rate_per_minute = 3;
    let (app, _) = app_with(cfg).await;
    let mut c = Client::new(&app);
    for _ in 0..3 {
        let r = c.post("/api/auth/login", json!({"email": "x@example.com", "password": "whatever1"})).await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST);
    }
    let r = c.post("/api/auth/login", json!({"email": "x@example.com", "password": "whatever1"})).await;
    assert_eq!(r.status, StatusCode::TOO_MANY_REQUESTS);
}

// ---------- Stripe ----------

fn stripe_config(api_base: &str) -> Config {
    let mut cfg = Config::for_tests(content_dir());
    cfg.billing = BillingMode::Stripe;
    cfg.stripe = Some(StripeConfig {
        secret_key: "sk_test_123".into(),
        webhook_secret: "whsec_test".into(),
        price_monthly: "price_monthly".into(),
        price_yearly: "price_yearly".into(),
        price_lifetime: "price_lifetime".into(),
        api_base: api_base.into(),
    });
    cfg
}

async fn webhook(app: &Router, event: Value) -> (StatusCode, Value) {
    let payload = event.to_string();
    let sig = sign_stripe_payload(payload.as_bytes(), "whsec_test", chrono::Utc::now().timestamp());
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/stripe/webhook")
        .header("stripe-signature", sig)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(payload))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

#[tokio::test]
async fn stripe_webhooks_drive_subscription_state() {
    let (app, _) = app_with(stripe_config("http://127.0.0.1:9")).await;
    let mut u = Client::new(&app);
    let id = u.signup("Jo", "jo@example.com").await["user"]["id"].as_i64().unwrap();

    // demo endpoints are disabled in stripe mode
    assert_eq!(u.post("/api/billing/demo/complete", json!({"plan": "monthly"})).await.status, StatusCode::NOT_FOUND);

    // bad signature
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/stripe/webhook")
        .header("stripe-signature", "t=1,v1=deadbeef")
        .body(Body::from("{}"))
        .unwrap();
    assert_eq!(app.clone().oneshot(req).await.unwrap().status(), StatusCode::BAD_REQUEST);

    let completed = json!({
        "id": "evt_1", "type": "checkout.session.completed",
        "data": {"object": {"id": "cs_1", "client_reference_id": id.to_string(), "customer": "cus_1",
            "subscription": "sub_1", "amount_total": 9900, "metadata": {"plan": "yearly", "user_id": id.to_string()}}}
    });
    let (s, _) = webhook(&app, completed.clone()).await;
    assert_eq!(s, StatusCode::OK);
    let me = u.get("/api/me").await.json();
    assert_eq!(me["user"]["plan"], "yearly");
    assert_eq!(me["user"]["has_pro"], true);
    assert_eq!(me["user"]["has_billing_portal"], true);

    // replayed event is ignored
    let (_, body) = webhook(&app, completed).await;
    assert_eq!(body["duplicate"], true);

    // payment failure → past_due (still has access during grace)
    webhook(&app, json!({"id": "evt_2", "type": "invoice.payment_failed", "data": {"object": {"customer": "cus_1"}}})).await;
    let me = u.get("/api/me").await.json();
    assert_eq!(me["user"]["plan_status"], "past_due");
    assert_eq!(me["user"]["has_pro"], true);

    // renewal → active with new period end
    webhook(
        &app,
        json!({"id": "evt_3", "type": "customer.subscription.updated", "data": {"object": {
        "id": "sub_1", "customer": "cus_1", "status": "active", "current_period_end": 1_900_000_000_i64}}}),
    )
    .await;
    let me = u.get("/api/me").await.json();
    assert_eq!(me["user"]["plan_status"], "active");
    assert!(me["user"]["plan_renews_at"].as_str().unwrap().starts_with("2030-"));

    // cancellation → back to free
    webhook(&app, json!({"id": "evt_4", "type": "customer.subscription.deleted", "data": {"object": {"id": "sub_1", "customer": "cus_1", "status": "canceled"}}})).await;
    let me = u.get("/api/me").await.json();
    assert_eq!(me["user"]["plan"], "free");
    assert_eq!(me["user"]["has_pro"], false);
}

#[tokio::test]
async fn stripe_checkout_and_portal_call_the_api() {
    use axum::{extract::Form, routing::post, Json};
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    // A fake Stripe API that records what we sent.
    let seen: Arc<Mutex<Vec<HashMap<String, String>>>> = Arc::default();
    let seen2 = seen.clone();
    let seen3 = seen.clone();
    let mock = Router::new()
        .route(
            "/v1/checkout/sessions",
            post(move |Form(f): Form<HashMap<String, String>>| {
                let seen = seen2.clone();
                async move {
                    seen.lock().unwrap().push(f);
                    Json(json!({"id": "cs_test", "url": "https://checkout.stripe.com/c/pay/cs_test"}))
                }
            }),
        )
        .route(
            "/v1/billing_portal/sessions",
            post(move |Form(f): Form<HashMap<String, String>>| {
                let seen = seen3.clone();
                async move {
                    seen.lock().unwrap().push(f);
                    Json(json!({"url": "https://billing.stripe.com/p/session/test"}))
                }
            }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, mock).await.unwrap() });

    let (app, _) = app_with(stripe_config(&format!("http://{addr}"))).await;
    let mut u = Client::new(&app);
    let id = u.signup("Kai", "kai@example.com").await["user"]["id"].as_i64().unwrap();

    let r = u.post("/api/billing/checkout", json!({"plan": "monthly"})).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text);
    assert_eq!(r.json()["url"], "https://checkout.stripe.com/c/pay/cs_test");
    {
        let sent = seen.lock().unwrap();
        let f = &sent[0];
        assert_eq!(f["mode"], "subscription");
        assert_eq!(f["line_items[0][price]"], "price_monthly");
        assert_eq!(f["client_reference_id"], id.to_string());
        assert_eq!(f["customer_email"], "kai@example.com");
    }

    // No customer yet → no portal
    assert_eq!(u.post("/api/billing/portal", json!({})).await.status, StatusCode::BAD_REQUEST);
    webhook(
        &app,
        json!({"id": "evt_p", "type": "checkout.session.completed", "data": {"object": {
        "id": "cs_2", "client_reference_id": id.to_string(), "customer": "cus_9", "subscription": "sub_9",
        "amount_total": 1400, "metadata": {"plan": "monthly"}}}}),
    )
    .await;
    let r = u.post("/api/billing/portal", json!({})).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text);
    assert_eq!(r.json()["url"], "https://billing.stripe.com/p/session/test");
    assert_eq!(seen.lock().unwrap()[1]["customer"], "cus_9");
}

// ---------- Email, password reset, contact, certificates ----------

async fn outbox(state: &AppState, to: &str) -> Vec<(String, String, String)> {
    sqlx::query_as("SELECT kind, subject, body_text FROM email_outbox WHERE to_email = ? ORDER BY id")
        .bind(to)
        .fetch_all(&state.db)
        .await
        .unwrap()
}

#[tokio::test]
async fn signup_and_purchase_send_emails() {
    let (app, state) = app().await;
    let mut u = Client::new(&app);
    u.signup("Mia", "mia@example.com").await;
    u.post("/api/billing/demo/complete", json!({"plan": "lifetime"})).await;
    let kinds: Vec<String> = outbox(&state, "mia@example.com").await.into_iter().map(|e| e.0).collect();
    assert_eq!(kinds, vec!["welcome", "purchase"]);
    let purchase = &outbox(&state, "mia@example.com").await[1];
    assert!(purchase.1.contains("Lifetime"));
    assert!(purchase.2.contains("$249.00"));

    // Leads get the starter kit exactly once
    let mut anon = Client::new(&app);
    anon.post("/api/leads", json!({"email": "kit@example.com"})).await;
    anon.post("/api/leads", json!({"email": "kit@example.com"})).await;
    assert_eq!(outbox(&state, "kit@example.com").await.len(), 1);
}

fn reset_token(body: &str) -> String {
    let start = body.find("token=").expect("link in email") + 6;
    body[start..].split_whitespace().next().unwrap().to_string()
}

#[tokio::test]
async fn password_reset_flow() {
    let (app, state) = app().await;
    let mut u = Client::new(&app);
    u.signup("Noa", "noa@example.com").await;
    let mut other_device = Client::new(&app);
    other_device.post("/api/auth/login", json!({"email": "noa@example.com", "password": "correct horse 42"})).await;

    let mut anon = Client::new(&app);
    // Unknown emails get the same answer and no email
    let r = anon.post("/api/auth/forgot", json!({"email": "ghost@example.com"})).await;
    assert_eq!(r.status, StatusCode::OK);
    assert!(outbox(&state, "ghost@example.com").await.is_empty());

    let r = anon.post("/api/auth/forgot", json!({"email": "NOA@example.com"})).await;
    assert_eq!(r.status, StatusCode::OK);
    let mail = outbox(&state, "noa@example.com").await.into_iter().find(|e| e.0 == "password_reset").expect("reset email");
    assert!(mail.2.contains("http://localhost:8080/reset-password?token="));
    let token = reset_token(&mail.2);

    // Bad token and weak password are rejected
    assert_eq!(anon.post("/api/auth/reset", json!({"token": "nope", "password": "brand new pass"})).await.status, StatusCode::BAD_REQUEST);
    assert_eq!(anon.post("/api/auth/reset", json!({"token": token, "password": "short"})).await.status, StatusCode::BAD_REQUEST);

    let r = anon.post("/api/auth/reset", json!({"token": token, "password": "brand new pass"})).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text);
    assert_eq!(r.json()["user"]["email"], "noa@example.com");
    assert_eq!(anon.get("/api/me").await.json()["user"]["name"], "Noa", "reset signs you in");
    // All other sessions are revoked, the token is single-use, and the new password works
    assert!(other_device.get("/api/me").await.json()["user"].is_null());
    assert!(u.get("/api/me").await.json()["user"].is_null());
    assert_eq!(anon.post("/api/auth/reset", json!({"token": token, "password": "another new pass"})).await.status, StatusCode::BAD_REQUEST);
    let mut fresh = Client::new(&app);
    assert_eq!(
        fresh.post("/api/auth/login", json!({"email": "noa@example.com", "password": "brand new pass"})).await.status,
        StatusCode::OK
    );
    assert!(outbox(&state, "noa@example.com").await.iter().any(|e| e.0 == "password_changed"));
}

#[tokio::test]
async fn expired_reset_tokens_are_rejected() {
    let (app, state) = app().await;
    let mut anon = Client::new(&app);
    anon.signup("Old", "old@example.com").await;
    anon.post("/api/auth/forgot", json!({"email": "old@example.com"})).await;
    let mail = outbox(&state, "old@example.com").await.into_iter().find(|e| e.0 == "password_reset").unwrap();
    sqlx::query("UPDATE password_resets SET expires_at = '2000-01-01T00:00:00Z'").execute(&state.db).await.unwrap();
    let r = anon.post("/api/auth/reset", json!({"token": reset_token(&mail.2), "password": "brand new pass"})).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert!(r.json()["error"]["message"].as_str().unwrap().contains("expired"));
}

#[tokio::test]
async fn contact_form_stores_and_notifies() {
    let (app, state) = app().await;
    let mut anon = Client::new(&app);
    let bad = anon
        .post(
            "/api/contact",
            json!({"name": "Ola", "email": "ola@example.com", "topic": "Hacking", "message": "Hello there, quick question"}),
        )
        .await;
    assert_eq!(bad.status, StatusCode::BAD_REQUEST);
    let short = anon.post("/api/contact", json!({"name": "Ola", "email": "ola@example.com", "topic": "Feedback", "message": "hi"})).await;
    assert_eq!(short.status, StatusCode::BAD_REQUEST);
    let ok = anon
        .post("/api/contact", json!({"name": "Ola", "email": "ola@example.com", "topic": "Teams & companies", "message": "We'd like 25 seats for our office."}))
        .await;
    assert_eq!(ok.status, StatusCode::OK, "{}", ok.text);
    let support = outbox(&state, "support@lumora.test").await;
    assert_eq!(support.len(), 1);
    assert!(support[0].1.contains("Teams & companies"));
    assert!(support[0].2.contains("25 seats"));
    assert_eq!(outbox(&state, "ola@example.com").await[0].0, "contact_receipt");

    let mut admin = Client::new(&app);
    admin.signup("Admin", "admin@lumora.test").await;
    let msgs = admin.get("/api/admin/messages").await.json();
    assert_eq!(msgs["messages"][0]["email"], "ola@example.com");
    let mails = admin.get("/api/admin/emails?to=ola@example.com").await.json();
    assert_eq!(mails["provider"], "log");
    assert_eq!(mails["emails"].as_array().unwrap().len(), 1);
    assert_eq!(anon.get("/api/admin/emails").await.status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn certificates_are_publicly_verifiable() {
    let (app, state) = app().await;
    let mut u = Client::new(&app);
    u.signup("Pat Verified", "pat@example.com").await;
    u.post("/api/billing/demo/complete", json!({"plan": "yearly"})).await;
    for slug in &state.content.order {
        u.post(&format!("/api/lessons/{slug}/complete"), json!({})).await;
    }
    let d = u.get("/api/dashboard").await.json();
    let code = d["certificate_code"].as_str().expect("issued").to_string();
    assert!(code.starts_with("LUM-"));
    let svg = u.get("/api/certificate").await.text;
    assert!(svg.contains(&code));
    assert!(svg.contains(&format!("/verify/{code}")));
    // Stable across calls
    assert_eq!(u.get("/api/dashboard").await.json()["certificate_code"], code.as_str());

    let mut anon = Client::new(&app);
    let v = anon.get(&format!("/api/verify/{}", code.to_lowercase())).await.json();
    assert_eq!(v["valid"], true);
    assert_eq!(v["name"], "Pat Verified");
    assert_eq!(v["lessons"], 40);
    assert_eq!(anon.get("/api/verify/LUM-FAKE-CODE").await.json()["valid"], false);
}

#[tokio::test]
async fn emails_are_delivered_through_the_provider_api() {
    use axum::{routing::post, Json};
    use std::sync::{Arc, Mutex};
    let seen: Arc<Mutex<Vec<(String, Value)>>> = Arc::default();
    let seen2 = seen.clone();
    let mock = Router::new().route(
        "/emails",
        post(move |headers: axum::http::HeaderMap, Json(body): Json<Value>| {
            let seen = seen2.clone();
            async move {
                let auth = headers.get("authorization").and_then(|v| v.to_str().ok()).unwrap_or_default().to_string();
                seen.lock().unwrap().push((auth, body));
                Json(json!({"id": "email_123"}))
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, mock).await.unwrap() });

    let mut cfg = Config::for_tests(content_dir());
    cfg.email.provider = lumora::config::EmailProvider::Resend;
    cfg.email.api_key = "re_test".into();
    cfg.email.api_base = format!("http://{addr}");
    let (app, state) = app_with(cfg).await;
    Client::new(&app).signup("Quinn", "quinn@example.com").await;
    for _ in 0..50 {
        let status: Option<(String,)> =
            sqlx::query_as("SELECT status FROM email_outbox WHERE to_email = 'quinn@example.com'").fetch_optional(&state.db).await.unwrap();
        if status.as_ref().is_some_and(|s| s.0 == "sent") {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    let sent = seen.lock().unwrap();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].0, "Bearer re_test");
    assert_eq!(sent[0].1["to"][0], "quinn@example.com");
    assert!(sent[0].1["html"].as_str().unwrap().contains("Start lesson 1"));
}

/// Runs against Stripe's official API mock (https://github.com/stripe/stripe-mock), which validates
/// every parameter against Stripe's OpenAPI spec. Set STRIPE_MOCK_URL (e.g. http://localhost:12111).
#[tokio::test]
async fn checkout_requests_are_valid_against_stripe_mock() {
    let Ok(base) = std::env::var("STRIPE_MOCK_URL") else {
        eprintln!("STRIPE_MOCK_URL not set; skipping stripe-mock validation");
        return;
    };
    let (app, _) = app_with(stripe_config(&base)).await;
    let mut u = Client::new(&app);
    let id = u.signup("Stripe Tester", "stripe@example.com").await["user"]["id"].as_i64().unwrap();
    for plan in ["monthly", "yearly", "lifetime"] {
        let r = u.post("/api/billing/checkout", json!({"plan": plan})).await;
        assert_eq!(r.status, StatusCode::OK, "{plan}: {}", r.text);
        assert!(r.json()["url"].as_str().unwrap().starts_with("http"), "{plan}: {}", r.text);
    }
    webhook(
        &app,
        json!({"id": "evt_sm", "type": "checkout.session.completed", "data": {"object": {
        "id": "cs_sm", "client_reference_id": id.to_string(), "customer": "cus_123", "subscription": "sub_123",
        "amount_total": 1400, "metadata": {"plan": "monthly"}}}}),
    )
    .await;
    // Existing customers reuse their customer id
    let r = u.post("/api/billing/checkout", json!({"plan": "yearly"})).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text);
    let r = u.post("/api/billing/portal", json!({})).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text);
}
