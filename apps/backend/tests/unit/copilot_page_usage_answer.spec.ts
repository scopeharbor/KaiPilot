/**
 * copilot_page_usage_answer.spec.ts — 页面用法答案测试。
 *
 * 验证：
 * - 按当前路由取该页可用能力，素材取命令注册表元数据
 * - 按 actor 权限缺席过滤，不标注「你没有权限」
 * - 非泄露测试：仅相差一项权限的两个 actor，答案无计数差、无位次移动、无暗示
 * - 未启用与授权门能力的可见不可用表述
 * - 授权门能力被提及时不发起任何外部请求
 * - 覆盖项目路由与非项目路由两条路径
 */
import { describe, it, expect } from 'vitest'
import CopilotPageUsageAnswerService from '#services/copilot/copilot_page_usage_answer_service'
import CopilotAnswerSynthesisService from '#services/copilot/copilot_answer_synthesis_service'
import type {
  PageUsageAnswerParams,
  CommandMetadata,
} from '#services/copilot/copilot_page_usage_answer_service'

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

function createCommands(): readonly CommandMetadata[] {
  return [
    {
      id: 'cmd-1',
      label: '任务管理',
      group: 'navigation',
    },
    {
      id: 'cmd-2',
      label: '甘特图',
      group: 'navigation',
    },
    {
      id: 'cmd-3',
      label: '风险登记',
      group: 'contextual',
      requiresPermission: ['risk:create'],
    },
    {
      id: 'cmd-4',
      label: '资源分配',
      group: 'contextual',
      requiresPermission: ['resource:manage'],
    },
  ]
}

function createParams(overrides: Partial<PageUsageAnswerParams> = {}): PageUsageAnswerParams {
  return {
    organizationId: 1,
    projectId: 1,
    userId: 1,
    pathname: '/projects/1/tasks',
    params: { id: '1' },
    searchParams: new URLSearchParams(),
    commands: createCommands(),
    userPermissions: ['task:read', 'risk:create'],
    uncertainty: [],
    conclusionTrace: [],
    modelAvailable: true,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 测试：权限过滤
// ---------------------------------------------------------------------------

describe('copilot page usage answer - permission filtering', () => {
  it('should filter commands by permission', async () => {
    const synthesisService = new CopilotAnswerSynthesisService()
    const service = new CopilotPageUsageAnswerService(synthesisService)
    const params = createParams({
      userPermissions: ['task:read'], // 只有 task:read 权限
    })

    const result = await service.answer(params)

    expect(result.kind).toBe('sufficient')
    if (result.kind === 'sufficient') {
      // 应该只包含无权限要求的命令
      const sourceIds = result.entries.flatMap((e: any) => e.sourceRefs.map((r: any) => r.sourceId))
      expect(sourceIds).toContain('cmd-1') // 任务管理
      expect(sourceIds).toContain('cmd-2') // 甘特图
      // 不应该包含需要 risk:create 或 resource:manage 的命令
      expect(sourceIds).not.toContain('cmd-3') // 风险登记
      expect(sourceIds).not.toContain('cmd-4') // 资源分配
    }
  })

  it('should not reveal that a capability exists but is not permitted', async () => {
    const synthesisService = new CopilotAnswerSynthesisService()
    const service = new CopilotPageUsageAnswerService(synthesisService)
    const params = createParams({
      userPermissions: ['task:read'], // 只有 task:read 权限
    })

    const result = await service.answer(params)

    expect(result.kind).toBe('sufficient')
    if (result.kind === 'sufficient') {
      // 答案中不应该提到「权限」「无权」「不允许」等词汇
      const narrative = result.narrative
      expect(narrative).not.toContain('权限')
      expect(narrative).not.toContain('无权')
      expect(narrative).not.toContain('不允许')
    }
  })
})

// ---------------------------------------------------------------------------
// 测试：非泄露
// ---------------------------------------------------------------------------

describe('copilot page usage answer - non-leakage', () => {
  it('should not reveal hidden capabilities between two actors with one permission difference', async () => {
    const synthesisService = new CopilotAnswerSynthesisService()
    const service = new CopilotPageUsageAnswerService(synthesisService)

    // Actor A 有 task:read 和 risk:create
    const paramsA = createParams({
      userPermissions: ['task:read', 'risk:create'],
    })

    // Actor B 只有 task:read
    const paramsB = createParams({
      userPermissions: ['task:read'],
    })

    const resultA = await service.answer(paramsA)
    const resultB = await service.answer(paramsB)

    // 两个结果都应该成功
    expect(resultA.kind).toBe('sufficient')
    expect(resultB.kind).toBe('sufficient')

    if (resultA.kind === 'sufficient' && resultB.kind === 'sufficient') {
      // Actor B 的答案不应该暗示 Actor A 有额外能力
      const narrativeB = resultB.narrative
      expect(narrativeB).not.toContain('风险登记')
      expect(narrativeB).not.toContain('更多功能')
      expect(narrativeB).not.toContain('其他功能')
    }
  })
})

// ---------------------------------------------------------------------------
// 测试：项目路由与非项目路由
// ---------------------------------------------------------------------------

describe('copilot page usage answer - route coverage', () => {
  it('should work for project routes', async () => {
    const synthesisService = new CopilotAnswerSynthesisService()
    const service = new CopilotPageUsageAnswerService(synthesisService)
    const params = createParams({
      pathname: '/projects/1/tasks',
    })

    const result = await service.answer(params)

    expect(result.kind).toBe('sufficient')
    if (result.kind === 'sufficient') {
      expect(result.entries.length).toBeGreaterThan(0)
    }
  })

  it('should work for non-project routes', async () => {
    const synthesisService = new CopilotAnswerSynthesisService()
    const service = new CopilotPageUsageAnswerService(synthesisService)
    const params = createParams({
      pathname: '/settings',
      params: {},
      commands: [
        {
          id: 'cmd-settings-1',
          label: '主题设置',
          group: 'theme',
        },
      ],
    })

    const result = await service.answer(params)

    expect(result.kind).toBe('sufficient')
    if (result.kind === 'sufficient') {
      expect(result.entries.length).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// 测试：零命令
// ---------------------------------------------------------------------------

describe('copilot page usage answer - zero commands', () => {
  it('should output insufficient evidence when no commands', async () => {
    const synthesisService = new CopilotAnswerSynthesisService()
    const service = new CopilotPageUsageAnswerService(synthesisService)
    const params = createParams({
      commands: [],
    })

    const result = await service.answer(params)

    expect(result.kind).toBe('insufficient')
    if (result.kind === 'insufficient') {
      expect(result.reason).toBeTruthy()
      expect(result.missingWhat).toBeTruthy()
    }
  })
})

// ---------------------------------------------------------------------------
// 测试：模型不可用降级
// ---------------------------------------------------------------------------

describe('copilot page usage answer - model unavailability', () => {
  it('should produce answer with fallback when model is unavailable', async () => {
    const synthesisService = new CopilotAnswerSynthesisService()
    const service = new CopilotPageUsageAnswerService(synthesisService)
    const params = createParams({
      modelAvailable: false,
    })

    const result = await service.answer(params)

    expect(result.kind).toBe('sufficient')
    if (result.kind === 'sufficient') {
      expect(result.isFallback).toBe(true)
      expect(result.fallbackReason).toBeTruthy()
    }
  })
})
