import crypto from 'node:crypto'

/**
 * TOTP（RFC 6238）与 Base32（RFC 4648）纯函数实现。
 *
 * 不引入第三方依赖：算法本身只有 HMAC + 动态截断，Node 内置 crypto 即可覆盖；
 * 少一个供应链依赖对认证链路是净收益。本模块**无副作用、不碰数据库**，
 * 便于用 RFC 官方测试向量直接回归。
 */

/** RFC 4648 Base32 字母表（大写 A-Z + 2-7），认证器 App 通用。 */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export type TotpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512'

/** RFC 6238 默认参数：SHA1 / 6 位 / 30 秒，与 Google Authenticator 等主流 App 对齐。 */
export const TOTP_DEFAULTS = {
  algorithm: 'SHA1' as TotpAlgorithm,
  digits: 6,
  period: 30,
  /** 校验时前后各容忍的时间步数（±1 步 = ±30 秒，覆盖手机时钟漂移）。 */
  window: 1,
} as const

/** 把字节序列编成不带 `=` 填充的 Base32（认证器扫码/手工录入格式）。 */
export function base32Encode(buffer: Buffer): string {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of buffer) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  }
  return output
}

/**
 * 解析 Base32 字符串（容忍小写、空格与 `=` 填充）。
 * 出现字母表之外的字符即抛错——手工录入错字必须当场失败，不得静默按 0 处理。
 */
export function base32Decode(input: string): Buffer {
  const normalized = input.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase()
  if (normalized.length === 0) {
    throw new Error('Base32 密钥为空')
  }
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char)
    if (index === -1) {
      throw new Error('Base32 密钥包含非法字符')
    }
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

/**
 * 生成新的 TOTP 密钥（Base32）。
 * 默认 20 字节 = 160 位，正好是 RFC 4226 对 HMAC-SHA1 建议的密钥长度。
 */
export function generateSecret(byteLength = 20): string {
  return base32Encode(crypto.randomBytes(byteLength))
}

/** 当前时间（毫秒）对应的 TOTP 时间步。 */
export function currentStep(period: number = TOTP_DEFAULTS.period, nowMs: number = Date.now()) {
  return Math.floor(nowMs / 1000 / period)
}

function hmacName(algorithm: TotpAlgorithm): string {
  switch (algorithm) {
    case 'SHA256':
      return 'sha256'
    case 'SHA512':
      return 'sha512'
    default:
      return 'sha1'
  }
}

/**
 * 计算指定时间步的一次性口令（RFC 4226 动态截断）。
 */
export function totpCodeForStep(
  secret: string,
  step: number,
  options: { digits?: number; algorithm?: TotpAlgorithm } = {},
): string {
  const digits = options.digits ?? TOTP_DEFAULTS.digits
  const algorithm = options.algorithm ?? TOTP_DEFAULTS.algorithm

  // 8 字节大端计数器；step 可能超过 32 位，用 BigInt 写入避免精度丢失。
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))

  const digest = crypto
    .createHmac(hmacName(algorithm), base32Decode(secret))
    .update(counter)
    .digest()
  const offset = digest[digest.length - 1] & 0x0f
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff)

  return String(binary % 10 ** digits).padStart(digits, '0')
}

/** 去掉用户粘贴时常见的空格/连字符，只保留数字。 */
export function normalizeTotpCode(code: string): string {
  return code.replace(/[\s-]/g, '')
}

/** 是否全为 ASCII 数字（空串返回 false）。 */
function isAllDigits(value: string): boolean {
  if (value.length === 0) return false
  for (let index = 0; index < value.length; index += 1) {
    const charCode = value.charCodeAt(index)
    if (charCode < 48 || charCode > 57) return false
  }
  return true
}

/** 定长常量时间比较：长度不等直接判否，避免 timingSafeEqual 抛错。 */
function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return crypto.timingSafeEqual(left, right)
}

/**
 * 校验一次性口令。
 *
 * 返回**命中的时间步**（而非布尔值）——调用方据此写入 `last_used_step`，
 * 让同一时间步的验证码无法被重放（RFC 6238 §5.2 要求）。不匹配返回 `null`。
 */
export function verifyTotpCode(
  secret: string,
  code: string,
  options: {
    digits?: number
    period?: number
    algorithm?: TotpAlgorithm
    window?: number
    nowMs?: number
    /** 已消费过的时间步（含）——小于等于它的一律拒绝。 */
    lastUsedStep?: number | null
  } = {},
): number | null {
  const digits = options.digits ?? TOTP_DEFAULTS.digits
  const period = options.period ?? TOTP_DEFAULTS.period
  const algorithm = options.algorithm ?? TOTP_DEFAULTS.algorithm
  const window = options.window ?? TOTP_DEFAULTS.window

  const candidate = normalizeTotpCode(code)
  // 刻意不用动态构造的正则：`\d` 在模板字符串里是转义序列，拼进 RegExp 极易写成
  // 匹配字母 d 的死规则（且一旦写错就是「永远验不过」而非报错）。显式判定更难写错。
  if (candidate.length !== digits || !isAllDigits(candidate)) return null

  const center = currentStep(period, options.nowMs ?? Date.now())
  const lastUsedStep = options.lastUsedStep ?? null
  for (let drift = -window; drift <= window; drift += 1) {
    const step = center + drift
    if (step < 0) continue
    if (lastUsedStep !== null && step <= lastUsedStep) {
      continue
    }
    if (constantTimeEquals(totpCodeForStep(secret, step, { digits, algorithm }), candidate)) {
      return step
    }
  }
  return null
}

/**
 * 生成 `otpauth://totp/...` 配置 URI（认证器扫码内容）。
 *
 * label 用 `issuer:account` 形式，参数里再带一次 issuer——这是 Google Authenticator
 * key-uri-format 的既定约定，两处都写才能在各家 App 里稳定显示归属。
 */
export function buildOtpauthUri(input: {
  secret: string
  accountName: string
  issuer: string
  digits?: number
  period?: number
  algorithm?: TotpAlgorithm
}): string {
  const digits = input.digits ?? TOTP_DEFAULTS.digits
  const period = input.period ?? TOTP_DEFAULTS.period
  const algorithm = input.algorithm ?? TOTP_DEFAULTS.algorithm
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.accountName)}`
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm,
    digits: String(digits),
    period: String(period),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}

/** 单条恢复码的字符数（Base32，每字符 5 位）。 */
const RECOVERY_CODE_CHARS = 16

/**
 * 生成一批恢复码（每条 16 位 Base32 = 80 位熵，展示为 `XXXX-XXXX-XXXX-XXXX`）。
 *
 * 为什么是 80 位而不是常见的 50 位：恢复码按 sha256 存储（见 `hashRecoveryCode`），
 * 快哈希 + 无盐意味着库一旦泄露就能离线爆破。50 位在现代 GPU 上（约 10^10 次/秒）
 * 只需数小时即可命中一个用户的某条码；80 位把这个数字推到宇宙尺度。
 * 代价只是用户多敲 6 个字符，而恢复码是极低频操作。
 *
 * 用 `crypto.randomInt` 做无偏取样，避免 `% 32` 造成的模偏置。
 */
export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = []
  for (let index = 0; index < count; index += 1) {
    let raw = ''
    for (let position = 0; position < RECOVERY_CODE_CHARS; position += 1) {
      raw += BASE32_ALPHABET[crypto.randomInt(0, BASE32_ALPHABET.length)]
    }
    codes.push((raw.match(/.{4}/g) ?? [raw]).join('-'))
  }
  return codes
}

/** 恢复码规范化：去分隔符 + 大写，保证「录入形态」与「存储哈希」一一对应。 */
export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase()
}

/** 恢复码哈希（sha256 十六进制）。恢复码自带 80 位熵，离线爆破不可行，无需慢哈希。 */
export function hashRecoveryCode(code: string): string {
  return crypto.createHash('sha256').update(normalizeRecoveryCode(code), 'utf8').digest('hex')
}
