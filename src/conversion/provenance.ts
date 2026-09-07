/**
 * Capture provenance (CP4) — pure value + header/time builders.
 *
 * "Provenance" is where + when a send was captured: the original page URL and a
 * capture timestamp (epoch ms). This module is the SINGLE home for the visible
 * header markup and the human-readable time formatting, consumed by every output
 * path — Reader PDF (prepended HTML), Reader EPUB (injected after the <h1>), and
 * Full Page (drawn on page 1) — so the wording/escaping is identical (DRY).
 *
 * Pure by design: no `Date.now()` / argless `new Date()` (those would break
 * deterministic tests). The epoch ms is stamped once in the saga via the Clock
 * port and the IANA `timeZone` is resolved there too, both carried on the value,
 * so `formatCapturedAt(epochMs, timeZone)` is deterministic. Output is strict
 * XHTML-safe (escaped, void elements self-closed) because the EPUB branch injects
 * the header into XHTML that is NOT re-normalized at the injection point.
 */
import type { Provenance } from '@domain/conversion';
import { escapeXml } from './escape-xml';

export type { Provenance } from '@domain/conversion';

/** Max characters of the URL shown in the VISIBLE header (full URL is kept in metadata). */
const MAX_VISIBLE_URL = 100;

/**
 * Format a capture time as local time with the zone abbreviation and UTC offset,
 * e.g. `2026-06-13 11:30 AM PST (GMT-8)`. Deterministic for a given
 * `(epochMs, timeZone)`. Distinct from the EPUB `dc:date` (ISO-8601/UTC — see
 * `isoDate`).
 */
export function formatCapturedAt(epochMs: number, timeZone?: string): string {
  const date = new Date(epochMs);
  const base = new Intl.DateTimeFormat('en-CA', {
    ...(timeZone ? { timeZone } : {}),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).format(date);
  // en-CA renders `YYYY-MM-DD, hh:mm AM TZ`; normalize the comma to a space so
  // the header reads `YYYY-MM-DD hh:mm AM TZ`.
  const readable = base.replace(', ', ' ');
  const offset = utcOffsetLabel(epochMs, timeZone);
  return offset ? `${readable} (${offset})` : readable;
}

/** ISO-8601 UTC instant (W3C-DTF) for the EPUB `<dc:date>` — always UTC, no zone needed. */
export function isoDate(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

/**
 * Build the visible provenance block as strict XHTML-safe markup: the source URL
 * (as a link when present, truncated for display but with the full href) and the
 * formatted capture time. A blank URL yields a time-only block with no empty
 * anchor (CP4-FR5).
 */
export function buildProvenanceHeaderHtml(p: Provenance): string {
  const when = escapeXml(formatCapturedAt(p.capturedAtMs, p.timeZone));
  const url = p.sourceUrl.trim();
  const source =
    url.length > 0
      ? `<span>Source: <a href="${escapeXml(url)}">${escapeXml(truncate(url, MAX_VISIBLE_URL))}</a></span>`
      : '';
  const time = `<span>Captured: ${when}</span>`;
  // A self-contained block; `<hr/>` is self-closed for XHTML validity. The
  // separator MUST be a numeric character reference (`&#183;` = middle dot), NOT
  // a named HTML entity like `&middot;` — EPUB content is strict XML with no
  // DOCTYPE, so a named entity is undefined and a conformant reader (MuPDF 1.17
  // on the Supernote) HALTS on it. `&#NNN;` is valid in any XML.
  return `<aside class="capture-provenance" style="font-size:0.8em;color:#555;margin:0 0 1em;">${source}${source ? ' &#183; ' : ''}${time}<hr/></aside>`;
}

/** Plain-text provenance lines for the Full Page banner (drawn via jsPDF.text). */
export function provenanceTextLines(p: Provenance): string[] {
  const lines: string[] = [];
  const url = p.sourceUrl.trim();
  if (url.length > 0) {
    lines.push(`Source: ${truncate(url, MAX_VISIBLE_URL)}`);
  }
  lines.push(`Captured: ${formatCapturedAt(p.capturedAtMs, p.timeZone)}`);
  return lines;
}

function truncate(value: string, max: number): string {
  // Slice by CODE POINTS, not UTF-16 units, so an astral char (emoji / decoded
  // IDN) at the cut boundary is never split into a lone surrogate — a lone
  // surrogate is malformed XML and would halt a strict EPUB reader.
  const chars = Array.from(value);
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : value;
}

/** `GMT-8` / `GMT+5:30` style offset for the given instant + zone (empty if unresolvable). */
function utcOffsetLabel(epochMs: number, timeZone?: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      ...(timeZone ? { timeZone } : {}),
      timeZoneName: 'shortOffset',
    }).formatToParts(new Date(epochMs));
    return parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
  } catch {
    /* c8 ignore next 2 — defensive: an invalid IANA zone throws; header drops the offset. */
    return '';
  }
}
