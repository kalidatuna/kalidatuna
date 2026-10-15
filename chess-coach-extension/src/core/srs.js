/*
 * Spaced repetition for opening lines (a small SM-2 variant).
 * A record is { ease, interval (days), due (ms epoch), reps, lapses, last }.
 */
(function (root) {
  const CC = (root.ChessCoach = root.ChessCoach || {});
  const DAY = 24 * 60 * 60 * 1000;

  function fresh(now) {
    return { ease: 2.5, interval: 0, due: now, reps: 0, lapses: 0, last: null };
  }

  /** Map the number of mistakes in a drill to an SM-2 quality score (0-5). */
  function qualityFromMistakes(mistakes) {
    if (mistakes <= 0) return 5;
    if (mistakes === 1) return 4;
    if (mistakes === 2) return 3;
    return 1;
  }

  function grade(record, quality, now) {
    now = now || Date.now();
    const r = Object.assign(fresh(now), record || {});
    if (quality < 3) {
      r.reps = 0;
      r.lapses += 1;
      r.interval = 0; // see it again in this session / today
      r.due = now + 10 * 60 * 1000;
    } else {
      r.reps += 1;
      if (r.reps === 1) r.interval = 1;
      else if (r.reps === 2) r.interval = 3;
      else r.interval = Math.round(r.interval * r.ease);
      r.due = now + r.interval * DAY;
    }
    r.ease = Math.max(1.3, r.ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
    r.last = now;
    return r;
  }

  function isDue(record, now) {
    return !record || record.due <= (now || Date.now());
  }

  CC.SRS = { fresh, grade, isDue, qualityFromMistakes, DAY };
})(globalThis);
