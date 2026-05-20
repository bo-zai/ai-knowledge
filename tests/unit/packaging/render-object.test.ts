import { describe, expect, it } from 'vitest';
import { renderObjectMarkdown } from '../../../src/packaging/render-object';

describe('renderObjectMarkdown', () => {
  it('renders yaml frontmatter and markdown body', () => {
    const text = renderObjectMarkdown({
      frontmatter: { id: 'DB-users', type: 'DB' },
      body: '# Users',
    });
    expect(text).toContain('---');
    expect(text).toContain('id: DB-users');
    expect(text).toContain('# Users');
  });
});