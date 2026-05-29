import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ORIGIN_STRIP_FILTER } from '../../../src/background/origin-stripper.firefox';

// FF3-FR4 gap: the existing manifest.test.ts only pins the DNR rule file's
// PATH + permission, not its CONTENTS. This guard asserts the rule in
// `public/dnr-rules.json` actually strips `origin` on viewer/cloud.supernote.com
// for `xmlhttprequest`, never touches the S3 PUT (I-F3), and has IDENTICAL scope
// to the Firefox webRequest fallback (`ORIGIN_STRIP_FILTER` + `stripOrigin`).

const DNR_PATH = fileURLToPath(new URL('../../../public/dnr-rules.json', import.meta.url));
const DNR_RAW = readFileSync(DNR_PATH, 'utf8');

interface RequestHeader {
  header: string;
  operation: string;
}
interface DnrRule {
  action: { type: string; requestHeaders?: RequestHeader[] };
  condition: { requestDomains?: string[]; resourceTypes?: string[] };
}

const rules = JSON.parse(DNR_RAW) as DnrRule[];

describe('dnr-rules.json content parity (FF3-FR4 / I-F3)', () => {
  it('declares exactly one rule', () => {
    expect(rules).toHaveLength(1);
  });

  it('uses a modifyHeaders action that removes the `origin` request header (case-insensitive)', () => {
    const rule = rules[0]!;
    expect(rule.action.type).toBe('modifyHeaders');
    const removals = (rule.action.requestHeaders ?? []).map((h) => ({
      header: h.header.toLowerCase(),
      operation: h.operation,
    }));
    expect(removals).toContainEqual({ header: 'origin', operation: 'remove' });
  });

  it('conditions on exactly the viewer/cloud Supernote domains (order-insensitive)', () => {
    const domains = [...(rules[0]!.condition.requestDomains ?? [])].sort();
    expect(domains).toEqual(['cloud.supernote.com', 'viewer.supernote.com']);
  });

  it('conditions on `xmlhttprequest` resource types only', () => {
    expect(rules[0]!.condition.resourceTypes).toEqual(['xmlhttprequest']);
  });

  it('never references an amazonaws host — the S3 pre-signed PUT is untouched (I-F3)', () => {
    expect(DNR_RAW).not.toContain('amazonaws');
  });

  it('matches the Firefox webRequest fallback scope exactly (DNR ⇔ ORIGIN_STRIP_FILTER)', () => {
    // The DNR rule's bare domains, expressed as the filter's url patterns.
    const dnrDomainsAsUrls = [...(rules[0]!.condition.requestDomains ?? [])]
      .map((d) => `https://${d}/*`)
      .sort();
    const filterUrls = [...(ORIGIN_STRIP_FILTER.urls ?? [])].sort();
    expect(filterUrls).toEqual(dnrDomainsAsUrls);

    // Resource/type scope is identical too.
    expect(ORIGIN_STRIP_FILTER.types).toEqual(rules[0]!.condition.resourceTypes);
  });
});
