/**
 * ConceptVerifier 单元测试
 *
 * 测试验证逻辑：
 * - verify() 返回成功
 * - verifyAggregation() 断言
 * - verifyConfidenceCalculation() 断言
 * - verifyCandidates() 断言
 * - verifyCrossModuleDetection() 断言
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { ConceptVerifier, createConceptVerifier } from '../../../../../src/evidence/extractors/concept-verifier.js';

describe('ConceptVerifier', () => {
  let verifier: ConceptVerifier;

  beforeEach(() => {
    verifier = createConceptVerifier(
      '/test/repo',
      ['mall-admin', 'music-course', 'music-sync'],
      0.2 // crossModuleBonus
    );
  });

  describe('verify()', () => {
    it('returns success with valid mock data', async () => {
      const result = await verifier.verify();

      expect(result.success).toBe(true);
      expect(result.details.errors).toHaveLength(0);
    });

    it('returns correct summary statistics', async () => {
      const result = await verifier.verify();

      expect(result.summary.totalTables).toBe(2);
      expect(result.summary.crossModuleTables).toBe(1);
      expect(result.summary.totalCandidates).toBe(2);
      expect(result.summary.totalEntryPoints).toBe(3);
    });

    it('returns pathway stats with controller and scheduled', async () => {
      const result = await verifier.verify();

      expect(result.summary.pathwayStats.controller).toBe(2);
      expect(result.summary.pathwayStats.scheduled).toBe(1);
      expect(result.summary.pathwayStats.mqConsumer).toBe(0);
    });

    it('returns all 20 assertions', async () => {
      const result = await verifier.verify();

      expect(result.assertions.length).toBe(20);
    });

    it('returns table anchors in details', async () => {
      const result = await verifier.verify();

      expect(result.details.tableAnchors.length).toBe(2);
      const tableNames = result.details.tableAnchors.map(a => a.tableName);
      expect(tableNames).toContain('pms_product');
      expect(tableNames).toContain('edu_course');
    });

    it('returns candidates in details', async () => {
      const result = await verifier.verify();

      expect(result.details.candidates.length).toBe(2);
      const candidateIds = result.details.candidates.map(c => c.candidateId);
      expect(candidateIds).toContain('CAND-pms_product');
      expect(candidateIds).toContain('CAND-edu_course');
    });

    it('returns discovery results in details', async () => {
      const result = await verifier.verify();

      expect(result.details.discoveryResults.length).toBe(3);
      // mall-group, music-course, music-sync
      const pathways = result.details.discoveryResults.map(r => r.pathway);
      expect(pathways).toContain('controller');
      expect(pathways).toContain('scheduled');
    });
  });

  describe('verifyAggregation()', () => {
    it('asserts table anchor count is 2', async () => {
      const result = await verifier.verify();

      const assertion = result.assertions.find(a => a.name === 'table_anchor_count');
      expect(assertion).toBeDefined();
      expect(assertion?.passed).toBe(true);
    });

    it('asserts edu_course table exists', async () => {
      const result = await verifier.verify();

      const assertion = result.assertions.find(a => a.name === 'edu_course_exists');
      expect(assertion).toBeDefined();
      expect(assertion?.passed).toBe(true);
    });

    it('asserts cross module detection for edu_course', async () => {
      const result = await verifier.verify();

      const assertion = result.assertions.find(a => a.name === 'cross_module_detection');
      expect(assertion).toBeDefined();
      expect(assertion?.passed).toBe(true);
    });

    it('asserts module count is 2 for edu_course', async () => {
      const result = await verifier.verify();

      const assertion = result.assertions.find(a => a.name === 'module_count');
      expect(assertion).toBeDefined();
      expect(assertion?.passed).toBe(true);
    });

    it('asserts trace source count is 2 for edu_course', async () => {
      const result = await verifier.verify();

      const assertion = result.assertions.find(a => a.name === 'trace_source_count');
      expect(assertion).toBeDefined();
      expect(assertion?.passed).toBe(true);
    });

    it('asserts single module detection for pms_product', async () => {
      const result = await verifier.verify();

      const assertion = result.assertions.find(a => a.name === 'single_module_detection');
      expect(assertion).toBeDefined();
      expect(assertion?.passed).toBe(true);
    });

    it('asserts module count is 1 for pms_product', async () => {
      const result = await verifier.verify();

      const assertion = result.assertions.find(a => a.name === 'pms_module_count');
      expect(assertion).toBeDefined();
      expect(assertion?.passed).toBe(true);
    });
  });

  describe('verifyConfidenceCalculation()', () => {
    it('asserts cross module confidence >= 0.9', async () => {
      const result = await verifier.verify();

      const assertion = result.assertions.find(a => a.name === 'cross_module_confidence');
      expect(assertion).toBeDefined();
      expect(assertion?.passed).toBe(true);
    });

    it('asserts cross module bonus effect', async () => {
      const result = await verifier.verify();

      const assertion = result.assertions.find(a => a.name === 'cross_module_bonus_effect');
      expect(assertion).toBeDefined();
      expect(assertion?.passed).toBe(true);
    });

    it('asserts single module confidence ~0.8', async () => {
      const result = await verifier.verify();

      const assertion = result.assertions.find(a => a.name === 'single_module_confidence');
      expect(assertion).toBeDefined();
      expect(assertion?.passed).toBe(true);
    });

    it('asserts confidence cap at 1.0', async () => {
      const result = await verifier.verify();

      const assertion = result.assertions.find(a => a.name === 'confidence_cap');
      expect(assertion).toBeDefined();
      expect(assertion?.passed).toBe(true);
    });
  });

  describe('verifyCandidates()', () => {
    it('asserts candidate ID format starts with CAND-', async () => {
      const result = await verifier.verify();

      const assertion = result.assertions.find(a => a.name === 'candidate_id_format');
      expect(assertion).toBeDefined();
      expect(assertion?.passed).toBe(true);
    });

    it('asserts candidate count is 2', async () => {
      const result = await verifier.verify();

      const assertion = result.assertions.find(a => a.name === 'candidate_count');
      expect(assertion).toBeDefined();
      expect(assertion?.passed).toBe(true);
    });

    it('asserts name candidates count >= 2', async () => {
      const result = await verifier.verify();

      const assertion = result.assertions.find(a => a.name === 'name_candidates_count');
      expect(assertion).toBeDefined();
      expect(assertion?.passed).toBe(true);
    });

    it('asserts confidence breakdown format', async () => {
      const result = await verifier.verify();

      const assertion = result.assertions.find(a => a.name === 'confidence_breakdown_format');
      expect(assertion).toBeDefined();
      expect(assertion?.passed).toBe(true);
    });
  });

  describe('verifyCrossModuleDetection()', () => {
    it('asserts cross module candidate count is 1', async () => {
      const result = await verifier.verify();

      const assertion = result.assertions.find(a => a.name === 'cross_module_candidate_count');
      expect(assertion).toBeDefined();
      expect(assertion?.passed).toBe(true);
    });

    it('asserts cross module candidate mark is correct', async () => {
      const result = await verifier.verify();

      const assertion = result.assertions.find(a => a.name === 'cross_module_candidate_mark');
      expect(assertion).toBeDefined();
      expect(assertion?.passed).toBe(true);
    });

    it('asserts cross module breakdown value is 0.2', async () => {
      const result = await verifier.verify();

      const assertion = result.assertions.find(a => a.name === 'cross_module_breakdown_value');
      expect(assertion).toBeDefined();
      expect(assertion?.passed).toBe(true);
    });

    it('asserts cross module coverage has at least 2 modules', async () => {
      const result = await verifier.verify();

      const assertion = result.assertions.find(a => a.name === 'cross_module_coverage');
      expect(assertion).toBeDefined();
      expect(assertion?.passed).toBe(true);
    });

    it('asserts edu_course module names include music-course and music-sync', async () => {
      const result = await verifier.verify();

      const assertion = result.assertions.find(a => a.name === 'edu_course_module_names');
      expect(assertion).toBeDefined();
      expect(assertion?.passed).toBe(true);
    });
  });

  describe('createConceptVerifier()', () => {
    it('creates ConceptVerifier instance with default cross module bonus', () => {
      const v = createConceptVerifier('/test/repo', ['module1']);
      expect(v).toBeInstanceOf(ConceptVerifier);
    });

    it('creates ConceptVerifier instance with custom cross module bonus', () => {
      const v = createConceptVerifier('/test/repo', ['module1'], 0.3);
      expect(v).toBeInstanceOf(ConceptVerifier);
    });
  });
});