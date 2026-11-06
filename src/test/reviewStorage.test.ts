import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { readApproved, readViewed, writeApproved, writeViewed } from '../utils/reviewStorage';

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('reviewStorage', () => {
  it('remembers approval per branch AND commit', () => {
    expect(readApproved('AT-1-x', 'sha1')).toBe(false);
    writeApproved('AT-1-x', 'sha1', true);
    expect(readApproved('AT-1-x', 'sha1')).toBe(true);
    // new commits pushed => the old approval no longer applies
    expect(readApproved('AT-1-x', 'sha2')).toBe(false);
    expect(readApproved('AT-2-y', 'sha1')).toBe(false);
  });

  it('can withdraw an approval', () => {
    writeApproved('AT-1-x', 'sha1', true);
    writeApproved('AT-1-x', 'sha1', false);
    expect(readApproved('AT-1-x', 'sha1')).toBe(false);
  });

  it('remembers viewed files per branch and commit', () => {
    expect(readViewed('AT-1-x', 'sha1')).toEqual([]);
    writeViewed('AT-1-x', 'sha1', ['a.ts', 'b.ts']);
    expect(readViewed('AT-1-x', 'sha1')).toEqual(['a.ts', 'b.ts']);
    expect(readViewed('AT-1-x', 'sha2')).toEqual([]);
  });

  it('ignores corrupt stored data', () => {
    sessionStorage.setItem('review-viewed:AT-1-x@sha1', '{not json');
    expect(readViewed('AT-1-x', 'sha1')).toEqual([]);
    sessionStorage.setItem('review-viewed:AT-1-x@sha1', '{"a":1}');
    expect(readViewed('AT-1-x', 'sha1')).toEqual([]);
    sessionStorage.setItem('review-viewed:AT-1-x@sha1', '["ok", 5, null]');
    expect(readViewed('AT-1-x', 'sha1')).toEqual(['ok']);
  });

  it('never throws when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readApproved('a', 'b')).toBe(false);
    expect(readViewed('a', 'b')).toEqual([]);
    expect(() => writeApproved('a', 'b', true)).not.toThrow();
    expect(() => writeApproved('a', 'b', false)).not.toThrow();
    expect(() => writeViewed('a', 'b', ['x'])).not.toThrow();
  });
});
