export function buildPrompt(input: {
  objectType: string;
  generationMode: string;
  evidence: unknown;
}): { system: string; user: string } {
  const system = `You must generate only JSON. You may only use supplied evidence. You may not invent fields, routes, tables, symbols, or constraints. All output must be Chinese except code identifiers.

Output format:
{
  "objects": [...],
  "warnings": [...]
}`;

  const user = JSON.stringify(
    {
      task: { object_type: input.objectType, generation_mode: input.generationMode },
      evidence: input.evidence,
    },
    null,
    2,
  );

  return { system, user };
}