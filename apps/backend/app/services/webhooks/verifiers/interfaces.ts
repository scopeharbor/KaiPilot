/**
 * v2-5-provider-incoming-webhook-foundation —— provider 签名 verifier 抽象（design D2）。
 *
 * 不同 provider 的签名头名、编码（hex/base64）、时间戳位置各异。新增 provider = 加一个
 * verifier，不动核心接收管线。比较一律走 `crypto.timingSafeEqual`（先校验长度）。
 */

/** 请求头最小契约：键小写，值可为字符串/字符串数组/缺失。对齐 AdonisJS Request.headers。 */
export type WebhookHeaders = Record<string, string | string[] | undefined>

export interface WebhookProviderVerifier {
  /** provider 标识，与端点表 `provider` 列对齐（如 'github'）。 */
  readonly provider: string
  /** 签名头名，如 GitHub 的 `X-Hub-Signature-256`。 */
  readonly headerName: string
  /** 从请求头提取 provider 时间戳（毫秒）；无则返回 null。 */
  extractTimestamp(headers: WebhookHeaders): number | null
  /** 从请求头提取 provider delivery id（幂等首选）；无则返回 null。 */
  extractDeliveryId(headers: WebhookHeaders): string | null
  /** 用密钥对原始 body 计算期望签名串（与头部签名同格式）。 */
  computeExpected(rawBody: Buffer, secret: string): string
  /** 取出请求头中的签名串；缺失返回 null。 */
  extractReceivedSignature(headers: WebhookHeaders): string | null
  /** 常量时间比较收到的签名与期望签名（先比长度再 timingSafeEqual）。 */
  compare(received: string, expected: string): boolean
}
