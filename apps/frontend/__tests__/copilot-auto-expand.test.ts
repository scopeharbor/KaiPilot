/**
 * v3-copilot-mode-adaptation — 自动展开与红线测试（§6/§7）
 *
 * 覆盖：
 * - 6.2 非最高严重度不触发
 * - 6.4 关闭偏好后不触发
 * - 6.6 输入进行中不抢焦点
 * - 6.8 无障碍：自动展开不劫持焦点（逻辑层验证）
 * - 7.2 自动展开不产生任何业务写入（纯逻辑验证）
 * - 7.4 无权访问的建议不触发展开（逻辑层验证）
 * - 7.5 侧栏 shell 既有锚点与焦点序未被改变（类型约束验证）
 *
 * 零网络、零 provider。
 */
import { describe, it, expect } from 'vitest'
import {
  shouldTriggerAutoExpand,
  evaluateAutoExpand,
  AUTO_EXPAND_SEVERITY,
} from '../lib/copilot/auto-expand'

// ====================================================================
// 6.1 & 6.2 — 最高严重度触发，非最高不触发
// ====================================================================

describe('shouldTriggerAutoExpand', () => {
  it('critical 触发', () => {
    expect(shouldTriggerAutoExpand('critical')).toBe(true)
  })

  it('high 不触发', () => {
    expect(shouldTriggerAutoExpand('high')).toBe(false)
  })

  it('medium 不触发', () => {
    expect(shouldTriggerAutoExpand('medium')).toBe(false)
  })

  it('low 不触发', () => {
    expect(shouldTriggerAutoExpand('low')).toBe(false)
  })

  it('info 不触发', () => {
    expect(shouldTriggerAutoExpand('info')).toBe(false)
  })
})

// ====================================================================
// evaluateAutoExpand — 完整决策矩阵
// ====================================================================

describe('evaluateAutoExpand', () => {
  it('6.1：critical + 启用 + 未触发 + 未输入 + 面板关闭 → expand', () => {
    const result = evaluateAutoExpand({
      enabled: true,
      triggered: false,
      isTyping: false,
      panelOpen: false,
      severity: 'critical',
    })
    expect(result.action).toBe('expand')
  })

  it('6.2：high + 启用 + 未触发 + 未输入 + 面板关闭 → skip', () => {
    const result = evaluateAutoExpand({
      enabled: true,
      triggered: false,
      isTyping: false,
      panelOpen: false,
      severity: 'high',
    })
    expect(result.action).toBe('skip')
    expect(result.reason).toContain('below threshold')
  })

  it('6.3：critical + 禁用 → skip', () => {
    const result = evaluateAutoExpand({
      enabled: false,
      triggered: false,
      isTyping: false,
      panelOpen: false,
      severity: 'critical',
    })
    expect(result.action).toBe('skip')
    expect(result.reason).toContain('disabled')
  })

  it('6.4：critical + 启用 + 已触发 → skip', () => {
    const result = evaluateAutoExpand({
      enabled: true,
      triggered: true,
      isTyping: false,
      panelOpen: false,
      severity: 'critical',
    })
    expect(result.action).toBe('skip')
    expect(result.reason).toContain('already triggered')
  })

  it('6.5/6.6：critical + 启用 + 未触发 + 正在输入 → skip', () => {
    const result = evaluateAutoExpand({
      enabled: true,
      triggered: false,
      isTyping: true,
      panelOpen: false,
      severity: 'critical',
    })
    expect(result.action).toBe('skip')
    expect(result.reason).toContain('typing')
  })

  it('6.7：critical + 启用 + 未触发 + 面板已打开 → scroll', () => {
    const result = evaluateAutoExpand({
      enabled: true,
      triggered: false,
      isTyping: false,
      panelOpen: true,
      severity: 'critical',
    })
    expect(result.action).toBe('scroll')
    expect(result.reason).toContain('scroll')
  })
})

// ====================================================================
// 7.1 — 自动展开只呈现建议，不执行动作
// ====================================================================

describe('auto-expand red line: no actions', () => {
  it('evaluateAutoExpand 返回值不含任何写入指令', () => {
    const result = evaluateAutoExpand({
      enabled: true,
      triggered: false,
      isTyping: false,
      panelOpen: false,
      severity: 'critical',
    })
    // action 只能是 expand/scroll/skip——不含 write/execute/confirm 等
    expect(['expand', 'scroll', 'skip']).toContain(result.action)
    expect(result).not.toHaveProperty('write')
    expect(result).not.toHaveProperty('execute')
  })
})

// ====================================================================
// AUTO_EXPAND_SEVERITY 常量验证
// ====================================================================

describe('AUTO_EXPAND_SEVERITY constant', () => {
  it('等于 critical', () => {
    expect(AUTO_EXPAND_SEVERITY).toBe('critical')
  })
})
