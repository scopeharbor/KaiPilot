/**
 * diagram-spec-fixtures —— DiagramSpec 共享测试夹具（§4.2 P1）。
 *
 * 提供当前版本、旧版本以及含未知可选字段的 fixture，
 * 用于前端/后端/编译器端测试一致性。
 *
 * 所有 fixture 使用 DIAGRAM_SPEC_VERSION = '1.0' 作为 currentVersion。
 * 由于 V1 DiagramSpec 无旧版本（v1.0 为首版），oldVersion fixture
 * 模拟在引入 "1.0" 前可能的内部格式。
 */
import type { DiagramSpec, DiagramSpecVersion, DiagramMetadata } from './diagram-spec.js'

// ─── 版本常量 ──────────────────────────────────────────

/** 当前 DiagramSpec contractVersion（同 DIAGRAM_SPEC_VERSION = '1.0'）。 */
export const DIAGRAM_FIXTURE_CURRENT_VERSION: DiagramSpecVersion = '1.0'

// ─── 辅助函数 ──────────────────────────────────────────

function createMetadata(overrides?: Partial<DiagramMetadata>): DiagramMetadata {
  return {
    generatedBy: 'system',
    generatedAt: '2026-07-17T00:00:00.000Z',
    sourceProjectId: 1,
    sourceDataHash: 'abc123',
    sourceDataTimestamp: '2026-07-17T00:00:00.000Z',
    ...overrides,
  }
}

// ─── 1. 当前版本 fixture（DiagramSpec v1.0）───────────

/** 当前版本 WBS Tree DiagramSpec fixture。 */
export const CURRENT_WBS_TREE_SPEC: DiagramSpec = {
  version: '1.0',
  type: 'wbs_tree',
  title: '项目 WBS',
  data: {
    nodes: [
      { id: 1, code: '1', name: '项目启动', parentId: null, isLeaf: false, depth: 0 },
      { id: 2, code: '1.1', name: '需求分析', parentId: 1, isLeaf: true, depth: 1 },
    ],
  },
  metadata: createMetadata(),
  exports: { mermaid: { supported: true, limitations: [] } },
}

/** 当前版本甘特图 DiagramSpec fixture。 */
export const CURRENT_GANTT_SPEC: DiagramSpec = {
  version: '1.0',
  type: 'gantt',
  title: '项目排期',
  data: {
    bars: [
      {
        taskId: 1,
        name: '需求分析',
        startDate: '2026-01-01',
        endDate: '2026-01-15',
        progress: 100,
        isCriticalPath: true,
        dependencies: [],
        entityRef: { entityType: 'task', entityId: 1 },
      },
    ],
    milestones: [],
    timelineStart: '2026-01-01',
    timelineEnd: '2026-03-31',
  },
  metadata: createMetadata(),
  exports: { mermaid: { supported: true, limitations: [] } },
}

/** 当前版本依赖图 DiagramSpec fixture。 */
export const CURRENT_DEPENDENCY_GRAPH_SPEC: DiagramSpec = {
  version: '1.0',
  type: 'dependency_graph',
  title: '依赖关系',
  data: {
    nodes: [{ taskId: 1, name: '需求分析', entityRef: { entityType: 'task', entityId: 1 } }],
    edges: [{ fromTaskId: 1, toTaskId: 2, type: 'FS' }],
  },
  metadata: createMetadata(),
  exports: { mermaid: { supported: true, limitations: ['不支持条件边'] } },
}

/** 当前版本关键路径 DiagramSpec fixture。 */
export const CURRENT_CRITICAL_PATH_SPEC: DiagramSpec = {
  version: '1.0',
  type: 'critical_path',
  title: '关键路径',
  data: {
    nodes: [
      {
        taskId: 1,
        name: '任务 A',
        earliestStart: '2026-01-01',
        earliestFinish: '2026-01-10',
        latestStart: '2026-01-01',
        latestFinish: '2026-01-10',
        totalFloat: 0,
        entityRef: { entityType: 'task', entityId: 1 },
      },
    ],
    path: [1],
  },
  metadata: createMetadata(),
  exports: { mermaid: { supported: false, limitations: ['关键路径暂不支持 Mermaid 导出'] } },
}

// ─── 2. 旧版本 fixture（模拟 pre-1.0 格式）───────────

/** 旧版本 WBS Tree（0.9 风格：无 exports 字段，metadata 结构不同）。 */
export const OLD_WBS_TREE_SPEC: Record<string, unknown> = {
  version: '0.9',
  type: 'wbs_tree',
  title: 'Project WBS',
  data: {
    nodes: [{ id: 1, code: '1', name: 'Kickoff', parentId: null, isLeaf: false, depth: 0 }],
  },
  metadata: {
    generatedBy: 'system',
    generatedAt: '2026-06-01T00:00:00.000Z',
    sourceProjectId: 1,
  },
  // 无 exports 字段
}

// ─── 3. 含未知可选字段的 fixture ──────────────────────

/** 未知可选字段 WBS Tree（额外字段应该被安全忽略）。 */
export const UNKNOWN_FIELD_WBS_TREE_SPEC: Record<string, unknown> = {
  version: '1.0',
  type: 'wbs_tree',
  title: 'WBS with extras',
  data: {
    nodes: [
      {
        id: 1,
        code: '1',
        name: 'Root',
        parentId: null,
        isLeaf: true,
        depth: 0,
        extraMeta: 'should be stripped',
      },
    ],
  },
  metadata: createMetadata(),
  exports: { mermaid: { supported: true } },
  // 顶层未知字段
  customTheme: 'dark',
  tags: ['v1', 'test'],
}

// ─── 4. 不支持 major 的 fixture ──────────────────────

/** 不支持 major 版本（future major = 2.0）。 */
export const UNSUPPORTED_MAJOR_WBS_SPEC: Record<string, unknown> = {
  version: '2.0',
  type: 'wbs_tree',
  title: 'Future WBS',
  data: { nodes: [] },
  metadata: createMetadata(),
  exports: { mermaid: { supported: true } },
}

// ─── 5. 所有 fixture 集合 ─────────────────────────────

export const ALL_DIAGRAM_CURRENT_FIXTURES: readonly DiagramSpec[] = [
  CURRENT_WBS_TREE_SPEC,
  CURRENT_GANTT_SPEC,
  CURRENT_DEPENDENCY_GRAPH_SPEC,
  CURRENT_CRITICAL_PATH_SPEC,
] as const

export const ALL_DIAGRAM_OLD_FIXTURES: readonly Record<string, unknown>[] = [
  OLD_WBS_TREE_SPEC,
] as const

export const ALL_DIAGRAM_UNKNOWN_FIELD_FIXTURES: readonly Record<string, unknown>[] = [
  UNKNOWN_FIELD_WBS_TREE_SPEC,
] as const

export const ALL_DIAGRAM_UNSUPPORTED_FIXTURES: readonly Record<string, unknown>[] = [
  UNSUPPORTED_MAJOR_WBS_SPEC,
] as const
