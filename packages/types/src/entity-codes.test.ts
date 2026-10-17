import { describe, expect, test } from 'vitest'
import {
  formatProjectCode,
  formatSignalCode,
  formatTaskCode,
  matchTaskCodeKeyword,
  parseEntityCodes,
  parseSignalCodes,
  projectIdFromFallbackCode,
} from './entity-codes.js'

describe('项目 / 任务编号', () => {
  test('格式化：有 code 用 code，否则 P{id}', () => {
    expect(formatProjectCode({ id: 5, code: 'PROJ-5' })).toBe('PROJ-5')
    expect(formatProjectCode({ id: 12, code: null })).toBe('PROJ-12')
    expect(formatTaskCode({ id: 5, code: 'PROJ-5' }, 128)).toBe('PROJ-5#128')
    expect(formatTaskCode({ id: 12 }, 7)).toBe('PROJ-12#7')
  })

  test('从文字里解析编号', () => {
    const parsed = parseEntityCodes('看看 PROJ-5#128 和 #7，再打开 PROJ-9 与 ABC-12')
    expect(parsed.taskIds).toEqual([128, 7])
    expect(parsed.taskProjectCodes).toEqual(['PROJ-5', null])
    expect(parsed.projectCodes).toEqual(['PROJ-9', 'ABC-12'])
  })

  test('整个关键词是任务编号', () => {
    expect(matchTaskCodeKeyword('#128')).toEqual({ taskId: 128, projectCode: null })
    expect(matchTaskCodeKeyword(' PROJ-5#128 ')).toEqual({ taskId: 128, projectCode: 'PROJ-5' })
    expect(matchTaskCodeKeyword('登录 #128')).toBeNull()
    expect(projectIdFromFallbackCode('PROJ-12')).toBe(12)
    expect(projectIdFromFallbackCode('ABC-5')).toBeNull()
  })
})

describe('信号编号', () => {
  test('项目编号#S信号号；未设 code 回退 PROJ-{id}', () => {
    expect(formatSignalCode({ id: 8 }, 10)).toBe('PROJ-8#S10')
    expect(formatSignalCode({ id: 8, code: 'GIG-2' }, 10)).toBe('GIG-2#S10')
  })

  test('从文字里解析信号编号，且不被当成任务 / 项目编号', () => {
    expect(parseSignalCodes('矛盾求解 PROJ-8#S10，还有 #s9 和 PROJ-8#S10')).toEqual([
      { signalId: 10, projectCode: 'PROJ-8' },
      { signalId: 9, projectCode: null },
    ])
    expect(parseEntityCodes('矛盾求解 PROJ-8#S10')).toEqual({
      taskIds: [],
      taskProjectCodes: [],
      projectCodes: [],
    })
    expect(parseSignalCodes('打开 PROJ-5#128')).toEqual([])
  })
})
