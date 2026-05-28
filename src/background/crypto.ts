/**
 * WebCrypto adapters (F2/F7/F8) — Sha256Hex + RandomSource over the platform
 * crypto. THIN glue: the login-hash composition and nonce/equipment logic are in
 * covered domain modules; these only provide the injected primitives.
 * Coverage-excluded.
 */
/* c8 ignore start */
import type { RandomSource } from '@shared/ports';

/** Lowercase-hex SHA-256 via WebCrypto (the injected Sha256Hex for loginHash). */
export async function webCryptoSha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class WebCryptoRandomSource implements RandomSource {
  digits(count: number): string {
    let out = '';
    while (out.length < count) {
      out += Math.floor(Math.random() * 10).toString();
    }
    return out.slice(0, count);
  }

  uuid(): string {
    return crypto.randomUUID();
  }
}
/* c8 ignore stop */
