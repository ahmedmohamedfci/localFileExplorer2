/** User pattern language → match clauses (full path).
 *
 * `a+b+c` = AND of flexible substrings (any order, anywhere in path).
 * Implemented as separate substring regexes — NOT lookaround — so Rust's
 * regex crate and JS RegExp both work.
 */

export type PatternCompileResult =
  | { ok: true; clause: PatternClause }
  | { ok: false; error: string };

/** One user pattern. All `terms` must match (AND). */
export type PatternClause = {
  /** Rust/JS regex sources for each required term (may include `(?i)`). */
  terms: string[];
};

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** JS RegExp does not accept Rust-style `(?i)` — convert for local matching. */
export function jsRegexFromSource(source: string): RegExp {
  let body = source;
  let flags = "";
  if (body.startsWith("(?i)")) {
    body = body.slice(4);
    flags = "i";
  } else if (body.startsWith("(?-i)")) {
    body = body.slice(5);
  }
  return new RegExp(body, flags || undefined);
}

function assertValidJsRegex(source: string): void {
  jsRegexFromSource(source);
}

function substringTerm(raw: string): string {
  return `(?i)${escapeRegex(raw)}`;
}

/**
 * Plain language patterns:
 * - `foo` → flexible substring on full path (case-insensitive)
 * - `a+b+c` → path must contain all substrings, any order / anywhere
 * - strings that look like explicit regex are compiled as-is
 */
export function compileUserPattern(raw: string): PatternCompileResult {
  const pattern = raw.trim();
  if (!pattern) {
    return { ok: false, error: "Empty pattern" };
  }

  // AND of flexible substrings via +
  if (pattern.includes("+") && !looksLikeExplicitRegex(pattern)) {
    const parts = pattern
      .split("+")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0) {
      return { ok: false, error: "Invalid pattern" };
    }
    try {
      const terms = parts.map(substringTerm);
      for (const t of terms) assertValidJsRegex(t);
      return { ok: true, clause: { terms } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Invalid pattern" };
    }
  }

  // Flexible substring (default)
  if (!looksLikeExplicitRegex(pattern)) {
    try {
      const source = substringTerm(pattern);
      assertValidJsRegex(source);
      return { ok: true, clause: { terms: [source] } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Invalid regex" };
    }
  }

  try {
    const source =
      pattern.startsWith("(?i)") || pattern.startsWith("(?-i)")
        ? pattern
        : `(?i)${pattern}`;
    assertValidJsRegex(source);
    return { ok: true, clause: { terms: [source] } };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Invalid regex",
    };
  }
}

function looksLikeExplicitRegex(pattern: string): boolean {
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\" && i + 1 < pattern.length) {
      i += 1;
      continue;
    }
    if (".*?^${}()|[]".includes(ch)) return true;
  }
  return pattern.includes("(?");
}

export function validatePattern(raw: string): string | null {
  const r = compileUserPattern(raw);
  return r.ok ? null : r.error;
}

export function compilePatternList(patterns: string[]):
  | { ok: true; clauses: PatternClause[] }
  | { ok: false; error: string } {
  const clauses: PatternClause[] = [];
  for (const p of patterns) {
    const r = compileUserPattern(p);
    if (!r.ok) return { ok: false, error: `Invalid pattern: ${r.error}` };
    clauses.push(r.clause);
  }
  return { ok: true, clauses };
}

/** True if every term in the clause matches the path. */
export function pathMatchesClause(path: string, clause: PatternClause): boolean {
  try {
    return clause.terms.every((term) => jsRegexFromSource(term).test(path));
  } catch {
    return false;
  }
}

/** Live test filter against full path (JS side). */
export function pathMatchesUserPattern(path: string, raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return true;
  const compiled = compileUserPattern(trimmed);
  if (!compiled.ok) return false;
  return pathMatchesClause(path, compiled.clause);
}
