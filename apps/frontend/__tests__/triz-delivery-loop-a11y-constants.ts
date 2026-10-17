/**
 * 10.12 测试辅助常量：组件内部 POSTURE_LABELS 的镜像（避免为测试导出实现细节）。
 * 与 delivery-loop-panel.tsx 中 POSTURE_LABELS 保持同步；漂移由 responsive-a11y
 * 测试的键集合断言发现。
 */
export const POSTURE_LABELS_SHADOW: Record<string, { text: string; icon: string; tone: string }> = {
  superseded: { text: '已被更正', icon: '⊘', tone: 'text-muted-foreground' },
  source_stale: { text: '来源过期', icon: '⚠', tone: 'text-amber-600 dark:text-amber-400' },
  verified_effective: {
    text: '验证有效',
    icon: '✓',
    tone: 'text-emerald-600 dark:text-emerald-400',
  },
  verified_ineffective: { text: '验证无效', icon: '✗', tone: 'text-red-600 dark:text-red-400' },
  blocked: { text: '受阻', icon: '⛔', tone: 'text-red-600 dark:text-red-400' },
  in_progress: { text: '进行中', icon: '◐', tone: 'text-blue-600 dark:text-blue-400' },
  awaiting_verification: {
    text: '待人工验证',
    icon: '…',
    tone: 'text-purple-600 dark:text-purple-400',
  },
  delivery_linked: { text: '已关联交付', icon: '⛓', tone: 'text-muted-foreground' },
  awaiting_apply: { text: '待确认提交', icon: '○', tone: 'text-muted-foreground' },
}
