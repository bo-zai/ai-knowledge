import { describe, expect, it } from "vitest";
import {
  mergeDbFieldSources,
  extractTableSchema,
  mergeSchemaSources,
} from "../../../src/evidence/db-evidence";

describe("mergeDbFieldSources", () => {
  it("prefers comment source over inferred source", () => {
    const fields = mergeDbFieldSources([
      {
        name: "id",
        type: "bigint",
        nullable: false,
        default: null,
        description_zh: "主键",
        description_source: "comment",
        constraints: [],
      },
      {
        name: "id",
        type: "bigint",
        nullable: false,
        default: null,
        description_zh: "用户编号",
        description_source: "inferred",
        constraints: [],
      },
    ]);
    expect(fields[0].description_zh).toBe("主键");
    expect(fields[0].description_source).toBe("comment");
  });

  it("keeps first field when both have same source", () => {
    const fields = mergeDbFieldSources([
      {
        name: "name",
        type: "varchar",
        nullable: true,
        default: null,
        description_zh: "名称",
        description_source: "inferred",
        constraints: [],
      },
      {
        name: "name",
        type: "varchar",
        nullable: true,
        default: null,
        description_zh: "姓名",
        description_source: "inferred",
        constraints: [],
      },
    ]);
    expect(fields[0].description_zh).toBe("名称");
  });
});

describe("mergeSchemaSources", () => {
  it("prefers DDL over migration", () => {
    const sources = [
      { kind: "migration" as const, file: "migrate.sql", priority: 2 },
      { kind: "ddl" as const, file: "schema.sql", priority: 1 },
    ];
    const result = mergeSchemaSources(sources);
    expect(result?.kind).toBe("ddl");
    expect(result?.file).toBe("schema.sql");
  });

  it("prefers ORM over SQL", () => {
    const sources = [
      { kind: "sql" as const, file: "query.sql", priority: 4 },
      { kind: "orm" as const, file: "model.py", priority: 3 },
    ];
    const result = mergeSchemaSources(sources);
    expect(result?.kind).toBe("orm");
  });
});

describe("extractTableSchema", () => {
  it("extracts fields from DDL content", () => {
    const ddlContent = `
CREATE TABLE users (
  id BIGINT PRIMARY KEY COMMENT '主键',
  name VARCHAR(100) COMMENT '用户名',
  email VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`;

    const result = extractTableSchema({
      tableName: "users",
      schemaName: "public",
      sources: [{ kind: "ddl", file: "schema.sql", priority: 1 }],
      ddlContent,
    });

    expect(result.primarySource).toBe("ddl");
    expect(result.fields.length).toBeGreaterThan(0);

    // 检查有注释的字段
    const idField = result.fields.find((f) => f.name === "id");
    expect(idField?.description_source).toBe("comment");
    expect(idField?.description_zh).toBe("主键");
  });

  it("emits gaps for inferred-only descriptions", () => {
    const ddlContent = `
CREATE TABLE orders (
  id BIGINT PRIMARY KEY,
  user_id BIGINT,
  total DECIMAL(10, 2)
);`;

    const result = extractTableSchema({
      tableName: "orders",
      schemaName: "public",
      sources: [{ kind: "ddl", file: "schema.sql", priority: 1 }],
      ddlContent,
    });

    // 检查 inferred 字段描述的 gap
    const inferredGaps = result.gaps.filter(
      (g) => g.kind === "inferred-description",
    );
    expect(inferredGaps.length).toBeGreaterThan(0);
  });

  it("emits gap when only inferred source available", () => {
    const result = extractTableSchema({
      tableName: "unknown",
      schemaName: "public",
      sources: [],
      inferredFields: [
        {
          name: "id",
          type: "bigint",
          nullable: false,
          default: null,
          description_zh: "推断字段",
          description_source: "inferred",
          constraints: [],
        },
      ],
    });

    expect(result.primarySource).toBe("inferred");
    expect(result.gaps.some((g) => g.kind === "inferred-source")).toBe(true);
  });

  it("extracts primary key from DDL", () => {
    const ddlContent = `
CREATE TABLE products (
  id BIGINT PRIMARY KEY,
  name VARCHAR(100)
);`;

    const result = extractTableSchema({
      tableName: "products",
      schemaName: "public",
      sources: [{ kind: "ddl", file: "schema.sql", priority: 1 }],
      ddlContent,
    });

    expect(result.primaryKey).toContain("id");
  });

  it("extracts foreign keys from DDL", () => {
    const ddlContent = `
CREATE TABLE orders (
  id BIGINT PRIMARY KEY,
  user_id BIGINT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);`;

    const result = extractTableSchema({
      tableName: "orders",
      schemaName: "public",
      sources: [{ kind: "ddl", file: "schema.sql", priority: 1 }],
      ddlContent,
    });

    expect(result.foreignKeys.length).toBeGreaterThan(0);
    expect(result.foreignKeys[0].targetTable).toBe("users");
  });
});
