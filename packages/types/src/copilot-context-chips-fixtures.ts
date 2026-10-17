/**
 * v3-copilot-context-chips-fixtures —— 芯片描述符 fixtures。
 *
 * 覆盖八态：项目页、任务页、报表页、通用 scope、权限缺失、未启用、授权门、溢出。
 * 用于契约测试与组件测试。
 */

import type {
  ChipDescriptor,
  ChipVisibleBound,
  ChipExposureRecord,
  ChipClickRecord,
} from './copilot-context-chips.js'

// ===========================================================================
// 辅助函数
// ===========================================================================

function makeChip(
  overrides: Partial<ChipDescriptor> & { id: string; label: string },
): ChipDescriptor {
  const relevanceTier = overrides.relevanceTier ?? 'high'
  const impactSeverity = overrides.impactSeverity ?? 50
  return {
    sourceKind: 'registered-command',
    clickSemantics: 'direct-execution',
    relevanceTier,
    impactSeverity,
    availabilityKind: 'available',
    destination: 'unknown',
    requiredPermissions: [],
    sortKey: {
      relevanceTier,
      impactSeverity,
      stableTieBreak: overrides.id,
    },
    ...overrides,
  }
}

// ===========================================================================
// Fixture 1: 项目页（三个芯片）
// ===========================================================================

export const projectPageChips: readonly ChipDescriptor[] = [
  makeChip({
    id: 'ctx.project.new-task',
    label: '新建任务',
    sourceKind: 'registered-command',
    clickSemantics: 'direct-execution',
    relevanceTier: 'critical',
    impactSeverity: 80,
    destination: 'task-create',
    requiredPermissions: ['task:create'],
  }),
  makeChip({
    id: 'intent.decompose-task',
    label: '拆解当前任务',
    sourceKind: 'intent-catalog',
    clickSemantics: 'populate-composer',
    relevanceTier: 'high',
    impactSeverity: 70,
    destination: 'task-decompose',
    requiredPermissions: ['task:read', 'ai:trigger'],
  }),
  makeChip({
    id: 'intent.adjust-schedule',
    label: '调整排期',
    sourceKind: 'intent-catalog',
    clickSemantics: 'populate-composer',
    relevanceTier: 'medium',
    impactSeverity: 60,
    destination: 'schedule-adjust',
    requiredPermissions: ['project:write', 'ai:trigger'],
  }),
]

export const projectPageBound: ChipVisibleBound = {
  maxVisible: 6,
  visibleCount: 3,
  omittedCount: 0,
}

// ===========================================================================
// Fixture 2: 任务页（三个芯片，含实体引用）
// ===========================================================================

export const taskPageChips: readonly ChipDescriptor[] = [
  makeChip({
    id: 'intent.generate-subtasks',
    label: '生成子任务',
    sourceKind: 'intent-catalog',
    clickSemantics: 'populate-composer',
    relevanceTier: 'critical',
    impactSeverity: 80,
    destination: 'task-subtasks',
    requiredPermissions: ['task:read', 'ai:trigger'],
    entityRef: {
      kind: 'task',
      id: 123,
      name: '实现登录功能',
      scope: 'project',
    },
  }),
  makeChip({
    id: 'intent.estimate-effort',
    label: '估算工时',
    sourceKind: 'intent-catalog',
    clickSemantics: 'populate-composer',
    relevanceTier: 'high',
    impactSeverity: 70,
    destination: 'effort-estimate',
    requiredPermissions: ['task:read', 'ai:trigger'],
  }),
  makeChip({
    id: 'intent.find-similar',
    label: '查找相似任务',
    sourceKind: 'intent-catalog',
    clickSemantics: 'populate-composer',
    relevanceTier: 'medium',
    impactSeverity: 60,
    destination: 'task-search',
    requiredPermissions: ['task:read', 'search:read'],
  }),
]

export const taskPageBound: ChipVisibleBound = {
  maxVisible: 6,
  visibleCount: 3,
  omittedCount: 0,
}

// ===========================================================================
// Fixture 3: 报表页（三个芯片）
// ===========================================================================

export const reportPageChips: readonly ChipDescriptor[] = [
  makeChip({
    id: 'intent.generate-weekly-report',
    label: '生成周报',
    sourceKind: 'intent-catalog',
    clickSemantics: 'populate-composer',
    relevanceTier: 'critical',
    impactSeverity: 80,
    destination: 'report-weekly',
    requiredPermissions: ['project:read', 'ai:trigger'],
  }),
  makeChip({
    id: 'intent.analyze-bottleneck',
    label: '分析瓶颈',
    sourceKind: 'intent-catalog',
    clickSemantics: 'populate-composer',
    relevanceTier: 'high',
    impactSeverity: 70,
    destination: 'analysis-bottleneck',
    requiredPermissions: ['project:read', 'ai:trigger'],
  }),
  makeChip({
    id: 'intent.predict-progress',
    label: '预测进度',
    sourceKind: 'intent-catalog',
    clickSemantics: 'populate-composer',
    relevanceTier: 'medium',
    impactSeverity: 60,
    destination: 'prediction-progress',
    requiredPermissions: ['project:read', 'ai:trigger'],
  }),
]

export const reportPageBound: ChipVisibleBound = {
  maxVisible: 6,
  visibleCount: 3,
  omittedCount: 0,
}

// ===========================================================================
// Fixture 4: 通用 scope（两个芯片，无项目作用域）
// ===========================================================================

export const globalScopeChips: readonly ChipDescriptor[] = [
  makeChip({
    id: 'intent.create-project',
    label: '创建新项目',
    sourceKind: 'intent-catalog',
    clickSemantics: 'populate-composer',
    relevanceTier: 'high',
    impactSeverity: 70,
    destination: 'project-create',
    requiredPermissions: ['project:create'],
  }),
  makeChip({
    id: 'intent.search-project',
    label: '查找项目',
    sourceKind: 'intent-catalog',
    clickSemantics: 'populate-composer',
    relevanceTier: 'medium',
    impactSeverity: 60,
    destination: 'project-search',
    requiredPermissions: ['project:read'],
  }),
]

export const globalScopeBound: ChipVisibleBound = {
  maxVisible: 6,
  visibleCount: 2,
  omittedCount: 0,
}

// ===========================================================================
// Fixture 5: 权限缺失（一个芯片被过滤，只保留通用提示）
// ===========================================================================

export const permissionMissingChips: readonly ChipDescriptor[] = [
  makeChip({
    id: 'intent.create-project',
    label: '创建新项目',
    sourceKind: 'intent-catalog',
    clickSemantics: 'populate-composer',
    relevanceTier: 'high',
    impactSeverity: 70,
    destination: 'project-create',
    requiredPermissions: ['project:create'],
    availabilityKind: 'not-permitted',
    // 无权限芯片应缺席，但 fixtures 中保留用于测试过滤逻辑
  }),
  makeChip({
    id: 'intent.search-project',
    label: '查找项目',
    sourceKind: 'intent-catalog',
    clickSemantics: 'populate-composer',
    relevanceTier: 'medium',
    impactSeverity: 60,
    destination: 'project-search',
    requiredPermissions: ['project:read'],
  }),
]

export const permissionMissingBound: ChipVisibleBound = {
  maxVisible: 6,
  visibleCount: 1,
  omittedCount: 0,
}

// ===========================================================================
// Fixture 6: 未启用（一个芯片可见但不可用）
// ===========================================================================

export const notEnabledChips: readonly ChipDescriptor[] = [
  makeChip({
    id: 'intent.generate-ai-report',
    label: 'AI 生成报表',
    sourceKind: 'intent-catalog',
    clickSemantics: 'populate-composer',
    relevanceTier: 'high',
    impactSeverity: 70,
    destination: 'report-ai-generate',
    requiredPermissions: ['project:read', 'ai:trigger'],
    availabilityKind: 'not-enabled',
    hint: '该能力未启用，可在设置中开启',
  }),
  makeChip({
    id: 'intent.search-project',
    label: '查找项目',
    sourceKind: 'intent-catalog',
    clickSemantics: 'populate-composer',
    relevanceTier: 'medium',
    impactSeverity: 60,
    destination: 'project-search',
    requiredPermissions: ['project:read'],
  }),
]

export const notEnabledBound: ChipVisibleBound = {
  maxVisible: 6,
  visibleCount: 2,
  omittedCount: 0,
}

// ===========================================================================
// Fixture 7: 授权门（一个芯片可见但不可用，点击不发外部请求）
// ===========================================================================

export const authorizationGatedChips: readonly ChipDescriptor[] = [
  makeChip({
    id: 'intent.external-integration',
    label: '外部系统集成',
    sourceKind: 'intent-catalog',
    clickSemantics: 'populate-composer',
    relevanceTier: 'high',
    impactSeverity: 70,
    destination: 'external-integration',
    requiredPermissions: ['integration:use'],
    availabilityKind: 'authorization-gated',
    hint: '需要用户授权后才能使用该能力',
  }),
  makeChip({
    id: 'intent.search-project',
    label: '查找项目',
    sourceKind: 'intent-catalog',
    clickSemantics: 'populate-composer',
    relevanceTier: 'medium',
    impactSeverity: 60,
    destination: 'project-search',
    requiredPermissions: ['project:read'],
  }),
]

export const authorizationGatedBound: ChipVisibleBound = {
  maxVisible: 6,
  visibleCount: 2,
  omittedCount: 0,
}

// ===========================================================================
// Fixture 8: 溢出（超过上界，省略计数准确）
// ===========================================================================

export const overflowChips: readonly ChipDescriptor[] = [
  makeChip({
    id: 'chip-1',
    label: '芯片 1',
    relevanceTier: 'critical',
    impactSeverity: 90,
    destination: 'dest-1',
  }),
  makeChip({
    id: 'chip-2',
    label: '芯片 2',
    relevanceTier: 'critical',
    impactSeverity: 85,
    destination: 'dest-2',
  }),
  makeChip({
    id: 'chip-3',
    label: '芯片 3',
    relevanceTier: 'high',
    impactSeverity: 80,
    destination: 'dest-3',
  }),
  makeChip({
    id: 'chip-4',
    label: '芯片 4',
    relevanceTier: 'high',
    impactSeverity: 75,
    destination: 'dest-4',
  }),
  makeChip({
    id: 'chip-5',
    label: '芯片 5',
    relevanceTier: 'high',
    impactSeverity: 70,
    destination: 'dest-5',
  }),
  makeChip({
    id: 'chip-6',
    label: '芯片 6',
    relevanceTier: 'medium',
    impactSeverity: 65,
    destination: 'dest-6',
  }),
  makeChip({
    id: 'chip-7',
    label: '芯片 7',
    relevanceTier: 'medium',
    impactSeverity: 60,
    destination: 'dest-7',
  }),
  makeChip({
    id: 'chip-8',
    label: '芯片 8',
    relevanceTier: 'low',
    impactSeverity: 55,
    destination: 'dest-8',
  }),
]

export const overflowBound: ChipVisibleBound = {
  maxVisible: 6,
  visibleCount: 6,
  omittedCount: 2,
}

// ===========================================================================
// Fixture 9: 曝光与点击记录示例
// ===========================================================================

export const sampleExposureRecord: ChipExposureRecord = {
  chipId: 'ctx.project.new-task',
  sourceKind: 'registered-command',
  ordinal: 0,
  clicked: false,
}

export const sampleClickRecord: ChipClickRecord = {
  chipId: 'ctx.project.new-task',
  sourceKind: 'registered-command',
  ordinal: 0,
  clicked: true,
}

export const sampleUnavailableExposureRecord: ChipExposureRecord = {
  chipId: 'intent.external-integration',
  sourceKind: 'intent-catalog',
  ordinal: 0,
  clicked: false,
  unavailabilityKind: 'authorization-gated',
}
