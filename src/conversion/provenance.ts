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
 * e.g. `2026-06-13 11:30 a.m. PST (GMT-8)`. Deterministic for a given
 * `(epochMs, timeZone)`. Distinct from the EPUB `dc:date` (ISO-8601/UTC — see
 * `isoDate`).
 */
export function formatCapturedAt(epochMs: number, timeZone?: string): string {
  const date = new Date(epochMs);
  try {
    return formatInZone(date, timeZone);
  } catch {
    // An IANA zone the runtime rejects must never fail the whole send: fall
    // back to the host zone (which cannot throw) rather than dropping the time.
    return formatInZone(date, undefined);
  }
}

/**
 * `YYYY-MM-DD hh:mm a.m./p.m. ZONE (GMT±h)` for one zone. The short zone name is
 * an abbreviation where the locale has one (`PST`), and already an offset
 * (`GMT+2`) elsewhere — in that case the offset suffix is redundant and skipped,
 * so Berlin reads `GMT+2`, not `GMT+2 (GMT+2)`. Throws on an invalid zone.
 */
function formatInZone(date: Date, timeZone: string | undefined): string {
  const zone = timeZone ? { timeZone } : {};
  const parts = new Intl.DateTimeFormat('en-CA', {
    ...zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).formatToParts(date);
  const shortName = parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
  // en-CA renders `YYYY-MM-DD, hh:mm a.m. TZ`; normalize the comma to a space.
  const readable = parts
    .map((part) => part.value)
    .join('')
    .replace(', ', ' ');
  if (/^(GMT|UTC)/i.test(shortName)) {
    return readable;
  }
  const offset = new Intl.DateTimeFormat('en-US', { ...zone, timeZoneName: 'shortOffset' })
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName')?.value;
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

/**
 * jsPDF document properties for a stamped PDF (CP5/CP6). jsPDF has no native
 * "source URL" field, so the URL rides in `subject` and the capture time in
 * `keywords`. One home for both PDF paths (Reader HTML + Full Page stitch).
 */
export function provenancePdfProperties(p: Provenance): { subject: string; keywords: string } {
  return {
    subject: p.sourceUrl,
    keywords: `Captured ${formatCapturedAt(p.capturedAtMs, p.timeZone)}`,
  };
}

function truncate(value: string, max: number): string {
  // Slice by CODE POINTS, not UTF-16 units, so an astral char (emoji / decoded
  // IDN) at the cut boundary is never split into a lone surrogate — a lone
  // surrogate is malformed XML and would halt a strict EPUB reader.
  const chars = Array.from(value);
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : value;
}
