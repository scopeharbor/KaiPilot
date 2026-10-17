import { describe, it, expect } from 'vitest'
import { resolveCommandCenterTarget, isNavigableTarget } from '@/lib/command-center-target-resolver'

const ctx = { projectId: 101 }

describe('指挥中心 safe-target resolver（§5.5/5.6）', () => {
  it('每个允许目标解析为既有应用内路由', () => {
    const cases: Array<[unknown, string]> = [
      [{ kind: 'project-dashboard', params: { projectId: 101 } }, '/projects/101'],
      [{ kind: 'risk-workbench', params: { projectId: 101 } }, '/projects/101/risks'],
      [
        { kind: 'risk-detail', params: { projectId: 101, riskId: 501 } },
        '/projects/101/risks?risk=501',
      ],
      [{ kind: 'prediction-workbench', params: { projectId: 101 } }, '/projects/101/predictions'],
      [
        { kind: 'task-detail', params: { projectId: 101, taskId: 7001 } },
        '/projects/101/tasks/7001',
      ],
      [{ kind: 'resource-workbench', params: { projectId: 101 } }, '/projects/101/resources'],
      [{ kind: 'change-impact', params: { projectId: 101 } }, '/projects/101/change-requests'],
    ]
    for (const [target, expectedPath] of cases) {
      const resolved = resolveCommandCenterTarget(target, ctx)
      expect(isNavigableTarget(resolved)).toBe(true)
      if (isNavigableTarget(resolved)) {
        expect(resolved.path).toBe(expectedPath)
        // 只允许应用内相对路径
        expect(resolved.path.startsWith('/')).toBe(true)
      }
    }
  })

  it('health-evidence 解析为页内只读证据抽屉（无诊断页面 → 不导航）', () => {
    const resolved = resolveCommandCenterTarget(
      { kind: 'health-evidence', params: { projectId: 101, diagnosisId: 9001 } },
      ctx,
    )
    expect(resolved).toEqual({
      action: 'in-page',
      surface: 'health-evidence-drawer',
      diagnosisId: 9001,
    })
  })

  it('milestone-view 无独立 surface → unavailable', () => {
    const resolved = resolveCommandCenterTarget(
      { kind: 'milestone-view', params: { projectId: 101 } },
      ctx,
    )
    expect(resolved.action).toBe('unavailable')
    if (resolved.action === 'unavailable') {
      expect(resolved.reason).toBe('TARGET_SURFACE_UNAVAILABLE')
    }
  })

  it('拒绝未知 kind 与自由 URL / 路径注入字段', () => {
    for (const bad of [
      { kind: 'external-dashboard', params: {} },
      { kind: 'https://evil.example', params: {} },
      { kind: 'risk-workbench', params: { href: 'https://evil.example' } },
      { kind: 'risk-workbench', params: { url: 'javascript:alert(1)' } },
      { kind: 'task-detail', params: { projectId: 101, taskId: '../../../admin' } },
      'https://evil.example',
      null,
      undefined,
    ]) {
      expect(resolveCommandCenterTarget(bad, ctx).action).toBe('unavailable')
    }
  })

  it('拒绝跨项目 projectId（存在性隔离）', () => {
    const resolved = resolveCommandCenterTarget(
      { kind: 'risk-detail', params: { projectId: 999, riskId: 1 } },
      ctx,
    )
    expect(resolved.action).toBe('unavailable')
  })

  it('拒绝写/确认句柄类字段', () => {
    for (const bad of [
      { kind: 'risk-detail', params: { method: 'POST', riskId: 1, projectId: 101 } },
      { kind: 'health-evidence', params: { confirmToken: 'x', projectId: 101 } },
      { kind: 'risk-workbench', params: { confirmHandle: 'h' } },
      { kind: 'prediction-workbench', params: { previewToken: 't' } },
    ]) {
      expect(resolveCommandCenterTarget(bad, ctx).action).toBe('unavailable')
    }
  })

  it('畸形参数值（非正整数）→ unavailable', () => {
    expect(
      resolveCommandCenterTarget(
        { kind: 'task-detail', params: { projectId: 101, taskId: -1 } },
        ctx,
      ).action,
    ).toBe('unavailable')
    expect(
      resolveCommandCenterTarget(
        { kind: 'task-detail', params: { projectId: 101, taskId: 'one' } },
        ctx,
      ).action,
    ).toBe('unavailable')
  })

  it('missing target surface 场景：null 目标输入安全收束', () => {
    expect(resolveCommandCenterTarget(null, ctx).action).toBe('unavailable')
  })
})
