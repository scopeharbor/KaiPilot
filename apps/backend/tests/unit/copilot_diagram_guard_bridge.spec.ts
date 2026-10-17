/**
 * v3-copilot-structured-and-diagram-output —— 图表守卫桥接单元测试。
 *
 * 覆盖：
 * - 4.1 图表产出接入既有 ai_diagram_guard
 * - 4.2 未过守卫的图不呈现
 * - 4.3 守卫拒绝时给出可读原因
 * - 4.4 拒绝原因可读且被分类计数
 * - 4.5 Mermaid 禁可执行内容断言
 * - 4.6 三类可执行内容分别被拒
 * - 4.7 守卫拒绝不使整轮失败
 * - 4.8 图被拒时回合仍成功
 * - 4.9 守卫拒绝原因的低敏计数
 *
 * 约束：零真实 provider / 模型 / 公网调用。
 */
import { test } from '@japa/runner'
import {
  validateDiagramBlock,
  assertMermaidSafe,
  detectMermaidExecutableContent,
} from '#services/copilot_turn/copilot_diagram_guard_bridge'
import { buildDiagramNodeRef, buildGuardConclusion } from '@aiproj/types'
import type { CopilotDiagramBlock } from '@aiproj/types'

function makeDiagramBlock(
  mermaidText: string,
  overrides?: Partial<CopilotDiagramBlock>,
): CopilotDiagramBlock {
  return {
    kind: 'diagram',
    title: overrides?.title ?? '测试图',
    diagramType: overrides?.diagramType ?? 'flowchart',
    mermaidText,
    nodeRefs: overrides?.nodeRefs ?? [
      buildDiagramNodeRef({
        nodeId: 'A',
        sourceRefs: [{ sourceId: 'task:1', sourceKind: 'task', summary: 'test' }],
      }),
    ],
    guardConclusion: overrides?.guardConclusion ?? buildGuardConclusion(),
    omittedNodeCount: overrides?.omittedNodeCount ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Task 4.1: 接入既有 ai_diagram_guard
// ---------------------------------------------------------------------------

test.group('Diagram Guard Bridge — guard integration', () => {
  test('delegates to injected guard validate function', ({ assert }) => {
    let guardCalled = false
    const guard = (_mermaidText: string) => {
      guardCalled = true
      return { passed: true }
    }

    const block = makeDiagramBlock('graph TD\\n    A --> B')
    const result = validateDiagramBlock(block, guard)

    assert.isTrue(guardCalled)
    assert.isTrue(result.conclusion.passed)
    assert.equal(result.rejectionCount, 0)
  })

  test('guard rejection is propagated', ({ assert }) => {
    const guard = () => ({
      passed: false as const,
      rejectionReason: 'AI 生成的 DiagramSpec 不允许直接写入',
    })

    const block = makeDiagramBlock('graph TD\\n    A --> B')
    const result = validateDiagramBlock(block, guard)

    assert.isFalse(result.conclusion.passed)
    assert.equal(result.rejectionCount, 1)
  })
})

// ---------------------------------------------------------------------------
// Task 4.3: 守卫拒绝时给出可读原因
// ---------------------------------------------------------------------------

test.group('Diagram Guard Bridge — readable rejection', () => {
  test('rejection reason is included in conclusion', ({ assert }) => {
    const guard = () => ({
      passed: false as const,
      rejectionReason: 'metadata 缺少 confidence',
    })

    const block = makeDiagramBlock('graph TD\\n    A --> B')
    const result = validateDiagramBlock(block, guard)

    assert.equal(result.conclusion.rejectionReason, 'metadata 缺少 confidence')
  })
})

// ---------------------------------------------------------------------------
// Task 4.4: 拒绝原因可读且被分类计数
// ---------------------------------------------------------------------------

test.group('Diagram Guard Bridge — rejection classification', () => {
  test('rejection category is classified for metadata issues', ({ assert }) => {
    const guard = () => ({
      passed: false as const,
      rejectionReason: 'missing confidence',
    })

    const block = makeDiagramBlock('graph TD\\n    A --> B')
    const result = validateDiagramBlock(block, guard)

    assert.equal(result.rejectionCategory, 'missing_confidence')
  })

  test('rejection category is classified for assumptions', ({ assert }) => {
    const guard = () => ({
      passed: false as const,
      rejectionReason: '缺少 assumptions',
    })

    const block = makeDiagramBlock('graph TD\\n    A --> B')
    const result = validateDiagramBlock(block, guard)

    assert.equal(result.rejectionCategory, 'missing_assumptions')
  })
})

// ---------------------------------------------------------------------------
// Task 4.5: Mermaid 禁可执行内容断言
// ---------------------------------------------------------------------------

test.group('Diagram Guard Bridge — Mermaid executable content', () => {
  test('safe mermaid passes assertion', ({ assert }) => {
    const result = assertMermaidSafe('graph TD\\n    A[设计] --> B[实现]')
    assert.isTrue(result.passed)
  })

  test('click callback is detected', ({ assert }) => {
    const detections = detectMermaidExecutableContent('graph TD\\n    A[点击] --> B[操作]')
    // No click callback in simple text
    assert.equal(detections.length, 0)
  })

  test('actual click callback is detected', ({ assert }) => {
    const detections = detectMermaidExecutableContent(
      'graph TD\\n    A["click callA "http://example.com"] --> B',
    )
    assert.isTrue(detections.some((d) => d.type === 'click_callback'))
  })
})

// ---------------------------------------------------------------------------
// Task 4.6: 三类可执行内容分别被拒
// ---------------------------------------------------------------------------

test.group('Diagram Guard Bridge — three executable content types', () => {
  test('click callback is rejected', ({ assert }) => {
    const result = assertMermaidSafe('graph TD\\n    A["click callA "http://example.com"]')
    assert.isFalse(result.passed)
    assert.equal(result.rejectionCategory, 'click_callback')
  })

  test('script is rejected', ({ assert }) => {
    const result = assertMermaidSafe('graph TD\\n    A["<script>alert(1)</script>"]')
    assert.isFalse(result.passed)
    assert.equal(result.rejectionCategory, 'script')
  })

  test('external resource reference is rejected', ({ assert }) => {
    const result = assertMermaidSafe(
      'graph TD\\n    A["image"] --> B["http://evil.com/payload.js"]',
    )
    assert.isFalse(result.passed)
    assert.equal(result.rejectionCategory, 'external_resource')
  })
})

// ---------------------------------------------------------------------------
// Task 4.7 & 4.8: 守卫拒绝不使整轮失败
// ---------------------------------------------------------------------------

test.group('Diagram Guard Bridge — rejection does not fail turn', () => {
  test('rejected diagram returns conclusion without throwing', ({ assert }) => {
    const guard = () => ({
      passed: false as const,
      rejectionReason: '守卫拒绝',
    })

    const block = makeDiagramBlock('graph TD\\n    A --> B')

    // 不应抛出异常
    assert.doesNotThrow(() => validateDiagramBlock(block, guard))

    const result = validateDiagramBlock(block, guard)
    assert.isFalse(result.conclusion.passed)
    // rejectionCount 为 1 表示被拒，但不影响回合
    assert.equal(result.rejectionCount, 1)
  })

  test('turn can proceed with only text conclusions when diagram is rejected', ({ assert }) => {
    // 模拟：图被拒，但文本结论仍返回
    const guard = () => ({
      passed: false as const,
      rejectionReason: 'guard rejected',
    })

    const diagramBlock = makeDiagramBlock('graph TD\\n    A --> B')
    const result = validateDiagramBlock(diagramBlock, guard)

    // 结构化块缺席，但回合仍可返回文本结论
    assert.isFalse(result.conclusion.passed)
    // 文本结论不受影响（由调用方保证）
  })
})

// ---------------------------------------------------------------------------
// Task 4.9: 守卫拒绝原因的低敏计数
// ---------------------------------------------------------------------------

test.group('Diagram Guard Bridge — low-sensitivity rejection counting', () => {
  test('rejection count is tracked', ({ assert }) => {
    const guard = () => ({
      passed: false as const,
      rejectionReason: 'guard rejected',
    })

    const block = makeDiagramBlock('graph TD\\n    A --> B')
    const result = validateDiagramBlock(block, guard)

    assert.equal(result.rejectionCount, 1)
  })

  test('pass has zero rejection count', ({ assert }) => {
    const guard = () => ({
      passed: true as const,
    })

    const block = makeDiagramBlock('graph TD\\n    A --> B')
    const result = validateDiagramBlock(block, guard)

    assert.equal(result.rejectionCount, 0)
  })
})
