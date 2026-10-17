/**
 * v3-copilot-structured-and-diagram-output —— 结构化产出块测试 fixtures。
 *
 * 覆盖五态：表格命中、图命中、守卫拒绝、零可追溯行、截断。
 * 确定性纯数据，零运行时依赖。
 */

import type {
  CopilotStructuredSourceRef,
  CopilotTableBlock,
  CopilotTableColumn,
  CopilotTableRow,
  CopilotListBlock,
  CopilotListItem,
  CopilotDiagramBlock,
  CopilotDiagramNodeRef,
  CopilotGuardConclusion,
  CopilotBlockAbsent,
  CopilotStructuredOutput,
} from './copilot-structured-output.js'

// ---------------------------------------------------------------------------
// 辅助构建器
// ---------------------------------------------------------------------------

export function buildStructuredSourceRef(
  overrides?: Partial<CopilotStructuredSourceRef>,
): CopilotStructuredSourceRef {
  return {
    sourceId: overrides?.sourceId ?? 'task:1001',
    sourceKind: overrides?.sourceKind ?? 'task',
    summary: overrides?.summary ?? '示例来源摘要',
  }
}

export function buildTableColumn(overrides?: Partial<CopilotTableColumn>): CopilotTableColumn {
  return {
    key: overrides?.key ?? 'col1',
    label: overrides?.label ?? '列 1',
    valueType: overrides?.valueType ?? 'text',
  }
}

export function buildTableRow(overrides?: Partial<CopilotTableRow>): CopilotTableRow {
  return {
    values: overrides?.values ?? { col1: '值 1' },
    sourceRefs: overrides?.sourceRefs ?? [buildStructuredSourceRef()],
  }
}

export function buildListItem(overrides?: Partial<CopilotListItem>): CopilotListItem {
  return {
    text: overrides?.text ?? '条目 1',
    depth: overrides?.depth ?? 0,
    sourceRefs: overrides?.sourceRefs ?? [buildStructuredSourceRef()],
  }
}

export function buildDiagramNodeRef(
  overrides?: Partial<CopilotDiagramNodeRef>,
): CopilotDiagramNodeRef {
  return {
    nodeId: overrides?.nodeId ?? 'node1',
    label: overrides?.label ?? '节点 1',
    sourceRefs: overrides?.sourceRefs ?? [buildStructuredSourceRef()],
  }
}

export function buildGuardConclusion(
  overrides?: Partial<CopilotGuardConclusion>,
): CopilotGuardConclusion {
  return {
    passed: overrides?.passed ?? true,
    rejectionReason: overrides?.rejectionReason,
    rejectionCategory: overrides?.rejectionCategory,
  }
}

// ---------------------------------------------------------------------------
// 五态 fixtures
// ---------------------------------------------------------------------------

/**
 * Fix 1：表格命中 — 完整表格，每行有 sourceRef。
 */
export function fixtureTableHit(): CopilotTableBlock {
  return {
    kind: 'table',
    title: '任务对比表',
    columns: [
      buildTableColumn({ key: 'name', label: '任务名', valueType: 'text' }),
      buildTableColumn({ key: 'status', label: '状态', valueType: 'status' }),
      buildTableColumn({ key: 'duration', label: '工期', valueType: 'number' }),
    ],
    rows: [
      buildTableRow({
        values: { name: '设计评审', status: '进行中', duration: 3 },
        sourceRefs: [buildStructuredSourceRef({ sourceId: 'task:1001', summary: '设计评审任务' })],
      }),
      buildTableRow({
        values: { name: '代码实现', status: '未开始', duration: 5 },
        sourceRefs: [buildStructuredSourceRef({ sourceId: 'task:1002', summary: '代码实现任务' })],
      }),
    ],
    omittedRowCount: 0,
  }
}

/**
 * Fix 2：图命中 — 完整图，每节点有 sourceRef，守卫通过。
 */
export function fixtureDiagramHit(): CopilotDiagramBlock {
  return {
    kind: 'diagram',
    title: '任务依赖关系图',
    diagramType: 'dependency_graph',
    mermaidText: 'graph TD\\n    A[设计评审] --> B[代码实现]\\n    B --> C[测试]',
    nodeRefs: [
      buildDiagramNodeRef({
        nodeId: 'A',
        label: '设计评审',
        sourceRefs: [buildStructuredSourceRef({ sourceId: 'task:1001' })],
      }),
      buildDiagramNodeRef({
        nodeId: 'B',
        label: '代码实现',
        sourceRefs: [buildStructuredSourceRef({ sourceId: 'task:1002' })],
      }),
      buildDiagramNodeRef({
        nodeId: 'C',
        label: '测试',
        sourceRefs: [buildStructuredSourceRef({ sourceId: 'task:1003' })],
      }),
    ],
    guardConclusion: buildGuardConclusion({ passed: true }),
    omittedNodeCount: 0,
  }
}

/**
 * Fix 3：守卫拒绝 — 图被守卫拒绝，给出拒绝原因。
 */
export function fixtureGuardRejected(): CopilotDiagramBlock {
  return {
    kind: 'diagram',
    title: '含回调的流程图',
    diagramType: 'flowchart',
    mermaidText: 'graph TD\\n    A[点击我] -->|click| B[执行操作]',
    nodeRefs: [
      buildDiagramNodeRef({ nodeId: 'A', label: '点击我' }),
      buildDiagramNodeRef({ nodeId: 'B', label: '执行操作' }),
    ],
    guardConclusion: buildGuardConclusion({
      passed: false,
      rejectionReason: 'Mermaid 文本包含可执行内容（click callback）',
      rejectionCategory: 'click_callback',
    }),
    omittedNodeCount: 0,
  }
}

/**
 * Fix 4：零可追溯行 — 所有行均无 sourceRef，块缺席。
 */
export function fixtureZeroTraceable(): CopilotBlockAbsent {
  return {
    kind: 'absent',
    blockType: 'table',
    reason: 'no_traceable_content',
    detail: '所有候选行均无法锚定到素材，表格块缺席',
  }
}

/**
 * Fix 5：截断 — 表格超预算，截断后保留部分行。
 */
export function fixtureTruncated(): CopilotTableBlock {
  return {
    kind: 'table',
    title: '大型任务列表',
    columns: [buildTableColumn({ key: 'name', label: '任务名', valueType: 'text' })],
    rows: [
      buildTableRow({
        values: { name: '任务 1' },
        sourceRefs: [buildStructuredSourceRef({ sourceId: 'task:1' })],
      }),
      buildTableRow({
        values: { name: '任务 2' },
        sourceRefs: [buildStructuredSourceRef({ sourceId: 'task:2' })],
      }),
    ],
    omittedRowCount: 98,
  }
}

/**
 * Fix 6：清单命中。
 */
export function fixtureListHit(): CopilotListBlock {
  return {
    kind: 'list',
    title: '风险清单',
    items: [
      buildListItem({
        text: '技术风险：前端渲染性能',
        depth: 0,
        sourceRefs: [buildStructuredSourceRef({ sourceId: 'risk:101' })],
      }),
      buildListItem({
        text: '业务风险：需求变更频繁',
        depth: 0,
        sourceRefs: [buildStructuredSourceRef({ sourceId: 'risk:102' })],
      }),
    ],
    omittedItemCount: 0,
  }
}

/**
 * Fix 7：能力不支持 — 结构化输出块缺席。
 */
export function fixtureCapabilityUnsupported(): CopilotBlockAbsent {
  return {
    kind: 'absent',
    blockType: 'table',
    reason: 'capability_unsupported',
    detail: '当前连接不支持严格 schema 输出，结构化块缺席',
  }
}

/**
 * Fix 8：完整结构化输出集合（含表格 + 图 + 文本结论）。
 */
export function fixtureFullStructuredOutput(): CopilotStructuredOutput {
  return {
    blocks: [fixtureTableHit(), fixtureDiagramHit()],
    textualConclusions: [
      '设计评审任务进行中，预计 3 天完成',
      '代码实现任务未开始，预计 5 天',
      '任务依赖关系：设计评审 → 代码实现 → 测试',
    ],
    estimatedOutputTokens: 450,
  }
}
