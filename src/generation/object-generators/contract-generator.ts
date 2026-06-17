export function buildConPrompt(input: unknown): {
  system: string;
  user: string;
} {
  const system =
    "You must generate only JSON. You are generating a contract (CON) object that describes an interface between components. Include: interface_kind (route/tool/api/method/event), interface_name, producer, consumers, input_shape, output_shape, middleware, error_shape, and code anchors. All descriptions must be in Chinese except code identifiers. Every field in input_shape and output_shape must have description_zh and description_source.";
  const user = JSON.stringify(
    {
      task: { object_type: "CON", generation_mode: "bootstrap" },
      evidence: input,
    },
    null,
    2,
  );
  return { system, user };
}
