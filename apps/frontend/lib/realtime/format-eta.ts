/**
 * format-eta —— ETA 中文人读格式化（v2-5-streaming-eta-estimation）。
 *
 * 纯函数，把毫秒数转为简体中文人读文案（spec Requirement: Chinese human-readable strings）。
 *
 * 规则（D4）：
 * - `ms <= 0` 或 `null`/`undefined` → 空串（由调用方决定隐藏）
 * - `< 60_000`（< 1 分钟）→ 「不到 1 分钟」
 * - `< 3_600_000`（< 1 小时）→ 「~X 分钟」（四舍五入到整分钟）
 * - `≥ 3_600_000` → 「~X 小时 Y 分钟」
 *
 * 零副作用、零依赖、确定性。
 */

/**
 * 将毫秒数格式化为中文人读剩余时间文案。
 *
 * @param ms 剩余毫秒数；null/undefined/<=0 返回空串。
 * @returns 中文文案，或空串（调用方应据此隐藏 ETA）。
 */
export function formatEta(ms: number | null | undefined): string {
  // ── 边界：null/undefined/非有限/<=0 → 空串 ──────────────────────
  if (ms === null || ms === undefined) return ''
  if (!Number.isFinite(ms) || ms <= 0) return ''

  // ── 秒级（< 1 分钟）─────────────────────────────────────────────
  if (ms < 60_000) {
    return '不到 1 分钟'
  }

  // ── 分钟级（< 1 小时）：四舍五入到整分钟 ─────────────────────────
  if (ms < 3_600_000) {
    const minutes = Math.round(ms / 60_000)
    // 四舍五入恰好进位到 60 分钟时，归入小时级表达更自然
    if (minutes >= 60) {
      return '~1 小时 0 分钟'
    }
    return `~${minutes} 分钟`
  }

  // ── 小时级（≥ 1 小时）：X 小时 Y 分钟 ───────────────────────────
  const totalMinutes = Math.round(ms / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `~${hours} 小时 ${minutes} 分钟`
}
