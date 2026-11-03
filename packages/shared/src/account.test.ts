import { describe, expect, it } from 'vitest';
import { safeNextPath } from './account';

describe('safeNextPath', () => {
  it('keeps a path on this site, with its search', () => {
    expect(safeNextPath('/calendar?week=2026-11-02')).toBe('/calendar?week=2026-11-02');
    expect(safeNextPath('/')).toBe('/');
  });

  it('refuses anything that could leave the site', () => {
    for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example', 'evil', '', '/a\\b', '/a\nb', 42, null, undefined]) {
      expect(safeNextPath(bad)).toBeNull();
    }
  });
});
