/**
 * v3-llm-wiki-memory-foundation —— 维基导出的 DLP 预检端口。
 *
 * v3-llm-wiki-default-on：经版本扩展点取实现——企业版由 `providers/enterprise_edition_provider.ts` 注册
 * 报表导出 DLP 适配器（内容类别 `wiki_export_text`，预检结果不是放行时拒绝导出，含策略要求水印的情形）；
 * 个人版没有 DLP 模块，回落为放行。维基目录不直接引用 DLP 模块。
 */
import { editionHooks } from '#services/edition/edition_registry'
import type { WikiExportDlpPort } from '#services/edition/ports'

export type { WikiExportDlpPort }

export const wikiExportDlp: WikiExportDlpPort = {
  preflight: (input) => editionHooks().wikiExportDlp().preflight(input),
}
