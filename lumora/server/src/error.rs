use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("{0}")]
    BadRequest(String),
    #[error("Please sign in to continue.")]
    Unauthorized,
    #[error("{0}")]
    Forbidden(String),
    #[error("This content is part of Lumora Pro.")]
    PaymentRequired,
    #[error("Not found.")]
    NotFound,
    #[error("{0}")]
    Conflict(String),
    #[error("Too many requests. Please wait a minute and try again.")]
    TooManyRequests,
    #[error("Something went wrong on our side.")]
    Internal(#[from] anyhow::Error),
}

impl From<sqlx::Error> for ApiError {
    fn from(e: sqlx::Error) -> Self {
        ApiError::Internal(e.into())
    }
}

impl ApiError {
    pub fn bad(msg: impl Into<String>) -> Self {
        ApiError::BadRequest(msg.into())
    }
    fn status(&self) -> StatusCode {
        match self {
            ApiError::BadRequest(_) => StatusCode::BAD_REQUEST,
            ApiError::Unauthorized => StatusCode::UNAUTHORIZED,
            ApiError::Forbidden(_) => StatusCode::FORBIDDEN,
            ApiError::PaymentRequired => StatusCode::PAYMENT_REQUIRED,
            ApiError::NotFound => StatusCode::NOT_FOUND,
            ApiError::Conflict(_) => StatusCode::CONFLICT,
            ApiError::TooManyRequests => StatusCode::TOO_MANY_REQUESTS,
            ApiError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
    fn code(&self) -> &'static str {
        match self {
            ApiError::BadRequest(_) => "bad_request",
            ApiError::Unauthorized => "unauthorized",
            ApiError::Forbidden(_) => "forbidden",
            ApiError::PaymentRequired => "payment_required",
            ApiError::NotFound => "not_found",
            ApiError::Conflict(_) => "conflict",
            ApiError::TooManyRequests => "rate_limited",
            ApiError::Internal(_) => "internal",
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        if let ApiError::Internal(ref e) = self {
            tracing::error!(error = ?e, "internal error");
        }
        let body = Json(json!({ "error": { "code": self.code(), "message": self.to_string() } }));
        (self.status(), body).into_response()
    }
}

pub type ApiResult<T> = Result<T, ApiError>;
