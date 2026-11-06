//! Completion certificate rendered as a crisp, printable SVG.

pub fn escape(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            '<' => "&lt;".to_string(),
            '>' => "&gt;".to_string(),
            '&' => "&amp;".to_string(),
            '"' => "&quot;".to_string(),
            '\'' => "&#39;".to_string(),
            c => c.to_string(),
        })
        .collect()
}

pub fn render(name: &str, date: &str, lessons: usize, minutes: u32, code: &str, verify_url: &str) -> String {
    let name = escape(name);
    let code = escape(code);
    let verify_url = escape(verify_url);
    let hours = (minutes as f32 / 60.0).round() as u32;
    format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1130" viewBox="0 0 1600 1130" font-family="Georgia, 'Times New Roman', serif">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0d0b1f"/><stop offset="1" stop-color="#1b1442"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ffd27a"/><stop offset=".5" stop-color="#ffb347"/><stop offset="1" stop-color="#ff7ad9"/>
    </linearGradient>
    <radialGradient id="glow" cx=".5" cy=".3" r=".7">
      <stop offset="0" stop-color="#7c5cff" stop-opacity=".35"/><stop offset="1" stop-color="#7c5cff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1600" height="1130" fill="url(#bg)"/>
  <rect width="1600" height="1130" fill="url(#glow)"/>
  <rect x="40" y="40" width="1520" height="1050" rx="28" fill="none" stroke="url(#gold)" stroke-width="3"/>
  <rect x="62" y="62" width="1476" height="1006" rx="20" fill="none" stroke="#ffffff" stroke-opacity=".12"/>
  <g transform="translate(800 190)">
    <polygon points="0,-58 50,-29 50,29 0,58 -50,29 -50,-29" fill="none" stroke="url(#gold)" stroke-width="4"/>
    <polygon points="0,-30 26,-15 26,15 0,30 -26,15 -26,-15" fill="url(#gold)" opacity=".9"/>
  </g>
  <text x="800" y="320" text-anchor="middle" fill="#cfc8ff" font-size="26" letter-spacing="10" font-family="Helvetica, Arial, sans-serif">LUMORA ACADEMY</text>
  <text x="800" y="410" text-anchor="middle" fill="#ffffff" font-size="64">Certificate of Completion</text>
  <text x="800" y="490" text-anchor="middle" fill="#a9a3d6" font-size="28" font-style="italic">This certifies that</text>
  <text x="800" y="600" text-anchor="middle" fill="url(#gold)" font-size="92">{name}</text>
  <line x1="420" y1="640" x2="1180" y2="640" stroke="#ffffff" stroke-opacity=".25"/>
  <text x="800" y="710" text-anchor="middle" fill="#e6e2ff" font-size="30">has completed the full Lumora curriculum: Practical AI for Everyday Life</text>
  <text x="800" y="760" text-anchor="middle" fill="#a9a3d6" font-size="24" font-family="Helvetica, Arial, sans-serif">{lessons} lessons · about {hours} hours of guided practice · prompting, automation, skills, safety</text>
  <g font-family="Helvetica, Arial, sans-serif" fill="#cfc8ff" font-size="22">
    <text x="300" y="930" text-anchor="middle">{date}</text>
    <line x1="170" y1="890" x2="430" y2="890" stroke="#ffffff" stroke-opacity=".3"/>
    <text x="300" y="965" text-anchor="middle" fill="#8f89bd" font-size="18">DATE</text>
    <text x="1300" y="930" text-anchor="middle">{code}</text>
    <line x1="1170" y1="890" x2="1430" y2="890" stroke="#ffffff" stroke-opacity=".3"/>
    <text x="1300" y="965" text-anchor="middle" fill="#8f89bd" font-size="18">CREDENTIAL ID</text>
    <text x="800" y="1040" text-anchor="middle" fill="#8f89bd" font-size="18">Verify at {verify_url}</text>
  </g>
</svg>"##
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_names() {
        let svg = render("<Ann & \"Bo\">", "Jan 1, 2026", 40, 600, "ABC", "https://x/verify/ABC");
        assert!(svg.contains("&lt;Ann &amp; &quot;Bo&quot;&gt;"));
        assert!(!svg.contains("<Ann"));
        assert!(svg.contains("about 10 hours"));
    }
}
