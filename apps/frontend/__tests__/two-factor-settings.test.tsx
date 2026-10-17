import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { TwoFactorSettings } from '@/components/settings/TwoFactorSettings'
import {
  formatRecoveryCodesForDownload,
  twoFactorApi,
  type TwoFactorStatus,
} from '@/lib/api/two-factor'
import { useAuthStore } from '@/stores/auth-store'
import { accessTokenWith } from './_jwt-helper'

// qrcode 在 jsdom 下会走 canvas；这里只关心「二维码渲染进了 img」，
// 生成真实位图对断言没有价值，故整体替身。
// 用普通函数而非 `vi.fn()`：`vi.restoreAllMocks()` 会把 spy 的实现清成 undefined，
// 让 `toDataURL()` 返回 undefined 而在 `.then` 上炸掉。
vi.mock('qrcode', () => ({
  default: { toDataURL: () => Promise.resolve('data:image/png;base64,stub') },
}))

const DISABLED_STATUS: TwoFactorStatus = {
  state: 'disabled',
  enabled: false,
  pending: false,
  rebinding: false,
  label: null,
  confirmedAt: null,
  lastUsedAt: null,
  recoveryCodesRemaining: 0,
}

const ENABLED_STATUS: TwoFactorStatus = {
  state: 'active',
  enabled: true,
  pending: false,
  rebinding: false,
  label: 'iPhone',
  confirmedAt: '2026-09-01T02:00:00.000Z',
  lastUsedAt: '2026-09-04T01:00:00.000Z',
  recoveryCodesRemaining: 10,
}

const ENROLLMENT = {
  secret: 'JBSWY3DPEHPK3PXPJBSWY3DP',
  otpauthUri: 'otpauth://totp/%E6%99%BA%E9%A1%B9:ada@aiproj.local?secret=JBSWY3DPEHPK3PXPJBSWY3DP',
  digits: 6,
  period: 30,
  algorithm: 'SHA1',
}

const RECOVERY_CODES = Array.from({ length: 10 }, (_, index) => `CODE-${index}AAA-BBBB-CCCC`)

function signIn() {
  useAuthStore.getState().setSession({
    user: { id: 7, email: 'ada@aiproj.local', fullName: 'Ada', organizations: [] },
    accessToken: accessTokenWith([]),
    refreshToken: 'refresh-1',
  })
}

describe('两步验证设置面板', () => {
  beforeEach(() => {
    sessionStorage.clear()
    useAuthStore.getState().clear()
    useAuthStore.getState().setHasHydrated(true)
    vi.restoreAllMocks()
    signIn()
  })

  test('未启用时展示引导与「开始设置」', async () => {
    vi.spyOn(twoFactorApi, 'status').mockResolvedValue(DISABLED_STATUS)

    render(<TwoFactorSettings />)

    expect(await screen.findByText('未启用')).toBeTruthy()
    expect(screen.getByRole('button', { name: /开始设置/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /关闭两步验证/ })).toBeNull()
  })

  test('上次设置未完成时提示继续设置', async () => {
    vi.spyOn(twoFactorApi, 'status').mockResolvedValue({ ...DISABLED_STATUS, pending: true })

    render(<TwoFactorSettings />)

    expect(await screen.findByRole('button', { name: /继续设置/ })).toBeTruthy()
    expect(screen.getByText(/上次设置未完成/)).toBeTruthy()
  })

  test('设置向导展示二维码与可手工录入的密钥', async () => {
    vi.spyOn(twoFactorApi, 'status').mockResolvedValue(DISABLED_STATUS)
    const setup = vi.spyOn(twoFactorApi, 'setup').mockResolvedValue(ENROLLMENT)

    render(<TwoFactorSettings />)
    fireEvent.click(await screen.findByRole('button', { name: /开始设置/ }))

    await screen.findByText('绑定认证器')
    expect(setup).toHaveBeenCalledOnce()
    expect(screen.getByText(ENROLLMENT.secret)).toBeTruthy()
    // 二维码是异步生成的，等它落到 img 上再断言
    const qr = (await screen.findByAltText('两步验证配置二维码')) as HTMLImageElement
    expect(qr.src).toBe('data:image/png;base64,stub')
    expect(screen.getByLabelText('输入认证器显示的 6 位验证码')).toBeTruthy()
  })

  test('确认后启用，并把恢复码只展示这一次', async () => {
    vi.spyOn(twoFactorApi, 'status').mockResolvedValue(DISABLED_STATUS)
    vi.spyOn(twoFactorApi, 'setup').mockResolvedValue(ENROLLMENT)
    const confirm = vi.spyOn(twoFactorApi, 'confirm').mockResolvedValue({
      ...ENABLED_STATUS,
      recoveryCodes: RECOVERY_CODES,
    })

    render(<TwoFactorSettings />)
    fireEvent.click(await screen.findByRole('button', { name: /开始设置/ }))
    fireEvent.change(await screen.findByLabelText('输入认证器显示的 6 位验证码'), {
      target: { value: '123456' },
    })
    fireEvent.click(screen.getByRole('button', { name: '确认并启用' }))

    await waitFor(() => expect(confirm).toHaveBeenCalledWith('123456'))
    expect(await screen.findByText('保存你的恢复码')).toBeTruthy()
    for (const code of RECOVERY_CODES) {
      expect(screen.getByText(code)).toBeTruthy()
    }
    // 明文密钥在确认后立刻从界面消失
    expect(screen.queryByText(ENROLLMENT.secret)).toBeNull()
  })

  test('未勾选「已保存」时无法离开恢复码页', async () => {
    vi.spyOn(twoFactorApi, 'status').mockResolvedValue(DISABLED_STATUS)
    vi.spyOn(twoFactorApi, 'setup').mockResolvedValue(ENROLLMENT)
    vi.spyOn(twoFactorApi, 'confirm').mockResolvedValue({
      ...ENABLED_STATUS,
      recoveryCodes: RECOVERY_CODES,
    })

    render(<TwoFactorSettings />)
    fireEvent.click(await screen.findByRole('button', { name: /开始设置/ }))
    fireEvent.change(await screen.findByLabelText('输入认证器显示的 6 位验证码'), {
      target: { value: '123456' },
    })
    fireEvent.click(screen.getByRole('button', { name: '确认并启用' }))

    const done = (await screen.findByRole('button', { name: '完成' })) as HTMLButtonElement
    expect(done.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(done.disabled).toBe(false)
  })

  test('确认验证码错误时留在向导并提示', async () => {
    vi.spyOn(twoFactorApi, 'status').mockResolvedValue(DISABLED_STATUS)
    vi.spyOn(twoFactorApi, 'setup').mockResolvedValue(ENROLLMENT)
    vi.spyOn(twoFactorApi, 'confirm').mockRejectedValue({
      status: 401,
      code: 'TWO_FACTOR_INVALID_CODE',
      message: 'raw-server-text',
    })

    render(<TwoFactorSettings />)
    fireEvent.click(await screen.findByRole('button', { name: /开始设置/ }))
    fireEvent.change(await screen.findByLabelText('输入认证器显示的 6 位验证码'), {
      target: { value: '000000' },
    })
    fireEvent.click(screen.getByRole('button', { name: '确认并启用' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('验证码不正确')
    expect(alert.textContent).not.toContain('raw-server-text')
    expect(screen.getByText('绑定认证器')).toBeTruthy()
  })

  test('已启用时展示状态并提供重置恢复码 / 关闭入口', async () => {
    vi.spyOn(twoFactorApi, 'status').mockResolvedValue(ENABLED_STATUS)

    render(<TwoFactorSettings />)

    expect(await screen.findByText('已启用')).toBeTruthy()
    expect(screen.getByText('10 条')).toBeTruthy()
    expect(screen.getByRole('button', { name: /重新生成恢复码/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /关闭两步验证/ })).toBeTruthy()
  })

  test('恢复码剩余不多时给出警告', async () => {
    vi.spyOn(twoFactorApi, 'status').mockResolvedValue({
      ...ENABLED_STATUS,
      recoveryCodesRemaining: 1,
    })

    render(<TwoFactorSettings />)

    expect(await screen.findByText(/恢复码即将用尽/)).toBeTruthy()
  })

  test('关闭两步验证必须同时提交密码与第二因子（高风险重认证）', async () => {
    vi.spyOn(twoFactorApi, 'status').mockResolvedValue(ENABLED_STATUS)
    const disable = vi.spyOn(twoFactorApi, 'disable').mockResolvedValue(DISABLED_STATUS)

    render(<TwoFactorSettings />)
    fireEvent.click(await screen.findByRole('button', { name: /关闭两步验证/ }))

    // 不存在「只凭会话就摘掉 2FA」的路径：两项都填齐前提交按钮始终禁用
    const submit = (await screen.findByRole('button', {
      name: '确认关闭',
    })) as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('验证码或恢复码'), { target: { value: '123456' } })
    expect(submit.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('当前账号密码'), { target: { value: 'password123' } })
    expect(submit.disabled).toBe(false)

    fireEvent.click(submit)

    await waitFor(() => expect(disable).toHaveBeenCalledWith('123456', 'password123'))
    expect(await screen.findByText('未启用')).toBeTruthy()
  })

  test('更换认证器同样要求密码 + 当前第二因子', async () => {
    vi.spyOn(twoFactorApi, 'status').mockResolvedValue(ENABLED_STATUS)
    const setup = vi.spyOn(twoFactorApi, 'setup').mockResolvedValue(ENROLLMENT)

    render(<TwoFactorSettings />)
    fireEvent.click(await screen.findByRole('button', { name: /更换认证器/ }))

    const submit = (await screen.findByRole('button', {
      name: '验证并生成新二维码',
    })) as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('当前认证器的验证码或恢复码'), {
      target: { value: '654321' },
    })
    fireEvent.change(screen.getByLabelText('当前账号密码'), { target: { value: 'password123' } })
    fireEvent.click(submit)

    await waitFor(() =>
      expect(setup).toHaveBeenCalledWith({ currentCode: '654321', password: 'password123' }),
    )
    // 授权通过后才拿到新二维码
    expect(await screen.findByText(ENROLLMENT.secret)).toBeTruthy()
  })

  test('needs_reenrollment 状态明确告知用户绑定已失效', async () => {
    vi.spyOn(twoFactorApi, 'status').mockResolvedValue({
      ...DISABLED_STATUS,
      state: 'needs_reenrollment',
    })

    render(<TwoFactorSettings />)

    expect(await screen.findByText('需要重新绑定')).toBeTruthy()
    expect(screen.getByText(/此前的认证器绑定已失效/)).toBeTruthy()
    // 不能把用户留在「已启用」的假象里：入口是重新绑定，不是输验证码
    expect(screen.getByRole('button', { name: /开始设置/ })).toBeTruthy()
  })

  test('重新生成恢复码后展示新码', async () => {
    vi.spyOn(twoFactorApi, 'status').mockResolvedValue(ENABLED_STATUS)
    const fresh = RECOVERY_CODES.map((code) => code.replace('CODE', 'NEWC'))
    const regenerate = vi
      .spyOn(twoFactorApi, 'regenerateRecoveryCodes')
      .mockResolvedValue({ ...ENABLED_STATUS, recoveryCodes: fresh })

    render(<TwoFactorSettings />)
    fireEvent.click(await screen.findByRole('button', { name: /重新生成恢复码/ }))
    fireEvent.change(await screen.findByLabelText('验证码或恢复码'), {
      target: { value: 'AAAA-BBBB-CCCC-DDDD' },
    })
    fireEvent.click(screen.getByRole('button', { name: '生成新恢复码' }))

    await waitFor(() => expect(regenerate).toHaveBeenCalledWith('AAAA-BBBB-CCCC-DDDD'))
    expect(await screen.findByText(/恢复码已重新生成，旧码立即失效/)).toBeTruthy()
    for (const code of fresh) {
      expect(screen.getByText(code)).toBeTruthy()
    }
  })

  test('状态读取失败时给出可恢复提示而非空白页', async () => {
    vi.spyOn(twoFactorApi, 'status').mockRejectedValue(new Error('network'))

    render(<TwoFactorSettings />)

    expect(await screen.findByText('无法读取两步验证状态，请刷新页面重试。')).toBeTruthy()
  })

  test('恢复码导出文本含全部码与一次性说明', () => {
    const text = formatRecoveryCodesForDownload(RECOVERY_CODES, 'ada@aiproj.local')
    expect(text).toContain('ada@aiproj.local')
    expect(text).toContain('每条恢复码只能使用一次')
    for (const code of RECOVERY_CODES) {
      expect(text).toContain(code)
    }
  })
})
