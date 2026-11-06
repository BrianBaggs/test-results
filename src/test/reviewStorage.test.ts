import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { readViewed, writeViewed } from '../utils/reviewStorage';

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('reviewStorage', () => {
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
    expect(readViewed('a', 'b')).toEqual([]);
    expect(() => writeViewed('a', 'b', ['x'])).not.toThrow();
  });
});
