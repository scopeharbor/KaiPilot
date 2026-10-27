/**
 * v3-personal-edition-open-source-export §D4 —— 版本扩展点注册表。
 *
 * 核心通过 `editionHooks()` 取企业或平台行为；企业实现由
 * `providers/enterprise_edition_provider.ts` 在应用启动时调用 `registerEditionHooks` 注册。
 * 个人版导出会删掉那个 provider，这里就回落到 `defaults.ts` 的个人版语义。
 *
 * 状态挂在 `globalThis` 上：开发态热重载可能让本模块重新求值，挂在模块作用域会丢掉
 * 已注册的企业实现，私有部署就会静默变成「DLP 放行」。
 */
import {
  NoopCopilotWatermark,
  PassThroughCopilotDlp,
  PassThroughWikiExportDlp,
} from '#services/edition/defaults'
import type {
  CopilotDlpPort,
  CopilotWatermarkPort,
  PlatformAiPort,
  WikiExportDlpPort,
} from '#services/edition/ports'

export interface EditionHooks {
  /** 每次调用返回一个可用的 DLP 预检实现。 */
  copilotDlp: () => CopilotDlpPort
  /** 每次调用返回一个可用的上下文水印实现。 */
  copilotWatermark: () => CopilotWatermarkPort
  /** 平台统一 AI 配置；个人版为 null。 */
  platformAi: PlatformAiPort | null
  /** 维基 Markdown 导出的 DLP 预检（v3-llm-wiki-default-on）；个人版放行。 */
  wikiExportDlp: () => WikiExportDlpPort
}

function defaultHooks(): EditionHooks {
  return {
    copilotDlp: () => new PassThroughCopilotDlp(),
    copilotWatermark: () => new NoopCopilotWatermark(),
    platformAi: null,
    wikiExportDlp: () => new PassThroughWikiExportDlp(),
  }
}

const STATE_KEY = Symbol.for('aiproj.edition.hooks')

type GlobalWithHooks = typeof globalThis & { [STATE_KEY]?: EditionHooks }

function state(): EditionHooks {
  const g = globalThis as GlobalWithHooks
  g[STATE_KEY] ??= defaultHooks()
  return g[STATE_KEY]
}

/** 注册（覆盖）部分扩展点；未提供的字段保持现值。 */
export function registerEditionHooks(partial: Partial<EditionHooks>): void {
  const current = state()
  const g = globalThis as GlobalWithHooks
  g[STATE_KEY] = { ...current, ...partial }
}

export function editionHooks(): EditionHooks {
  return state()
}

/**
 * 仅供测试：回到未注册任何企业实现时的个人版默认值。
 * 返回重置前的状态；测试结束时用 `registerEditionHooks(previous)` 还原，
 * 避免影响同一进程里后续依赖企业实现的测试。
 */
export function resetEditionHooksForTests(): EditionHooks {
  const previous = state()
  const g = globalThis as GlobalWithHooks
  g[STATE_KEY] = defaultHooks()
  return previous
}
