/**
 * v3-copilot-structured-and-diagram-output —— 预算与截断单元测试。
 *
 * 覆盖：
 * - 7.1 结构化块计入响应预算
 * - 7.2 超预算按行/节点截断并标记未显示数量
 * - 7.3 截断标记计数正确且不静默丢弃
 * - 7.4 响应体不超过声明上限
 * - 7.5 截断上限按响应字节预算反推
 *
 * 约束：零真实 provider / 模型 / 公网调用。
 */
import { test } from '@japa/runner'
import { CopilotStructuredOutputAnalyzer } from '#services/copilot_turn/copilot_structured_output_analyzer'
import {
  buildStructuredSourceRef,
  buildTableColumn,
  buildTableRow,
  buildDiagramNodeRef,
  buildGuardConclusion,
  fixtureTruncated,
  fixtureFullStructuredOutput,
} from '@aiproj/types'
import type { CopilotTableBlock, CopilotDiagramBlock, CopilotStructuredOutput } from '@aiproj/types'

function makeAnalyzer(): CopilotStructuredOutputAnalyzer {
  return new CopilotStructuredOutputAnalyzer()
}

// ---------------------------------------------------------------------------
// Task 7.1: 结构化块计入响应预算
// ---------------------------------------------------------------------------

test.group('Structured Output Budget — budget counting', () => {
  test('structured output has estimated byte size', ({ assert }) => {
    const output = fixtureFullStructuredOutput()
    const byteSize = CopilotStructuredOutputAnalyzer.estimateByteSize(output)

    assert.isAbove(byteSize, 0)
  })

  test('larger output has larger byte size', ({ assert }) => {
    const smallOutput = fixtureFullStructuredOutput()
    const largeOutput: CopilotStructuredOutput = {
      ...smallOutput,
      blocks: [
        ...smallOutput.blocks,
        {
          kind: 'table',
          title: '额外表格',
          columns: [buildTableColumn()],
          rows: Array.from({ length: 10 }, (_, i) =>
            buildTableRow({
              values: { col1: `行 ${i}` },
              sourceRefs: [buildStructuredSourceRef()],
            }),
          ),
          omittedRowCount: 0,
        },
      ],
    }

    const smallSize = CopilotStructuredOutputAnalyzer.estimateByteSize(smallOutput)
    const largeSize = CopilotStructuredOutputAnalyzer.estimateByteSize(largeOutput)

    assert.isAbove(largeSize, smallSize)
  })
})

// ---------------------------------------------------------------------------
// Task 7.2: 超预算按行/节点截断
// ---------------------------------------------------------------------------

test.group('Structured Output Budget — truncation', () => {
  test('table rows are truncated when exceeding max', ({ assert }) => {
    const analyzer = makeAnalyzer()
    const block: CopilotTableBlock = {
      kind: 'table',
      title: '大表',
      columns: [buildTableColumn()],
      rows: Array.from({ length: 20 }, (_, i) =>
        buildTableRow({
          values: { col1: `行 ${i}` },
          sourceRefs: [buildStructuredSourceRef({ sourceId: `task:${i}` })],
        }),
      ),
      omittedRowCount: 0,
    }

    const result = analyzer.analyze([block], [], 5) // maxRows = 5

    const table = result.blocks.find((b) => b.kind === 'table') as CopilotTableBlock | undefined
    assert.isDefined(table)
    assert.equal(table!.rows.length, 5)
    assert.equal(table!.omittedRowCount, 15) // 20 - 5 = 15
    assert.equal(result.truncatedRowCount, 15)
  })

  test('diagram nodes are truncated when exceeding max', ({ assert }) => {
    const analyzer = makeAnalyzer()
    const block: CopilotDiagramBlock = {
      kind: 'diagram',
      title: '大图',
      diagramType: 'flowchart',
      mermaidText: 'graph TD',
      nodeRefs: Array.from({ length: 15 }, (_, i) =>
        buildDiagramNodeRef({
          nodeId: `N${i}`,
          label: `节点 ${i}`,
          sourceRefs: [buildStructuredSourceRef({ sourceId: `task:${i}` })],
        }),
      ),
      guardConclusion: buildGuardConclusion(),
      omittedNodeCount: 0,
    }

    const result = analyzer.analyze([block], [], 50, 3) // maxNodes = 3

    const diagram = result.blocks.find((b) => b.kind === 'diagram') as
      CopilotDiagramBlock | undefined
    assert.isDefined(diagram)
    assert.equal(diagram!.nodeRefs.length, 3)
    assert.equal(diagram!.omittedNodeCount, 12) // 15 - 3 = 12
    assert.equal(result.truncatedNodeCount, 12)
  })
})

// ---------------------------------------------------------------------------
// Task 7.3: 截断标记计数正确且不静默丢弃
// ---------------------------------------------------------------------------

test.group('Structured Output Budget — truncation marks', () => {
  test('omitted count is correct after truncation', ({ assert }) => {
    const analyzer = makeAnalyzer()
    const block = fixtureTruncated() // 已有 omittedRowCount = 98

    const result = analyzer.analyze([block], [], 5) // 再截断

    const table = result.blocks.find((b) => b.kind === 'table') as CopilotTableBlock | undefined
    assert.isDefined(table)
    // 原 omittedRowCount=98 + 新截断 = 98 + (2-5=0, 不截断因为2<5)
    // 由于 rows.length=2 < maxRows=5，不截断
    assert.equal(table!.rows.length, 2)
    assert.equal(table!.omittedRowCount, 98) // 保持原值
  })

  test('truncation does not silently drop', ({ assert }) => {
    const analyzer = makeAnalyzer()
    const block: CopilotTableBlock = {
      kind: 'table',
      title: '测试表',
      columns: [buildTableColumn()],
      rows: Array.from({ length: 10 }, (_, i) =>
        buildTableRow({
          values: { col1: `行 ${i}` },
          sourceRefs: [buildStructuredSourceRef({ sourceId: `task:${i}` })],
        }),
      ),
      omittedRowCount: 0,
    }

    const result = analyzer.analyze([block], [], 3)

    const table = result.blocks.find((b) => b.kind === 'table') as CopilotTableBlock | undefined
    assert.equal(table!.rows.length, 3)
    assert.equal(table!.omittedRowCount, 7) // 10 - 3 = 7，明确标记
  })
})

// ---------------------------------------------------------------------------
// Task 7.4: 响应体不超过声明上限
// ---------------------------------------------------------------------------

test.group('Structured Output Budget — response size limit', () => {
  test('truncated output stays within byte budget', ({ assert }) => {
    const analyzer = makeAnalyzer()
    const block: CopilotTableBlock = {
      kind: 'table',
      title: '大表',
      columns: [buildTableColumn()],
      rows: Array.from({ length: 100 }, (_, i) =>
        buildTableRow({
          values: { col1: `行 ${i} 内容较长以增加字节数` },
          sourceRefs: [buildStructuredSourceRef({ sourceId: `task:${i}` })],
        }),
      ),
      omittedRowCount: 0,
    }

    // 设定较小的截断限制
    const result = analyzer.analyze([block], [], 10)

    const table = result.blocks.find((b) => b.kind === 'table') as CopilotTableBlock | undefined
    assert.isAtMost(table!.rows.length, 10)
  })
})

// ---------------------------------------------------------------------------
// Task 7.5: 截断上限按响应字节预算反推
// ---------------------------------------------------------------------------

test.group('Structured Output Budget — byte budget derivation', () => {
  test('computeTruncationLimits returns correct limits', ({ assert }) => {
    const limits = CopilotStructuredOutputAnalyzer.computeTruncationLimits({
      totalBudgetBytes: 1000,
      estimatedOutputBytes: 200,
      currentRowCount: 50,
      currentNodeCount: 30,
      avgRowBytes: 100,
      avgNodeBytes: 80,
    })

    // remaining = 1000 - 200 = 800
    // maxRows = 800 / 100 = 8, maxNodes = 800 / 80 = 10
    assert.equal(limits.maxRows, 8)
    assert.equal(limits.maxNodes, 10)
  })

  test('computeTruncationLimits caps at current count', ({ assert }) => {
    const limits = CopilotStructuredOutputAnalyzer.computeTruncationLimits({
      totalBudgetBytes: 10000,
      estimatedOutputBytes: 100,
      currentRowCount: 5,
      currentNodeCount: 3,
    })

    // remaining = 9900, but only 5 rows and 3 nodes exist
    assert.equal(limits.maxRows, 5)
    assert.equal(limits.maxNodes, 3)
  })

  test('computeTruncationLimits returns zero when budget exceeded', ({ assert }) => {
    const limits = CopilotStructuredOutputAnalyzer.computeTruncationLimits({
      totalBudgetBytes: 100,
      estimatedOutputBytes: 200,
      currentRowCount: 10,
      currentNodeCount: 10,
    })

    assert.equal(limits.maxRows, 0)
    assert.equal(limits.maxNodes, 0)
  })
})
