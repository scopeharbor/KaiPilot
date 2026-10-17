/**
 * GitHub / GitLab 已公布的 webhook 源 IP 段——静态 fixture（v2-5-webhook-ip-allowlist，design D6/R2）。
 *
 * ⚠️ 快照性质与边界：
 * - 本文件是**静态常量**，仅作文档与测试/本地默认值。真正生效的清单以环境变量
 *   `WEBHOOK_IP_ALLOWLIST_CIDRS` 为权威来源（见 config/webhook_allowlist.ts）。
 * - 快照来源：GitHub Meta API（api.github.com/meta 的 `hooks` 字段）与 GitLab 官方文档
 *   公布的 webhook/集成出站 IP 段。
 * - 快照时点：模型知识（约 2026-01）静态录入，**未联网核对**（本 change 禁止任何出站请求）。
 * - 刷新方式：**人工**核对 provider 最新公布值后手动更新本数组——属独立事项，不在本 change 内。
 *   provider 随时可能变更 IP 段，启用前务必以最新公布值为准复核，勿把本快照当作长期事实。
 *
 * 禁止：本文件不得发起任何 fetch/http/DNS 等 I/O，只导出常量。
 */

/**
 * GitHub webhook 源段快照（IPv4 + IPv6）。
 * 对应 api.github.com/meta 的 `hooks` 列表（静态录入，需人工复核）。
 */
export const GITHUB_WEBHOOK_CIDRS: readonly string[] = [
  '192.30.252.0/22',
  '185.199.108.0/22',
  '140.82.112.0/20',
  '143.55.64.0/20',
  '2a0a:a440::/29',
  '2606:50c0::/32',
]

/**
 * GitLab.com webhook/集成出站源段快照（IPv4）。
 * 对应 GitLab 官方文档公布的「用于 webhook/集成的 IP 地址」（静态录入，需人工复核）。
 */
export const GITLAB_WEBHOOK_CIDRS: readonly string[] = ['34.74.90.64/28', '34.74.226.0/24']

/**
 * 便捷合集：GitHub + GitLab 全部源段。
 * 仅作参考默认；生产环境应显式在 env 中按实际接入的 provider 收敛清单。
 */
export const ALL_PROVIDER_WEBHOOK_CIDRS: readonly string[] = [
  ...GITHUB_WEBHOOK_CIDRS,
  ...GITLAB_WEBHOOK_CIDRS,
]
