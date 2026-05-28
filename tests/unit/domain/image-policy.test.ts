import { describe, expect, it } from 'vitest';
import { canFetchImage, classifyImage } from '@domain/image-policy';

const PAGE = 'https://example.com/article';

describe('classifyImage (F4-FR4)', () => {
  it('treats a data URI as safe', () => {
    expect(classifyImage('data:image/png;base64,AAA', PAGE)).toBe('safe');
  });

  it('treats a blob URL as safe', () => {
    expect(classifyImage('blob:https://example.com/abc', PAGE)).toBe('safe');
  });

  it('treats a same-origin absolute URL as safe', () => {
    expect(classifyImage('https://example.com/img/a.png', PAGE)).toBe('safe');
  });

  it('treats a same-origin relative URL as safe', () => {
    expect(classifyImage('/img/a.png', PAGE)).toBe('safe');
  });

  it('treats a cross-origin URL as a fetch candidate', () => {
    expect(classifyImage('https://cdn.other.com/a.png', PAGE)).toBe('fetch');
  });

  it('omits an empty src', () => {
    expect(classifyImage('   ', PAGE)).toBe('omit');
  });

  it('omits an unparseable src', () => {
    expect(classifyImage('http://[bad', PAGE)).toBe('omit');
  });

  it('omits a non-http(s) protocol (e.g. javascript:)', () => {
    expect(classifyImage('javascript:alert(1)', PAGE)).toBe('omit');
  });
});

describe('canFetchImage (F4-FR4 host-permission gate)', () => {
  it('allows a fetch when the image origin is granted', () => {
    expect(canFetchImage('https://cdn.other.com/a.png', PAGE, ['https://cdn.other.com'])).toBe(
      true,
    );
  });

  it('denies a fetch when the image origin is not granted', () => {
    expect(canFetchImage('https://cdn.other.com/a.png', PAGE, ['https://example.com'])).toBe(false);
  });

  it('denies a fetch for an unparseable src', () => {
    expect(canFetchImage('http://[bad', PAGE, ['https://example.com'])).toBe(false);
  });
});
