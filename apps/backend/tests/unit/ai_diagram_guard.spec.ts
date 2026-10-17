import { test } from '@japa/runner'
import AiDiagramGuard from '#services/ai_diagram_guard'
import AuditService from '#services/audit_service'
import { ValidationException } from '#exceptions/api_exception'
import type { DiagramSpec } from '@aiproj/types'

function makeAiSpec(overrides?: Partial<DiagramSpec>): DiagramSpec {
  return {
    version: '1.0',
    type: 'wbs_tree',
    title: 'AI 生成图表',
    data: { nodes: [] },
    metadata: {
      generatedBy: 'ai',
      generatedAt: '2026-01-01T00:00:00Z',
      sourceProjectId: 1,
      confidence: 0.8,
      assumptions: ['假设工期合理'],
      missingInputs: ['缺少资源信息'],
      sourceDraftId: 'draft-123',
    },
    exports: { mermaid: { supported: false } },
    ...overrides,
  }
}

function makeSystemSpec(): DiagramSpec {
  return {
    version: '1.0',
    type: 'wbs_tree',
    title: '系统生成图表',
    data: { nodes: [] },
    metadata: {
      generatedBy: 'system',
      generatedAt: '2026-01-01T00:00:00Z',
      sourceProjectId: 1,
    },
    exports: { mermaid: { supported: false } },
  }
}

test.group('AiDiagramGuard', () => {
  const guard = new AiDiagramGuard(new AuditService())

  test('AI DiagramSpec 直接写入被拒绝', ({ assert }) => {
    const spec = makeAiSpec()
    assert.throws(
      () => guard.assertNotDirectAiWrite(spec),
      ValidationException,
      'AI 生成的 DiagramSpec 不允许直接写入',
    )
  })

  test('系统生成的 DiagramSpec 允许写入', ({ assert }) => {
    const spec = makeSystemSpec()
    assert.doesNotThrow(() => guard.assertNotDirectAiWrite(spec))
  })

  test('用户生成的 DiagramSpec 允许写入', ({ assert }) => {
    const spec: DiagramSpec = {
      version: '1.0',
      type: 'wbs_tree',
      title: '用户图表',
      data: { nodes: [] },
      metadata: {
        generatedBy: 'user',
        generatedAt: '2026-01-01T00:00:00Z',
        sourceProjectId: 1,
      },
      exports: { mermaid: { supported: false } },
    }
    assert.doesNotThrow(() => guard.assertNotDirectAiWrite(spec))
  })

  test('confirmAndPersist 验证 AI metadata 完整性', async ({ assert }) => {
    const spec = makeAiSpec({
      metadata: {
        generatedBy: 'ai',
        generatedAt: '2026-01-01T00:00:00Z',
        sourceProjectId: 1,
        // 缺少 confidence
        assumptions: [],
        missingInputs: [],
      },
    })

    try {
      await guard.confirmAndPersist(spec, 1, 1, 1)
      assert.fail('应抛出 ValidationException')
    } catch (err) {
      assert.isTrue(err instanceof ValidationException)
    }
  })

  test('confirmAndPersist 系统图表直接通过', async ({ assert }) => {
    const spec = makeSystemSpec()
    const result = await guard.confirmAndPersist(spec, 1, 1, 1)
    assert.equal(result.metadata.generatedBy, 'system')
  })

  test('setDraftMetadata 设置草案来源', ({ assert }) => {
    const spec = makeSystemSpec()
    const result = guard.setDraftMetadata(spec, 'draft-456', 2)

    assert.equal(result.metadata.generatedBy, 'ai')
    assert.equal(result.metadata.sourceDraftId, 'draft-456')
    assert.equal(result.metadata.sourceDraftVersion, 2)
  })
})
