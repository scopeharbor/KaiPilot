/**
 * v3-ui-next-settings-admin-domains W1 · tasks 1.10 —— 两步验证向导组件测试
 * （spec「个人两步验证向导」，design D-2FA）。
 *
 * 覆盖：
 * - 未启用 → 绑定（enrolling）→ 确认 → 恢复码（codes）→ 已启用全链路状态机；
 * - 恢复码二次进入页面不可再取（明文仅内存：离开 codes 阶段后组件状态里不再有）；
 * - 错误口令关闭失败并回显服务端错误（按钮复位允许重试）；
 * - 重新生成恢复码的旧码作废警示。
 */
import * as React from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from '@testing-library/react'
import { TwoFactorWorkspace } from '@/components/next/settings/security/TwoFactorWorkspace'
import { twoFactorApi, type TwoFactorStatus } from '@/lib/api/two-factor'
import { useAuthStore } from '@/stores/auth-store'
import { useNextTrackStore } from '@/stores/next-track-store'
import { accessTokenWith } from './_jwt-helper'

// qrcode 在 jsdom 下会走 canvas；只关心「二维码渲染进了 img」。
vi.mock('qrcode', () => ({
  default: { toDataURL: () => Promise.resolve('data:image/png;base64,stub') },
}))

/** 口令防抖窗口（与实现一致）。 */
const DEBOUNCE_WAIT = 350

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
  useAuthStore.setState({
    user: { id: 7, email: 'ada@aiproj.local', fullName: 'Ada', organizations: [] },
    accessToken: accessTokenWith([]),
    refreshToken: 'refresh-1',
    permissions: [],
    currentOrganizationId: null,
    planTier: 'enterprise',
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

/** 等待口令防抖窗口结束（防抖计时器在真实时钟上跑，需显式推进）。 */
async function settleDebounce() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_WAIT))
  })
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  signIn()
  useNextTrackStore.setState({ immersionTier: null })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  useNextTrackStore.setState({ immersionTier: null })
  document.documentElement.removeAttribute('data-immersion')
})

describe('新轨两步验证向导', () => {
  test('未启用 → 绑定 → 确认 → 恢复码 → 已启用全链路状态机', async () => {
    const statusSpy = vi
      .spyOn(twoFactorApi, 'status')
      .mockResolvedValueOnce(DISABLED_STATUS)
      .mockResolvedValueOnce(ENABLED_STATUS)
    const setupSpy = vi.spyOn(twoFactorApi, 'setup').mockResolvedValue(ENROLLMENT)
    const confirmSpy = vi.spyOn(twoFactorApi, 'confirm').mockResolvedValue({
      ...ENABLED_STATUS,
      recoveryCodes: RECOVERY_CODES,
    })

    const { container } = render(<TwoFactorWorkspace />)

    // 阶段一：未启用总览
    await waitFor(() => expect(container.querySelector('[data-stage="overview"]')).not.toBeNull())
    expect(screen.getByText('未启用')).toBeTruthy()
    expect(container.querySelector('[data-two-factor-disable-button]')).toBeNull()

    fireEvent.click(container.querySelector('[data-two-factor-setup-button]') as HTMLElement)
    await waitFor(() => expect(container.querySelector('[data-stage="enrolling"]')).not.toBeNull())
    expect(setupSpy).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[data-two-factor-secret]')?.textContent).toBe(ENROLLMENT.secret)

    // 阶段二：输入动态口令（防抖后提交）
    const codeInput = screen.getByLabelText('输入认证器显示的 6 位验证码')
    fireEvent.change(codeInput, { target: { value: '123456' } })
    const submit = container.querySelector(
      '[data-two-factor-prompt-submit="next-two-factor-confirm"]',
    ) as HTMLButtonElement
    // 防抖未结束：提交被阻断（零请求）
    fireEvent.click(submit)
    expect(confirmSpy).not.toHaveBeenCalled()

    await settleDebounce()
    fireEvent.click(submit)
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledWith('123456'))

    // 阶段三：恢复码一次性展示
    await waitFor(() =>
      expect(container.querySelector('[data-two-factor-recovery-codes]')).not.toBeNull(),
    )
    expect(container.querySelector('[data-stage="codes"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-two-factor-recovery-list] li')).toHaveLength(
      RECOVERY_CODES.length,
    )
    expect(screen.getByText(/两步验证已启用。/)).toBeTruthy()

    // 「已保存恢复码」必须显式勾选
    const done = container.querySelector('[data-two-factor-recovery-done]') as HTMLButtonElement
    expect(done.disabled).toBe(true)
    fireEvent.click(container.querySelector('[data-two-factor-recovery-ack]') as HTMLElement)
    expect(done.disabled).toBe(false)

    fireEvent.click(done)
    // 回到已启用总览（恢复码不再可见）
    await waitFor(() => expect(container.querySelector('[data-stage="overview"]')).not.toBeNull())
    expect(container.querySelector('[data-two-factor-recovery-codes]')).toBeNull()
    expect(screen.getByText('已启用')).toBeTruthy()
    expect(
      container.querySelector('[data-two-factor-overview]')?.getAttribute('data-enabled'),
    ).toBe('true')
    await waitFor(() => expect(statusSpy).toHaveBeenCalledTimes(2))
  })

  test('恢复码二次进入页面不可再取（明文只活组件内存）', async () => {
    vi.spyOn(twoFactorApi, 'status').mockResolvedValue(ENABLED_STATUS)
    vi.spyOn(twoFactorApi, 'setup').mockResolvedValue(ENROLLMENT)

    const confirmSpy = vi.spyOn(twoFactorApi, 'confirm').mockResolvedValue({
      ...ENABLED_STATUS,
      recoveryCodes: RECOVERY_CODES,
    })

    // 已启用状态走「更换认证器」路径拿恢复码
    const first = render(<TwoFactorWorkspace />)
    await waitFor(() =>
      expect(first.container.querySelector('[data-two-factor-rebind-button]')).not.toBeNull(),
    )
    fireEvent.click(first.container.querySelector('[data-two-factor-rebind-button]') as HTMLElement)
    // 换绑需先验证身份（口令 + 密码）
    fireEvent.change(screen.getByLabelText('当前账号密码'), { target: { value: 'secret' } })
    fireEvent.change(screen.getByLabelText('当前认证器的验证码或恢复码'), {
      target: { value: '654321' },
    })
    await settleDebounce()
    fireEvent.click(
      first.container.querySelector(
        '[data-two-factor-prompt-submit="next-two-factor-rebind"]',
      ) as HTMLElement,
    )
    await waitFor(() =>
      expect(first.container.querySelector('[data-stage="enrolling"]')).not.toBeNull(),
    )

    fireEvent.change(screen.getByLabelText('输入认证器显示的 6 位验证码'), {
      target: { value: '111111' },
    })
    await settleDebounce()
    fireEvent.click(
      first.container.querySelector(
        '[data-two-factor-prompt-submit="next-two-factor-confirm"]',
      ) as HTMLElement,
    )
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled())

    const codes = await first.findAllByText(RECOVERY_CODES[0] as string)
    expect(codes.length).toBeGreaterThan(0)

    // 明文不落任何持久化存储
    expect(localStorage.getItem('aiproj-recovery-codes')).toBeNull()
    expect(sessionStorage.getItem('aiproj-recovery-codes')).toBeNull()
    expect(JSON.stringify(localStorage)).not.toContain(RECOVERY_CODES[0] as string)
    expect(JSON.stringify(sessionStorage)).not.toContain(RECOVERY_CODES[0] as string)

    // unmount + remount 后恢复码不再出现（明文仅内存）
    first.unmount()
    vi.spyOn(twoFactorApi, 'status').mockResolvedValue(ENABLED_STATUS)
    const second = render(<TwoFactorWorkspace />)
    await waitFor(() =>
      expect(second.container.querySelector('[data-stage="overview"]')).not.toBeNull(),
    )
    expect(second.container.querySelector('[data-two-factor-recovery-codes]')).toBeNull()
    expect(screen.queryByText(RECOVERY_CODES[0] as string)).toBeNull()
  })

  test('错误口令关闭失败并回显服务端错误，2FA 保持启用且按钮复位', async () => {
    vi.spyOn(twoFactorApi, 'status').mockResolvedValue(ENABLED_STATUS)
    const disableSpy = vi.spyOn(twoFactorApi, 'disable').mockRejectedValue({
      status: 422,
      code: 'TWO_FACTOR_INVALID_CODE',
      message: 'boom',
    })

    const { container } = render(<TwoFactorWorkspace />)
    await waitFor(() =>
      expect(container.querySelector('[data-two-factor-disable-button]')).not.toBeNull(),
    )

    fireEvent.click(container.querySelector('[data-two-factor-disable-button]') as HTMLElement)
    fireEvent.change(screen.getByLabelText('当前账号密码'), { target: { value: 'secret' } })
    fireEvent.change(screen.getByLabelText('验证码或恢复码'), { target: { value: '000000' } })
    await settleDebounce()

    const submit = container.querySelector(
      '[data-two-factor-prompt-submit="next-two-factor-disable"]',
    ) as HTMLButtonElement
    fireEvent.click(submit)

    await waitFor(() => expect(disableSpy).toHaveBeenCalledWith('000000', 'secret'))
    // 服务端错误码映射成中文文案（不回显原始 message）
    const error = await container.querySelector('[data-two-factor-prompt-error]')
    expect(error?.textContent).toContain('验证码不正确')
    expect(error?.textContent).not.toContain('boom')

    // 2FA 仍为启用状态，口令提示卡保留（可重试），提交按钮复位
    expect(
      container.querySelector('[data-two-factor-overview]')?.getAttribute('data-enabled'),
    ).toBe('true')
    expect(container.querySelector('[data-two-factor-prompt-error]')).not.toBeNull()
    await waitFor(() => expect(submit.disabled).toBe(false))
  })

  test('重新生成恢复码展示旧码作废警示', async () => {
    vi.spyOn(twoFactorApi, 'status').mockResolvedValue(ENABLED_STATUS)
    const regenerateSpy = vi.spyOn(twoFactorApi, 'regenerateRecoveryCodes').mockResolvedValue({
      ...ENABLED_STATUS,
      recoveryCodes: RECOVERY_CODES,
    })

    const { container } = render(<TwoFactorWorkspace />)
    await waitFor(() =>
      expect(container.querySelector('[data-two-factor-regenerate-button]')).not.toBeNull(),
    )

    fireEvent.click(container.querySelector('[data-two-factor-regenerate-button]') as HTMLElement)
    // 展开确认卡（描述含旧码作废语义）
    expect(screen.getByText(/当前全部恢复码会立即失效/)).toBeTruthy()

    fireEvent.change(screen.getByLabelText('验证码或恢复码'), { target: { value: '222222' } })
    await settleDebounce()
    fireEvent.click(
      container.querySelector(
        '[data-two-factor-prompt-submit="next-two-factor-regenerate"]',
      ) as HTMLElement,
    )

    await waitFor(() => expect(regenerateSpy).toHaveBeenCalledWith('222222'))
    await waitFor(() => {
      const notice = container.querySelector('[data-two-factor-recovery-notice]')
      expect(notice?.textContent ?? '').toContain('恢复码已重新生成，旧码立即失效。')
    })
  })

  test('读取状态失败渲染错误卡与「重新载入」重试', async () => {
    const statusSpy = vi
      .spyOn(twoFactorApi, 'status')
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(ENABLED_STATUS)

    const { container } = render(<TwoFactorWorkspace />)

    await waitFor(() => expect(container.querySelector('[data-two-factor-error]')).not.toBeNull())
    expect(screen.getByText('两步验证状态加载失败')).toBeTruthy()

    fireEvent.click(container.querySelector('[data-two-factor-retry]') as HTMLElement)
    await waitFor(() =>
      expect(container.querySelector('[data-two-factor-overview]')).not.toBeNull(),
    )
    expect(statusSpy).toHaveBeenCalledTimes(2)
  })

  test('精确档剥离氛围光晕与动效', async () => {
    vi.spyOn(twoFactorApi, 'status').mockResolvedValue(DISABLED_STATUS)
    useNextTrackStore.setState({ immersionTier: 'precise' })

    const { container } = render(<TwoFactorWorkspace />)
    await waitFor(() =>
      expect(container.querySelector('[data-two-factor-workspace]')).not.toBeNull(),
    )
    const workspace = container.querySelector('[data-two-factor-workspace]') as HTMLElement
    expect(workspace.getAttribute('data-immersion')).toBe('precise')
    expect(workspace.className).not.toContain('nx-space-atmosphere')
    expect(workspace.innerHTML).not.toMatch(/\btransition-(colors|transform)\b/)
  })
})
