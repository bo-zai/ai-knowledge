import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';
import { execa } from 'execa';

async function createFakeOpenAiServer(responseContent: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'test-model',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: responseContent },
        finish_reason: 'stop',
      }],
    }));
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server address unavailable');

  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    close: () => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())),
  };
}

async function createGitRepo(repo: string): Promise<void> {
  await execa('git', ['init'], { cwd: repo });
  await execa('git', ['config', 'user.email', 'test@test.com'], { cwd: repo });
  await execa('git', ['config', 'user.name', 'Test User'], { cwd: repo });
}

async function createSimpleRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'generate-capability-'));
  await mkdir(join(repo, 'src'), { recursive: true });
  await mkdir(join(repo, 'tests'), { recursive: true });
  await writeFile(join(repo, 'README.md'), '# test repo');
  await writeFile(
    join(repo, 'src', 'order.ts'),
    `export interface Order {
  id: string;
  amount: number;
  status: string;
}

export async function createOrder(amount: number): Promise<Order> {
  return { id: '1', amount, status: 'pending' };
}

export async function getOrder(id: string): Promise<Order> {
  return { id, amount: 100, status: 'completed' };
}

export async function cancelOrder(id: string): Promise<void> {
  console.log('cancel', id);
}

export async function listOrders(): Promise<Order[]> {
  return [];
}

export async function validateOrder(order: Order): Promise<boolean> {
  return order.amount > 0;
}`
  );
  await writeFile(
    join(repo, 'tests', 'order.test.ts'),
    `describe('OrderService', () => {
  it('should create order', async () => {
    expect(true).toBe(true);
  });
  it('should get order', async () => {
    expect(true).toBe(true);
  });
  it('should cancel order', async () => {
    expect(true).toBe(true);
  });
  it('should list orders', async () => {
    expect(true).toBe(true);
  });
  it('should validate order', async () => {
    expect(true).toBe(true);
  });
});`
  );
  await createGitRepo(repo);
  return repo;
}

describe('generate --terms (capability mode)', () => {
  it('fails when no API key is configured', async () => {
    const repo = await createSimpleRepo();

    const result = await execa(
      'node',
      [
        'dist/cli/index.js',
        'generate',
        repo,
        '--terms', 'order',
        '--paths', 'src',
      ],
      {
        reject: false,
        timeout: 30000,
        env: { ...process.env, OPENAI_API_KEY: '' },
      }
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toContain('LLM API key is missing');
  });

  it('accepts --llm-config option and fails when endpoint is unreachable', async () => {
    const repo = await createSimpleRepo();

    // Create a config file with invalid endpoint
    const configPath = join(repo, 'llm.config.json');
    await writeFile(configPath, JSON.stringify({
      model: 'test-model',
      baseUrl: 'http://localhost:9999/v1',
      apiKey: 'test-key',
    }));

    const result = await execa(
      'node',
      [
        'dist/cli/index.js',
        'generate',
        repo,
        '--terms', 'order',
        '--paths', 'src',
        '--llm-config', configPath,
        '--verbose',
      ],
      {
        reject: false,
        timeout: 10000,
      }
    );

    // Should show LangGraph runtime in verbose output before failing
    expect(result.stdout).toContain('LLM runtime: langgraph');
    // Should fail because endpoint is unreachable
    expect(result.exitCode).not.toBe(0);
  });

  it('succeeds with mock LLM and produces business quality objects', async () => {
    const repo = await createSimpleRepo();

    // Create fake LLM response with business-quality claims
    const fakeResponse = JSON.stringify([
      {
        suggestedType: 'CAP',
        claimText: 'Order management lets customers create, retrieve, and cancel orders.',
        confidence: 'high',
        evidenceRefs: ['evidence://behavior/BEH-001'],
        decisionPoints: ['requirement_intent'],
        sddStageUses: ['requirement_clarification', 'requirement_specification'],
        unsupportedParts: [],
        blockedDecisions: [],
        objectHints: {
          canonicalTerm: 'Order management',
          goal: 'Submit and manage customer orders',
          successCriteria: ['Order created with pending status', 'Order retrievable by id'],
          nonGoals: ['Payment processing', 'Inventory management'],
        },
      },
      {
        suggestedType: 'FLOW',
        claimText: 'Customer creates an order with amount, system records it as pending.',
        confidence: 'high',
        evidenceRefs: ['evidence://behavior/BEH-001'],
        decisionPoints: ['current_behavior'],
        sddStageUses: ['design_planning'],
        unsupportedParts: [],
        blockedDecisions: [],
        objectHints: {
          subject: 'Order management',
          orderedSteps: [
            { action: 'Customer submits order with amount', evidenceRef: 'evidence://behavior/BEH-001', note: 'Order created as pending' },
            { action: 'System returns order with pending status' },
          ],
          failureBranches: ['Order amount must be positive'],
        },
      },
      {
        suggestedType: 'MOD',
        claimText: 'Order service module owns order lifecycle changes.',
        confidence: 'high',
        evidenceRefs: ['evidence://behavior/BEH-001'],
        decisionPoints: ['change_surface'],
        sddStageUses: ['implementation_planning', 'coding'],
        unsupportedParts: [],
        blockedDecisions: [],
        objectHints: {
          modulePath: 'src/order.ts',
          ownedResponsibility: 'Order lifecycle management',
          touchWhen: ['Changing order creation logic', 'Changing order status flow'],
          doNotTouchWhen: ['Changing unrelated payment or user modules'],
        },
      },
      {
        suggestedType: 'CON',
        claimText: 'Order output exposes order identity, amount, and status used by order management.',
        confidence: 'high',
        evidenceRefs: ['evidence://behavior/BEH-001'],
        decisionPoints: ['affected_contracts'],
        sddStageUses: ['requirement_specification'],
        unsupportedParts: [],
        blockedDecisions: [],
        objectHints: {
          contractSubject: 'Order output contract',
          contractKind: 'schema',
          fieldSemantics: {
            status: {
              meaning: 'Current lifecycle state of the order',
              validation: ['pending after creation'],
              evidenceRef: 'evidence://behavior/BEH-001',
            },
          },
        },
      },
      {
        suggestedType: 'VER',
        claimText: 'Order creation returns pending status test covers core capability path.',
        confidence: 'high',
        evidenceRefs: ['evidence://behavior/BEH-001'],
        decisionPoints: ['validation_plan'],
        sddStageUses: ['validation'],
        unsupportedParts: [],
        blockedDecisions: [],
        objectHints: {
          verificationGoal: 'Order creation returns pending status',
          acceptanceOracle: ['createOrder returns an order with pending status'],
        },
      },
      {
        suggestedType: 'OPEN',
        claimText: 'Cannot determine external payment service contract for order settlement.',
        confidence: 'low',
        evidenceRefs: [],
        decisionPoints: [],
        sddStageUses: ['requirement_clarification'],
        unsupportedParts: ['Payment settlement integration'],
        blockedDecisions: ['Cannot decide if payment must be synchronous or async'],
        objectHints: {
          minimalNextEvidence: ['Find payment service API contract', 'Identify payment gateway integration'],
          ownerToAsk: 'payment team',
          escalationGate: 'Order settlement boundary decision',
        },
      },
    ]);

    const server = await createFakeOpenAiServer(fakeResponse);
    const outputRoot = await mkdtemp(join(tmpdir(), 'capability-mock-llm-'));

    try {
      const configPath = join(repo, 'llm.config.json');
      await writeFile(configPath, JSON.stringify({
        model: 'test-model',
        baseUrl: server.url,
        apiKey: 'test-key',
      }));

      const result = await execa(
        'node',
        [
          'dist/cli/index.js',
          'generate',
          repo,
          '--terms', 'order',
          '--paths', 'src',
          '--out', outputRoot,
          '--llm-config', configPath,
        ],
        {
          reject: false,
          timeout: 30000,
        }
      );

      expect(result.exitCode).toBe(0);

      // 验证 report
      const reportPath = join(outputRoot, 'bootstrap-knowledge', 'reports', 'capability-generation.json');
      const report = JSON.parse(await readFile(reportPath, 'utf-8'));

      expect(report.llmRuntime).toBe('langgraph');
      expect(report.llmSucceeded).toBe(true);
      expect(report.capabilityGenerationMode).toBe('single');
      expect(report.selectedCandidateId).toBeTruthy();
      expect(report.candidateCount).toBeGreaterThan(0);
      expect(report.requiredBusinessObjects.capFromLlm).toBe(true);
      expect(report.requiredBusinessObjects.flowOrConFromLlm).toBe(true);
      expect(report.requiredBusinessObjects.modPresent).toBe(true);
      expect(report.requiredBusinessObjects.modHasTouchGuidance).toBe(true);
      expect(report.requiredBusinessObjects.verHasOracle).toBe(true);
      expect(report.requiredBusinessObjects.noTechnicalTermLeakage).toBe(true);
      expect(report.objectSourceCounts.llm).toBeGreaterThan(0);

      // 验证 CAP 对象
      const capPath = join(outputRoot, 'bootstrap-knowledge', 'objects', 'capabilities');
      const capFiles = await readFile(join(capPath, 'CAP-ORDER-MANAGEMENT.yaml'), 'utf-8');
      expect(capFiles).toContain('source: llm');

      // 验证 MOD 对象
      const modFiles = await readFile(join(outputRoot, 'bootstrap-knowledge', 'objects', 'modules', 'MOD-SRC-ORDER-TS.yaml'), 'utf-8');
      expect(modFiles).toContain('touchWhen');
      expect(modFiles).toContain('doNotTouchWhen');

      // 验证 OPEN 对象
      const openDir = join(outputRoot, 'bootstrap-knowledge', 'objects', 'open');
      const { readdir } = await import('node:fs/promises');
      const openEntries = await readdir(openDir);
      const openFile = openEntries.find(f => f.endsWith('.yaml'));
      if (openFile) {
        const openContent = await readFile(join(openDir, openFile), 'utf-8');
        expect(openContent).toContain('minimalNextEvidence');
      }
    } finally {
      await server.close();
    }
  });
});
