import { describe, expect, it } from 'vitest';
import { dbObjectSchema } from '../../../src/schemas/db';
import { conObjectSchema } from '../../../src/schemas/contract';

describe('schemas', () => {
  describe('DB schema', () => {
    it('rejects db fields without chinese description source', () => {
      const bad = {
        id: 'DB-users',
        type: 'DB',
        title: 'users',
        status: 'fact',
        maturity: 'bootstrap',
        scope: 'db.users',
        repo: 'sample',
        slice_ids: ['db-users'],
        evidence_primary: ['schema.sql'],
        evidence_secondary: [],
        stale_if: [],
        generated_by: 'test',
        generated_at: '2026-05-20T00:00:00Z',
        table_name: 'users',
        table_name_zh: '用户表',
        schema_name: 'public',
        source_kind: 'ddl',
        primary_key: ['id'],
        indexes: [],
        foreign_keys: [],
        read_by_direct: [],
        read_by_joined: [],
        write_by_direct: [],
        write_by_joined: [],
        fields: [{ name: 'id', type: 'bigint', nullable: false, default: null, description_zh: '主键', constraints: [] }],
      };
      expect(() => dbObjectSchema.parse(bad)).toThrow();
    });

    it('accepts db fields with description_source', () => {
      const good = {
        id: 'DB-users',
        type: 'DB',
        title: 'users',
        status: 'fact',
        maturity: 'bootstrap',
        scope: 'db.users',
        repo: 'sample',
        slice_ids: ['db-users'],
        evidence_primary: ['schema.sql'],
        evidence_secondary: [],
        stale_if: [],
        generated_by: 'test',
        generated_at: '2026-05-20T00:00:00Z',
        table_name: 'users',
        table_name_zh: '用户表',
        schema_name: 'public',
        source_kind: 'ddl',
        primary_key: ['id'],
        indexes: [],
        foreign_keys: [],
        read_by_direct: [],
        read_by_joined: [],
        write_by_direct: [],
        write_by_joined: [],
        fields: [{ name: 'id', type: 'bigint', nullable: false, default: null, description_zh: '主键', description_source: 'comment', constraints: [] }],
      };
      const result = dbObjectSchema.parse(good);
      expect(result.fields[0].description_source).toBe('comment');
    });
  });

  describe('CON schema', () => {
    it('rejects old constraint-style CON objects', () => {
      const oldConstraintStyle = {
        id: 'CON-auth',
        type: 'CON',
        title: 'auth constraint',
        status: 'fact',
        maturity: 'bootstrap',
        scope: 'auth',
        repo: 'sample',
        slice_ids: ['auth'],
        evidence_primary: ['auth.ts'],
        evidence_secondary: [],
        stale_if: [],
        generated_by: 'test',
        generated_at: '2026-05-20T00:00:00Z',
        // Old constraint fields - should fail
        constraint: 'auth required',
        constraint_zh: '需要认证',
        rationale_zh: '安全原因',
        scope_kind: 'global',
        enforcement: 'hard',
        violations: [],
        examples: [],
      };
      expect(() => conObjectSchema.parse(oldConstraintStyle)).toThrow();
    });

    it('accepts contract-style CON objects', () => {
      const contractStyle = {
        id: 'CON-auth',
        type: 'CON',
        title: 'auth contract',
        status: 'fact',
        maturity: 'bootstrap',
        scope: 'auth',
        repo: 'sample',
        slice_ids: ['auth'],
        evidence_primary: ['auth.ts'],
        evidence_secondary: [],
        stale_if: [],
        generated_by: 'test',
        generated_at: '2026-05-20T00:00:00Z',
        // New contract fields
        interface_kind: 'route',
        interface_name: 'POST /api/auth',
        interface_name_zh: '认证接口',
        producer: 'AuthService',
        producer_zh: '认证服务',
        consumers: ['UserController', 'OrderService'],
        input_shape: [
          { name: 'username', type: 'string', required: true, description_zh: '用户名', description_source: 'comment' },
          { name: 'password', type: 'string', required: true, description_zh: '密码', description_source: 'comment' },
        ],
        input_description_zh: '认证请求输入',
        output_shape: [
          { name: 'token', type: 'string', required: true, description_zh: '认证令牌', description_source: 'comment' },
          { name: 'expires_at', type: 'timestamp', required: false, description_zh: '过期时间', description_source: 'inferred' },
        ],
        output_description_zh: '认证响应输出',
        middleware: ['rate-limiter', 'validator'],
        error_shape: [
          { code: 'AUTH_FAILED', message_zh: '认证失败', http_status: 401 },
        ],
        related_routes: ['GET /api/user'],
        related_tools: ['hash-password'],
        entry_file: 'src/services/auth.ts',
        entry_symbol: 'authenticate',
      };
      const result = conObjectSchema.parse(contractStyle);
      expect(result.interface_kind).toBe('route');
      expect(result.input_shape).toHaveLength(2);
      expect(result.output_shape).toHaveLength(2);
    });

    it('requires input_shape and output_shape fields', () => {
      const missingShapes = {
        id: 'CON-test',
        type: 'CON',
        title: 'test',
        status: 'fact',
        maturity: 'bootstrap',
        scope: 'test',
        repo: 'sample',
        slice_ids: ['test'],
        evidence_primary: ['test.ts'],
        evidence_secondary: [],
        stale_if: [],
        generated_by: 'test',
        generated_at: '2026-05-20T00:00:00Z',
        interface_kind: 'api',
        interface_name: 'test',
        interface_name_zh: '测试',
        producer: 'TestService',
        producer_zh: '测试服务',
        consumers: [],
        // Missing input_shape and output_shape
        related_routes: [],
        related_tools: [],
        entry_file: 'test.ts',
      };
      expect(() => conObjectSchema.parse(missingShapes)).toThrow();
    });
  });
});