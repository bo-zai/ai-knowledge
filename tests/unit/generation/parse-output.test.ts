import { describe, expect, it } from "vitest";
import {
  parseGeneratorOutput,
  parseTypedOutput,
} from "../../../src/generation/parse-output";
import { dbObjectSchema } from "../../../src/schemas/db";

describe("parseGeneratorOutput", () => {
  it("parses valid object output", () => {
    const result = parseGeneratorOutput(
      '{"objects":[{"id":"DB-users"}],"warnings":[]}',
    );
    expect(result.objects).toHaveLength(1);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseGeneratorOutput("not json")).toThrow();
  });

  it("extracts JSON from markdown code block", () => {
    const markdownWrapped = `
Here is the output:
\`\`\`json
{"objects":[{"id":"DB-users"}],"warnings":[]}
\`\`\`
`;
    const result = parseGeneratorOutput(markdownWrapped);
    expect(result.objects).toHaveLength(1);
  });

  it("extracts JSON without code block marker", () => {
    const textWithCodeBlock = `
\`\`\`
{"objects":[{"id":"DB-users"}],"warnings":[]}
\`\`\`
`;
    const result = parseGeneratorOutput(textWithCodeBlock);
    expect(result.objects).toHaveLength(1);
  });

  it("repairs trailing commas", () => {
    const withTrailingComma = '{"objects":[{"id":"DB-users"},],"warnings":[]}';
    const result = parseGeneratorOutput(withTrailingComma);
    expect(result.objects).toHaveLength(1);
  });

  it("extracts JSON from partial text", () => {
    const partialText =
      'Some prefix text {"objects":[{"id":"DB-users"}],"warnings":[]} some suffix text';
    const result = parseGeneratorOutput(partialText);
    expect(result.objects).toHaveLength(1);
  });

  it("accepts single object output and wraps it", () => {
    const singleObject = '{"id":"DB-users","type":"DB"}';
    const result = parseGeneratorOutput(singleObject);
    expect(result.objects).toHaveLength(1);
    expect(result.objects[0]).toHaveProperty("id");
  });

  it("defaults warnings to empty array when missing", () => {
    const withoutWarnings = '{"objects":[{"id":"DB-users"}]}';
    const result = parseGeneratorOutput(withoutWarnings);
    expect(result.warnings).toEqual([]);
  });
});

describe("parseTypedOutput", () => {
  it("validates objects with schema", () => {
    const validDb = JSON.stringify({
      objects: [
        {
          id: "DB-users",
          type: "DB",
          title: "users",
          status: "fact",
          maturity: "bootstrap",
          scope: "db.users",
          repo: "test",
          slice_ids: ["db-users"],
          evidence_primary: ["schema.sql"],
          evidence_secondary: [],
          stale_if: [],
          generated_by: "test",
          generated_at: "2026-05-20T00:00:00Z",
          table_name: "users",
          table_name_zh: "用户表",
          schema_name: "public",
          source_kind: "ddl",
          primary_key: ["id"],
          indexes: [],
          foreign_keys: [],
          read_by_direct: [],
          read_by_joined: [],
          write_by_direct: [],
          write_by_joined: [],
          fields: [
            {
              name: "id",
              type: "bigint",
              nullable: false,
              default: null,
              description_zh: "主键",
              description_source: "comment",
              constraints: [],
            },
          ],
        },
      ],
      warnings: [],
    });

    const result = parseTypedOutput(validDb, (data) => {
      try {
        return dbObjectSchema.parse(data);
      } catch {
        return null;
      }
    });

    expect(result.objects).toHaveLength(1);
    expect(result.objects[0].type).toBe("DB");
  });

  it("adds warnings for validation failures", () => {
    const invalidDb = JSON.stringify({
      objects: [
        {
          id: "DB-invalid",
          type: "DB",
          // Missing required fields
        },
      ],
      warnings: [],
    });

    const result = parseTypedOutput(invalidDb, (data) => {
      try {
        return dbObjectSchema.parse(data);
      } catch {
        return null;
      }
    });

    expect(result.objects).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
