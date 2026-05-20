import YAML from 'yaml';

export function renderObjectMarkdown(input: {
  frontmatter: Record<string, unknown>;
  body: string;
}): string {
  return `---\n${YAML.stringify(input.frontmatter)}---\n\n${input.body}\n`;
}