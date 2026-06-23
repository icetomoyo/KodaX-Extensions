import { describe, expect, it } from 'vitest';

import { validateInput } from '../src/validate';

describe('validateInput', () => {
  it('accepts a minimal valid input with only path', () => {
    const result = validateInput({ path: 'C:/docs/a.pdf' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.path).toBe('C:/docs/a.pdf');
    }
  });

  it('trims the path and normalizes optional fields', () => {
    const result = validateInput({
      path: '  C:/docs/a.pdf  ',
      pages: ' 1-3,7 ',
      engine: 'auto',
      force_ocr: true,
      max_pages: 5,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        path: 'C:/docs/a.pdf',
        pages: '1-3,7',
        engine: 'auto',
        force_ocr: true,
        max_pages: 5,
      });
    }
  });

  it('rejects missing path', () => {
    const result = validateInput({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/missing required "path"/);
    }
  });

  it('rejects empty/whitespace path', () => {
    expect(validateInput({ path: '   ' }).ok).toBe(false);
  });

  it('rejects malformed pages', () => {
    for (const pages of ['abc', '1-', '1,,2', '1-2-3', '-1', '1..3']) {
      const result = validateInput({ path: 'a.pdf', pages });
      expect(result.ok, `pages=${pages}`).toBe(false);
    }
  });

  it('rejects a reversed page range', () => {
    const result = validateInput({ path: 'a.pdf', pages: '5-2' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/start greater than end/);
    }
  });

  it('rejects an unknown engine', () => {
    const result = validateInput({ path: 'a.pdf', engine: 'magic' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/invalid "engine"/);
    }
  });

  it('rejects non-positive or non-integer max_pages', () => {
    expect(validateInput({ path: 'a.pdf', max_pages: 0 }).ok).toBe(false);
    expect(validateInput({ path: 'a.pdf', max_pages: -3 }).ok).toBe(false);
    expect(validateInput({ path: 'a.pdf', max_pages: 1.5 }).ok).toBe(false);
  });

  it('rejects non-boolean force_ocr', () => {
    expect(validateInput({ path: 'a.pdf', force_ocr: 'yes' as unknown as boolean }).ok).toBe(false);
  });
});
