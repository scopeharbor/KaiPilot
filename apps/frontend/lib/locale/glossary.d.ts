/**
 * glossary.js 的类型声明（glossary.js 为纯 CommonJS 模块，Node loader
 * 可 require，本声明让 TypeScript 也能以默认导入使用）。
 */
export interface GlossaryEntry {
  /** 简体原文（Source of Truth），以其 OpenCC 转换结果作为替换键 */
  s: string
  /** 台湾繁体覆写值；缺省表示不覆写，保持 OpenCC 输出 */
  tw?: string
  /** 香港繁体覆写值；缺省表示不覆写，保持 OpenCC 输出 */
  hk?: string
}

declare const glossary: GlossaryEntry[]
export default glossary
