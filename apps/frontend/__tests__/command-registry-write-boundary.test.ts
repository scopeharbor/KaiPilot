/**
 * 写操作边界编译期断言（spec command-palette「写操作边界」/ design.md D6）。
 *
 * `CommandEffect` 类型不含 `'write'`——类型系统直接禁止注册直接执行业务写操作的命令。
 * 以下 `@ts-expect-error` 在 typecheck 时验证：给 `effect` 赋 `'write'` 必然是类型错误。
 * 若有人改类型加回 `'write'`，这些 `@ts-expect-error` 会因「无错误可期望」而编译失败，
 * 从而阻止写操作命令被重新允许。
 */
import { describe, expect, test } from 'vitest'
import type { RegisteredCommand } from '@/lib/command-registry/types'
import { Plus } from 'lucide-react'

describe('command-registry 写操作边界（编译期）', () => {
  test('effect 不接受 write', () => {
    // 编译期门禁：以下赋值在 typecheck 时必须报错（'"write"' 不能赋值给 CommandEffect）。
    // 若有人改类型加回 'write'，@ts-expect-error 会因「无错误可期望」而编译失败。
    const writeCmd: RegisteredCommand = {
      id: 'bad.write',
      label: '非法写命令',
      icon: Plus,
      group: 'contextual',
      // @ts-expect-error '"write"' 不能赋值给 CommandEffect
      effect: 'write',
      execute: () => {},
    }
    // 运行时类型已擦除，仅断言对象被构造（不深究 effect 值）。
    expect(typeof writeCmd.execute).toBe('function')
  })

  test('open-form effect 类型合法（导航/Dialog 开关，不直接写库）', () => {
    const openFormCmd: RegisteredCommand = {
      id: 'ctx.open-form',
      label: '打开表单',
      icon: Plus,
      group: 'contextual',
      effect: 'open-form',
      execute: () => {},
    }
    expect(openFormCmd.effect).toBe('open-form')
  })
})
