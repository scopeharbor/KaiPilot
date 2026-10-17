import crypto from 'node:crypto'
import env from '#start/env'

const ALGORITHM = 'aes-256-gcm'

export default class IntegrationTokenCipher {
  encrypt(plainText: string): string {
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv(ALGORITHM, this.key(), iv)
    const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return [iv, tag, encrypted].map((part) => part.toString('base64url')).join('.')
  }

  decrypt(payload: string): string {
    const [ivRaw, tagRaw, encryptedRaw] = payload.split('.')
    if (!ivRaw || !tagRaw || !encryptedRaw) {
      throw new Error('Invalid encrypted token payload')
    }
    const decipher = crypto.createDecipheriv(ALGORITHM, this.key(), Buffer.from(ivRaw, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedRaw, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  }

  private key(): Buffer {
    const source = env.get('INTEGRATION_TOKEN_ENCRYPTION_KEY') || String(env.get('APP_KEY'))
    return crypto.createHash('sha256').update(source).digest()
  }
}
