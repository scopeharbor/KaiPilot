/**
 * 自然语言候选类型边界测试（spec「自然语言写意图必须只打开审查界面」/ design.md D1/D3）。
 *
 * 与 command-registry-write-boundary.test.ts 同构：
 * - `NaturalLanguageCommandCandidate.effect` 复用 `CommandEffect`，类型层不含 `'write'`；
 * - 候选类型不声明 `execute`，不得携带直接 API 写函数；
 * - 可执行候选只能引用既有 `RegisteredCommand`。
 */
import { describe, expect, test } from 'vitest'
import { Plus } from 'lucide-react'
import type { NaturalLanguageCommandCandidate } from '@/lib/command-palette-natural-language'
import type { RegisteredCommand } from '@/lib/command-registry/types'

describe('自然语言候选类型边界', () => {
  test('candidate.effect 不接受 write（编译期门禁）', () => {
    const bad: NaturalLanguageCommandCandidate = {
      commandId: 'bad.write',
      label: '非法写候选',
      // @ts-expect-error '"write"' 不能赋值给 CommandEffect | null
      effect: 'write',
      confidence: 'high',
      reason: '测试',
      requiresReview: false,
      previewText: '测试',
    }
    // 运行时类型已擦除，仅断言对象被构造。
    expect(bad.commandId).toBe('bad.write')
  })

  test('candidate 类型不声明 execute（编译期门禁）', () => {
    const cmd: RegisteredCommand = {
      id: 'ctx.demo',
      label: '示例',
      icon: Plus,
      group: 'contextual',
      effect: 'open-form',
      execute: () => {},
    }
    const candidate: NaturalLanguageCommandCandidate = {
      commandId: cmd.id,
      label: cmd.label,
      effect: cmd.effect,
      confidence: 'high',
      reason: '测试',
      requiresReview: true,
      previewText: '测试',
      command: cmd,
      // @ts-expect-error NaturalLanguageCommandCandidate 不声明 execute 字段
      execute: () => {},
    }
    expect(candidate.command?.id).toBe('ctx.demo')
  })

  test('合法候选的 effect 只允许 registry 安全副作用类型', () => {
    const safeEffects: Array<NaturalLanguageCommandCandidate['effect']> = [
      'navigate',
      'ui-setting',
      'open-form',
      'open-confirm',
      null,
    ]
    for (const effect of safeEffects) {
      const candidate: NaturalLanguageCommandCandidate = {
        commandId: effect === null ? null : `demo.${effect}`,
        label: '示例',
        effect,
        confidence: 'medium',
        reason: '测试',
        requiresReview: effect === 'open-form' || effect === 'open-confirm',
        previewText: '测试',
      }
      expect(safeEffects).toContain(candidate.effect)
    }
  })
})
