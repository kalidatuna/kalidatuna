use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    auth::MaybeUser,
    error::{ApiError, ApiResult},
    state::AppState,
};

#[derive(Deserialize, Default)]
pub struct PromptQuery {
    pub q: Option<String>,
    pub category: Option<String>,
}

pub async fn prompts(State(state): State<AppState>, MaybeUser(user): MaybeUser, Query(q): Query<PromptQuery>) -> ApiResult<Json<Value>> {
    let pro = user.as_ref().is_some_and(|u| u.has_pro());
    let needle = q.q.unwrap_or_default().trim().to_lowercase();
    let mut categories: Vec<String> = Vec::new();
    for p in &state.content.prompts {
        if !categories.contains(&p.category) {
            categories.push(p.category.clone());
        }
    }
    let items: Vec<Value> = state
        .content
        .prompts
        .iter()
        .filter(|p| q.category.as_deref().is_none_or(|c| c.is_empty() || c == p.category))
        .filter(|p| {
            needle.is_empty()
                || p.title.to_lowercase().contains(&needle)
                || p.description.to_lowercase().contains(&needle)
                || p.tags.iter().any(|t| t.to_lowercase().contains(&needle))
                || p.category.to_lowercase().contains(&needle)
        })
        .map(|p| {
            let locked = !p.free && !pro;
            json!({
                "slug": p.slug, "title": p.title, "category": p.category, "description": p.description,
                "tags": p.tags, "free": p.free, "locked": locked,
                "prompt": if locked { None } else { Some(&p.prompt) },
            })
        })
        .collect();
    Ok(Json(json!({
        "categories": categories,
        "total": state.content.prompts.len(),
        "free_count": state.content.prompts.iter().filter(|p| p.free).count(),
        "prompts": items,
    })))
}

pub async fn glossary(State(state): State<AppState>) -> Json<Value> {
    let mut terms = state.content.glossary.clone();
    terms.sort_by_key(|t| t.term.to_lowercase());
    Json(json!({ "terms": terms }))
}

pub async fn tools(State(state): State<AppState>) -> Json<Value> {
    let mut categories: Vec<String> = Vec::new();
    for t in &state.content.tools {
        if !categories.contains(&t.category) {
            categories.push(t.category.clone());
        }
    }
    Json(json!({ "categories": categories, "tools": state.content.tools }))
}

pub async fn playbooks(State(state): State<AppState>, MaybeUser(user): MaybeUser) -> Json<Value> {
    let pro = user.as_ref().is_some_and(|u| u.has_pro());
    let items: Vec<Value> = state
        .content
        .playbooks
        .iter()
        .map(|p| {
            json!({
                "slug": p.slug, "title": p.title, "summary": p.summary, "difficulty": p.difficulty,
                "minutes": p.minutes, "saves": p.saves, "tools": p.tools, "free": p.free, "locked": !p.free && !pro,
            })
        })
        .collect();
    Json(json!({ "playbooks": items }))
}

pub async fn playbook(State(state): State<AppState>, MaybeUser(user): MaybeUser, Path(slug): Path<String>) -> ApiResult<Json<Value>> {
    let p = state.content.playbook(&slug).ok_or(ApiError::NotFound)?;
    let locked = !p.free && !user.as_ref().is_some_and(|u| u.has_pro());
    Ok(Json(json!({
        "playbook": {
            "slug": p.slug, "title": p.title, "summary": p.summary, "difficulty": p.difficulty,
            "minutes": p.minutes, "saves": p.saves, "tools": p.tools, "free": p.free, "locked": locked,
            "html": if locked { None } else { Some(&p.html) },
            "preview_html": p.preview_html,
        },
        "signed_in": user.is_some(),
    })))
}

#[derive(Deserialize)]
pub struct SearchQuery {
    pub q: String,
}

pub async fn search(State(state): State<AppState>, Query(q): Query<SearchQuery>) -> ApiResult<Json<Value>> {
    if q.q.len() > 200 {
        return Err(ApiError::bad("Search is too long."));
    }
    Ok(Json(json!({ "query": q.q, "results": state.content.search(&q.q, 25) })))
}
