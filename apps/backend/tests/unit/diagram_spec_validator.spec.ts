import { test } from '@japa/runner'
import { validateDiagramSpec } from '#services/diagram_spec_validator'
import { createDiagramValidator } from '#validators/diagram'
import { ValidationException } from '#exceptions/api_exception'
import {
  DIAGRAM_TYPES,
  isDiagramType,
  type DiagramSpec,
  type FishboneData,
  type WbsTreeData,
  type GanttData,
  type DiagramMetadata,
} from '@aiproj/types'

function makeMetadata(overrides?: Partial<DiagramMetadata>): DiagramMetadata {
  return {
    generatedBy: 'system',
    generatedAt: '2026-01-01T00:00:00Z',
    sourceProjectId: 1,
    ...overrides,
  }
}

function makeWbsTreeData(): WbsTreeData {
  return {
    nodes: [
      {
        id: 1,
        code: '1',
        name: '根节点',
        parentId: null,
        isLeaf: false,
        depth: 0,
      },
      {
        id: 2,
        code: '1.1',
        name: '子节点',
        parentId: 1,
        isLeaf: true,
        depth: 1,
      },
    ],
  }
}

function makeGanttData(): GanttData {
  return {
    bars: [
      {
        taskId: 1,
        name: '任务 A',
        startDate: '2026-01-01',
        endDate: '2026-01-10',
        progress: 50,
        isCriticalPath: true,
        dependencies: [],
        entityRef: { entityType: 'task', entityId: 1 },
      },
    ],
    milestones: [
      {
        milestoneId: 100,
        name: '里程碑 1',
        date: '2026-01-15',
        entityRef: { entityType: 'milestone', entityId: 100 },
      },
    ],
    timelineStart: '2026-01-01',
    timelineEnd: '2026-02-01',
  }
}

function makeFishboneData(overrides?: Partial<FishboneData>): FishboneData {
  return {
    effect: '项目里程碑交付频繁延期，需定位根因',
    categories: [
      {
        key: 'manpower',
        label: '人员 Manpower',
        causes: [
          { id: 'm-1', label: '关键成员同时投入多个项目' },
          {
            id: 'm-2',
            label: '新人上手周期长',
            children: [{ id: 'm-2-1', label: '缺乏交接文档' }],
          },
        ],
      },
      {
        key: 'method',
        label: '方法 Method',
        causes: [{ id: 'md-1', label: '缺乏交叉审查机制' }],
      },
    ],
    ...overrides,
  }
}

function makeMinimalSpec(overrides?: Partial<DiagramSpec>): DiagramSpec {
  return {
    version: '1.0',
    type: 'wbs_tree',
    title: '测试图表',
    data: makeWbsTreeData(),
    metadata: makeMetadata(),
    exports: { mermaid: { supported: false } },
    ...overrides,
  }
}

test.group('DiagramSpec 校验', () => {
  test('合法最小信封接受', ({ assert }) => {
    const spec = validateDiagramSpec(makeMinimalSpec())
    assert.equal(spec.version, '1.0')
    assert.equal(spec.type, 'wbs_tree')
    assert.equal(spec.title, '测试图表')
  })

  test('缺少 version 字段被拒绝', ({ assert }) => {
    const input = makeMinimalSpec()
    delete (input as unknown as Record<string, unknown>).version
    assert.throws(() => validateDiagramSpec(input), ValidationException, '缺少必填字段: version')
  })

  test('缺少 type 字段被拒绝', ({ assert }) => {
    const input = makeMinimalSpec()
    delete (input as unknown as Record<string, unknown>).type
    assert.throws(() => validateDiagramSpec(input), ValidationException, '缺少必填字段: type')
  })

  test('缺少 title 字段被拒绝', ({ assert }) => {
    const input = makeMinimalSpec()
    delete (input as unknown as Record<string, unknown>).title
    assert.throws(() => validateDiagramSpec(input), ValidationException, '缺少必填字段: title')
  })

  test('缺少 data 字段被拒绝', ({ assert }) => {
    const input = makeMinimalSpec()
    delete (input as unknown as Record<string, unknown>).data
    assert.throws(() => validateDiagramSpec(input), ValidationException, '缺少必填字段: data')
  })

  test('缺少 metadata 字段被拒绝', ({ assert }) => {
    const input = makeMinimalSpec()
    delete (input as unknown as Record<string, unknown>).metadata
    assert.throws(() => validateDiagramSpec(input), ValidationException, '缺少必填字段: metadata')
  })

  test('错误版本被拒绝', ({ assert }) => {
    const input = makeMinimalSpec({ version: '2.0' as any })
    assert.throws(() => validateDiagramSpec(input), ValidationException, '版本必须为 "1.0"')
  })

  test('未知类型被拒绝', ({ assert }) => {
    const input = makeMinimalSpec({ type: 'pie_chart' as any })
    assert.throws(() => validateDiagramSpec(input), ValidationException, '未知图表类型')
  })

  test('AI 生成缺少 confidence 被拒绝', ({ assert }) => {
    const input = makeMinimalSpec({
      metadata: makeMetadata({ generatedBy: 'ai' }),
    })
    delete (input.metadata as unknown as Record<string, unknown>).confidence
    assert.throws(
      () => validateDiagramSpec(input),
      ValidationException,
      '必须包含 metadata.confidence',
    )
  })

  test('AI 生成缺少 assumptions 被拒绝', ({ assert }) => {
    const input = makeMinimalSpec({
      metadata: makeMetadata({
        generatedBy: 'ai',
        confidence: 0.8,
        missingInputs: [],
      }),
    })
    delete (input.metadata as unknown as Record<string, unknown>).assumptions
    assert.throws(
      () => validateDiagramSpec(input),
      ValidationException,
      '必须包含 metadata.assumptions',
    )
  })

  test('AI 生成缺少 missingInputs 被拒绝', ({ assert }) => {
    const input = makeMinimalSpec({
      metadata: makeMetadata({
        generatedBy: 'ai',
        confidence: 0.8,
        assumptions: [],
      }),
    })
    delete (input.metadata as unknown as Record<string, unknown>).missingInputs
    assert.throws(
      () => validateDiagramSpec(input),
      ValidationException,
      '必须包含 metadata.missingInputs',
    )
  })

  test('AI 生成完整元数据通过', ({ assert }) => {
    const input = makeMinimalSpec({
      metadata: makeMetadata({
        generatedBy: 'ai',
        confidence: 0.85,
        assumptions: ['假设工期合理'],
        missingInputs: ['缺少资源信息'],
      }),
    })
    const spec = validateDiagramSpec(input)
    assert.equal(spec.metadata.generatedBy, 'ai')
    assert.equal(spec.metadata.confidence, 0.85)
  })

  test('confidence 超出 0..1 范围被拒绝', ({ assert }) => {
    const input = makeMinimalSpec({
      metadata: makeMetadata({
        generatedBy: 'ai',
        confidence: 1.5,
        assumptions: [],
        missingInputs: [],
      }),
    })
    assert.throws(
      () => validateDiagramSpec(input),
      ValidationException,
      'metadata.confidence 必须在 0..1 范围内',
    )
  })

  test('合法 WBS 树数据接受', ({ assert }) => {
    const spec = validateDiagramSpec(makeMinimalSpec({ type: 'wbs_tree', data: makeWbsTreeData() }))
    assert.equal(spec.type, 'wbs_tree')
    assert.isArray((spec.data as WbsTreeData).nodes)
    assert.lengthOf((spec.data as WbsTreeData).nodes, 2)
  })

  test('合法甘特图数据接受', ({ assert }) => {
    const spec = validateDiagramSpec(makeMinimalSpec({ type: 'gantt', data: makeGanttData() }))
    assert.equal(spec.type, 'gantt')
    const data = spec.data as GanttData
    assert.isArray(data.bars)
    assert.lengthOf(data.bars, 1)
    assert.isArray(data.milestones)
    assert.lengthOf(data.milestones, 1)
  })

  test('非对象输入被拒绝', ({ assert }) => {
    assert.throws(() => validateDiagramSpec('not an object'), ValidationException, '必须是非空对象')
  })

  test('null 输入被拒绝', ({ assert }) => {
    assert.throws(() => validateDiagramSpec(null), ValidationException, '必须是非空对象')
  })

  test('数组输入被拒绝', ({ assert }) => {
    assert.throws(() => validateDiagramSpec([]), ValidationException, '必须是非空对象')
  })
})

test.group('DiagramSpec fishbone（v3-ui-next-chart-gallery 扩充）', () => {
  test('DIAGRAM_TYPES 共享白名单包含 fishbone 且运行时守卫放行', ({ assert }) => {
    assert.isTrue((DIAGRAM_TYPES as readonly string[]).includes('fishbone'))
    assert.isTrue(isDiagramType('fishbone'))
    assert.isFalse(isDiagramType('pie_chart'))
  })

  test('validators/diagram.ts 的 Vine 类型枚举自动跟随共享白名单', async ({ assert }) => {
    const payload = await createDiagramValidator.validate({
      type: 'fishbone',
      title: '交付延期根因分析',
      spec: { version: '1.0', title: 'x' },
    })
    assert.equal(payload.type, 'fishbone')
  })

  test('合法鱼骨数据接受（effect + 6M 大骨 + 递归原因小骨）', ({ assert }) => {
    const spec = validateDiagramSpec(
      makeMinimalSpec({ type: 'fishbone', data: makeFishboneData() }),
    )
    assert.equal(spec.type, 'fishbone')
    const data = spec.data as FishboneData
    assert.equal(data.effect, '项目里程碑交付频繁延期，需定位根因')
    assert.lengthOf(data.categories, 2)
    assert.equal(data.categories[0]?.key, 'manpower')
    assert.lengthOf(data.categories[0]?.causes ?? [], 2)
    // 递归子骨（children）合法
    assert.equal(data.categories[0]?.causes[1]?.children?.[0]?.label, '缺乏交接文档')
  })

  test('缺少 effect 被拒绝', ({ assert }) => {
    const data = makeFishboneData()
    delete (data as unknown as Record<string, unknown>).effect
    assert.throws(
      () => validateDiagramSpec(makeMinimalSpec({ type: 'fishbone', data })),
      ValidationException,
      'fishbone.data.effect 必须是非空字符串',
    )
  })

  test('空白 effect 被拒绝', ({ assert }) => {
    const data = makeFishboneData({ effect: '   ' })
    assert.throws(
      () => validateDiagramSpec(makeMinimalSpec({ type: 'fishbone', data })),
      ValidationException,
      'fishbone.data.effect 必须是非空字符串',
    )
  })

  test('categories 非数组被拒绝', ({ assert }) => {
    const data = makeFishboneData() as unknown as Record<string, unknown>
    data.categories = { manpower: [] }
    assert.throws(
      () =>
        validateDiagramSpec(
          makeMinimalSpec({ type: 'fishbone', data: data as unknown as FishboneData }),
        ),
      ValidationException,
      'fishbone.data.categories 必须是数组',
    )
  })

  test('大骨分类缺少 key/label/causes 被拒绝', ({ assert }) => {
    const missingKey = makeFishboneData()
    delete (missingKey.categories[0] as unknown as Record<string, unknown>).key
    assert.throws(
      () =>
        validateDiagramSpec(
          makeMinimalSpec({ type: 'fishbone', data: missingKey as FishboneData }),
        ),
      ValidationException,
      'data.categories[0].key 必须是非空字符串',
    )

    const missingCauses = makeFishboneData()
    delete (missingCauses.categories[1] as unknown as Record<string, unknown>).causes
    assert.throws(
      () =>
        validateDiagramSpec(
          makeMinimalSpec({ type: 'fishbone', data: missingCauses as FishboneData }),
        ),
      ValidationException,
      'data.categories[1].causes 必须是数组',
    )
  })

  test('原因节点缺少 id/label 被拒绝', ({ assert }) => {
    const noId = makeFishboneData()
    delete (noId.categories[0]?.causes?.[0] as unknown as Record<string, unknown>).id
    assert.throws(
      () => validateDiagramSpec(makeMinimalSpec({ type: 'fishbone', data: noId as FishboneData })),
      ValidationException,
      'data.categories[0].causes[0].id 必须是非空字符串',
    )

    const noLabel = makeFishboneData()
    delete (noLabel.categories[0]?.causes?.[0] as unknown as Record<string, unknown>).label
    assert.throws(
      () =>
        validateDiagramSpec(makeMinimalSpec({ type: 'fishbone', data: noLabel as FishboneData })),
      ValidationException,
      'data.categories[0].causes[0].label 必须是非空字符串',
    )
  })

  test('递归子骨（children）结构与深层路径错误提示', ({ assert }) => {
    const badChild = makeFishboneData()
    delete (
      badChild.categories[0]?.causes?.[1]?.children?.[0] as unknown as Record<string, unknown>
    ).id
    assert.throws(
      () =>
        validateDiagramSpec(makeMinimalSpec({ type: 'fishbone', data: badChild as FishboneData })),
      ValidationException,
      'data.categories[0].causes[1].children[0].id 必须是非空字符串',
    )

    const badChildrenType = makeFishboneData() as unknown as Record<string, unknown>
    const categories = badChildrenType.categories as Array<Record<string, unknown>>
    ;(categories[0]?.causes as Array<Record<string, unknown>>)[1]!.children = 'not-array'
    assert.throws(
      () =>
        validateDiagramSpec(
          makeMinimalSpec({ type: 'fishbone', data: badChildrenType as unknown as FishboneData }),
        ),
      ValidationException,
      'children 必须是数组',
    )
  })

  test('fishbone 与既有四类并列：非法类型仍被拒绝', ({ assert }) => {
    const input = makeMinimalSpec({
      type: 'fishbone',
      data: makeFishboneData(),
    }) as unknown as Record<string, unknown>
    input.type = 'fish_bone_snake'
    assert.throws(() => validateDiagramSpec(input), ValidationException, '未知图表类型')
  })
})
