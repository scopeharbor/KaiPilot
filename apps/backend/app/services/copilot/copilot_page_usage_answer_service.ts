/**
 * CopilotPageUsageAnswerService —— 页面用法答案合成服务。
 *
 * v3-copilot-project-health-answer / Phase 5
 *
 * 页面用法答案按当前路由 + actor 权限过滤：
 * - 不得提及该 actor 无权访问的能力，缺席而非标注「你没有权限」
 * - 未启用与授权门能力的可见不可用表述，沿用既有三类枚举
 * - 覆盖非项目路由（设置页等），按同一规则处理
 *
 * 红线：
 * - 按权限缺席过滤，不标注「你没有权限」
 * - 授权门能力被提及时不发起任何外部请求
 *
 * @aiproj/backend
 */
import { inject } from '@adonisjs/core'
import type {
  CopilotAnswerOutput,
  CopilotAnswerSufficient,
  CopilotAnswerInsufficient,
  CopilotAnswerEntry,
  CopilotUncertaintyEntry,
  CopilotConclusionTraceEntry,
} from '@aiproj/types'
import CopilotAnswerSynthesisService from './copilot_answer_synthesis_service.js'
import type { SynthesisMaterialEntry } from './copilot_answer_synthesis_service.js'

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 命令元数据（来自前端 command-registry）。 */
export interface CommandMetadata {
  /** 命令 ID。 */
  readonly id: string
  /** 命令标签（中文）。 */
  readonly label: string
  /** 命令分组。 */
  readonly group: string
  /** 需要的权限（可选）。 */
  readonly requiresPermission?: readonly string[]
  /** 上下文可见条件（可选）。 */
  readonly when?: (ctx: CommandContext) => boolean
  /** 快捷键提示（可选）。 */
  readonly shortcut?: string
}

/** 命令上下文。 */
export interface CommandContext {
  /** 当前路由路径。 */
  readonly pathname: string
  /** 路由参数。 */
  readonly params: Record<string, string | string[]>
  /** 搜索参数。 */
  readonly searchParams: URLSearchParams
}

/** 页面用法答案请求参数。 */
export interface PageUsageAnswerParams {
  /** 组织 ID。 */
  readonly organizationId: number
  /** 项目 ID。 */
  readonly projectId: number
  /** 用户 ID。 */
  readonly userId: number
  /** 当前路由路径。 */
  readonly pathname: string
  /** 路由参数。 */
  readonly params: Record<string, string | string[]>
  /** 搜索参数。 */
  readonly searchParams: URLSearchParams
  /** 当前路由可用的命令元数据列表。 */
  readonly commands: readonly CommandMetadata[]
  /** 用户拥有的权限列表。 */
  readonly userPermissions: readonly string[]
  /** 不确定三分条目（来自上下文装配）。 */
  readonly uncertainty: readonly CopilotUncertaintyEntry[]
  /** 结论回溯条目（来自上下文装配）。 */
  readonly conclusionTrace: readonly CopilotConclusionTraceEntry[]
  /** 模型是否可用。 */
  readonly modelAvailable: boolean
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@inject()
export default class CopilotPageUsageAnswerService {
  constructor(private synthesisService: CopilotAnswerSynthesisService) {}

  // -----------------------------------------------------------------------
  // 主入口
  // -----------------------------------------------------------------------

  /**
   * 合成页面用法答案。
   *
   * @param params 页面用法答案请求参数
   * @returns 页面用法答案输出
   */
  async answer(params: PageUsageAnswerParams): Promise<CopilotAnswerOutput> {
    // Step 1: 按权限过滤命令
    const filteredCommands = this.filterCommandsByPermission(
      params.commands,
      params.userPermissions,
    )

    // Step 2: 从命令元数据提取素材
    const materials = this.extractMaterials(filteredCommands, params)

    // Step 3: 如果素材为空，返回「暂无足够依据」
    if (materials.length === 0) {
      return this.buildInsufficientResult(params)
    }

    // Step 4: 使用合成服务生成答案
    const synthesisResult = this.synthesisService.synthesize(
      'page-usage',
      materials,
      params.uncertainty,
      params.conclusionTrace,
      params.modelAvailable,
    )

    // Step 5: 构建最终答案
    if (synthesisResult.entries.length === 0) {
      return this.buildInsufficientResult(params)
    }

    // Step 6: 生成叙述文本
    const narrative = this.generateNarrative(synthesisResult.entries)

    // Step 7: 构建充足答案
    const answer: CopilotAnswerSufficient = {
      kind: 'sufficient',
      answerKind: 'page-usage',
      entries: synthesisResult.entries,
      narrative,
      isFallback: synthesisResult.isFallback,
      fallbackReason: synthesisResult.fallbackReason,
    }

    return answer
  }

  // -----------------------------------------------------------------------
  // 权限过滤
  // -----------------------------------------------------------------------

  /**
   * 按权限过滤命令：缺席而非标注「你没有权限」。
   */
  private filterCommandsByPermission(
    commands: readonly CommandMetadata[],
    userPermissions: readonly string[],
  ): readonly CommandMetadata[] {
    return commands.filter((cmd) => {
      // 如果命令没有权限要求，任何用户可见
      if (!cmd.requiresPermission || cmd.requiresPermission.length === 0) {
        return true
      }

      // 检查用户是否拥有所需权限（任一命中即可）
      return cmd.requiresPermission.some((perm) => userPermissions.includes(perm))
    })
  }

  // -----------------------------------------------------------------------
  // 素材提取
  // -----------------------------------------------------------------------

  /**
   * 从命令元数据提取素材。
   */
  private extractMaterials(
    commands: readonly CommandMetadata[],
    _params: PageUsageAnswerParams,
  ): readonly SynthesisMaterialEntry[] {
    const materials: SynthesisMaterialEntry[] = []

    for (const cmd of commands) {
      materials.push({
        materialId: cmd.id,
        materialKind: 'command-metadata',
        summary: cmd.label,
        group: cmd.group,
        confidence: 'high',
      })
    }

    return materials
  }

  // -----------------------------------------------------------------------
  // 辅助方法
  // -----------------------------------------------------------------------

  /**
   * 生成叙述文本。
   */
  private generateNarrative(entries: readonly CopilotAnswerEntry[]): string {
    if (entries.length === 0) {
      return '当前页面暂无可用功能。'
    }

    const capabilities = entries.map((e) => e.statement).join('、')
    return `当前页面提供${capabilities}等功能。`
  }

  /**
   * 构建「暂无足够依据」结果。
   */
  private buildInsufficientResult(_params: PageUsageAnswerParams): CopilotAnswerInsufficient {
    return {
      kind: 'insufficient',
      reason: 'no-command-metadata',
      missingWhat: '当前页面暂无可用功能信息',
    }
  }
}
