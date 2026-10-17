/**
 * v3-personal-edition-open-source-export §D4 —— 版本扩展点的默认实现（个人版语义）。
 *
 * 没有注册企业实现时使用：
 * - DLP 预检：明确「放行」。`adapterAvailable` 必须为 true，否则
 *   `copilot_turn_service#performDlpCheck` 会按 fail-closed 设计阻断所有 AI 对话；
 * - 水印：不注入，不写任何记录；
 * - 平台统一 AI 回退：不存在（`platformAi = null`）。
 */
import type {
  CopilotDlpPort,
  CopilotDlpPreflightResult,
  CopilotWatermarkPort,
} from '#services/edition/ports'

export class PassThroughCopilotDlp implements CopilotDlpPort {
  async preflightContextAssembly(): Promise<CopilotDlpPreflightResult> {
    return {
      allowed: true,
      snapshot: null,
      warnings: [],
      adapterAvailable: true,
      maskedContext: null,
    }
  }
}

export class NoopCopilotWatermark implements CopilotWatermarkPort {
  async prepareContext(): Promise<null> {
    return null
  }
}
