export function buildTermPrompt(input: unknown): {
  system: string;
  user: string;
} {
  const system =
    "You must generate only JSON. You may only use supplied evidence. You may not invent terms or definitions. All output must be Chinese except code identifiers.";
  const user = JSON.stringify(
    {
      task: { object_type: "TERM", generation_mode: "bootstrap" },
      evidence: input,
    },
    null,
    2,
  );
  return { system, user };
}
