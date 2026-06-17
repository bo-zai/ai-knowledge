export function buildOpenPrompt(input: unknown): {
  system: string;
  user: string;
} {
  const system =
    "You must generate only JSON. You may only use supplied evidence. You may not invent questions or impacts. All output must be Chinese except code identifiers.";
  const user = JSON.stringify(
    {
      task: { object_type: "OPEN", generation_mode: "bootstrap" },
      evidence: input,
    },
    null,
    2,
  );
  return { system, user };
}
