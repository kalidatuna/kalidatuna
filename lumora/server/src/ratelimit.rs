//! Tiny fixed-window rate limiter keyed by (bucket, client ip).

use std::time::{Duration, Instant};

use dashmap::DashMap;

pub struct RateLimiter {
    per_minute: u32,
    windows: DashMap<(String, String), (Instant, u32)>,
}

impl RateLimiter {
    pub fn new(per_minute: u32) -> Self {
        RateLimiter { per_minute, windows: DashMap::new() }
    }

    /// Returns true when the request is allowed.
    pub fn check(&self, bucket: &str, key: &str) -> bool {
        let now = Instant::now();
        if self.windows.len() > 50_000 {
            self.windows.retain(|_, (start, _)| now.duration_since(*start) < Duration::from_secs(60));
        }
        let mut entry = self.windows.entry((bucket.to_string(), key.to_string())).or_insert((now, 0));
        let (start, count) = entry.value_mut();
        if now.duration_since(*start) >= Duration::from_secs(60) {
            *start = now;
            *count = 0;
        }
        *count += 1;
        *count <= self.per_minute
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limits_per_key() {
        let rl = RateLimiter::new(3);
        assert!(rl.check("login", "1.1.1.1"));
        assert!(rl.check("login", "1.1.1.1"));
        assert!(rl.check("login", "1.1.1.1"));
        assert!(!rl.check("login", "1.1.1.1"));
        assert!(rl.check("login", "2.2.2.2"));
        assert!(rl.check("signup", "1.1.1.1"));
    }
}
