import { describe, expect, it } from "vitest";
import { parseMapperFile } from "../../../src/mybatis/mapper-parser.js";
import { resolveStatementSql } from "../../../src/mybatis/include-resolver.js";

describe("include resolution", () => {
  it("expands sql fragments into the final statement sql", async () => {
    const mapper = await parseMapperFile(
      "D:/workspace/other_project/music-education-admin/src/main/resources/mappers/CategoryMapper.xml",
    );
    expect(mapper).toBeTruthy();

    const stmt = mapper?.statements.find(
      (item) => item.id === "getCategoryList",
    );
    expect(stmt).toBeTruthy();

    const resolved = resolveStatementSql(stmt!, mapper!);
    expect(resolved.sql).toContain("id, name, sort_code");
    expect(resolved.fragmentRefs).toContain("Base_Category_Column_List");
  });

  it("resolves Base_Column_List for music_user table", async () => {
    const mapper = await parseMapperFile(
      "D:/workspace/other_project/music-education-admin/src/main/resources/mappers/UserMapper.xml",
    );
    expect(mapper).toBeTruthy();

    const stmt = mapper?.statements.find(
      (item) => item.id === "getAppUserById",
    );
    expect(stmt).toBeTruthy();

    const resolved = resolveStatementSql(stmt!, mapper!);
    expect(resolved.sql).toContain("u.id, u.date_login");
    expect(resolved.fragmentRefs).toContain("Base_Column_List");
  });
});

describe("resultMap extraction", () => {
  it("extracts resultMap definitions from CategoryMapper", async () => {
    const mapper = await parseMapperFile(
      "D:/workspace/other_project/music-education-admin/src/main/resources/mappers/CategoryMapper.xml",
    );
    expect(mapper).toBeTruthy();
    expect(mapper?.resultMaps.length).toBeGreaterThan(0);

    const baseCategoryResultMap = mapper?.resultMaps.find(
      (rm) => rm.id === "BaseCategoryResultMap",
    );
    expect(baseCategoryResultMap).toBeTruthy();
    expect(baseCategoryResultMap?.type).toBe(
      "com.education.music.core.DO.mall.CategoryDO",
    );
    expect(baseCategoryResultMap?.mappings.length).toBeGreaterThan(0);

    // Check specific mappings
    const nameMapping = baseCategoryResultMap?.mappings.find(
      (m) => m.property === "name",
    );
    expect(nameMapping?.column).toBe("name");

    const picUrlMapping = baseCategoryResultMap?.mappings.find(
      (m) => m.property === "picUrl",
    );
    expect(picUrlMapping?.column).toBe("pic_url");
  });

  it("extracts resultMap definitions from UserMapper", async () => {
    const mapper = await parseMapperFile(
      "D:/workspace/other_project/music-education-admin/src/main/resources/mappers/UserMapper.xml",
    );
    expect(mapper).toBeTruthy();

    const baseResultMap = mapper?.resultMaps.find(
      (rm) => rm.id === "BaseResultMap",
    );
    expect(baseResultMap).toBeTruthy();
    expect(baseResultMap?.type).toBe("com.education.music.core.DO.user.UserDO");

    // Check specific mappings
    const mobileMapping = baseResultMap?.mappings.find(
      (m) => m.property === "mobile",
    );
    expect(mobileMapping?.column).toBe("mobile");

    const nicknameMapping = baseResultMap?.mappings.find(
      (m) => m.property === "nickname",
    );
    expect(nicknameMapping?.column).toBe("nickname");
  });
});

describe("statement resultType/resultMap preservation", () => {
  it("preserves resultType for auth_menu statements", async () => {
    const mapper = await parseMapperFile(
      "D:/workspace/other_project/music-education-admin/src/main/resources/mappers/AuthMapper.xml",
    );
    expect(mapper).toBeTruthy();

    const stmt = mapper?.statements.find(
      (item) => item.id === "getMenuAuthList",
    );
    expect(stmt).toBeTruthy();
    expect(stmt?.resultType).toBe("com.education.music.core.DO.user.AuthDO");
  });

  it("preserves resultMap for mall_category statements", async () => {
    const mapper = await parseMapperFile(
      "D:/workspace/other_project/music-education-admin/src/main/resources/mappers/CategoryMapper.xml",
    );
    expect(mapper).toBeTruthy();

    const stmt = mapper?.statements.find(
      (item) => item.id === "getCategoryList",
    );
    expect(stmt).toBeTruthy();
    expect(stmt?.resultMap).toBe("BaseCategoryResultMap");
  });
});
