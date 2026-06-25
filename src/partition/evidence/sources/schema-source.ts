import type { EvidenceAtom } from "../types.js";
import type {
  SchemaTableEdge,
  SchemaTableNode,
} from "../../../partitioning/types.js";
import type {
  EvidenceSource,
  EvidenceSourceCollectionResult,
} from "./types.js";
import type { EvidenceCollectionContext } from "../types.js";
import type { DomainClusterInput } from "../../../partitioning/types.js";

export class SchemaSource implements EvidenceSource {
  readonly sourceName = "schema";
  readonly sourceKind = "schema" as const;

  async collect(
    clusterInput: DomainClusterInput,
    _context: EvidenceCollectionContext,
  ): Promise<EvidenceSourceCollectionResult> {
    const atoms: EvidenceAtom[] = [];

    for (const table of clusterInput.schemaRelationGraph.tables) {
      atoms.push(buildTableShapeAtom(table));
    }

    for (const relation of clusterInput.schemaRelationGraph.relations) {
      const atom = buildRelationAtom(relation);
      if (atom) {
        atoms.push(atom);
      }
    }

    return {
      sourceName: this.sourceName,
      sourceKind: this.sourceKind,
      atoms,
      metadata: {
        tableCount: clusterInput.schemaRelationGraph.tables.length,
        relationCount: clusterInput.schemaRelationGraph.relations.length,
      },
    };
  }
}

export function createSchemaSource(): SchemaSource {
  return new SchemaSource();
}

function buildTableShapeAtom(table: SchemaTableNode): EvidenceAtom {
  return {
    id: `schema-table-shape:${table.tableName}`,
    atomKind: "schema-table-shape",
    sourceKind: "schema",
    summary: `表 ${table.tableName} 的结构类型为 ${table.tableKind}`,
    subjects: [
      {
        kind: "table",
        id: table.tableName,
        name: table.tableName,
      },
    ],
    attributes: {
      normalizedName: table.normalizedName,
      tableKind: table.tableKind,
      nameTokens: table.nameTokens,
    },
    confidence: 0.85,
    locations: [],
    tags: ["schema-shape"],
  };
}

function buildRelationAtom(
  relation: SchemaTableEdge,
): EvidenceAtom | undefined {
  const atomKind = mapRelationTypeToAtomKind(relation.relationType);
  if (!atomKind) {
    return undefined;
  }

  return {
    id: `${atomKind}:${relation.sourceTable}:${relation.targetTable}:${relation.relationType}`,
    atomKind,
    sourceKind: "schema",
    summary: `表 ${relation.sourceTable} 与 ${relation.targetTable} 存在 ${relation.relationType} 关系`,
    subjects: [
      {
        kind: "table",
        id: relation.sourceTable,
        name: relation.sourceTable,
      },
      {
        kind: "table",
        id: relation.targetTable,
        name: relation.targetTable,
      },
    ],
    attributes: {
      relationType: relation.relationType,
      strength: relation.strength,
      direction: relation.direction,
      evidence: relation.evidence,
    },
    confidence: mapStrengthToConfidence(relation.strength),
    locations: [],
    tags: ["schema-relation"],
  };
}

function mapRelationTypeToAtomKind(
  relationType: SchemaTableEdge["relationType"],
): EvidenceAtom["atomKind"] | undefined {
  if (relationType === "explicit_fk") {
    return "schema-explicit-fk";
  }
  if (relationType === "implicit_fk") {
    return "schema-implicit-fk";
  }
  return undefined;
}

function mapStrengthToConfidence(
  strength: SchemaTableEdge["strength"],
): number {
  if (strength === "strong") {
    return 0.95;
  }
  if (strength === "medium") {
    return 0.75;
  }
  return 0.55;
}
