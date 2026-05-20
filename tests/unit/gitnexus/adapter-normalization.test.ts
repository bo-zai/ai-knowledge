import { describe, expect, it } from 'vitest';
import { normalizeGitNexusOutput } from '../../../src/gitnexus/adapter';
import type { GitNexusResult } from '../../../src/gitnexus/types';

describe('normalizeGitNexusOutput', () => {
  it('parses route lines correctly', () => {
    const input: GitNexusResult = {
      stdout: 'Route: POST /api/users (src/routes/users.ts)\nRoute: GET /api/products',
    };

    const result = normalizeGitNexusOutput(input);

    expect(result.routes).toHaveLength(2);
    expect(result.routes[0]).toEqual({
      id: 'route:POST:/api/users',
      method: 'POST',
      path: '/api/users',
      handler: 'src/routes/users.ts',
    });
    expect(result.routes[1]).toEqual({
      id: 'route:GET:/api/products',
      method: 'GET',
      path: '/api/products',
      handler: undefined,
    });
  });

  it('parses process lines correctly', () => {
    const input: GitNexusResult = {
      stdout: 'Process: UserRegistration (src/services/auth.ts)\nProcess: OrderFulfillment',
    };

    const result = normalizeGitNexusOutput(input);

    expect(result.processes).toHaveLength(2);
    expect(result.processes[0]).toEqual({
      id: 'process:UserRegistration',
      name: 'UserRegistration',
      entry_point: 'src/services/auth.ts',
    });
    expect(result.processes[1]).toEqual({
      id: 'process:OrderFulfillment',
      name: 'OrderFulfillment',
      entry_point: undefined,
    });
  });

  it('parses tool lines correctly', () => {
    const input: GitNexusResult = {
      stdout: 'Tool: EmailSender (src/tools/email.ts)\nTool: Logger',
    };

    const result = normalizeGitNexusOutput(input);

    expect(result.tools).toHaveLength(2);
    expect(result.tools[0]).toEqual({
      id: 'tool:EmailSender',
      name: 'EmailSender',
      file: 'src/tools/email.ts',
    });
    expect(result.tools[1]).toEqual({
      id: 'tool:Logger',
      name: 'Logger',
      file: undefined,
    });
  });

  it('parses community lines correctly', () => {
    const input: GitNexusResult = {
      stdout: 'Community: AuthTeam (alice, bob, charlie)\nCommunity: DevOps',
    };

    const result = normalizeGitNexusOutput(input);

    expect(result.communities).toHaveLength(2);
    expect(result.communities[0]).toEqual({
      id: 'community:AuthTeam',
      name: 'AuthTeam',
      members: ['alice', 'bob', 'charlie'],
    });
    expect(result.communities[1]).toEqual({
      id: 'community:DevOps',
      name: 'DevOps',
      members: undefined,
    });
  });

  it('parses table lines correctly', () => {
    const input: GitNexusResult = {
      stdout: 'Table: users (public)\nTable: orders',
    };

    const result = normalizeGitNexusOutput(input);

    expect(result.tables).toHaveLength(2);
    expect(result.tables[0]).toEqual({
      id: 'table:users',
      name: 'users',
      schema: 'public',
    });
    expect(result.tables[1]).toEqual({
      id: 'table:orders',
      name: 'orders',
      schema: undefined,
    });
  });

  it('handles empty output', () => {
    const input: GitNexusResult = { stdout: '' };

    const result = normalizeGitNexusOutput(input);

    expect(result.routes).toHaveLength(0);
    expect(result.processes).toHaveLength(0);
    expect(result.tools).toHaveLength(0);
    expect(result.communities).toHaveLength(0);
    expect(result.tables).toHaveLength(0);
    expect(result.gaps).toHaveLength(0);
  });

  it('records gaps for malformed lines', () => {
    const input: GitNexusResult = {
      stdout: 'Route: invalid-route-format\nProcess: ',
    };

    const result = normalizeGitNexusOutput(input);

    expect(result.gaps).toHaveLength(2);
    expect(result.gaps[0].kind).toBe('route');
    expect(result.gaps[0].reason).toContain('Malformed');
    expect(result.gaps[1].kind).toBe('process');
  });

  it('skips unknown lines without error', () => {
    const input: GitNexusResult = {
      stdout: 'Some random output\nRoute: GET /api/test\nAnother unknown line',
    };

    const result = normalizeGitNexusOutput(input);

    expect(result.routes).toHaveLength(1);
    expect(result.parse_errors).toHaveLength(0);
  });

  it('handles mixed output with all slice kinds', () => {
    const input: GitNexusResult = {
      stdout: `
Route: POST /api/users (src/routes/users.ts)
Process: UserRegistration (src/services/auth.ts)
Tool: EmailSender (src/tools/email.ts)
Community: AuthTeam (alice, bob)
Table: users (public)
      `,
    };

    const result = normalizeGitNexusOutput(input);

    expect(result.routes).toHaveLength(1);
    expect(result.processes).toHaveLength(1);
    expect(result.tools).toHaveLength(1);
    expect(result.communities).toHaveLength(1);
    expect(result.tables).toHaveLength(1);
  });
});