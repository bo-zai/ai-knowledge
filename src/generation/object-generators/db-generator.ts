export function buildDbPrompt(input: unknown): { system: string; user: string } {
  const system =
    'You must generate only JSON. You may only use supplied evidence. You may not invent fields, routes, tables, symbols, or constraints. All output must be Chinese except code identifiers.';
  const user = JSON.stringify(
    {
      task: { object_type: 'DB', generation_mode: 'bootstrap' },
      evidence: input,
    },
    null,
    2,
  );
  return { system, user };
}