/**
 * DocumentSearchEntry model（v3-document-full-text-search §3.4）。
 *
 * 映射 document_search_entries 表，存储从 documents 表派生的有界可搜索投影。
 * 不与 Document model 建立 ORM 关系——索引是独立的只读搜索层。
 */
import { DocumentSearchEntrySchema } from '#database/schema'

export default class DocumentSearchEntry extends DocumentSearchEntrySchema {}
