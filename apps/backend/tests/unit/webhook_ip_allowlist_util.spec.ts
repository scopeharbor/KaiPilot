/**
 * v2-5-webhook-ip-allowlist —— CIDR 匹配纯函数单测（spec「CIDR 匹配纯函数」全场景穷举）。
 *
 * 覆盖：IPv4 段内/段外、/32 命中/非命中、/0 匹配任意 v4、IPv6 段内/段外、
 * IPv4-mapped IPv6、非法 IP 判拒不抛、清单含非法 CIDR 被跳过不抛、空清单判拒。
 *
 * isIpAllowed 是零依赖、无 I/O 的纯函数：不联网、不读文件、不读进程环境。
 */
import { test } from '@japa/runner'
import { isIpAllowed } from '#services/security/ip_allowlist'

test.group('webhook ip allowlist util — isIpAllowed', () => {
  test('IPv4 地址落在段内 → true', ({ assert }) => {
    assert.isTrue(isIpAllowed('192.30.252.10', ['192.30.252.0/22']))
  })

  test('IPv4 地址落在段外 → false', ({ assert }) => {
    assert.isFalse(isIpAllowed('10.0.0.5', ['192.30.252.0/22']))
  })

  test('/32 精确匹配命中 → true，相邻地址非匹配 → false', ({ assert }) => {
    assert.isTrue(isIpAllowed('203.0.113.7', ['203.0.113.7/32']))
    assert.isFalse(isIpAllowed('203.0.113.8', ['203.0.113.7/32']))
  })

  test('/0 匹配任意合法 IPv4 → true', ({ assert }) => {
    assert.isTrue(isIpAllowed('8.8.8.8', ['0.0.0.0/0']))
    assert.isTrue(isIpAllowed('10.0.0.5', ['0.0.0.0/0']))
    assert.isTrue(isIpAllowed('203.0.113.7', ['0.0.0.0/0']))
  })

  test('IPv6 地址落在段内 → true，段外 → false', ({ assert }) => {
    assert.isTrue(isIpAllowed('2606:50c0:8000::5', ['2606:50c0:8000::/40']))
    assert.isFalse(isIpAllowed('2001:db8::1', ['2606:50c0:8000::/40']))
  })

  test('IPv4-mapped IPv6 命中对应 IPv4 段 → true（来源被规范化为其 v4 地址）', ({ assert }) => {
    // ::ffff:192.0.2.1 是 192.0.2.1 的 v4-mapped 表示；应匹配 v4 段 192.0.2.0/24，
    // 否则攻击者可用 v4-mapped 表示绕过 v4 清单。
    assert.isTrue(isIpAllowed('::ffff:192.0.2.1', ['192.0.2.0/24']))
    // 段外的 v4-mapped 仍判拒
    assert.isFalse(isIpAllowed('::ffff:198.51.100.1', ['192.0.2.0/24']))
  })

  test('非法 IP（空串 / not-an-ip / 越界八位组）判拒且不抛异常', ({ assert }) => {
    assert.doesNotThrow(() => isIpAllowed('', ['0.0.0.0/0']))
    assert.isFalse(isIpAllowed('', ['0.0.0.0/0']))
    assert.isFalse(isIpAllowed('not-an-ip', ['0.0.0.0/0']))
    assert.isFalse(isIpAllowed('999.1.1.1', ['0.0.0.0/0']))
  })

  test('清单含非法 CIDR 被安全跳过、不抛，且合法条目仍生效', ({ assert }) => {
    assert.doesNotThrow(() =>
      isIpAllowed('192.30.252.10', ['garbage', '10.0.0.0/x', '192.30.252.0/22']),
    )
    assert.isTrue(isIpAllowed('192.30.252.10', ['garbage', '10.0.0.0/x', '192.30.252.0/22']))
    // 全部条目非法时退化为空清单语义 → 判拒
    assert.isFalse(isIpAllowed('192.30.252.10', ['garbage', 'not/a/cidr']))
  })

  test('空清单 → 任意 IP 判拒（false）', ({ assert }) => {
    assert.isFalse(isIpAllowed('192.30.252.10', []))
    assert.isFalse(isIpAllowed('2606:50c0:8000::5', []))
  })
})
