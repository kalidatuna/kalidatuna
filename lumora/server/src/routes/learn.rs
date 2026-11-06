use std::collections::{HashMap, HashSet};

use axum::{
    extract::{Path, State},
    http::header,
    response::IntoResponse,
    Json,
};
use chrono::{NaiveDate, Utc};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    auth::{CurrentUser, MaybeUser, User},
    certificate,
    content::{Lesson, ModuleDef},
    error::{ApiError, ApiResult},
    state::AppState,
};

pub const QUIZ_PASS_PERCENT: i64 = 70;

async fn completed_set(state: &AppState, user: Option<&User>) -> ApiResult<HashSet<String>> {
    let Some(u) = user else { return Ok(HashSet::new()) };
    let rows: Vec<(String,)> = sqlx::query_as("SELECT lesson_slug FROM progress WHERE user_id = ?").bind(u.id).fetch_all(&state.db).await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}

/// Best quiz score per module: (best_score, total, passed).
async fn quiz_bests(state: &AppState, user: Option<&User>) -> ApiResult<HashMap<String, (i64, i64, bool)>> {
    let Some(u) = user else { return Ok(HashMap::new()) };
    let rows: Vec<(String, i64, i64, i64)> =
        sqlx::query_as("SELECT module_slug, MAX(score), MAX(total), MAX(passed) FROM quiz_attempts WHERE user_id = ? GROUP BY module_slug")
            .bind(u.id)
            .fetch_all(&state.db)
            .await?;
    Ok(rows.into_iter().map(|(m, s, t, p)| (m, (s, t, p == 1))).collect())
}

pub fn can_read(lesson: &Lesson, user: Option<&User>) -> bool {
    lesson.free || user.is_some_and(|u| u.has_pro())
}

fn module_quiz_free(module: &ModuleDef) -> bool {
    module.free
}

fn lesson_card(l: &Lesson, user: Option<&User>, done: &HashSet<String>) -> Value {
    json!({
        "slug": l.slug,
        "title": l.title,
        "summary": l.summary,
        "minutes": l.minutes,
        "free": l.free,
        "locked": !can_read(l, user),
        "completed": done.contains(&l.slug),
    })
}

pub async fn curriculum(State(state): State<AppState>, MaybeUser(user): MaybeUser) -> ApiResult<Json<Value>> {
    let done = completed_set(&state, user.as_ref()).await?;
    let bests = quiz_bests(&state, user.as_ref()).await?;
    let c = &state.content;
    let modules: Vec<Value> = c
        .modules
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let lessons: Vec<&Lesson> = m.lessons.iter().filter_map(|s| c.lesson(s)).collect();
            let completed = lessons.iter().filter(|l| done.contains(&l.slug)).count();
            let best = bests.get(&m.slug);
            json!({
                "number": i + 1,
                "slug": m.slug,
                "title": m.title,
                "tagline": m.tagline,
                "description": m.description,
                "model": m.model,
                "color": m.color,
                "free": m.free,
                "minutes": lessons.iter().map(|l| l.minutes).sum::<u32>(),
                "lesson_count": lessons.len(),
                "completed_count": completed,
                "quiz": {
                    "questions": m.quiz.len(),
                    "free": module_quiz_free(m),
                    "best_score": best.map(|b| b.0),
                    "passed": best.is_some_and(|b| b.2),
                },
                "lessons": lessons.iter().map(|l| lesson_card(l, user.as_ref(), &done)).collect::<Vec<_>>(),
            })
        })
        .collect();
    Ok(Json(json!({
        "modules": modules,
        "totals": {
            "lessons": c.order.len(),
            "completed": done.len(),
            "minutes": c.total_minutes(),
        },
        "has_pro": user.as_ref().is_some_and(|u| u.has_pro()),
    })))
}

pub async fn lesson(State(state): State<AppState>, MaybeUser(user): MaybeUser, Path(slug): Path<String>) -> ApiResult<Json<Value>> {
    let c = &state.content;
    let l = c.lesson(&slug).ok_or(ApiError::NotFound)?;
    let module = c.module(&l.module_slug).ok_or(ApiError::NotFound)?;
    let done = completed_set(&state, user.as_ref()).await?;
    let readable = can_read(l, user.as_ref());
    let nav = |idx: Option<usize>| idx.and_then(|i| c.lesson_at(i)).map(|n| lesson_card(n, user.as_ref(), &done));
    let position = module.lessons.iter().position(|s| s == &l.slug).unwrap_or(0);
    Ok(Json(json!({
        "lesson": {
            "slug": l.slug,
            "title": l.title,
            "summary": l.summary,
            "minutes": l.minutes,
            "free": l.free,
            "locked": !readable,
            "completed": done.contains(&l.slug),
            "html": if readable { Some(&l.html) } else { None },
            "preview_html": l.preview_html,
            "toc": if readable { l.toc.clone() } else { vec![] },
            "position": position + 1,
            "module_lessons": module.lessons.len(),
        },
        "module": {
            "slug": module.slug,
            "title": module.title,
            "color": module.color,
            "model": module.model,
            "number": c.modules.iter().position(|m| m.slug == module.slug).unwrap_or(0) + 1,
            "is_last_lesson": position + 1 == module.lessons.len(),
            "quiz_questions": module.quiz.len(),
        },
        "prev": nav(l.order.checked_sub(1)),
        "next": nav(Some(l.order + 1)),
        "signed_in": user.is_some(),
    })))
}

async fn record_activity(state: &AppState, user_id: i64) -> ApiResult<()> {
    let today = Utc::now().format("%Y-%m-%d").to_string();
    sqlx::query("INSERT OR IGNORE INTO activity (user_id, day) VALUES (?, ?)").bind(user_id).bind(today).execute(&state.db).await?;
    Ok(())
}

pub async fn complete_lesson(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(slug): Path<String>,
) -> ApiResult<Json<Value>> {
    let l = state.content.lesson(&slug).ok_or(ApiError::NotFound)?;
    if !can_read(l, Some(&user)) {
        return Err(ApiError::PaymentRequired);
    }
    sqlx::query("INSERT OR IGNORE INTO progress (user_id, lesson_slug) VALUES (?, ?)").bind(user.id).bind(&slug).execute(&state.db).await?;
    record_activity(&state, user.id).await?;
    let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM progress WHERE user_id = ?").bind(user.id).fetch_one(&state.db).await?;
    Ok(Json(json!({ "completed": true, "total_completed": count })))
}

pub async fn uncomplete_lesson(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(slug): Path<String>,
) -> ApiResult<Json<Value>> {
    state.content.lesson(&slug).ok_or(ApiError::NotFound)?;
    sqlx::query("DELETE FROM progress WHERE user_id = ? AND lesson_slug = ?").bind(user.id).bind(&slug).execute(&state.db).await?;
    Ok(Json(json!({ "completed": false })))
}

fn quiz_allowed(module: &ModuleDef, user: &User) -> bool {
    module_quiz_free(module) || user.has_pro()
}

pub async fn quiz(State(state): State<AppState>, CurrentUser(user): CurrentUser, Path(slug): Path<String>) -> ApiResult<Json<Value>> {
    let m = state.content.module(&slug).ok_or(ApiError::NotFound)?;
    if m.quiz.is_empty() {
        return Err(ApiError::NotFound);
    }
    let locked = !quiz_allowed(m, &user);
    let best = quiz_bests(&state, Some(&user)).await?.get(&m.slug).copied();
    Ok(Json(json!({
        "module": { "slug": m.slug, "title": m.title, "color": m.color, "model": m.model },
        "locked": locked,
        "pass_percent": QUIZ_PASS_PERCENT,
        "questions": if locked { vec![] } else {
            m.quiz.iter().map(|q| json!({ "q": q.q, "options": q.options })).collect::<Vec<_>>()
        },
        "question_count": m.quiz.len(),
        "best": best.map(|(s, t, p)| json!({ "score": s, "total": t, "passed": p })),
    })))
}

#[derive(Deserialize)]
pub struct QuizSubmission {
    pub answers: Vec<Option<usize>>,
}

pub fn grade(questions: &[crate::content::QuizQuestion], answers: &[Option<usize>]) -> (i64, Vec<Value>) {
    let mut score = 0;
    let results = questions
        .iter()
        .enumerate()
        .map(|(i, q)| {
            let given = answers.get(i).copied().flatten();
            let correct = given == Some(q.answer);
            if correct {
                score += 1;
            }
            json!({ "correct": correct, "answer": q.answer, "given": given, "why": q.why })
        })
        .collect();
    (score, results)
}

pub async fn submit_quiz(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(slug): Path<String>,
    Json(body): Json<QuizSubmission>,
) -> ApiResult<Json<Value>> {
    let m = state.content.module(&slug).ok_or(ApiError::NotFound)?;
    if m.quiz.is_empty() {
        return Err(ApiError::NotFound);
    }
    if !quiz_allowed(m, &user) {
        return Err(ApiError::PaymentRequired);
    }
    if body.answers.len() != m.quiz.len() {
        return Err(ApiError::bad(format!("Expected {} answers.", m.quiz.len())));
    }
    let (score, results) = grade(&m.quiz, &body.answers);
    let total = m.quiz.len() as i64;
    let passed = score * 100 >= QUIZ_PASS_PERCENT * total;
    sqlx::query("INSERT INTO quiz_attempts (user_id, module_slug, score, total, passed) VALUES (?, ?, ?, ?, ?)")
        .bind(user.id)
        .bind(&m.slug)
        .bind(score)
        .bind(total)
        .bind(passed as i64)
        .execute(&state.db)
        .await?;
    record_activity(&state, user.id).await?;
    Ok(Json(json!({ "score": score, "total": total, "passed": passed, "results": results })))
}

/// Consecutive active days ending today (or yesterday, so the streak survives until midnight).
pub fn streak(days: &[NaiveDate], today: NaiveDate) -> i64 {
    let set: HashSet<NaiveDate> = days.iter().copied().collect();
    let mut cursor = if set.contains(&today) {
        today
    } else if set.contains(&(today - chrono::Duration::days(1))) {
        today - chrono::Duration::days(1)
    } else {
        return 0;
    };
    let mut n = 0;
    while set.contains(&cursor) {
        n += 1;
        cursor -= chrono::Duration::days(1);
    }
    n
}

pub async fn course_complete(state: &AppState, user: &User) -> ApiResult<bool> {
    let done = completed_set(state, Some(user)).await?;
    Ok(state.content.order.iter().all(|s| done.contains(s)))
}

pub async fn dashboard(State(state): State<AppState>, CurrentUser(user): CurrentUser) -> ApiResult<Json<Value>> {
    let c = &state.content;
    let done = completed_set(&state, Some(&user)).await?;
    let bests = quiz_bests(&state, Some(&user)).await?;
    let day_rows: Vec<(String,)> =
        sqlx::query_as("SELECT day FROM activity WHERE user_id = ? ORDER BY day DESC LIMIT 400").bind(user.id).fetch_all(&state.db).await?;
    let days: Vec<NaiveDate> = day_rows.iter().filter_map(|(d,)| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok()).collect();
    let today = Utc::now().date_naive();
    let last_14: Vec<Value> = (0..14)
        .rev()
        .map(|i| {
            let d = today - chrono::Duration::days(i);
            json!({ "day": d.format("%Y-%m-%d").to_string(), "active": days.contains(&d) })
        })
        .collect();

    let next = c.order.iter().filter_map(|s| c.lesson(s)).find(|l| !done.contains(&l.slug)).map(|l| {
        let m = c.module(&l.module_slug);
        json!({
            "slug": l.slug, "title": l.title, "summary": l.summary, "minutes": l.minutes,
            "locked": !can_read(l, Some(&user)),
            "module_title": m.map(|m| m.title.clone()), "color": m.map(|m| m.color.clone()), "model": m.map(|m| m.model.clone()),
        })
    });

    let modules: Vec<Value> = c
        .modules
        .iter()
        .map(|m| {
            let completed = m.lessons.iter().filter(|s| done.contains(*s)).count();
            let best = bests.get(&m.slug);
            json!({
                "slug": m.slug, "title": m.title, "color": m.color, "model": m.model,
                "completed": completed, "total": m.lessons.len(),
                "quiz_passed": best.is_some_and(|b| b.2),
                "quiz_best": best.map(|b| json!({"score": b.0, "total": b.1})),
            })
        })
        .collect();

    let recent: Vec<(String, String)> =
        sqlx::query_as("SELECT lesson_slug, completed_at FROM progress WHERE user_id = ? ORDER BY completed_at DESC LIMIT 5")
            .bind(user.id)
            .fetch_all(&state.db)
            .await?;
    let recent: Vec<Value> =
        recent.into_iter().filter_map(|(s, at)| c.lesson(&s).map(|l| json!({ "slug": l.slug, "title": l.title, "at": at }))).collect();

    let ready = state.content.order.iter().all(|s| done.contains(s));
    let certificate_code = if ready { Some(crate::routes::support::issue_certificate(&state, user.id, &user.name).await?.0) } else { None };
    let minutes_done: u32 = done.iter().filter_map(|s| c.lesson(s)).map(|l| l.minutes).sum();
    let total = c.order.len();
    Ok(Json(json!({
        "user": user.view(),
        "totals": {
            "lessons": total,
            "completed": done.len(),
            "percent": (done.len() * 100).checked_div(total).unwrap_or(0),
            "minutes_done": minutes_done,
            "minutes_total": c.total_minutes(),
            "quizzes_passed": bests.values().filter(|b| b.2).count(),
            "quizzes_total": c.modules.iter().filter(|m| !m.quiz.is_empty()).count(),
        },
        "streak": streak(&days, today),
        "active_days": last_14,
        "next_lesson": next,
        "modules": modules,
        "recent": recent,
        "certificate_ready": ready,
        "certificate_code": certificate_code,
    })))
}

#[derive(Deserialize)]
pub struct BookmarkBody {
    pub kind: String,
    #[serde(rename = "ref")]
    pub reference: String,
}

fn bookmark_exists(state: &AppState, kind: &str, r: &str) -> bool {
    let c = &state.content;
    match kind {
        "lesson" => c.lesson(r).is_some(),
        "prompt" => c.prompts.iter().any(|p| p.slug == r),
        "playbook" => c.playbook(r).is_some(),
        _ => false,
    }
}

pub async fn list_bookmarks(State(state): State<AppState>, CurrentUser(user): CurrentUser) -> ApiResult<Json<Value>> {
    let rows: Vec<(String, String, String)> =
        sqlx::query_as("SELECT kind, ref, created_at FROM bookmarks WHERE user_id = ? ORDER BY created_at DESC")
            .bind(user.id)
            .fetch_all(&state.db)
            .await?;
    let c = &state.content;
    let items: Vec<Value> = rows
        .into_iter()
        .filter_map(|(kind, r, at)| {
            let title = match kind.as_str() {
                "lesson" => c.lesson(&r).map(|l| l.title.clone()),
                "prompt" => c.prompts.iter().find(|p| p.slug == r).map(|p| p.title.clone()),
                "playbook" => c.playbook(&r).map(|p| p.title.clone()),
                _ => None,
            }?;
            Some(json!({ "kind": kind, "ref": r, "title": title, "at": at }))
        })
        .collect();
    Ok(Json(json!({ "bookmarks": items })))
}

pub async fn add_bookmark(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(b): Json<BookmarkBody>,
) -> ApiResult<Json<Value>> {
    if !bookmark_exists(&state, &b.kind, &b.reference) {
        return Err(ApiError::NotFound);
    }
    sqlx::query("INSERT OR IGNORE INTO bookmarks (user_id, kind, ref) VALUES (?, ?, ?)")
        .bind(user.id)
        .bind(&b.kind)
        .bind(&b.reference)
        .execute(&state.db)
        .await?;
    Ok(Json(json!({ "saved": true })))
}

pub async fn remove_bookmark(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(b): Json<BookmarkBody>,
) -> ApiResult<Json<Value>> {
    sqlx::query("DELETE FROM bookmarks WHERE user_id = ? AND kind = ? AND ref = ?")
        .bind(user.id)
        .bind(&b.kind)
        .bind(&b.reference)
        .execute(&state.db)
        .await?;
    Ok(Json(json!({ "saved": false })))
}

pub async fn certificate(State(state): State<AppState>, CurrentUser(user): CurrentUser) -> ApiResult<impl IntoResponse> {
    if !course_complete(&state, &user).await? {
        return Err(ApiError::Forbidden("Finish every lesson to unlock your certificate.".into()));
    }
    let (last,): (Option<String>,) =
        sqlx::query_as("SELECT MAX(completed_at) FROM progress WHERE user_id = ?").bind(user.id).fetch_one(&state.db).await?;
    let date = last
        .as_deref()
        .and_then(|d| chrono::DateTime::parse_from_rfc3339(d).ok())
        .map(|d| d.format("%B %-d, %Y").to_string())
        .unwrap_or_else(|| Utc::now().format("%B %-d, %Y").to_string());
    let (code, _) = crate::routes::support::issue_certificate(&state, user.id, &user.name).await?;
    let verify_url = format!("{}/verify/{}", state.config.public_url.trim_end_matches('/'), code);
    let svg = certificate::render(&user.name, &date, state.content.order.len(), state.content.total_minutes(), &code, &verify_url);
    Ok(([(header::CONTENT_TYPE, "image/svg+xml; charset=utf-8"), (header::CACHE_CONTROL, "private, no-store")], svg))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn streak_counts_consecutive_days() {
        let today = d("2026-03-10");
        assert_eq!(streak(&[], today), 0);
        assert_eq!(streak(&[d("2026-03-10")], today), 1);
        assert_eq!(streak(&[d("2026-03-10"), d("2026-03-09"), d("2026-03-08"), d("2026-03-05")], today), 3);
        // yesterday still counts until midnight
        assert_eq!(streak(&[d("2026-03-09"), d("2026-03-08")], today), 2);
        // gap of two days resets
        assert_eq!(streak(&[d("2026-03-07")], today), 0);
    }

    #[test]
    fn grading() {
        let qs = vec![
            crate::content::QuizQuestion { q: "a".into(), options: vec!["x".into(), "y".into()], answer: 1, why: "".into() },
            crate::content::QuizQuestion { q: "b".into(), options: vec!["x".into(), "y".into()], answer: 0, why: "".into() },
        ];
        assert_eq!(grade(&qs, &[Some(1), Some(0)]).0, 2);
        assert_eq!(grade(&qs, &[Some(1), None]).0, 1);
        assert_eq!(grade(&qs, &[]).0, 0);
    }
}
