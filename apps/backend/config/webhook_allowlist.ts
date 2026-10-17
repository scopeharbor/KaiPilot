/**
 * 入站 webhook 来源 IP 允许清单配置（v2-5-webhook-ip-allowlist，design D3/D7）。
 *
 * 装配自环境变量，暴露两个已解析字段：
 * - `enabled: boolean` —— 总开关，缺省 false（关闭时中间件 no-op，对现网零影响）。
 * - `cidrs: string[]`  —— 逗号分隔的 CIDR 列表，解析时去除空白与空项。
 *
 * 故障姿态（middleware 据此实现）：
 * - 关闭（enabled=false）           → 直接放行（no-op）。
 * - 开启且 cidrs 命中               → 放行。
 * - 开启且 cidrs 未命中             → 403 WEBHOOK_IP_FORBIDDEN。
 * - 开启但 cidrs 为空（误配）       → fail-closed 全拒 + 告警。
 *
 * 为何直读 process.env 而非 env.get：
 *   env.get 在启动阶段一次性缓存（Env.create 解析），运行时改环境变量不会反映；
 *   本控件需运行时可切换（测试四态覆盖、运维热切换），故实时读 process.env，
 *   与 webhook_ingest_service.readIngestEnabled() 同一理由与写法（字符串显式转换）。
 *   env.ts 仍声明这两项 schema，仅作 boot 校验与文档。
 *   getter 使每次访问都重新读取，保证 middleware 拿到当前值。
 */

/** 解析开关：仅 'true' / '1' 视为开启，其余（含未设置）视为关闭。 */
function readEnabled(): boolean {
  const raw = process.env.WEBHOOK_IP_ALLOWLIST_ENABLED
  return raw === 'true' || raw === '1'
}

/** 解析逗号分隔的 CIDR 列表，去除首尾空白与空项。 */
function readCidrs(): string[] {
  return (process.env.WEBHOOK_IP_ALLOWLIST_CIDRS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

const webhookAllowlistConfig = {
  get enabled(): boolean {
    return readEnabled()
  },
  get cidrs(): string[] {
    return readCidrs()
  },
}

export default webhookAllowlistConfig
