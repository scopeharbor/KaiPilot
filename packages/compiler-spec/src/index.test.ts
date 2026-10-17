/**
 * @aiproj/compiler-spec 单元测试（tasks 2.7）。
 *
 * 测试覆盖：
 * - 合法 PDM 通过 pdmSchema
 * - 缺必填字段失败
 * - 字段类型错误失败
 * - 同项目同实体名称 ID 稳定
 * - 改名产生新 ID
 * - 仅属性变化保持原 ID
 * - 前后端可从包入口 import 类型/函数
 */

import { describe, expect, it } from 'vitest'
import { ENTITY_ID_PREFIX, generateEntityId, isEntityIdForType, pdmSchema, slug } from './index.js'

describe('entity-id', () => {
  it('slug 化：中文与混合字符', () => {
    expect(slug('项目设计')).toBe('项目设计')
    expect(slug('Hello World')).toBe('hello_world')
    expect(slug('  Test  !!  Value  ')).toBe('test_value')
  })

  it('同项目同名实体 ID 稳定', () => {
    const id1 = generateEntityId('workstream', '需求分析', 'proj-1')
    const id2 = generateEntityId('workstream', '需求分析', 'proj-1')
    expect(id1).toBe(id2)
  })

  it('改名产生新 ID', () => {
    const id1 = generateEntityId('workstream', '需求分析', 'proj-1')
    const id2 = generateEntityId('workstream', '需求收集', 'proj-1')
    expect(id1).not.toBe(id2)
  })

  it('仅属性变化保持原 ID（名称不变）', () => {
    const id1 = generateEntityId('task_l1', '开发任务', 'proj-1')
    const id2 = generateEntityId('task_l1', '开发任务', 'proj-1')
    expect(id1).toBe(id2)
  })

  it('不同项目同名实体 ID 不同', () => {
    const id1 = generateEntityId('milestone', '发布', 'proj-1')
    const id2 = generateEntityId('milestone', '发布', 'proj-2')
    expect(id1).not.toBe(id2)
  })

  it('实体 ID 前缀正确', () => {
    expect(generateEntityId('workstream', 'test', 'p1')).toMatch(/^W/)
    expect(generateEntityId('task_l1', 'test', 'p1')).toMatch(/^T1/)
    expect(generateEntityId('task_l2', 'test', 'p1')).toMatch(/^T2/)
    expect(generateEntityId('milestone', 'test', 'p1')).toMatch(/^M/)
    expect(generateEntityId('risk', 'test', 'p1')).toMatch(/^R/)
    expect(generateEntityId('resource', 'test', 'p1')).toMatch(/^RS/)
    expect(generateEntityId('stakeholder', 'test', 'p1')).toMatch(/^SH/)
  })

  it('isEntityIdForType 判断正确', () => {
    const id = generateEntityId('workstream', '设计', 'proj-1')
    expect(isEntityIdForType(id, 'workstream')).toBe(true)
    expect(isEntityIdForType(id, 'milestone')).toBe(false)
  })

  it('名称超长被截断（前 30 字符）', () => {
    const longName = 'abcdefghijklmnopqrstuvwxyz0123456789' // 36 chars
    const id = generateEntityId('workstream', longName, 'proj-1')
    // prefix(W) + slug(30) + _(1) + hash(8) = 40
    expect(id).toHaveLength(40)
    expect(id.startsWith('Wabcdefghijklmnopqrstuvwxyz0123')).toBe(true)
  })
})

describe('pdm-schema', () => {
  const validPdm = {
    metadata: {
      schemaVersion: '2.0',
      compilerVersion: '0.1.0',
      generatedAt: '2026-07-11T00:00:00.000Z',
      projectId: 'proj-1',
      runId: 1,
    },
    intent: {
      text: '开发一个内部活动报名管理系统',
      detectedLanguage: 'zh-CN',
      receivedAt: '2026-07-11T00:00:00.000Z',
    },
    blueprint: {
      workstreams: [],
      milestones: [],
      risks: [],
      resources: [],
      stakeholders: [],
    },
  }

  it('合法最小 PDM 通过 schema', () => {
    const result = pdmSchema.safeParse(validPdm)
    expect(result.success).toBe(true)
  })

  it('包含完整实体（workstream + tasks）的 PDM 通过 schema', () => {
    const fullPdm = {
      ...validPdm,
      parsedIntent: {
        projectName: '活动报名系统',
        projectType: 'software',
        summary: '内部活动报名管理',
        objectives: ['实现报名', '管理活动'],
        scope: '内部使用',
        constraints: ['两周内交付'],
        stakeholders: ['HR 部门'],
        priority: 'high' as const,
      },
      blueprint: {
        workstreams: [
          {
            id: generateEntityId('workstream', '后端开发', 'proj-1'),
            name: '后端开发',
            workPackages: [
              {
                id: generateEntityId('work_package', 'API', 'proj-1'),
                name: 'API 开发',
                tasks: [
                  {
                    id: generateEntityId('task_l1', '用户模块', 'proj-1'),
                    name: '用户模块',
                    children: [
                      {
                        id: generateEntityId('task_l2', '登录', 'proj-1'),
                        name: '登录功能',
                        estimatedHours: 8,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
        milestones: [
          {
            id: generateEntityId('milestone', '上线', 'proj-1'),
            name: '上线',
            criteria: ['所有功能完成'],
          },
        ],
        risks: [],
        resources: [],
        stakeholders: [],
      },
    }
    const result = pdmSchema.safeParse(fullPdm)
    expect(result.success).toBe(true)
  })

  it('缺 metadata 字段失败', () => {
    const { metadata: _, ...noMetadata } = validPdm as any
    const result = pdmSchema.safeParse(noMetadata)
    expect(result.success).toBe(false)
  })

  it('缺 intent 字段失败', () => {
    const { intent: _, ...noIntent } = validPdm as any
    const result = pdmSchema.safeParse(noIntent)
    expect(result.success).toBe(false)
  })

  it('字段类型错误失败（metadata.runId 应为数字）', () => {
    const result = pdmSchema.safeParse({
      ...validPdm,
      metadata: { ...validPdm.metadata, runId: 'not-a-number' },
    })
    expect(result.success).toBe(false)
  })

  it('intent.text 为空字符串失败', () => {
    const result = pdmSchema.safeParse({
      ...validPdm,
      intent: { ...validPdm.intent, text: '' },
    })
    expect(result.success).toBe(false)
  })

  it('parsedIntent.projectName 为空字符串失败', () => {
    const result = pdmSchema.safeParse({
      ...validPdm,
      parsedIntent: {
        projectName: '',
        projectType: 'software',
        summary: '',
        objectives: [],
        scope: '',
        constraints: [],
        stakeholders: [],
        priority: 'medium',
      },
    })
    expect(result.success).toBe(false)
  })
})

describe('package-exports', () => {
  it('可以从包入口 import StageContract', async () => {
    const { StageContract } = await import('./index.js')
    expect(StageContract).toBeDefined()
  })

  it('可以从包入口 import pdmSchema', async () => {
    const { pdmSchema: schema } = await import('./index.js')
    expect(schema).toBeDefined()
  })

  it('可以从包入口 import entity id 工具', async () => {
    const { generateEntityId: gen, ENTITY_ID_PREFIX: prefix } = await import('./index.js')
    expect(typeof gen).toBe('function')
    expect(prefix.workstream).toBe('W')
  })
})
