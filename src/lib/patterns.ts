/** User pattern language → match clauses (full path).
 *
 * `a+b+c` = AND of flexible substrings (any order, anywhere in path).
 * `!xyz` = must NOT contain substring `xyz` (local negation).
 * Optional outer parentheses group a plain pattern: `(abc+ght+!xyz)`.
 * Implemented as separate substring regexes — NOT lookaround — so Rust's
 * regex crate and JS RegExp both work.
 */

export type PatternCompileResult =
  | { ok: true; clause: PatternClause }
  | { ok: false; error: string };

/** One user pattern. All `terms` must match (AND); none of `notTerms` may match. */
export type PatternClause = {
  /** Rust/JS regex sources for each required term (may include `(?i)`). */
  terms: string[];
  /** Rust/JS regex sources that must NOT match. */
  notTerms: string[];
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

/** Strip one layer of wrapping parentheses when the whole pattern is grouped. */
function stripOuterParens(raw: string): string {
  let s = raw.trim();
  while (s.length >= 2 && s.startsWith("(") && s.endsWith(")")) {
    let depth = 0;
    let wrapsAll = true;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === "\\" && i + 1 < s.length) {
        i += 1;
        continue;
      }
      if (ch === "(") depth += 1;
      else if (ch === ")") {
        depth -= 1;
        if (depth === 0 && i !== s.length - 1) {
          wrapsAll = false;
          break;
        }
      }
    }
    if (!wrapsAll || depth !== 0) break;
    s = s.slice(1, -1).trim();
  }
  return s;
}

type ParsedPart = { negate: boolean; text: string };

function parsePlainParts(pattern: string): ParsedPart[] | { error: string } {
  const parts = pattern
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return { error: "Invalid pattern" };
  }
  const parsed: ParsedPart[] = [];
  for (const part of parts) {
    if (part.startsWith("!")) {
      const text = part.slice(1).trim();
      if (!text) {
        return { error: "Empty negation (!)" };
      }
      parsed.push({ negate: true, text });
    } else {
      parsed.push({ negate: false, text: part });
    }
  }
  return parsed;
}

function compilePlainParts(parts: ParsedPart[]): PatternCompileResult {
  try {
    const terms: string[] = [];
    const notTerms: string[] = [];
    for (const part of parts) {
      const source = substringTerm(part.text);
      assertValidJsRegex(source);
      if (part.negate) notTerms.push(source);
      else terms.push(source);
    }
    if (terms.length === 0 && notTerms.length === 0) {
      return { ok: false, error: "Invalid pattern" };
    }
    return { ok: true, clause: { terms, notTerms } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Invalid pattern" };
  }
}

/**
 * Plain language patterns:
 * - `foo` → flexible substring on full path (case-insensitive)
 * - `a+b+c` → path must contain all substrings, any order / anywhere
 * - `!xyz` / `a+b+!xyz` → must not contain `xyz`
 * - `(a+b+!c)` → same, optional outer parentheses
 * - strings that look like explicit regex are compiled as-is
 */
export function compileUserPattern(raw: string): PatternCompileResult {
  const pattern = stripOuterParens(raw);
  if (!pattern) {
    return { ok: false, error: "Empty pattern" };
  }

  const usesAndOrNegation = pattern.includes("+") || pattern.startsWith("!");

  // AND / negation of flexible substrings
  if (usesAndOrNegation && !looksLikeExplicitRegex(pattern)) {
    const parts = parsePlainParts(pattern);
    if ("error" in parts) {
      return { ok: false, error: parts.error };
    }
    return compilePlainParts(parts);
  }

  // Flexible substring (default), including a lone `!term` already handled above
  if (!looksLikeExplicitRegex(pattern)) {
    try {
      const source = substringTerm(pattern);
      assertValidJsRegex(source);
      return { ok: true, clause: { terms: [source], notTerms: [] } };
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
    return { ok: true, clause: { terms: [source], notTerms: [] } };
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
    // Parentheses are used for optional grouping of plain patterns (stripped earlier).
    if (".*?^${}|[]".includes(ch)) return true;
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

/** True if every positive term matches and no negative term matches. */
export function pathMatchesClause(path: string, clause: PatternClause): boolean {
  try {
    const positives = clause.terms ?? [];
    const negatives = clause.notTerms ?? [];
    return (
      positives.every((term) => jsRegexFromSource(term).test(path)) &&
      negatives.every((term) => !jsRegexFromSource(term).test(path))
    );
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
