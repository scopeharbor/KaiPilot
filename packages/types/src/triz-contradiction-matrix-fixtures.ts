// @aiproj/types — V3 TRIZ 矛盾矩阵审查 UI 测试夹具
// v3-triz-contradiction-matrix-ui / design D1 §2.3
//
// 提供稳定、可复现的矩阵测试数据，覆盖 authorized/hidden/stale/empty/physical/fallback 等状态。

import type {
  ProjectParameterKey,
  ContradictionSeverity,
  InventivePrincipleId,
} from './triz-contradiction.js'
import type {
  MatrixSourceRef,
  MatrixCell,
  MatrixPhysicalTension,
  MatrixWarningSummary,
  MatrixParameterAxis,
  MatrixCatalogMetadata,
  MatrixHandoffInput,
  TrizContradictionMatrix,
  MatrixAvailableAction,
} from './triz-contradiction-matrix.js'
import { computeMatrixCellKey, computeTensionKey } from './triz-contradiction-matrix.js'

// ---------------------------------------------------------------------------
// 通用 fixture 常量
// ---------------------------------------------------------------------------

const FIXTURE_CATALOG_VERSION = 'fixture-1.0.0'
const FIXTURE_ORGANIZATION_ID = 1
const FIXTURE_PROJECT_ID = 100
const FIXTURE_ACTOR_ID = 7

// ---------------------------------------------------------------------------
// Source ref 构建器
// ---------------------------------------------------------------------------

/** 构建已授权的 contradiction source ref */
export function buildAuthorizedContradictionRef(
  overrides: Partial<MatrixSourceRef> = {},
): MatrixSourceRef {
  return {
    sourceType: 'contradiction',
    ref: 'contrad-key-001',
    hash: 'abc123',
    title: '工期 vs 成本技术矛盾',
    severity: 'high',
    stale: false,
    isAiGenerated: false,
    isFallback: false,
    warningCodes: [],
    ...overrides,
  }
}

/** 构建已授权的 triz_analysis source ref */
export function buildAuthorizedAnalysisRef(
  overrides: Partial<MatrixSourceRef> = {},
): MatrixSourceRef {
  return {
    sourceType: 'triz_analysis',
    ref: 'artifact-001',
    hash: 'def456',
    title: 'Compiler 分析结果 #1',
    severity: 'medium',
    stale: false,
    isAiGenerated: true,
    isFallback: false,
    warningCodes: ['NEEDS_HUMAN_REVIEW'],
    ...overrides,
  }
}

/** 构建 hidden source ref（模拟无权限来源） */
export function buildHiddenSourceRef(overrides: Partial<MatrixSourceRef> = {}): MatrixSourceRef {
  return {
    sourceType: 'contradiction',
    ref: 'hidden-ref',
    hash: null,
    title: '[hidden]',
    severity: null,
    stale: false,
    isAiGenerated: false,
    isFallback: false,
    warningCodes: [],
    ...overrides,
  }
}

/** 构建 stale source ref */
export function buildStaleSourceRef(overrides: Partial<MatrixSourceRef> = {}): MatrixSourceRef {
  return {
    sourceType: 'contradiction',
    ref: 'stale-ref-001',
    hash: 'old-hash-xyz',
    title: '资源负载 vs 灵活性（已过期）',
    severity: 'low',
    stale: true,
    isAiGenerated: false,
    isFallback: false,
    warningCodes: ['STALE_SOURCE_CONTRADICTION'],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Warning 摘要构建器
// ---------------------------------------------------------------------------

export function buildEmptyWarningSummary(): MatrixWarningSummary {
  return { total: 0, blocking: 0, warning: 0, info: 0, codes: [] }
}

export function buildWarningSummary(
  overrides: Partial<MatrixWarningSummary> = {},
): MatrixWarningSummary {
  return {
    total: 3,
    blocking: 1,
    warning: 1,
    info: 1,
    codes: ['NEEDS_HUMAN_REVIEW', 'STALE_SOURCE_CONTRADICTION', 'EMPTY_EVIDENCE_CHAIN'],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 参数轴构建器
// ---------------------------------------------------------------------------

export function buildParameterAxis(
  key: ProjectParameterKey,
  direction: 'improving' | 'worsening',
  overrides: Partial<MatrixParameterAxis> = {},
): MatrixParameterAxis {
  const nameMap: Record<string, string> = {
    duration: '工期/进度',
    cost: '成本',
    resource_load: '资源负载',
    quality: '质量',
    scope: '范围',
    risk_level: '风险等级',
    flexibility: '灵活性',
    stability: '稳定性',
    information_completeness: '信息完整度',
    maintainability: '可维护性',
    uncertainty: '不确定性',
    throughput: '吞吐量',
  }
  return {
    parameterKey: key,
    name: nameMap[key] ?? key,
    direction,
    visibleSourceCount: 2,
    hasHiddenSources: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 目录元数据构建器
// ---------------------------------------------------------------------------

export function buildCatalogMetadata(
  overrides: Partial<MatrixCatalogMetadata> = {},
): MatrixCatalogMetadata {
  return {
    version: FIXTURE_CATALOG_VERSION,
    parameters: [
      buildParameterAxis('duration', 'improving'),
      buildParameterAxis('cost', 'improving'),
      buildParameterAxis('duration', 'worsening', { name: '工期/进度' }),
      buildParameterAxis('cost', 'worsening', { name: '成本' }),
    ],
    principleIds: [
      'segmentation',
      'preliminary_action',
      'dynamics',
      'parameter_change',
    ] as InventivePrincipleId[],
    rulesetVersion: '1.0.0',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 矩阵单元构建器
// ---------------------------------------------------------------------------

/** 构建 has_sources 状态的正常单元格 */
export function buildNormalCell(overrides: Partial<MatrixCell> = {}): MatrixCell {
  const improving: ProjectParameterKey = overrides.improvingParameterKey ?? 'duration'
  const worsening: ProjectParameterKey = overrides.worseningParameterKey ?? 'cost'
  return {
    cellKey: computeMatrixCellKey({
      improvingParameterKey: improving,
      worseningParameterKey: worsening,
      catalogVersion: FIXTURE_CATALOG_VERSION,
    }),
    improvingParameterKey: improving,
    worseningParameterKey: worsening,
    state: 'has_sources',
    sourceRefs: [
      buildAuthorizedContradictionRef({ ref: 'contrad-key-001' }),
      buildAuthorizedAnalysisRef({ ref: 'artifact-001' }),
    ],
    totalVisibleSources: 2,
    hasHiddenSources: false,
    candidatePrincipleIds: ['segmentation', 'preliminary_action'] as InventivePrincipleId[],
    severity: 'high' as ContradictionSeverity,
    confidenceRange: { min: 0.65, max: 0.85 },
    warningSummary: buildWarningSummary(),
    isStale: false,
    availableActions: [
      'view_rationale',
      'add_to_workbench',
      'open_draft_review',
      'copy_ref',
    ] as MatrixAvailableAction[],
    ...overrides,
  }
}

/** 构建 empty 单元格 */
export function buildEmptyCell(
  improving: ProjectParameterKey = 'duration',
  worsening: ProjectParameterKey = 'risk_level',
): MatrixCell {
  return {
    cellKey: computeMatrixCellKey({
      improvingParameterKey: improving,
      worseningParameterKey: worsening,
      catalogVersion: FIXTURE_CATALOG_VERSION,
    }),
    improvingParameterKey: improving,
    worseningParameterKey: worsening,
    state: 'empty',
    sourceRefs: [],
    totalVisibleSources: 0,
    hasHiddenSources: false,
    candidatePrincipleIds: [],
    severity: null,
    confidenceRange: null,
    warningSummary: buildEmptyWarningSummary(),
    isStale: false,
    availableActions: [],
  }
}

/** 构建 hidden 单元格 */
export function buildHiddenCell(
  improving: ProjectParameterKey = 'cost',
  worsening: ProjectParameterKey = 'quality',
): MatrixCell {
  return {
    cellKey: computeMatrixCellKey({
      improvingParameterKey: improving,
      worseningParameterKey: worsening,
      catalogVersion: FIXTURE_CATALOG_VERSION,
    }),
    improvingParameterKey: improving,
    worseningParameterKey: worsening,
    state: 'hidden',
    sourceRefs: [],
    totalVisibleSources: 0,
    hasHiddenSources: true,
    candidatePrincipleIds: [],
    severity: null,
    confidenceRange: null,
    warningSummary: buildEmptyWarningSummary(),
    isStale: false,
    availableActions: [],
  }
}

/** 构建 stale 单元格（所有来源均过期） */
export function buildStaleCell(
  improving: ProjectParameterKey = 'scope',
  worsening: ProjectParameterKey = 'cost',
): MatrixCell {
  return {
    cellKey: computeMatrixCellKey({
      improvingParameterKey: improving,
      worseningParameterKey: worsening,
      catalogVersion: FIXTURE_CATALOG_VERSION,
    }),
    improvingParameterKey: improving,
    worseningParameterKey: worsening,
    state: 'stale',
    sourceRefs: [buildStaleSourceRef()],
    totalVisibleSources: 1,
    hasHiddenSources: false,
    candidatePrincipleIds: ['dynamics', 'parameter_change'] as InventivePrincipleId[],
    severity: 'low' as ContradictionSeverity,
    confidenceRange: { min: 0.3, max: 0.5 },
    warningSummary: {
      total: 1,
      blocking: 0,
      warning: 1,
      info: 0,
      codes: ['STALE_SOURCE_CONTRADICTION'],
    },
    isStale: true,
    availableActions: ['view_rationale', 'add_to_workbench', 'copy_ref'] as MatrixAvailableAction[],
  }
}

// ---------------------------------------------------------------------------
// 物理矛盾构建器
// ---------------------------------------------------------------------------

export function buildPhysicalTension(
  overrides: Partial<MatrixPhysicalTension> = {},
): MatrixPhysicalTension {
  const pKey: ProjectParameterKey = overrides.parameterKey ?? 'scope'
  return {
    tensionKey: computeTensionKey({
      parameterKey: pKey,
      catalogVersion: FIXTURE_CATALOG_VERSION,
    }),
    parameterKey: pKey,
    opposingRequirements: '范围既要全面又要快速交付',
    state: 'has_sources',
    sourceRefs: [
      buildAuthorizedContradictionRef({ ref: 'physical-contrad-001', title: '范围物理矛盾' }),
    ],
    candidatePrincipleIds: [
      'segmentation',
      'preliminary_action',
      'dynamics',
    ] as InventivePrincipleId[],
    severity: 'critical' as ContradictionSeverity,
    confidence: 0.78,
    warningSummary: buildWarningSummary(),
    isStale: false,
    availableActions: [
      'view_rationale',
      'add_to_workbench',
      'open_draft_review',
      'copy_ref',
    ] as MatrixAvailableAction[],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 完整矩阵 DTO 构建器
// ---------------------------------------------------------------------------

export function buildMatrixDTO(
  overrides: Partial<TrizContradictionMatrix> = {},
): TrizContradictionMatrix {
  return {
    organizationId: FIXTURE_ORGANIZATION_ID,
    projectId: FIXTURE_PROJECT_ID,
    scope: {
      hasViewPermission: true,
      canAccessWorkbench: true,
      canAccessRationale: true,
    },
    catalog: buildCatalogMetadata(),
    cells: [buildNormalCell(), buildEmptyCell(), buildHiddenCell(), buildStaleCell()],
    physicalTensions: [buildPhysicalTension()],
    warningSummary: buildWarningSummary(),
    filters: {},
    calculatedAt: '2026-07-31T12:00:00.000Z',
    zeroModelCost: true,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Handoff input 构建器
// ---------------------------------------------------------------------------

export function buildMatrixHandoffInput(
  overrides: Partial<MatrixHandoffInput> = {},
): MatrixHandoffInput {
  const cells = overrides.selectedCells ?? [
    computeMatrixCellKey({
      improvingParameterKey: 'duration',
      worseningParameterKey: 'cost',
      catalogVersion: FIXTURE_CATALOG_VERSION,
    }),
  ]
  const tensions = overrides.selectedTensions ?? [
    computeTensionKey({ parameterKey: 'scope', catalogVersion: FIXTURE_CATALOG_VERSION }),
  ]
  const sourceHashes = overrides.sourceHashes ?? ['abc123', 'def456']
  return {
    target: 'workbench',
    organizationId: FIXTURE_ORGANIZATION_ID,
    projectId: FIXTURE_PROJECT_ID,
    actorId: FIXTURE_ACTOR_ID,
    selectedCells: cells,
    selectedTensions: tensions,
    sourceRefs: [buildAuthorizedContradictionRef(), buildAuthorizedAnalysisRef()],
    sourceHashes,
    selectedParameterKeys: ['duration', 'cost', 'scope'] as ProjectParameterKey[],
    selectedPrincipleIds: ['segmentation', 'preliminary_action'] as InventivePrincipleId[],
    warningSummary: buildWarningSummary(),
    idempotencyKey: 'test-idempotency-key-001',
    note: '测试 handoff',
    ...overrides,
  }
}
