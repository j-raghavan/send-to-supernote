/**
 * ChromeCookieReader — CookieReader port over `chrome.cookies`. THIN glue: reads
 * a single cookie value for a URL (e.g. the `x-access-token` the official
 * cloud.supernote.com login sets). Coverage-excluded (architecture §9.3).
 */
/* c8 ignore start */
import type { CookieReader } from '@shared/ports';

export class ChromeCookieReader implements CookieReader {
  async get(url: string, name: string): Promise<string | undefined> {
    const cookie = await chrome.cookies.get({ url, name });
    return cookie?.value && cookie.value.length > 0 ? cookie.value : undefined;
  }
}
/* c8 ignore stop */
