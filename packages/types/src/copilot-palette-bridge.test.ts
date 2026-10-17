/**
 * copilot-palette-bridge 纯函数单元测试（v3-copilot-command-palette-bridge）。
 *
 * 覆盖：载荷构造、判定构造、反向目标校验、不可用说明、类型守卫。
 * 纯数据，零网络/数据库/React 依赖。
 */
import { describe, expect, test } from 'vitest'
import {
  buildHandoffPayload,
  buildHandoffDecision,
  isValidReverseHandoffTarget,
  buildUnavailabilityInfo,
  isCopilotPaletteUnavailabilityKind,
  isCopilotReverseHandoffEffect,
} from './copilot-palette-bridge.js'
import {
  fixtureHandoffPayloadBasic,
  fixtureHandoffPayloadWithRefs,
  fixtureDecisionPartialMatch,
  fixtureDecisionZeroMatch,
  fixtureDecisionAllUnavailable,
  fixtureReverseTargetNavigate,
  fixtureReverseTargetOpenForm,
  fixtureReverseTargetPersistence,
  fixtureUnavailabilityNotPermitted,
  fixtureUnavailabilityNotEnabled,
  fixtureUnavailabilityAuthGated,
} from './copilot-palette-bridge-fixtures.js'

describe('buildHandoffPayload', () => {
  test('构造基本载荷', () => {
    const payload = buildHandoffPayload('把首页设计拆成子任务', '/projects/1/tasks', [])
    expect(payload.inputText).toBe('把首页设计拆成子任务')
    expect(payload.routeContext).toBe('/projects/1/tasks')
    expect(payload.entityRefs).toEqual([])
    expect(payload.source).toBe('command-palette')
  })

  test('带实体引用的载荷', () => {
    const refs = [{ entityType: 'task', entityId: '42', label: '实现登录功能' }]
    const payload = buildHandoffPayload('给这个任务添加风险', '/projects/1/tasks/42', refs)
    expect(payload.entityRefs).toHaveLength(1)
    expect(payload.entityRefs[0].entityType).toBe('task')
  })

  test('输入文本被 trim', () => {
    const payload = buildHandoffPayload('  hello  ', '/test', [])
    expect(payload.inputText).toBe('hello')
  })

  test('空输入抛错', () => {
    expect(() => buildHandoffPayload('', '/test', [])).toThrow('inputText must be non-empty')
  })

  test('纯空白输入抛错', () => {
    expect(() => buildHandoffPayload('   ', '/test', [])).toThrow('inputText must be non-empty')
  })

  test('路由含查询串抛错', () => {
    expect(() => buildHandoffPayload('test', '/test?q=1', [])).toThrow(
      'routeContext must not contain ? or #',
    )
  })

  test('路由含哈希抛错', () => {
    expect(() => buildHandoffPayload('test', '/test#section', [])).toThrow(
      'routeContext must not contain ? or #',
    )
  })
})

describe('buildHandoffDecision', () => {
  test('不转交', () => {
    const d = buildHandoffDecision(false)
    expect(d.shouldHandoff).toBe(false)
    expect(d.reason).toBeUndefined()
  })

  test('转交带原因', () => {
    const d = buildHandoffDecision(true, 'no-match')
    expect(d.shouldHandoff).toBe(true)
    expect(d.reason).toBe('no-match')
  })

  test('转交无原因抛错', () => {
    expect(() => buildHandoffDecision(true)).toThrow('reason is required')
  })
})

describe('isValidReverseHandoffTarget', () => {
  test('navigation 目标合法', () => {
    expect(isValidReverseHandoffTarget(fixtureReverseTargetNavigate())).toBe(true)
  })

  test('open-form 目标合法', () => {
    expect(isValidReverseHandoffTarget(fixtureReverseTargetOpenForm())).toBe(true)
  })

  test('ui-setting 目标非法', () => {
    expect(
      isValidReverseHandoffTarget({
        commandId: 'test',
        label: 'test',
        effect: 'ui-setting' as any,
      }),
    ).toBe(false)
  })

  test('open-confirm 目标非法', () => {
    expect(
      isValidReverseHandoffTarget({
        commandId: 'test',
        label: 'test',
        effect: 'open-confirm' as any,
      }),
    ).toBe(false)
  })
})

describe('buildUnavailabilityInfo', () => {
  test('not-permitted 措辞', () => {
    const info = buildUnavailabilityInfo('not-permitted')
    expect(info.kind).toBe('not-permitted')
    expect(info.message).toContain('权限')
  })

  test('not-enabled 措辞', () => {
    const info = buildUnavailabilityInfo('not-enabled')
    expect(info.kind).toBe('not-enabled')
    expect(info.message).toContain('启用')
  })

  test('authorization-gated 措辞', () => {
    const info = buildUnavailabilityInfo('authorization-gated')
    expect(info.kind).toBe('authorization-gated')
    expect(info.message).toContain('授权')
  })
})

describe('type guards', () => {
  test('isCopilotPaletteUnavailabilityKind', () => {
    expect(isCopilotPaletteUnavailabilityKind('not-permitted')).toBe(true)
    expect(isCopilotPaletteUnavailabilityKind('not-enabled')).toBe(true)
    expect(isCopilotPaletteUnavailabilityKind('authorization-gated')).toBe(true)
    expect(isCopilotPaletteUnavailabilityKind('unknown')).toBe(false)
    expect(isCopilotPaletteUnavailabilityKind(null)).toBe(false)
  })

  test('isCopilotReverseHandoffEffect', () => {
    expect(isCopilotReverseHandoffEffect('navigate')).toBe(true)
    expect(isCopilotReverseHandoffEffect('open-form')).toBe(true)
    expect(isCopilotReverseHandoffEffect('ui-setting')).toBe(false)
    expect(isCopilotReverseHandoffEffect('write')).toBe(false)
  })
})

describe('fixtures', () => {
  test('fixtureHandoffPayloadBasic 结构正确', () => {
    const p = fixtureHandoffPayloadBasic()
    expect(p.source).toBe('command-palette')
    expect(p.entityRefs).toEqual([])
  })

  test('fixtureHandoffPayloadWithRefs 含引用', () => {
    const p = fixtureHandoffPayloadWithRefs()
    expect(p.entityRefs.length).toBeGreaterThan(0)
  })

  test('fixtureDecisionPartialMatch 不转交', () => {
    expect(fixtureDecisionPartialMatch().shouldHandoff).toBe(false)
  })

  test('fixtureDecisionZeroMatch 转交', () => {
    expect(fixtureDecisionZeroMatch().shouldHandoff).toBe(true)
  })

  test('fixtureReverseTargetNavigate 合法', () => {
    expect(isValidReverseHandoffTarget(fixtureReverseTargetNavigate())).toBe(true)
  })

  test('fixtureUnavailabilityNotPermitted 结构正确', () => {
    const info = fixtureUnavailabilityNotPermitted()
    expect(info.kind).toBe('not-permitted')
    expect(typeof info.message).toBe('string')
  })
})
