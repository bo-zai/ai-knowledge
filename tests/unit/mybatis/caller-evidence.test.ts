import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveCallerEvidence } from "../../../src/mybatis/caller-evidence.js";

describe("resolveCallerEvidence", () => {
  it("extracts call site snippet for mapper invocations", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "caller-evidence-"));
    const javaDir = join(
      repoPath,
      "src",
      "main",
      "java",
      "com",
      "demo",
      "service",
    );
    await mkdir(javaDir, { recursive: true });

    await writeFile(
      join(javaDir, "QuestionService.java"),
      `package com.demo.service;

import com.demo.mapper.UserMapper;

public class QuestionService {
    private UserMapper userMapper;

    /**
     * 根据题目难度构建卡片
     */
    public void buildQuestionCard(Long id) {
        Object user = userMapper.selectById(id);
        card.setDifficulty(user);
    }
}
`,
      "utf8",
    );

    const result = await resolveCallerEvidence({
      repoPath,
      namespace: "com.demo.mapper.UserMapper",
      methodId: "selectById",
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.callerMethod).toBe("buildQuestionCard");
    expect(result[0]?.callSiteSnippet).toContain("userMapper.selectById(id);");
  });

  it("ignores non-mapper receivers with the same method name before the mapper call", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "caller-evidence-"));
    const javaDir = join(
      repoPath,
      "src",
      "main",
      "java",
      "com",
      "demo",
      "service",
    );
    await mkdir(javaDir, { recursive: true });

    await writeFile(
      join(javaDir, "QuestionService.java"),
      `package com.demo.service;

import com.demo.mapper.QuestionMapper;

public class QuestionService {
    private QuestionMapper questionMapper;
    private CacheClient cacheClient;

    /**
     * 根据题目难度构建卡片
     */
    public void buildQuestionCard(Long id) {
        Object cached = cacheClient.selectById(id);
        Object question = questionMapper.selectById(id);
        card.setDifficulty(question);
    }
}
`,
      "utf8",
    );

    const result = await resolveCallerEvidence({
      repoPath,
      namespace: "com.demo.mapper.QuestionMapper",
      methodId: "selectById",
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.callerMethod).toBe("buildQuestionCard");
    expect(result[0]?.callSiteSnippet).toContain(
      "questionMapper.selectById(id);",
    );
    expect(result[0]?.callSiteSnippet).not.toContain(
      "cacheClient.selectById(id);",
    );
  });

  it("uses mapper receivers declared as constructor parameters", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "caller-evidence-"));
    const javaDir = join(
      repoPath,
      "src",
      "main",
      "java",
      "com",
      "demo",
      "service",
    );
    await mkdir(javaDir, { recursive: true });

    await writeFile(
      join(javaDir, "QuestionService.java"),
      `package com.demo.service;

import com.demo.mapper.QuestionMapper;

public class QuestionService {
    private final QuestionMapper mapper;

    public QuestionService(QuestionMapper mapper) {
        this.mapper = mapper;
    }

    /**
     * 查询题目详情
     */
    public Object loadQuestion(Long id) {
        return mapper.selectById(id);
    }
}
`,
      "utf8",
    );

    const result = await resolveCallerEvidence({
      repoPath,
      namespace: "com.demo.mapper.QuestionMapper",
      methodId: "selectById",
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.callerMethod).toBe("loadQuestion");
    expect(result[0]?.callSiteSnippet).toContain("mapper.selectById(id);");
  });
});
