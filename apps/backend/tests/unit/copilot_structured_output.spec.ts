/**
 * v3-copilot-structured-and-diagram-output —— 结构化产出块单元测试。
 *
 * 覆盖：
 * - 2.6 禁存负例测试（敏感样本不出现在块字段）
 * - 2.8 五态 fixtures 覆盖
 * - 2.9 barrel 导出无撞名
 *
 * 约束：零真实 provider / 模型 / 公网调用。
 */
import { test } from '@japa/runner'
import {
  buildStructuredSourceRef,
  buildTableColumn,
  buildTableRow,
  buildDiagramNodeRef,
  buildGuardConclusion,
  fixtureTableHit,
  fixtureDiagramHit,
  fixtureGuardRejected,
  fixtureZeroTraceable,
  fixtureTruncated,
  fixtureListHit,
  fixtureCapabilityUnsupported,
  fixtureFullStructuredOutput,
} from '@aiproj/types'
import { containsForbiddenStructuredOutput } from '@aiproj/types'
import type { CopilotTableBlock, CopilotDiagramBlock, CopilotListBlock } from '@aiproj/types'
import {
  COPILOT_BLOCK_ABSENT_REASONS,
  COPILOT_GUARD_REJECTION_CATEGORIES,
  COPILOT_DIAGRAM_TYPES,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// Task 2.6: 禁存负例测试
// ---------------------------------------------------------------------------

test.group('Structured Output — forbidden payload', () => {
  test('table block must not contain prompt', ({ assert }) => {
    const block: CopilotTableBlock = {
      kind: 'table',
      title: 'Test',
      columns: [buildTableColumn()],
      rows: [
        {
          values: { col1: 'prompt: "system instructions"' },
          sourceRefs: [buildStructuredSourceRef()],
        },
      ],
      omittedRowCount: 0,
    }
    assert.isTrue(containsForbiddenStructuredOutput(block))
  })

  test('table block must not contain model output', ({ assert }) => {
    const block: CopilotTableBlock = {
      kind: 'table',
      title: 'Test',
      columns: [buildTableColumn()],
      rows: [
        {
          values: { col1: '模型输出全文内容' },
          sourceRefs: [buildStructuredSourceRef()],
        },
      ],
      omittedRowCount: 0,
    }
    // modelOutput is in COPILOT_TURN_FORBIDDEN_KEYS
    assert.isTrue(containsForbiddenStructuredOutput(block, ['模型输出全文内容']))
  })

  test('diagram block must not contain token', ({ assert }) => {
    const block: CopilotDiagramBlock = {
      kind: 'diagram',
      title: 'Test',
      diagramType: 'flowchart',
      mermaidText: 'graph TD\\n    A[token: sk-1234]',
      nodeRefs: [buildDiagramNodeRef()],
      guardConclusion: buildGuardConclusion(),
      omittedNodeCount: 0,
    }
    assert.isTrue(containsForbiddenStructuredOutput(block))
  })

  test('list block must not contain secret', ({ assert }) => {
    const block: CopilotListBlock = {
      kind: 'list',
      title: 'Test',
      items: [
        {
          text: 'secret: my-password',
          depth: 0,
          sourceRefs: [buildStructuredSourceRef()],
        },
      ],
      omittedItemCount: 0,
    }
    assert.isTrue(containsForbiddenStructuredOutput(block))
  })

  test('clean block must pass forbidden check', ({ assert }) => {
    const output = fixtureFullStructuredOutput()
    assert.isFalse(containsForbiddenStructuredOutput(output))
  })
})

// ---------------------------------------------------------------------------
// Task 2.8: 五态 fixtures 覆盖
// ---------------------------------------------------------------------------

test.group('Structured Output — fixtures five states', () => {
  test('fixtureTableHit returns a valid table block', ({ assert }) => {
    const block = fixtureTableHit()
    assert.equal(block.kind, 'table')
    assert.equal(block.title, '任务对比表')
    assert.equal(block.columns.length, 3)
    assert.equal(block.rows.length, 2)
    assert.equal(block.omittedRowCount, 0)
    // 每行有 sourceRef
    for (const row of block.rows) {
      assert.isAtLeast(row.sourceRefs.length, 1)
    }
  })

  test('fixtureDiagramHit returns a valid diagram block', ({ assert }) => {
    const block = fixtureDiagramHit()
    assert.equal(block.kind, 'diagram')
    assert.equal(block.diagramType, 'dependency_graph')
    assert.isTrue(block.guardConclusion.passed)
    assert.equal(block.nodeRefs.length, 3)
    // 每节点有 sourceRef
    for (const node of block.nodeRefs) {
      assert.isAtLeast(node.sourceRefs.length, 1)
    }
  })

  test('fixtureGuardRejected returns a rejected diagram block', ({ assert }) => {
    const block = fixtureGuardRejected()
    assert.equal(block.kind, 'diagram')
    assert.isFalse(block.guardConclusion.passed)
    assert.isTrue(block.guardConclusion.rejectionReason!.includes('click callback'))
    assert.equal(block.guardConclusion.rejectionCategory, 'click_callback')
  })

  test('fixtureZeroTraceable returns an absent block', ({ assert }) => {
    const block = fixtureZeroTraceable()
    assert.equal(block.kind, 'absent')
    assert.equal(block.blockType, 'table')
    assert.equal(block.reason, 'no_traceable_content')
  })

  test('fixtureTruncated returns a table with omitted count', ({ assert }) => {
    const block = fixtureTruncated()
    assert.equal(block.kind, 'table')
    assert.equal(block.rows.length, 2)
    assert.equal(block.omittedRowCount, 98)
  })

  test('fixtureListHit returns a valid list block', ({ assert }) => {
    const block = fixtureListHit()
    assert.equal(block.kind, 'list')
    assert.equal(block.items.length, 2)
    assert.equal(block.omittedItemCount, 0)
    for (const item of block.items) {
      assert.isAtLeast(item.sourceRefs.length, 1)
    }
  })

  test('fixtureCapabilityUnsupported returns an absent block', ({ assert }) => {
    const block = fixtureCapabilityUnsupported()
    assert.equal(block.kind, 'absent')
    assert.equal(block.reason, 'capability_unsupported')
  })

  test('fixtureFullStructuredOutput contains blocks and text conclusions', ({ assert }) => {
    const output = fixtureFullStructuredOutput()
    assert.equal(output.blocks.length, 2)
    assert.equal(output.textualConclusions.length, 3)
    assert.isAbove(output.estimatedOutputTokens, 0)
  })
})

// ---------------------------------------------------------------------------
// Task 2.9: barrel 导出无撞名
// ---------------------------------------------------------------------------

test.group('Structured Output — barrel exports', () => {
  test('COPILOT_BLOCK_ABSENT_REASONS is exported and non-empty', ({ assert }) => {
    assert.isAtLeast(COPILOT_BLOCK_ABSENT_REASONS.length, 1)
  })

  test('COPILOT_GUARD_REJECTION_CATEGORIES is exported and non-empty', ({ assert }) => {
    assert.isAtLeast(COPILOT_GUARD_REJECTION_CATEGORIES.length, 1)
  })

  test('COPILOT_DIAGRAM_TYPES is exported and non-empty', ({ assert }) => {
    assert.isAtLeast(COPILOT_DIAGRAM_TYPES.length, 1)
  })

  test('fixture builders are exported and callable', ({ assert }) => {
    assert.equal(typeof buildStructuredSourceRef, 'function')
    assert.equal(typeof buildTableColumn, 'function')
    assert.equal(typeof buildTableRow, 'function')
    assert.equal(typeof buildDiagramNodeRef, 'function')
    assert.equal(typeof buildGuardConclusion, 'function')
  })
})
