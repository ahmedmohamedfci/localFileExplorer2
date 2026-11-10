/** User pattern language → match clauses (full path).
 *
 * `a+b+c` = AND of flexible substrings (any order, anywhere in path).
 * `!xyz` or `+-xyz` = must NOT contain substring `xyz` (local negation).
 * `(Y|Z|A)` = OR group — path must contain at least one alternative.
 * Combined: `x+(Y|Z|A)-S` → x AND (Y or Z or A), excluding paths with S.
 * Optional outer parentheses: `(abc+ght+!xyz)`.
 * Hyphens inside a bare term (`foo-bar`) stay literal; `-S` negation only
 * after a `)` group, as a leading segment op, or via `!S`.
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

/** `(Y|Z|A)` → one regex that matches if any alternative appears as a substring. */
function compileOrGroup(raw: string): string | null {
  const s = raw.trim();
  if (!(s.startsWith("(") && s.endsWith(")"))) return null;
  const inner = s.slice(1, -1);
  if (!inner.includes("|") || /[()]/.test(inner)) return null;
  const alts = inner
    .split("|")
    .map((a) => a.trim())
    .filter(Boolean);
  if (alts.length < 2) return null;
  return `(?i)(?:${alts.map(escapeRegex).join("|")})`;
}

function compileTermSource(raw: string): string {
  return compileOrGroup(raw) ?? substringTerm(raw);
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
    // Don't strip `(a|b|c)` OR groups — those are a single term.
    if (s.slice(1, -1).includes("|") && !/[()]/.test(s.slice(1, -1))) break;
    s = s.slice(1, -1).trim();
  }
  return s;
}

type ParsedPart = { negate: boolean; text: string };

/** Split by `+` at parenthesis depth 0. */
function splitByPlus(pattern: string): string[] | { error: string } {
  const segments: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "\\" && i + 1 < pattern.length) {
      i += 1;
      continue;
    }
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (ch === "+" && depth === 0) {
      segments.push(pattern.slice(start, i));
      start = i + 1;
    }
  }
  segments.push(pattern.slice(start));
  if (depth !== 0) return { error: "Unbalanced parentheses" };
  return segments;
}

/**
 * After a leading `(...)` group, allow `)-S` / `)!S` as local negation.
 * Bare hyphens inside terms (`foo-bar`) are left alone.
 */
function splitTrailingGroupNegation(
  segment: string,
): { positive: string; negative: string } | null {
  if (!segment.startsWith("(")) return null;
  let depth = 0;
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i]!;
    if (ch === "\\" && i + 1 < segment.length) {
      i += 1;
      continue;
    }
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        const rest = segment.slice(i + 1);
        if (!/^[-!]/.test(rest)) return null;
        const negative = rest.slice(1).trim();
        if (!negative) return null;
        return { positive: segment.slice(0, i + 1), negative };
      }
    }
  }
  return null;
}

/**
 * Tokenize `x+(Y|Z|A)-S` / `a+b+!c` into AND parts.
 * `+` separates AND terms; `!term` / `-term` as a whole segment negates;
 * `(Y|Z|A)-S` attaches a local exclude after an OR group.
 */
function parseAndExpr(pattern: string): ParsedPart[] | { error: string } {
  const segments = splitByPlus(pattern);
  if ("error" in segments) return segments;

  const parts: ParsedPart[] = [];
  for (const rawSeg of segments) {
    let s = rawSeg.trim();
    if (!s) return { error: "Empty term" };

    let negate = false;
    if (s.startsWith("!") || s.startsWith("-")) {
      negate = true;
      s = s.slice(1).trim();
      if (!s) return { error: "Empty negation" };
    }

    if (!negate) {
      const trail = splitTrailingGroupNegation(s);
      if (trail) {
        parts.push({ negate: false, text: trail.positive });
        parts.push({ negate: true, text: trail.negative });
        continue;
      }
    }

    parts.push({ negate, text: s });
  }

  if (parts.length === 0) return { error: "Invalid pattern" };
  return parts;
}

function compilePlainParts(parts: ParsedPart[]): PatternCompileResult {
  try {
    const terms: string[] = [];
    const notTerms: string[] = [];
    for (const part of parts) {
      const source = compileTermSource(part.text);
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

function isOrGroupOnly(pattern: string): boolean {
  return /^\([^()|]+(?:\|[^()|]+)+\)$/.test(pattern);
}

function looksLikePlainAndExpr(pattern: string): boolean {
  if (pattern.includes("+") || pattern.startsWith("!") || pattern.startsWith("-")) {
    return true;
  }
  if (isOrGroupOnly(pattern)) return true;
  // `(Y|Z|A)-S` style: group then local exclude
  if (pattern.startsWith("(") && splitTrailingGroupNegation(pattern)) return true;
  // Mid-pattern `!` at depth 0 (rare without +)
  let depth = 0;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "\\" && i + 1 < pattern.length) {
      i += 1;
      continue;
    }
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (depth === 0 && ch === "!" && i > 0) return true;
  }
  return false;
}

/**
 * Plain language patterns:
 * - `foo` → flexible substring on full path (case-insensitive)
 * - `a+b+c` → path must contain all substrings, any order / anywhere
 * - `!xyz` / `a+b+!xyz` / `a+b+-xyz` → must not contain `xyz`
 * - `(Y|Z|A)` → must contain at least one of Y, Z, A
 * - `x+(Y|Z|A)-S` → x AND (Y|Z|A), excluding S
 * - `(a+b+!c)` → same, optional outer parentheses
 * - strings that look like explicit regex are compiled as-is
 */
export function compileUserPattern(raw: string): PatternCompileResult {
  const pattern = stripOuterParens(raw);
  if (!pattern) {
    return { ok: false, error: "Empty pattern" };
  }

  if (looksLikePlainAndExpr(pattern) && !looksLikeExplicitRegex(pattern)) {
    const parts = parseAndExpr(pattern);
    if ("error" in parts) {
      return { ok: false, error: parts.error };
    }
    return compilePlainParts(parts);
  }

  // Flexible substring (default)
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
  if (isOrGroupOnly(pattern)) return false;
  if (looksLikePlainAndExpr(pattern)) {
    // If the only "regex-y" chars are | inside OR groups and +/!/-, stay plain.
    let depth = 0;
    for (let i = 0; i < pattern.length; i++) {
      const ch = pattern[i]!;
      if (ch === "\\" && i + 1 < pattern.length) {
        i += 1;
        continue;
      }
      if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
      else if (".*?^${}[]".includes(ch)) return true;
      else if (ch === "|" && depth === 0) return true;
    }
    return false;
  }
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "\\" && i + 1 < pattern.length) {
      i += 1;
      continue;
    }
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
