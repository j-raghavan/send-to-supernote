/**
 * Pure MD5 (RFC 1321) → lowercase hex. Bundled because WebCrypto has no MD5,
 * and the Supernote login hash and the upload `md5` field both require it
 * (Interfaces, F2-FR3, F5/F8). No I/O, fully unit-testable against known
 * vectors. Operates on a UTF-8 string or raw bytes.
 */

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14,
  20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6,
  10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

// K[i] = floor(2^32 * abs(sin(i + 1)))
const K = (() => {
  const table = new Uint32Array(64);
  for (let i = 0; i < 64; i += 1) {
    table[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000);
  }
  return table;
})();

function toUtf8Bytes(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

function leftRotate(value: number, amount: number): number {
  return (value << amount) | (value >>> (32 - amount));
}

function md5Bytes(message: Uint8Array): Uint8Array {
  const originalLengthBits = message.length * 8;

  // Pad: append 0x80, then zeros, until length ≡ 56 (mod 64), then 64-bit length.
  const paddedLength = ((message.length + 8) >>> 6) * 64 + 64;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(message);
  bytes[message.length] = 0x80;

  // Append original length in bits as little-endian 64-bit (low 32 bits suffice
  // for our payloads; high 32 bits set for completeness).
  const lengthOffset = paddedLength - 8;
  bytes[lengthOffset] = originalLengthBits & 0xff;
  bytes[lengthOffset + 1] = (originalLengthBits >>> 8) & 0xff;
  bytes[lengthOffset + 2] = (originalLengthBits >>> 16) & 0xff;
  bytes[lengthOffset + 3] = (originalLengthBits >>> 24) & 0xff;

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const M = new Uint32Array(16);
  for (let chunk = 0; chunk < paddedLength; chunk += 64) {
    for (let i = 0; i < 16; i += 1) {
      const j = chunk + i * 4;
      M[i] = bytes[j]! | (bytes[j + 1]! << 8) | (bytes[j + 2]! << 16) | (bytes[j + 3]! << 24);
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i += 1) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      f = (f + a + K[i]! + M[g]!) | 0;
      a = d;
      d = c;
      c = b;
      b = (b + leftRotate(f >>> 0, S[i]!)) | 0;
    }

    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }

  const out = new Uint8Array(16);
  const words = [a0, b0, c0, d0];
  for (let i = 0; i < 4; i += 1) {
    const w = words[i]!;
    out[i * 4] = w & 0xff;
    out[i * 4 + 1] = (w >>> 8) & 0xff;
    out[i * 4 + 2] = (w >>> 16) & 0xff;
    out[i * 4 + 3] = (w >>> 24) & 0xff;
  }
  return out;
}

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/** Lowercase hex MD5 of a UTF-8 string. */
export function md5hex(input: string): string {
  return toHex(md5Bytes(toUtf8Bytes(input)));
}

/** Lowercase hex MD5 of raw bytes (used for the upload `md5` field). */
export function md5hexBytes(bytes: Uint8Array): string {
  return toHex(md5Bytes(bytes));
}
