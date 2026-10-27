/**
 * v3-personal-edition-open-source-export §D4 —— 版本扩展点接口。
 *
 * 核心代码需要企业或平台行为（AI 上下文 DLP 预检、上下文水印、平台统一 AI 回退）时，
 * 只依赖这里定义的结构类型，不直接 import 企业或平台模块。这样个人版导出时可以把
 * 企业实现整块删掉，核心仍能编译。
 *
 * 形状从现有实现的公开方法签名抽出：
 * - `DlpAiAdapter#preflightContextAssembly`
 * - `AiContextWatermarkAdapter#prepareContext`
 * - `platform_ai_scope` / `platform_fallback_gateway` / `readPlatformAiRouting`
 *
 * 默认实现（个人版语义）见 `defaults.ts`，注册入口见 `edition_registry.ts`。
 */
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { DlpDecisionSnapshot } from '@aiproj/types/enterprise-dlp-engine'
import type { AIGateway } from '#services/ai_m0/gateway'

// ---------------------------------------------------------------------------
// Copilot DLP 预检
// ---------------------------------------------------------------------------

export interface CopilotDlpPreflightInput {
  organizationId: number
  projectId: number | null
  actorId: number
  sourceHash: string
  authorizedContextSummary: string
  contextPacketRefs: string[]
  itemCount?: number
}

export interface CopilotDlpPreflightResult {
  /** false = 策略阻断。 */
  allowed: boolean
  /** 判定快照；没有策略判定（个人版放行）时为 null。 */
  snapshot: DlpDecisionSnapshot | null
  warnings: readonly string[]
  /**
   * false = 判定不可用。`copilot_turn_service#performDlpCheck` 对它 fail-closed（阻断），
   * 所以「放行」必须返回 true。
   */
  adapterAvailable: boolean
  /** 非 null = 策略要求脱敏。 */
  maskedContext: string | null
}

export interface CopilotDlpPort {
  preflightContextAssembly(input: CopilotDlpPreflightInput): Promise<CopilotDlpPreflightResult>
}

// ---------------------------------------------------------------------------
// Copilot 上下文水印
// ---------------------------------------------------------------------------

export interface CopilotWatermarkInput {
  organizationId: number
  projectId: number | null
  actorId: number
  sourceRef: string
  sourceHash: string
  format: 'markdown'
  dlpResult: string
  decisionHash: string
  policyHash: string
}

export interface CopilotWatermarkPort {
  /** 返回值由实现自定（企业实现返回水印跟进摘要），调用方不读取；不注入时可返回 null。 */
  prepareContext(input: CopilotWatermarkInput): Promise<unknown>
}

// ---------------------------------------------------------------------------
// 维基导出 DLP 预检（v3-llm-wiki-default-on）
// ---------------------------------------------------------------------------

export interface WikiExportDlpInput {
  organizationId: number
  projectId: number | null
  actorId: number
  text: string
  sourceHash: string
  itemCount: number
}

export interface WikiExportDlpPort {
  /** true = 放行导出；企业实现在预检结果不是放行（含要求水印）时返回 false。 */
  preflight(input: WikiExportDlpInput): Promise<boolean>
}

// ---------------------------------------------------------------------------
// 平台统一 AI 配置（SaaS 运营）
// ---------------------------------------------------------------------------

/** AI 连接解析的组织作用域。 */
export interface AiConnectionScope {
  /** 本组织自己的连接是否参与解析。 */
  ownAllowed: boolean
  /** 可回退的平台统一配置组织；不适用或尚未建立时为 null。 */
  platformOrganizationId: number | null
}

/** 平台统一 AI 配置组织的模型路由（主模型 + 备选模型）。 */
export interface PlatformAiRoutingShape {
  primaryModelId: number
  fallbackModelIds: number[]
  revision: number
}

export interface PlatformAiPort {
  /** free 组织的连接作用域（自己的连接是否可用、回退到哪个平台组织）。 */
  resolveScope(organizationId: number): Promise<AiConnectionScope>
  /** 平台统一 AI 配置组织的 id；尚未建立时为 null。 */
  findPlatformOrganizationId(): Promise<number | null>
  /** 组织是平台统一 AI 配置组织且路由有效时返回路由，否则 null。 */
  readRouting(organization: {
    slug: string | null
    settings: Record<string, unknown> | null
  }): PlatformAiRoutingShape | null
  /** 平台路由的逐个模型回退网关。 */
  createFallbackGateway(primary: AIGateway, next: Array<() => Promise<AIGateway | null>>): AIGateway
  /**
   * `node ace admin:create-super`：把超级管理员加入平台统一 AI 配置组织（不存在则创建），
   * 返回该组织 id。
   */
  ensureSuperAdminOrganization(input: {
    client: TransactionClientContract
    userId: number
  }): Promise<number>
}
