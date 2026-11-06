//! Course content: loaded once at startup from `content/`, rendered to HTML,
//! validated, and kept in memory so every request is a pointer lookup.

use std::{collections::HashMap, fs, path::Path};

use anyhow::{anyhow, bail, Context, Result};
use pulldown_cmark::{html, CowStr, Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct QuizQuestion {
    pub q: String,
    pub options: Vec<String>,
    pub answer: usize,
    pub why: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ModuleDef {
    pub slug: String,
    pub title: String,
    pub tagline: String,
    pub description: String,
    pub model: String,
    pub color: String,
    #[serde(default)]
    pub free: bool,
    pub lessons: Vec<String>,
    #[serde(default)]
    pub quiz: Vec<QuizQuestion>,
}

#[derive(Debug, Deserialize)]
struct CurriculumFile {
    modules: Vec<ModuleDef>,
}

#[derive(Debug, Deserialize)]
struct LessonFront {
    title: String,
    summary: String,
    minutes: u32,
    #[serde(default)]
    free: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct TocEntry {
    pub id: String,
    pub text: String,
}

#[derive(Debug, Clone)]
pub struct Lesson {
    pub slug: String,
    pub module_slug: String,
    pub title: String,
    pub summary: String,
    pub minutes: u32,
    pub free: bool,
    pub html: String,
    pub preview_html: String,
    pub toc: Vec<TocEntry>,
    /// Global position in the course (0-based).
    pub order: usize,
    search_text: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PromptItem {
    pub slug: String,
    pub title: String,
    pub category: String,
    pub description: String,
    pub prompt: String,
    #[serde(default)]
    pub free: bool,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct PromptsFile {
    prompts: Vec<PromptItem>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Term {
    pub term: String,
    pub definition: String,
    #[serde(default)]
    pub example: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GlossaryFile {
    terms: Vec<Term>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Tool {
    pub name: String,
    pub category: String,
    pub url: String,
    pub what: String,
    pub best_for: String,
    pub pricing: String,
    #[serde(default)]
    pub free_tier: bool,
}

#[derive(Debug, Deserialize)]
struct ToolsFile {
    tools: Vec<Tool>,
}

#[derive(Debug, Deserialize)]
struct PlaybookFront {
    title: String,
    summary: String,
    difficulty: String,
    minutes: u32,
    saves: String,
    tools: Vec<String>,
    #[serde(default)]
    free: bool,
}

#[derive(Debug, Clone)]
pub struct Playbook {
    pub slug: String,
    pub title: String,
    pub summary: String,
    pub difficulty: String,
    pub minutes: u32,
    pub saves: String,
    pub tools: Vec<String>,
    pub free: bool,
    pub html: String,
    pub preview_html: String,
    search_text: String,
}

#[derive(Debug)]
pub struct Content {
    pub modules: Vec<ModuleDef>,
    pub lessons: HashMap<String, Lesson>,
    /// Lesson slugs in course order.
    pub order: Vec<String>,
    pub prompts: Vec<PromptItem>,
    pub glossary: Vec<Term>,
    pub tools: Vec<Tool>,
    pub playbooks: Vec<Playbook>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchHit {
    pub kind: &'static str,
    pub slug: String,
    pub title: String,
    pub snippet: String,
    pub score: u32,
}

fn split_front_matter(raw: &str) -> Result<(&str, &str)> {
    let raw = raw.trim_start_matches('\u{feff}');
    let rest = raw.strip_prefix("+++").ok_or_else(|| anyhow!("missing +++ front matter"))?;
    let end = rest.find("\n+++").ok_or_else(|| anyhow!("unterminated front matter"))?;
    let front = &rest[..end];
    let body = rest[end + 4..].trim_start_matches(['\r', '\n']);
    Ok((front, body))
}

pub fn slugify(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut dash = false;
    for c in text.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            dash = false;
        } else if !dash && !out.is_empty() {
            out.push('-');
            dash = true;
        }
    }
    out.trim_end_matches('-').to_string()
}

fn md_options() -> Options {
    Options::ENABLE_TABLES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_GFM
        | Options::ENABLE_SMART_PUNCTUATION
        | Options::ENABLE_FOOTNOTES
}

/// Render Markdown to HTML, adding stable ids to `##` headings and returning a table of contents.
pub fn render_markdown(src: &str) -> (String, Vec<TocEntry>) {
    let events: Vec<Event> = Parser::new_ext(src, md_options()).collect();
    let mut toc = Vec::new();
    let mut out: Vec<Event> = Vec::with_capacity(events.len());
    let mut i = 0;
    while i < events.len() {
        match &events[i] {
            Event::Start(Tag::Heading { level: HeadingLevel::H2, classes, attrs, .. }) => {
                let mut text = String::new();
                let mut j = i + 1;
                while j < events.len() {
                    match &events[j] {
                        Event::End(TagEnd::Heading(_)) => break,
                        Event::Text(t) | Event::Code(t) => text.push_str(t),
                        _ => {}
                    }
                    j += 1;
                }
                let id = slugify(&text);
                toc.push(TocEntry { id: id.clone(), text });
                out.push(Event::Start(Tag::Heading {
                    level: HeadingLevel::H2,
                    id: Some(CowStr::from(id)),
                    classes: classes.clone(),
                    attrs: attrs.clone(),
                }));
            }
            Event::Start(Tag::Link { link_type, dest_url, title, id }) if dest_url.starts_with("http") => {
                // External links open in a new tab, safely.
                let mut attrs = String::new();
                html::push_html(
                    &mut attrs,
                    std::iter::once(Event::Start(Tag::Link {
                        link_type: *link_type,
                        dest_url: dest_url.clone(),
                        title: title.clone(),
                        id: id.clone(),
                    })),
                );
                let tag = attrs.trim_end_matches('>').to_string() + " target=\"_blank\" rel=\"noopener noreferrer\">";
                out.push(Event::Html(CowStr::from(tag)));
                // Matching end tag renders as </a> via TagEnd::Link below.
                i += 1;
                continue;
            }
            Event::End(TagEnd::Link) => out.push(Event::Html(CowStr::from("</a>"))),
            other => out.push(other.clone()),
        }
        i += 1;
    }
    let mut html_out = String::with_capacity(src.len() * 2);
    html::push_html(&mut html_out, out.into_iter());
    (html_out, toc)
}

/// The first couple of paragraphs of a document: what a visitor sees before the paywall.
fn preview_source(body: &str) -> String {
    let mut out = String::new();
    let mut paragraphs = 0;
    for block in body.split("\n\n") {
        let trimmed = block.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.starts_with("##") && paragraphs > 0 {
            break;
        }
        out.push_str(trimmed);
        out.push_str("\n\n");
        if !trimmed.starts_with('#') {
            paragraphs += 1;
        }
        if paragraphs >= 2 {
            break;
        }
    }
    out
}

fn plain_text(md: &str) -> String {
    let mut s = String::new();
    for ev in Parser::new_ext(md, md_options()) {
        match ev {
            Event::Text(t) | Event::Code(t) => {
                s.push_str(&t);
                s.push(' ');
            }
            Event::SoftBreak | Event::HardBreak => s.push(' '),
            _ => {}
        }
    }
    s
}

fn read_toml<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T> {
    let raw = fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?;
    toml::from_str(&raw).with_context(|| format!("parsing {}", path.display()))
}

impl Content {
    pub fn load(dir: &Path) -> Result<Content> {
        let curriculum: CurriculumFile = read_toml(&dir.join("curriculum.toml"))?;
        let mut lessons = HashMap::new();
        let mut order = Vec::new();
        for module in &curriculum.modules {
            if module.lessons.is_empty() {
                bail!("module {} has no lessons", module.slug);
            }
            for (qi, q) in module.quiz.iter().enumerate() {
                if q.answer >= q.options.len() || q.options.len() < 2 {
                    bail!("module {} quiz question {} has an invalid answer index", module.slug, qi + 1);
                }
            }
            for slug in &module.lessons {
                let path = dir.join("lessons").join(format!("{slug}.md"));
                let raw = fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))?;
                let (front, body) = split_front_matter(&raw).with_context(|| format!("in {}", path.display()))?;
                let fm: LessonFront = toml::from_str(front).with_context(|| format!("front matter of {}", path.display()))?;
                let (html, toc) = render_markdown(body);
                let (preview_html, _) = render_markdown(&preview_source(body));
                let search_text = format!("{} {} {}", fm.title, fm.summary, plain_text(body)).to_lowercase();
                if lessons.contains_key(slug) {
                    bail!("duplicate lesson slug {slug}");
                }
                lessons.insert(
                    slug.clone(),
                    Lesson {
                        slug: slug.clone(),
                        module_slug: module.slug.clone(),
                        title: fm.title,
                        summary: fm.summary,
                        minutes: fm.minutes,
                        free: fm.free || module.free,
                        html,
                        preview_html,
                        toc,
                        order: order.len(),
                        search_text,
                    },
                );
                order.push(slug.clone());
            }
        }

        let prompts: PromptsFile = read_toml(&dir.join("prompts.toml"))?;
        let glossary: GlossaryFile = read_toml(&dir.join("glossary.toml"))?;
        let tools: ToolsFile = read_toml(&dir.join("tools.toml"))?;

        let mut playbooks = Vec::new();
        let pb_dir = dir.join("playbooks");
        let mut entries: Vec<_> = fs::read_dir(&pb_dir)
            .with_context(|| format!("reading {}", pb_dir.display()))?
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().is_some_and(|x| x == "md"))
            .collect();
        entries.sort();
        for path in entries {
            let slug = path.file_stem().and_then(|s| s.to_str()).unwrap_or_default().to_string();
            let raw = fs::read_to_string(&path)?;
            let (front, body) = split_front_matter(&raw).with_context(|| format!("in {}", path.display()))?;
            let fm: PlaybookFront = toml::from_str(front).with_context(|| format!("front matter of {}", path.display()))?;
            let (html, _) = render_markdown(body);
            let (preview_html, _) = render_markdown(&preview_source(body));
            let search_text = format!("{} {} {}", fm.title, fm.summary, plain_text(body)).to_lowercase();
            playbooks.push(Playbook {
                slug,
                title: fm.title,
                summary: fm.summary,
                difficulty: fm.difficulty,
                minutes: fm.minutes,
                saves: fm.saves,
                tools: fm.tools,
                free: fm.free,
                html,
                preview_html,
                search_text,
            });
        }

        // Free and beginner-friendly playbooks first: they're the best starting points.
        playbooks.sort_by(|a, b| {
            (!a.free, a.difficulty != "Beginner", a.title.as_str()).cmp(&(!b.free, b.difficulty != "Beginner", b.title.as_str()))
        });

        let mut seen = std::collections::HashSet::new();
        for p in &prompts.prompts {
            if !seen.insert(p.slug.clone()) {
                bail!("duplicate prompt slug {}", p.slug);
            }
        }

        Ok(Content {
            modules: curriculum.modules,
            lessons,
            order,
            prompts: prompts.prompts,
            glossary: glossary.terms,
            tools: tools.tools,
            playbooks,
        })
    }

    pub fn module(&self, slug: &str) -> Option<&ModuleDef> {
        self.modules.iter().find(|m| m.slug == slug)
    }

    pub fn lesson(&self, slug: &str) -> Option<&Lesson> {
        self.lessons.get(slug)
    }

    pub fn lesson_at(&self, idx: usize) -> Option<&Lesson> {
        self.order.get(idx).and_then(|s| self.lessons.get(s))
    }

    pub fn playbook(&self, slug: &str) -> Option<&Playbook> {
        self.playbooks.iter().find(|p| p.slug == slug)
    }

    pub fn total_minutes(&self) -> u32 {
        self.lessons.values().map(|l| l.minutes).sum()
    }

    pub fn search(&self, query: &str, limit: usize) -> Vec<SearchHit> {
        let q = query.trim().to_lowercase();
        let tokens: Vec<&str> = q.split_whitespace().filter(|t| t.len() > 1).collect();
        if tokens.is_empty() {
            return vec![];
        }
        let score = |title: &str, body: &str| -> u32 {
            let title = title.to_lowercase();
            let mut s = 0u32;
            for t in &tokens {
                let in_title = title.contains(t);
                let body_hits = body.matches(t).count().min(10) as u32;
                if !in_title && body_hits == 0 {
                    return 0; // every token must match somewhere
                }
                if in_title {
                    s += 10;
                }
                s += body_hits;
            }
            if title.contains(q.as_str()) {
                s += 15;
            }
            s
        };
        let snippet = |body: &str| -> String {
            let first = tokens[0];
            match body.find(first) {
                Some(pos) => {
                    let start = body[..pos].char_indices().rev().nth(60).map(|(i, _)| i).unwrap_or(0);
                    let tail: String = body[start..].chars().take(160).collect();
                    format!("{}{}…", if start > 0 { "…" } else { "" }, tail.trim())
                }
                None => body.chars().take(160).collect(),
            }
        };
        let mut hits = Vec::new();
        for l in self.order.iter().filter_map(|s| self.lessons.get(s)) {
            let sc = score(&l.title, &l.search_text);
            if sc > 0 {
                hits.push(SearchHit {
                    kind: "lesson",
                    slug: l.slug.clone(),
                    title: l.title.clone(),
                    snippet: l.summary.clone(),
                    score: sc + 2,
                });
            }
        }
        for p in &self.playbooks {
            let sc = score(&p.title, &p.search_text);
            if sc > 0 {
                hits.push(SearchHit {
                    kind: "playbook",
                    slug: p.slug.clone(),
                    title: p.title.clone(),
                    snippet: p.summary.clone(),
                    score: sc + 1,
                });
            }
        }
        for p in &self.prompts {
            let body = format!("{} {} {} {}", p.description, p.category, p.tags.join(" "), p.prompt).to_lowercase();
            let sc = score(&p.title, &body);
            if sc > 0 {
                hits.push(SearchHit {
                    kind: "prompt",
                    slug: p.slug.clone(),
                    title: p.title.clone(),
                    snippet: p.description.clone(),
                    score: sc,
                });
            }
        }
        for t in &self.glossary {
            let body = t.definition.to_lowercase();
            let sc = score(&t.term, &body);
            if sc > 0 {
                hits.push(SearchHit { kind: "term", slug: slugify(&t.term), title: t.term.clone(), snippet: snippet(&body), score: sc });
            }
        }
        for t in &self.tools {
            let body = format!("{} {} {}", t.what, t.best_for, t.category).to_lowercase();
            let sc = score(&t.name, &body);
            if sc > 0 {
                hits.push(SearchHit { kind: "tool", slug: slugify(&t.name), title: t.name.clone(), snippet: t.what.clone(), score: sc });
            }
        }
        hits.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| a.title.cmp(&b.title)));
        hits.truncate(limit);
        hits
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_works() {
        assert_eq!(slugify("Hello, World!"), "hello-world");
        assert_eq!(slugify("  The 3 rules  "), "the-3-rules");
        assert_eq!(slugify("AI & You"), "ai-you");
    }

    #[test]
    fn front_matter_split() {
        let (f, b) = split_front_matter("+++\ntitle = \"x\"\n+++\n\nBody").unwrap();
        assert_eq!(f.trim(), "title = \"x\"");
        assert_eq!(b, "Body");
        assert!(split_front_matter("no front").is_err());
    }

    #[test]
    fn headings_get_ids_and_toc() {
        let (html, toc) = render_markdown("Intro\n\n## First step\n\ntext\n\n## Second `step`\n");
        assert!(html.contains("<h2 id=\"first-step\">"), "{html}");
        assert_eq!(toc.len(), 2);
        assert_eq!(toc[1].id, "second-step");
    }

    #[test]
    fn external_links_open_safely() {
        let (html, _) = render_markdown("See [site](https://example.com) and [local](/learn/x).");
        assert!(html.contains("target=\"_blank\" rel=\"noopener noreferrer\""), "{html}");
        assert!(html.contains("<a href=\"/learn/x\">local</a>"), "{html}");
    }

    #[test]
    fn raw_html_in_markdown_is_escaped_in_text() {
        let (html, _) = render_markdown("Use `<script>` carefully");
        assert!(html.contains("&lt;script&gt;"));
    }

    #[test]
    fn preview_takes_first_paragraphs() {
        let p = preview_source("One.\n\nTwo.\n\nThree.\n\n## Heading\n\nFour.");
        assert!(p.contains("One.") && p.contains("Two."));
        assert!(!p.contains("Three."));
    }
}
