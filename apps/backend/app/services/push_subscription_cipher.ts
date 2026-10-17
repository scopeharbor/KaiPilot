import crypto from 'node:crypto'
import logger from '@adonisjs/core/services/logger'

/**
 * PushSubscriptionCipher —— Web Push 订阅 endpoint/keys 的对称加解密（AES-256-GCM）。
 *
 * 密文格式 `v1.<iv>.<tag>.<enc>`（均 base64），自包含 iv+tag，落库单字段即可。
 * 密钥来源：`PWA_WEB_PUSH_ENCRYPTION_KEY` env（优先）；缺失则派生自 `APP_KEY`（sha256 取 32 字节）并告警。
 *
 * @see design.md D2 / spec pwa-web-push-notifications
 */
const ALGO = 'aes-256-gcm'
const IV_LEN = 12
const VERSION = 'v1'

function resolveKey(): Buffer {
  const explicit = process.env.PWA_WEB_PUSH_ENCRYPTION_KEY
  if (explicit && explicit.length > 0) {
    return crypto.createHash('sha256').update(explicit).digest()
  }
  const appKey = process.env.APP_KEY
  if (!appKey) {
    throw new Error('PWA_WEB_PUSH_ENCRYPTION_KEY 与 APP_KEY 均缺失，无法加解密 Web Push 订阅 keys')
  }
  logger.warn(
    'PWA_WEB_PUSH_ENCRYPTION_KEY 未设置，Web Push 订阅 key 加密回退派生自 APP_KEY（建议设置独立 key）',
  )
  return crypto.createHash('sha256').update(appKey).digest()
}

export default class PushSubscriptionCipher {
  encrypt(plain: string): string {
    const iv = crypto.randomBytes(IV_LEN)
    const cipher = crypto.createCipheriv(ALGO, resolveKey(), iv)
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return [VERSION, iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(
      '.',
    )
  }

  decrypt(payload: string): string {
    const parts = payload.split('.')
    if (parts.length !== 4 || parts[0] !== VERSION) {
      throw new Error('Web Push 订阅密文格式无效')
    }
    const iv = Buffer.from(parts[1], 'base64')
    const tag = Buffer.from(parts[2], 'base64')
    const enc = Buffer.from(parts[3], 'base64')
    const decipher = crypto.createDecipheriv(ALGO, resolveKey(), iv)
    decipher.setAuthTag(tag)
    const dec = Buffer.concat([decipher.update(enc), decipher.final()])
    return dec.toString('utf8')
  }
}
