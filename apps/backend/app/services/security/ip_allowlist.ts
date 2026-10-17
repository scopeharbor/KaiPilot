/**
 * CIDR 匹配纯函数（v2-5-webhook-ip-allowlist，design D1）。
 *
 * 零外部依赖、无 I/O：不联网、不读文件、不读进程环境。仅用 Node 标准库 node:net 的
 * BlockList + isIP 判定一个来源 IP 是否落在给定 CIDR 段集合内，同时支持 IPv4 与 IPv6。
 *
 * 健壮性（spec「非法输入不抛异常且判为拒绝」）：
 * - 非法 ip（net.isIP===0，如空串 / not-an-ip / 越界八位组）直接返回 false。
 * - 清单中的非法 CIDR 条目用 try/catch 逐条跳过，绝不抛异常。
 * - 空清单（或全部条目非法）自然返回 false。
 *
 * IPv4-mapped IPv6：BlockList.check 会规范化 v4-mapped 地址并匹配对应 v4 段，
 * 故 `::ffff:192.0.2.1` 命中 `192.0.2.0/24`（防止用 v4-mapped 表示绕过 v4 清单）。
 */
import net from 'node:net'

/** 判定 ip 是否落在任一 CIDR 段内；非法输入一律判拒且不抛异常。 */
export function isIpAllowed(ip: string, cidrs: readonly string[]): boolean {
  if (net.isIP(ip) === 0) return false

  const blockList = new net.BlockList()
  for (const cidr of cidrs) {
    try {
      const slash = cidr.indexOf('/')
      if (slash === -1) continue
      const addr = cidr.slice(0, slash)
      const prefix = Number(cidr.slice(slash + 1))
      const family = net.isIP(addr)
      if (family === 0 || !Number.isInteger(prefix)) continue
      blockList.addSubnet(addr, prefix, family === 6 ? 'ipv6' : 'ipv4')
    } catch {
      // 非法 CIDR 条目安全跳过，不影响其余条目
    }
  }

  return blockList.check(ip, net.isIP(ip) === 6 ? 'ipv6' : 'ipv4')
}
