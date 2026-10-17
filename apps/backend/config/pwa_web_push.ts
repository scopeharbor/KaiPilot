/**
 * PWA Web Push 配置（v2-5-pwa-web-push-notifications，design D3）。
 *
 * 装配自环境变量，提供 Web Push 功能门禁、发送模式和 VAPID 凭证。
 * 默认全关闭，需要时通过环境变量逐步启用。
 *
 * @see design.md D3 / spec pwa-web-push-notifications
 */

/** 读取布尔值环境变量。 */
function readBool(key: string, defaultValue: boolean = false): boolean {
  const raw = process.env[key]
  if (raw === undefined || raw === '') return defaultValue
  return raw === 'true' || raw === '1'
}

/** 读取字符串环境变量（可选）。 */
function readOptionalString(key: string): string | undefined {
  const raw = process.env[key]
  if (raw === undefined || raw === '') return undefined
  return raw
}

const pwaWebPushConfig = {
  /**
   * 功能总开关：是否公开 Web Push 订阅 UI/API。
   * 关闭时隐藏订阅入口、拒绝订阅变更、发送 no-op。
   */
  get enabled(): boolean {
    return readBool('PWA_WEB_PUSH_ENABLED')
  },

  /**
   * 发送总开关：是否允许实际外发推送。
   * 关闭时仅记录发送意图（fixture 模式），不产生真实网络流量。
   */
  get sendEnabled(): boolean {
    return readBool('PWA_WEB_PUSH_SEND_ENABLED')
  },

  /**
   * 发送器模式：'fixture'（默认）| 'production'。
   * production 模式需要完整 VAPID 凭证且 sendEnabled 必须为 true。
   */
  get senderMode(): 'fixture' | 'production' {
    const raw = process.env.PWA_WEB_PUSH_SENDER_MODE
    if (raw === 'production') return 'production'
    return 'fixture'
  },

  /** VAPID 公钥（base64url 编码，浏览器 subscribe 用）。 */
  get vapidPublicKey(): string | undefined {
    return readOptionalString('PWA_WEB_PUSH_VAPID_PUBLIC_KEY')
  },

  /** VAPID 私钥（base64url 编码，签名推送请求用）。 */
  get vapidPrivateKey(): string | undefined {
    return readOptionalString('PWA_WEB_PUSH_VAPID_PRIVATE_KEY')
  },

  /** VAPID 联系人（mailto: 或 URL）。 */
  get vapidSubject(): string | undefined {
    return readOptionalString('PWA_WEB_PUSH_VAPID_SUBJECT')
  },

  /**
   * 检查是否可进行生产发送。
   * 需同时满足：enabled + sendEnabled + senderMode=production + 完整 VAPID 凭证。
   */
  get canSendProduction(): boolean {
    if (!this.enabled) return false
    if (!this.sendEnabled) return false
    if (this.senderMode !== 'production') return false
    if (!this.vapidPublicKey || !this.vapidPrivateKey || !this.vapidSubject) return false
    return true
  },
}

export default pwaWebPushConfig
