import { describe, expect, it } from 'vitest'
import {
  base32Decode,
  base32Encode,
  buildOtpauthUri,
  generateRecoveryCodes,
  generateSecret,
  hashRecoveryCode,
  normalizeRecoveryCode,
  normalizeTotpCode,
  totpCodeForStep,
  verifyTotpCode,
} from '../../app/services/two_factor/totp.js'

/**
 * TOTP 核心算法回归。
 *
 * 关键点是**用 RFC 6238 Appendix B 的官方测试向量**验证，而不是自己算一遍再断言
 * 自己的结果——后者只能证明实现自洽，证明不了它和认证器 App 算的是同一个东西。
 */

/** RFC 6238 Appendix B 的 SHA1 种子 "12345678901234567890"（ASCII）的 Base32 形式。 */
const RFC_SECRET_SHA1 = base32Encode(Buffer.from('12345678901234567890', 'ascii'))
/** SHA256 种子为 32 字节：种子串循环补齐（RFC 6238 勘误后的公认取值）。 */
const RFC_SECRET_SHA256 = base32Encode(Buffer.from('12345678901234567890123456789012', 'ascii'))
/** SHA512 种子为 64 字节，同样循环补齐。 */
const RFC_SECRET_SHA512 = base32Encode(
  Buffer.from('1234567890123456789012345678901234567890123456789012345678901234', 'ascii'),
)

describe('Base32（RFC 4648）', () => {
  it('对已知向量编解码一致', () => {
    expect(base32Encode(Buffer.from('12345678901234567890', 'ascii'))).toBe(
      'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
    )
    expect(base32Decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ').toString('ascii')).toBe(
      '12345678901234567890',
    )
  })

  it('容忍小写、空格与填充', () => {
    const secret = generateSecret()
    const messy = `${secret.toLowerCase().slice(0, 8)} ${secret.toLowerCase().slice(8)}==`
    expect(base32Decode(messy).equals(base32Decode(secret))).toBe(true)
  })

  it('非法字符当场失败，不静默按 0 处理', () => {
    // 1 / 8 / 0 均不在 RFC 4648 Base32 字母表内，是手工录入最常见的错字。
    expect(() => base32Decode('AAAA1AAA')).toThrow()
    expect(() => base32Decode('')).toThrow()
  })

  it('任意字节长度都能往返', () => {
    for (const length of [1, 2, 3, 4, 5, 10, 20, 32, 64]) {
      const raw = Buffer.alloc(length, 0xab)
      expect(base32Decode(base32Encode(raw)).equals(raw)).toBe(true)
    }
  })
})

describe('TOTP 官方测试向量（RFC 6238 Appendix B）', () => {
  // [Unix 时间, 期望 8 位口令]
  const sha1Vectors: Array<[number, string]> = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ]

  it.each(sha1Vectors)('SHA1 T=%i → %s', (unixTime, expected) => {
    const step = Math.floor(unixTime / 30)
    expect(totpCodeForStep(RFC_SECRET_SHA1, step, { digits: 8, algorithm: 'SHA1' })).toBe(expected)
  })

  const sha256Vectors: Array<[number, string]> = [
    [59, '46119246'],
    [1111111109, '68084774'],
    [1234567890, '91819424'],
    [20000000000, '77737706'],
  ]

  it.each(sha256Vectors)('SHA256 T=%i → %s', (unixTime, expected) => {
    const step = Math.floor(unixTime / 30)
    expect(totpCodeForStep(RFC_SECRET_SHA256, step, { digits: 8, algorithm: 'SHA256' })).toBe(
      expected,
    )
  })

  const sha512Vectors: Array<[number, string]> = [
    [59, '90693936'],
    [1111111109, '25091201'],
    [1234567890, '93441116'],
    [20000000000, '47863826'],
  ]

  it.each(sha512Vectors)('SHA512 T=%i → %s', (unixTime, expected) => {
    const step = Math.floor(unixTime / 30)
    expect(totpCodeForStep(RFC_SECRET_SHA512, step, { digits: 8, algorithm: 'SHA512' })).toBe(
      expected,
    )
  })

  it('默认 6 位口令是 8 位向量的后 6 位', () => {
    // 动态截断取的是同一个 31 位整数，位数只影响最后一次取模。
    expect(totpCodeForStep(RFC_SECRET_SHA1, Math.floor(59 / 30), { digits: 6 })).toBe('287082')
  })
})

describe('verifyTotpCode', () => {
  const secret = generateSecret()
  const nowMs = 1_700_000_000_000
  const currentStepValue = Math.floor(nowMs / 1000 / 30)

  it('接受当前时间步的口令并返回命中的步数', () => {
    const code = totpCodeForStep(secret, currentStepValue)
    expect(verifyTotpCode(secret, code, { nowMs })).toBe(currentStepValue)
  })

  it('在 ±1 步窗口内容忍时钟漂移', () => {
    expect(verifyTotpCode(secret, totpCodeForStep(secret, currentStepValue - 1), { nowMs })).toBe(
      currentStepValue - 1,
    )
    expect(verifyTotpCode(secret, totpCodeForStep(secret, currentStepValue + 1), { nowMs })).toBe(
      currentStepValue + 1,
    )
  })

  it('拒绝窗口外的口令', () => {
    expect(verifyTotpCode(secret, totpCodeForStep(secret, currentStepValue - 2), { nowMs })).toBe(
      null,
    )
    expect(verifyTotpCode(secret, totpCodeForStep(secret, currentStepValue + 2), { nowMs })).toBe(
      null,
    )
  })

  it('拒绝已消费时间步（同步口令重放防护）', () => {
    const code = totpCodeForStep(secret, currentStepValue)
    expect(verifyTotpCode(secret, code, { nowMs, lastUsedStep: currentStepValue })).toBe(null)
    // 更早的时间步同样被 lastUsedStep 挡住
    expect(
      verifyTotpCode(secret, totpCodeForStep(secret, currentStepValue - 1), {
        nowMs,
        lastUsedStep: currentStepValue,
      }),
    ).toBe(null)
    // 下一步仍可用
    expect(
      verifyTotpCode(secret, totpCodeForStep(secret, currentStepValue + 1), {
        nowMs,
        lastUsedStep: currentStepValue,
      }),
    ).toBe(currentStepValue + 1)
  })

  it('拒绝位数不符或非数字输入，不抛异常', () => {
    expect(verifyTotpCode(secret, '', { nowMs })).toBe(null)
    expect(verifyTotpCode(secret, '12345', { nowMs })).toBe(null)
    expect(verifyTotpCode(secret, '1234567', { nowMs })).toBe(null)
    expect(verifyTotpCode(secret, 'abcdef', { nowMs })).toBe(null)
  })

  it('容忍用户粘贴时带的空格与连字符', () => {
    const code = totpCodeForStep(secret, currentStepValue)
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`
    expect(normalizeTotpCode(spaced)).toBe(code)
    expect(verifyTotpCode(secret, spaced, { nowMs })).toBe(currentStepValue)
  })

  it('换一个密钥就验不过（口令确实绑定密钥）', () => {
    const code = totpCodeForStep(secret, currentStepValue)
    expect(verifyTotpCode(generateSecret(), code, { nowMs })).toBe(null)
  })
})

describe('otpauth URI', () => {
  it('按 key-uri-format 同时在 label 与参数里写 issuer', () => {
    const uri = buildOtpauthUri({
      secret: 'JBSWY3DPEHPK3PXP',
      accountName: 'ada@example.com',
      issuer: '开项 Kaiplan',
    })
    const parsed = new URL(uri)
    expect(parsed.protocol).toBe('otpauth:')
    expect(uri.startsWith('otpauth://totp/')).toBe(true)
    expect(decodeURIComponent(parsed.pathname)).toContain('开项 Kaiplan:ada@example.com')
    expect(parsed.searchParams.get('secret')).toBe('JBSWY3DPEHPK3PXP')
    expect(parsed.searchParams.get('issuer')).toBe('开项 Kaiplan')
    expect(parsed.searchParams.get('algorithm')).toBe('SHA1')
    expect(parsed.searchParams.get('digits')).toBe('6')
    expect(parsed.searchParams.get('period')).toBe('30')
  })
})

describe('恢复码', () => {
  it('生成 10 条互不相同的 80 位熵码（XXXX-XXXX-XXXX-XXXX）', () => {
    const codes = generateRecoveryCodes()
    expect(codes).toHaveLength(10)
    expect(new Set(codes).size).toBe(10)
    for (const code of codes) {
      expect(code).toMatch(/^([A-Z2-7]{4}-){3}[A-Z2-7]{4}$/)
      // 16 个 Base32 字符 × 5 位 = 80 位熵：sha256 快哈希下仍不可离线爆破。
      expect(code.replace(/-/g, '')).toHaveLength(16)
    }
  })

  it('规范化后大小写与分隔符不影响哈希', () => {
    const [code] = generateRecoveryCodes(1)
    expect(normalizeRecoveryCode(code)).toBe(code.replace(/-/g, ''))
    expect(hashRecoveryCode(code.toLowerCase())).toBe(hashRecoveryCode(code))
    expect(hashRecoveryCode(` ${code.replace(/-/g, ' ')} `)).toBe(hashRecoveryCode(code))
  })

  it('哈希是 64 位十六进制且不同码不同哈希', () => {
    const [a, b] = generateRecoveryCodes(2)
    expect(hashRecoveryCode(a)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashRecoveryCode(a)).not.toBe(hashRecoveryCode(b))
  })
})

describe('generateSecret', () => {
  it('默认产出 160 位密钥且每次不同', () => {
    const a = generateSecret()
    const b = generateSecret()
    expect(base32Decode(a)).toHaveLength(20)
    expect(a).not.toBe(b)
  })
})
