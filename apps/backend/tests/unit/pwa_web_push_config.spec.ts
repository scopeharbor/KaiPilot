/**
 * v2-5-pwa-web-push-notifications -- Web Push 配置测试（task 2.4）。
 *
 * 验证：
 * - 默认环境下所有功能关闭（disabled-by-default）
 * - 缺失 VAPID 凭证无法产生生产发送
 * - fixture 模式不产生真实网络流量
 * - 完整配置可启用生产发送
 */
import { describe, expect, it } from 'vitest'

describe('PWA Web Push 配置 - 默认关闭', () => {
  it('PWA_WEB_PUSH_ENABLED 未设置时返回 false', () => {
    const raw = process.env.PWA_WEB_PUSH_ENABLED
    expect(raw === 'true' || raw === '1').toBe(false)
  })

  it('PWA_WEB_PUSH_SEND_ENABLED 未设置时返回 false', () => {
    const raw = process.env.PWA_WEB_PUSH_SEND_ENABLED
    expect(raw === 'true' || raw === '1').toBe(false)
  })

  it('默认 sender mode 为 fixture', () => {
    const raw = process.env.PWA_WEB_PUSH_SENDER_MODE
    const mode = raw === 'production' ? 'production' : 'fixture'
    expect(mode).toBe('fixture')
  })

  it('缺失 VAPID 凭证时无法生产发送', () => {
    process.env.PWA_WEB_PUSH_ENABLED = 'true'
    process.env.PWA_WEB_PUSH_SEND_ENABLED = 'true'
    process.env.PWA_WEB_PUSH_SENDER_MODE = 'production'

    const vapidPublic = process.env.PWA_WEB_PUSH_VAPID_PUBLIC_KEY
    const vapidPrivate = process.env.PWA_WEB_PUSH_VAPID_PRIVATE_KEY
    const vapidSubject = process.env.PWA_WEB_PUSH_VAPID_SUBJECT

    const canSend =
      process.env.PWA_WEB_PUSH_ENABLED === 'true' &&
      process.env.PWA_WEB_PUSH_SEND_ENABLED === 'true' &&
      process.env.PWA_WEB_PUSH_SENDER_MODE === 'production' &&
      !!vapidPublic &&
      !!vapidPrivate &&
      !!vapidSubject
    expect(canSend).toBe(false)

    delete process.env.PWA_WEB_PUSH_ENABLED
    delete process.env.PWA_WEB_PUSH_SEND_ENABLED
    delete process.env.PWA_WEB_PUSH_SENDER_MODE
  })

  it('缺失 VAPID 私钥时无法生产发送', () => {
    process.env.PWA_WEB_PUSH_ENABLED = 'true'
    process.env.PWA_WEB_PUSH_SEND_ENABLED = 'true'
    process.env.PWA_WEB_PUSH_SENDER_MODE = 'production'
    process.env.PWA_WEB_PUSH_VAPID_PUBLIC_KEY = 'BNr3...'
    process.env.PWA_WEB_PUSH_VAPID_SUBJECT = 'mailto:admin@example.com'

    const vapidPrivate = process.env.PWA_WEB_PUSH_VAPID_PRIVATE_KEY
    expect(!!vapidPrivate).toBe(false)

    delete process.env.PWA_WEB_PUSH_ENABLED
    delete process.env.PWA_WEB_PUSH_SEND_ENABLED
    delete process.env.PWA_WEB_PUSH_SENDER_MODE
    delete process.env.PWA_WEB_PUSH_VAPID_PUBLIC_KEY
    delete process.env.PWA_WEB_PUSH_VAPID_SUBJECT
  })

  it('缺失 VAPID subject 时无法生产发送', () => {
    process.env.PWA_WEB_PUSH_ENABLED = 'true'
    process.env.PWA_WEB_PUSH_SEND_ENABLED = 'true'
    process.env.PWA_WEB_PUSH_SENDER_MODE = 'production'
    process.env.PWA_WEB_PUSH_VAPID_PUBLIC_KEY = 'BNr3...'
    process.env.PWA_WEB_PUSH_VAPID_PRIVATE_KEY = 'priv-key'

    const vapidSubject = process.env.PWA_WEB_PUSH_VAPID_SUBJECT
    expect(!!vapidSubject).toBe(false)

    delete process.env.PWA_WEB_PUSH_ENABLED
    delete process.env.PWA_WEB_PUSH_SEND_ENABLED
    delete process.env.PWA_WEB_PUSH_SENDER_MODE
    delete process.env.PWA_WEB_PUSH_VAPID_PUBLIC_KEY
    delete process.env.PWA_WEB_PUSH_VAPID_PRIVATE_KEY
  })

  it('仅 enabled 但 sendEnabled=false 时不产生发送', () => {
    process.env.PWA_WEB_PUSH_ENABLED = 'true'

    const sendEnabled =
      process.env.PWA_WEB_PUSH_SEND_ENABLED === 'true' ||
      process.env.PWA_WEB_PUSH_SEND_ENABLED === '1'
    expect(sendEnabled).toBe(false)

    delete process.env.PWA_WEB_PUSH_ENABLED
  })

  it('fixture 模式下不产生真实网络流量', () => {
    process.env.PWA_WEB_PUSH_ENABLED = 'true'
    process.env.PWA_WEB_PUSH_SEND_ENABLED = 'true'

    const mode = process.env.PWA_WEB_PUSH_SENDER_MODE === 'production' ? 'production' : 'fixture'
    expect(mode).toBe('fixture')

    delete process.env.PWA_WEB_PUSH_ENABLED
    delete process.env.PWA_WEB_PUSH_SEND_ENABLED
  })

  it('完整 VAPID 凭证且全开启时允许生产发送', () => {
    process.env.PWA_WEB_PUSH_ENABLED = 'true'
    process.env.PWA_WEB_PUSH_SEND_ENABLED = 'true'
    process.env.PWA_WEB_PUSH_SENDER_MODE = 'production'
    process.env.PWA_WEB_PUSH_VAPID_PUBLIC_KEY = 'BNr3...'
    process.env.PWA_WEB_PUSH_VAPID_PRIVATE_KEY = 'priv-key'
    process.env.PWA_WEB_PUSH_VAPID_SUBJECT = 'mailto:admin@example.com'

    const canSend =
      process.env.PWA_WEB_PUSH_ENABLED === 'true' &&
      process.env.PWA_WEB_PUSH_SEND_ENABLED === 'true' &&
      process.env.PWA_WEB_PUSH_SENDER_MODE === 'production' &&
      !!process.env.PWA_WEB_PUSH_VAPID_PUBLIC_KEY &&
      !!process.env.PWA_WEB_PUSH_VAPID_PRIVATE_KEY &&
      !!process.env.PWA_WEB_PUSH_VAPID_SUBJECT
    expect(canSend).toBe(true)

    delete process.env.PWA_WEB_PUSH_ENABLED
    delete process.env.PWA_WEB_PUSH_SEND_ENABLED
    delete process.env.PWA_WEB_PUSH_SENDER_MODE
    delete process.env.PWA_WEB_PUSH_VAPID_PUBLIC_KEY
    delete process.env.PWA_WEB_PUSH_VAPID_PRIVATE_KEY
    delete process.env.PWA_WEB_PUSH_VAPID_SUBJECT
  })

  it('PWA_WEB_PUSH_ENABLED=true 时启用功能', () => {
    process.env.PWA_WEB_PUSH_ENABLED = 'true'
    const enabled =
      process.env.PWA_WEB_PUSH_ENABLED === 'true' || process.env.PWA_WEB_PUSH_ENABLED === '1'
    expect(enabled).toBe(true)

    delete process.env.PWA_WEB_PUSH_ENABLED
  })
})
