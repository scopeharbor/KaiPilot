/**
 * 账号两步验证状态机（与后端 `TwoFactorState` 一一对应，前端只做呈现）。
 *
 * - `disabled`：从未设置；
 * - `pending_setup`：已生成待确认密钥、尚未确认（不拦登录）；
 * - `active`：已启用且密钥可用；
 * - `needs_reenrollment`：曾标记启用但密钥已不可用，服务端已自动退回未绑定态，
 *   UI 需要明确告诉用户「请重新绑定」而不是假装一切正常。
 */
export type TwoFactorState = 'disabled' | 'pending_setup' | 'active' | 'needs_reenrollment'

/** 状态 → 中文标签（未知值回退到最保守的「未启用」）。 */
export function twoFactorStateLabel(state: TwoFactorState | undefined): string {
  switch (state) {
    case 'active':
      return '已启用'
    case 'pending_setup':
      return '设置未完成'
    case 'needs_reenrollment':
      return '需要重新绑定'
    default:
      return '未启用'
  }
}
