/**
 * 自然语言候选 feature flag（spec「自然语言候选必须可关闭或回退」）。
 *
 * 默认开启；环境变量 `NEXT_PUBLIC_COMMAND_PALETTE_NL=off` 可关闭。
 * 关闭后命令面板回到 registry/search/theme/density 旧行为，不展示「智能建议」分组。
 * 测试中可用 `setNaturalLanguageCommandsEnabled` 覆盖。
 */
let enabled = process.env.NEXT_PUBLIC_COMMAND_PALETTE_NL !== 'off'

export function isNaturalLanguageCommandsEnabled(): boolean {
  return enabled
}

export function setNaturalLanguageCommandsEnabled(value: boolean): void {
  enabled = value
}
