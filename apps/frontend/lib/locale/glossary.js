/* eslint-disable no-undef */
'use strict'

/**
 * 简体 → 台湾繁体 / 香港繁体 词汇覆写表（glossary）。
 *
 * 背景：OpenCC（twp / hk）已覆盖绝大多数简繁词汇转换，但仍存在少量
 * 大陆惯用词没被转换、或目标区域有更地道的说法。本表在 OpenCC 转换
 * 完成后做二次覆写，覆写方式（架构契约）：
 *   先把 opencc(entry.s) 的结果替换成 entry[variant]。
 * 条目缺省某个变体（tw / hk 为 undefined）表示该变体不覆写，保持
 * OpenCC 输出。
 *
 * 所有条目均已用 opencc-js@1.4.2 实跑验证（见
 * __tests__/locale/cc-loader.test.ts 的 glossary 用例），确保
 * opencc(entry.s) 与覆写目标在对应变体下成立；「开项」「甘特图」等
 * 产品词实测 OpenCC 输出即为正确的繁体字形（智項 / 甘特圖），未被
 * 词级转换误伤，因此无需保护条目。
 */

module.exports = [
  // ── 契约指定种子词：OpenCC 两个变体均不转换这些大陆说法 ──
  { s: '计算机', tw: '電腦', hk: '電腦' },
  // 双击：契约标注 tw only——港繁界面保持 OpenCC 的「雙擊」可接受
  { s: '双击', tw: '連按兩下' },
  // 回收站：契约标注 tw；香港 Windows 官方用语同为「資源回收筒」，
  // OpenCC hk 不转换，故 hk 一并覆写
  { s: '回收站', tw: '資源回收筒', hk: '資源回收筒' },

  // ── OpenCC twp 输出「賬號/賬戶」，台港惯用「帳號/帳戶」──
  { s: '账号', tw: '帳號', hk: '帳號' },
  { s: '账户', tw: '帳戶', hk: '帳戶' },

  // ── OpenCC twp 输出「許可權」，台湾软件界面惯用「權限」（微软台湾用词）──
  { s: '权限', tw: '權限' },

  // ── OpenCC twp 输出「釋出」，台湾 UI 惯用「發布」（香港 OpenCC 已给「發佈」）──
  { s: '发布', tw: '發布' },

  // ── OpenCC twp 输出「儀表盤」，台湾惯用「儀表板」──
  { s: '仪表盘', tw: '儀表板' },

  // ── OpenCC 两个变体均输出「質量」，台湾惯用「品質」（香港可接受）──
  { s: '质量', tw: '品質' },

  // ── OpenCC twp 输出「撤銷」，台湾 UI（Undo）惯用「復原」──
  { s: '撤销', tw: '復原' },
]
