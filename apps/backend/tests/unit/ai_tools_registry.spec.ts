/**
 * v3-ai-tools-orchestration-layer —— AiToolsRegistry 单元测试（tasks W1 1.2）。
 *
 * 覆盖：契约注册、重复注册抛错、按名检索、未注册抛 404 RESOURCE_NOT_FOUND、
 * 元数据列表纯净性（无 handler 泄漏、冻结不可变）与 RL-14 防动态覆盖守卫。
 * 纯构造注入，零数据库。
 */
import { describe, expect, it } from 'vitest'
import {
  ResourceNotFoundException,
  ValidationException,
} from '../../app/exceptions/api_exception.js'
import {
  AiToolsRegistry,
  AiToolsRegistrySealedError,
  type ToolDefinition,
} from '../../app/services/ai_tools/registry.js'
import type User from '../../app/models/user.js'

const DUMMY_USER = { id: 1, isSuperAdmin: false } as User

function makeTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: 'get_project_summary',
    description: '获取项目核心摘要',
    parametersJsonSchema: {
      type: 'object',
      properties: { projectId: { type: 'integer', minimum: 1 } },
      required: ['projectId'],
      additionalProperties: false,
    },
    requiredPermissions: ['project:view'],
    sideEffect: 'read',
    handler: async () => ({ status: 'SUCCESS', data: { ok: true } }),
    ...overrides,
  }
}

describe('AiToolsRegistry', () => {
  it('register + getOrFail：注册后可按名检索到完整定义', () => {
    const registry = new AiToolsRegistry()
    const tool = makeTool()
    registry.register([tool])
    const found = registry.getOrFail(tool.name)
    expect(found.name).toBe('get_project_summary')
    expect(found.sideEffect).toBe('read')
    expect(found.requiredPermissions).toEqual(['project:view'])
    expect(typeof found.handler).toBe('function')
  })

  it('重复注册同名工具抛 ValidationException', () => {
    const registry = new AiToolsRegistry()
    registry.register([makeTool()])
    expect(() => registry.register([makeTool()])).toThrow(ValidationException)
  })

  it('非法工具名（非 snake_case / 超长 / 空串）注册被拒', () => {
    const registry = new AiToolsRegistry()
    expect(() => registry.register([makeTool({ name: 'BadName' })])).toThrow(ValidationException)
    expect(() => registry.register([makeTool({ name: 'bad name' })])).toThrow(ValidationException)
    expect(() => registry.register([makeTool({ name: 'a'.repeat(65) })])).toThrow(
      ValidationException,
    )
  })

  it('缺少必填契约字段（description/schema/权限合法性/sideEffect/handler）注册被拒', () => {
    const registry = new AiToolsRegistry()
    expect(() => registry.register([makeTool({ description: '' })])).toThrow(ValidationException)
    expect(() =>
      registry.register([makeTool({ parametersJsonSchema: undefined as never })]),
    ).toThrow(ValidationException)
    expect(() =>
      registry.register([makeTool({ requiredPermissions: [123 as unknown as string] })]),
    ).toThrow(ValidationException)
    expect(() => registry.register([makeTool({ sideEffect: 'delete' as never })])).toThrow(
      ValidationException,
    )
    expect(() => registry.register([makeTool({ handler: undefined as never })])).toThrow(
      ValidationException,
    )
  })

  it('空权限清单允许注册（纯 ai:trigger 门禁工具，如测试探针）', () => {
    const registry = new AiToolsRegistry()
    const tool = makeTool({ requiredPermissions: [] })
    registry.register([tool])
    expect(registry.getOrFail(tool.name).requiredPermissions).toEqual([])
  })

  it('未注册工具 getOrFail 抛 404 ResourceNotFoundException（RESOURCE_NOT_FOUND）', () => {
    const registry = new AiToolsRegistry()
    try {
      registry.getOrFail('not_registered_tool')
      expect.unreachable('应当抛出 ResourceNotFoundException')
    } catch (error) {
      expect(error).toBeInstanceOf(ResourceNotFoundException)
      expect((error as ResourceNotFoundException).code).toBe('RESOURCE_NOT_FOUND')
      expect((error as ResourceNotFoundException).status).toBe(404)
    }
  })

  it('getAllMetadata：只暴露契约字段，绝不泄漏 handler 实现', () => {
    const registry = new AiToolsRegistry()
    const tool = makeTool({ name: 'list_project_tasks', requiredPermissions: ['task:view'] })
    registry.register([tool])
    const metadata = registry.getAllMetadata()
    expect(metadata).toHaveLength(1)
    const descriptor = metadata[0] as Record<string, unknown>
    expect(descriptor['name']).toBe('list_project_tasks')
    expect(descriptor['description']).toBeDefined()
    expect(descriptor['parameters']).toEqual(tool.parametersJsonSchema)
    expect(descriptor['parametersJsonSchema']).toEqual(tool.parametersJsonSchema)
    expect(descriptor['requiredPermissions']).toEqual(['task:view'])
    expect(descriptor['sideEffect']).toBe('read')
    expect(descriptor['handler']).toBeUndefined()
    // 冻结：外部无法改写元数据描述符
    expect(Object.isFrozen(metadata)).toBe(true)
    expect(Object.isFrozen(descriptor)).toBe(true)
  })

  it('RL-14：seal 后禁止任何 register（运行时动态注入被拒绝）', () => {
    const registry = new AiToolsRegistry()
    registry.register([makeTool()])
    registry.seal()
    expect(registry.isSealed()).toBe(true)
    expect(() => registry.register([makeTool({ name: 'another_tool' })])).toThrow(
      AiToolsRegistrySealedError,
    )
    // seal 不影响已注册工具的检索
    expect(registry.getOrFail('get_project_summary').name).toBe('get_project_summary')
  })

  it('RL-14：注册即冻结定义，运行时无法通过 getOrFail 篡改 handler', () => {
    const registry = new AiToolsRegistry()
    registry.register([makeTool()])
    const found = registry.getOrFail('get_project_summary')
    // 已注册定义被深冻结（含 schema 与权限数组）
    expect(Object.isFrozen(found)).toBe(true)
    expect(Object.isFrozen(found.parametersJsonSchema)).toBe(true)
    expect(Object.isFrozen(found.requiredPermissions)).toBe(true)
    expect(() => {
      ;(found as { sideEffect: string }).sideEffect = 'write'
    }).toThrow(TypeError)
  })

  it('单例 getInstance 返回同一实例且初始为空目录', () => {
    const a = AiToolsRegistry.getInstance()
    const b = AiToolsRegistry.getInstance()
    expect(a).toBe(b)
    expect(a.getAllMetadata()).toEqual([])
  })
})

describe('ToolExecutionContext 与 契约类型（编译期形状）', () => {
  it('handler 可通过 ctx 获得注入的组织隔离上下文', async () => {
    const registry = new AiToolsRegistry()
    const tool = makeTool({
      name: 'ctx_probe',
      handler: async (ctx) => {
        expect(ctx.organizationId).toBe(42)
        expect(ctx.requestId).toBe('req-1')
        expect(ctx.user.id).toBe(DUMMY_USER.id)
        return { status: 'SUCCESS', data: { seenOrg: ctx.organizationId } }
      },
    })
    registry.register([tool])
    const result = await tool.handler(
      { user: DUMMY_USER, organizationId: 42, requestId: 'req-1' },
      { projectId: 7 },
    )
    expect(result.status).toBe('SUCCESS')
    expect(result.data).toEqual({ seenOrg: 42 })
  })
})
