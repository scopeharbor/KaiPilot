import crypto from 'node:crypto'
import env from '#start/env'
import logger from '@adonisjs/core/services/logger'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const VERSION = 'v1'

/**
 * 密钥读不出来的两种成因——**必须分开**，因为处置方式相反：
 *
 * - `malformed`：密文本身结构不合法（空串、段数不对、版本号不认识）。
 *   这条记录没救了，且不可能是配置问题，自动修复成「需要重新绑定」是安全的。
 * - `undecryptable`：密文结构完好但解不开（auth tag 校验失败）——通常意味着
 *   **加密密钥变了或配错了**。此时全站所有凭据都读不出来，若按「坏数据」自动清理，
 *   一次配置失误就会抹掉所有人的 2FA。必须 fail closed，交由人工处置。
 */
export type TwoFactorSecretUnreadableReason = 'malformed' | 'undecryptable'

export class TwoFactorSecretUnreadableError extends Error {
  constructor(readonly reason: TwoFactorSecretUnreadableReason) {
    super(`两步验证密钥不可读（${reason}）`)
    this.name = 'TwoFactorSecretUnreadableError'
  }
}

/**
 * TOTP 密钥的静态加密（AES-256-GCM）。
 *
 * 与 `CryptoService`（AI 连接 key）、`IntegrationTokenCipher`（OAuth token）同构：
 * 每个密钥域一个 cipher 类 + 专属 env key + APP_KEY 兜底。这样轮换任一域的密钥
 * 不会牵连其他域——2FA 密钥泄露的爆炸半径必须止于 2FA。
 *
 * 密文自包含 iv 与 auth tag，落库单字段即可。
 */
export default class TwoFactorSecretCipher {
  encrypt(plain: string): string {
    const iv = crypto.randomBytes(IV_LENGTH)
    const cipher = crypto.createCipheriv(ALGORITHM, this.key(), iv)
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return [
      VERSION,
      iv.toString('base64url'),
      tag.toString('base64url'),
      encrypted.toString('base64url'),
    ].join('.')
  }

  /**
   * 解密。失败时抛 `TwoFactorSecretUnreadableError`，并**区分成因**（见该类型注释）。
   * 绝不把密文、密钥或原始错误写进消息——异常会一路冒到日志里。
   */
  decrypt(payload: string): string {
    const parts = payload.split('.')
    if (parts.length !== 4 || parts[0] !== VERSION || parts.some((part) => part.length === 0)) {
      throw new TwoFactorSecretUnreadableError('malformed')
    }
    try {
      const decipher = crypto.createDecipheriv(
        ALGORITHM,
        this.key(),
        Buffer.from(parts[1], 'base64url'),
      )
      decipher.setAuthTag(Buffer.from(parts[2], 'base64url'))
      return Buffer.concat([
        decipher.update(Buffer.from(parts[3], 'base64url')),
        decipher.final(),
      ]).toString('utf8')
    } catch {
      // 结构完好却解不开 = 密钥不匹配。不当作坏数据处理。
      throw new TwoFactorSecretUnreadableError('undecryptable')
    }
  }

  private key(): Buffer {
    const explicit = env.get('TWO_FACTOR_ENCRYPTION_KEY')
    if (explicit && explicit.length > 0) {
      return crypto.createHash('sha256').update(explicit).digest()
    }
    const appKey = process.env.APP_KEY
    if (!appKey) {
      throw new Error('TWO_FACTOR_ENCRYPTION_KEY 与 APP_KEY 均缺失，无法加解密两步验证密钥')
    }
    logger.warn(
      'TWO_FACTOR_ENCRYPTION_KEY 未设置，两步验证密钥加密回退派生自 APP_KEY（建议生产设置独立 key）',
    )
    return crypto.createHash('sha256').update(appKey).digest()
  }
}
