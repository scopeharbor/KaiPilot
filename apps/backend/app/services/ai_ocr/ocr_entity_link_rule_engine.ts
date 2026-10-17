import type { OcrEntityMentionType, OcrEntityLinkWarningCode } from '@aiproj/types'
import logger from '@adonisjs/core/services/logger'

/**
 * OCR 实体链接规则引擎（v3-ocr-entity-linking §3.4）。
 *
 * 确定性 mention 检测，使用正则模式从已接受提取的文本中
 * 识别任务引用、WBS 代码、风险代码、日期、金额、人名、里程碑、文件引用等。
 *
 * 红/线：
 * - 每次提取最多 500 条 mention，超出记录 TRUNCATED_TEXT 警告
 * - 不调用任何 AI 模型，纯正则匹配
 * - 返回 candidate status='pending'，目标匹配由 service 层完成
 */

// ─── 提及检测内部类型 ──────────────────────────────────────────────────────

interface DetectedMention {
  mentionType: OcrEntityMentionType
  normalizedLabel: string
  spanStart: number
  spanEnd: number
  confidence: number
  rawText: string
}

// ─── 规则引擎类 ────────────────────────────────────────────────────────────

export default class OcrEntityLinkRuleEngine {
  /**
   * 从提取文本中检测实体提及。
   *
   * @param extractionId   提取 ID（用于候选键计算）
   * @param text           已接受提取的 selectedText（完整文本）
   * @param pageRefs       该提取的页面引用
   * @returns 检测到的候选 mention 信息数组
   */
  async detectMentions(
    extractionId: number,
    text: string,
    pageRefs: number[],
  ): Promise<{
    mentions: DetectedMention[]
    warnings: OcrEntityLinkWarningCode[]
  }> {
    const warnings: OcrEntityLinkWarningCode[] = []
    const mentions: DetectedMention[] = []

    if (!text || text.trim().length === 0) {
      return { mentions, warnings }
    }

    // 检查文本是否过长，先截断再处理
    const MAX_TEXT_LENGTH = 100_000
    let workingText = text
    if (text.length > MAX_TEXT_LENGTH) {
      workingText = text.slice(0, MAX_TEXT_LENGTH)
      warnings.push('TRUNCATED_TEXT')
      logger.warn(
        { extractionId, originalLength: text.length },
        '[EntityLink] 提取文本过长，已截断至 100k 字符',
      )
    }

    // ── 规则 1: 任务引用 TASK-XXX / 任务-XXX ──
    this.applyTaskPatterns(workingText, mentions)

    // ── 规则 2: WBS 代码 (1.2.3 样式) ──
    this.applyWbsPatterns(workingText, pageRefs, mentions)

    // ── 规则 3: 风险代码 R-XXX / 风险-XXX ──
    this.applyRiskPatterns(workingText, mentions)

    // ── 规则 4: 日期表达式 YYYY-MM-DD ──
    this.applyDatePatterns(workingText, mentions)

    // ── 规则 5: 金额表达式 ¥$ + 数字 ──
    this.applyAmountPatterns(workingText, mentions)

    // ── 规则 6: 人名引用 ──
    this.applyPersonPatterns(workingText, mentions)

    // ── 规则 7: 里程碑引用 ──
    this.applyMilestonePatterns(workingText, mentions)

    // ── 规则 8: 文件引用 ──
    this.applyFilePatterns(workingText, mentions)

    // ── 规则 9: 项目名称引用 ──
    this.applyProjectPatterns(workingText, mentions)

    // ── 去重：基于候选键 + 重叠 span 合并 ──
    const deduped = this.deduplicateMentions(extractionId, pageRefs, mentions)

    // ── 上限检查：最多 500 条 ──
    const MAX_MENTIONS = 500
    if (deduped.length > MAX_MENTIONS) {
      warnings.push('TRUNCATED_TEXT')
      return { mentions: deduped.slice(0, MAX_MENTIONS), warnings }
    }

    return { mentions: deduped, warnings }
  }

  // ─── 各规则模式 ──────────────────────────────────────────────────────────

  private applyTaskPatterns(text: string, mentions: DetectedMention[]): void {
    // TASK-123 / TASK: 123 / 任务-123 / 任务: 123 / 任务#123
    const taskPattern = /\b(TASK|任务)\s*[-:#]?\s*(\d+)\b/gi
    this.collectMatches(taskPattern, text, (match) => {
      mentions.push({
        mentionType: 'task_ref',
        normalizedLabel: match[0].replace(/\s+/g, '').toUpperCase(),
        spanStart: match.index,
        spanEnd: match.index + match[0].length,
        confidence: 0.95,
        rawText: match[0],
      })
    })

    // 中文任务描述："第3项任务"、"任务三"、"第三项"
    const chineseTaskPattern =
      /\b(?:第\s*(\d+|[一二三四五六七八九十百千]+)\s*(?:项|个)\s*)?任务\s*(?:[#：:]\s*(\d+))?\b/gi
    this.collectMatches(chineseTaskPattern, text, (match) => {
      const cleaned = match[0].replace(/\s+/g, '')
      mentions.push({
        mentionType: 'task_ref',
        normalizedLabel: cleaned,
        spanStart: match.index,
        spanEnd: match.index + match[0].length,
        confidence: 0.75,
        rawText: match[0],
      })
    })
  }

  private applyWbsPatterns(text: string, _pageRefs: number[], mentions: DetectedMention[]): void {
    // WBS 代码: 1.2.3 样式（2-4 级）
    const wbsPattern = /\b(\d+(?:\.\d+){1,4})\b/g
    this.collectMatches(wbsPattern, text, (match) => {
      // 排除明显是日期的（如 2024.08.02 已由日期规则捕获）
      const digits = match[1]
      if (/^\d{4}\.\d{1,2}\.\d{1,2}$/.test(digits)) return
      mentions.push({
        mentionType: 'wbs_ref',
        normalizedLabel: digits,
        spanStart: match.index,
        spanEnd: match.index + match[0].length,
        confidence: 0.7,
        rawText: match[0],
      })
    })

    // 中文 WBS 描述："第1.2.3节"、"WBS 1.2.3"
    const chineseWbsPattern = /\b(?:WBS|wbs)\s*[：:]\s*(\d+(?:\.\d+)+)\b/gi
    this.collectMatches(chineseWbsPattern, text, (match) => {
      const code = match[1] ?? match[0]
      mentions.push({
        mentionType: 'wbs_ref',
        normalizedLabel: code.replace(/\s+/g, ''),
        spanStart: match.index,
        spanEnd: match.index + match[0].length,
        confidence: 0.9,
        rawText: match[0],
      })
    })
  }

  private applyRiskPatterns(text: string, mentions: DetectedMention[]): void {
    // R-XXX / 风险-XXX / 风险#XXX
    const riskPattern = /\b(R|风险)\s*[-:#]?\s*(\d+)\b/gi
    this.collectMatches(riskPattern, text, (match) => {
      mentions.push({
        mentionType: 'risk_ref',
        normalizedLabel: match[0].replace(/\s+/g, '').toUpperCase(),
        spanStart: match.index,
        spanEnd: match.index + match[0].length,
        confidence: 0.95,
        rawText: match[0],
      })
    })
  }

  private applyDatePatterns(text: string, mentions: DetectedMention[]): void {
    // YYYY-MM-DD 或 YYYY/MM/DD
    const datePattern = /\b(\d{4}[-/]\d{1,2}[-/]\d{1,2})\b/g
    this.collectMatches(datePattern, text, (match) => {
      // 验证日期有效性
      const dateStr = match[0]
      const parsed = new Date(dateStr)
      if (Number.isNaN(parsed.getTime())) return

      mentions.push({
        mentionType: 'date_expression',
        normalizedLabel: dateStr,
        spanStart: match.index,
        spanEnd: match.index + dateStr.length,
        confidence: 0.98,
        rawText: dateStr,
      })
    })

    // 中文日期: YYYY年MM月DD日
    const chineseDatePattern = /\b(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\b/g
    this.collectMatches(chineseDatePattern, text, (match) => {
      const y = match[1]!
      const m = match[2]!
      const d = match[3]!
      const normalized = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
      mentions.push({
        mentionType: 'date_expression',
        normalizedLabel: normalized,
        spanStart: match.index,
        spanEnd: match.index + match[0].length,
        confidence: 0.98,
        rawText: match[0],
      })
    })
  }

  private applyAmountPatterns(text: string, mentions: DetectedMention[]): void {
    // ¥100 / $200 / ￥300.00
    const amountPattern = /[¥￥$]\s*[\d,]+(?:\.\d{1,2})?\b/g
    this.collectMatches(amountPattern, text, (match) => {
      const raw = match[0]
      mentions.push({
        mentionType: 'amount_expression',
        normalizedLabel: raw.replace(/\s+/g, ''),
        spanStart: match.index,
        spanEnd: match.index + raw.length,
        confidence: 0.98,
        rawText: raw,
      })
    })

    // 中文金额："100元"、"100万"
    const chineseAmountPattern = /\b[\d,]+(?:\.\d{1,2})?\s*(?:元|万|万元|亿)\b/g
    this.collectMatches(chineseAmountPattern, text, (match) => {
      const raw = match[0]
      mentions.push({
        mentionType: 'amount_expression',
        normalizedLabel: raw.replace(/\s+/g, ''),
        spanStart: match.index,
        spanEnd: match.index + raw.length,
        confidence: 0.95,
        rawText: raw,
      })
    })
  }

  private applyPersonPatterns(text: string, mentions: DetectedMention[]): void {
    // "负责人：张三" / "经办人：李四" / "分配给：王五"
    const assignPattern = /\b(?:负责人|经办人|处理人|分配给|审批人|报告人)[：:]\s*([一-鿿]{2,4})\b/g
    this.collectMatches(assignPattern, text, (match) => {
      const name = match[1]!
      mentions.push({
        mentionType: 'person_name',
        normalizedLabel: name,
        spanStart: match.index + match[0].indexOf(name),
        spanEnd: match.index + match[0].indexOf(name) + name.length,
        confidence: 0.85,
        rawText: name,
      })
    })

    // 独立中文姓名 2-3 字（启发式，置信度较低）
    // 避免匹配常见词：的、了、是、在、和、与、或、为、等、都、也、就、而、但、从、被、把、对、向、到、自、于
    const commonWords = new Set(
      '的了是在和与或为等都也就而但从被把对向到自于以其这那哪何怎么些因所着来着过头上下中内外前后左右东西南北里旁边处时年月日天点分秒'.split(
        '',
      ),
    )
    const standaloneNamePattern = /\b([一-鿿]{2,4})\b/g
    this.collectMatches(standaloneNamePattern, text, (match) => {
      const name = match[1]!
      if (commonWords.has(name[0]!) || commonWords.has(name[name.length - 1]!)) return
      if (name.length === 1) return
      // 启发式：全姓+名的常见模式，置信度低
      mentions.push({
        mentionType: 'person_name',
        normalizedLabel: name,
        spanStart: match.index,
        spanEnd: match.index + name.length,
        confidence: 0.4,
        rawText: name,
      })
    })
  }

  private applyMilestonePatterns(text: string, mentions: DetectedMention[]): void {
    // 里程碑：XXX / M1：XXX / MS1：XXX
    const milestonePattern = /\b(?:里程碑|M\d+|MS\d+)\s*[：:]\s*([一-鿿\w\s]+?)(?=[，,。.\n]|$)/gi
    this.collectMatches(milestonePattern, text, (match) => {
      const label = match[0].replace(/\s+/g, '')
      mentions.push({
        mentionType: 'milestone_ref',
        normalizedLabel: label,
        spanStart: match.index,
        spanEnd: match.index + match[0].length,
        confidence: 0.9,
        rawText: match[0],
      })
    })

    // 简化的里程碑引用："里程碑X"、"第X个里程碑"
    const simpleMilestonePattern = /\b里程碑\s*(\d+|[一二三四五六七八九十]+)\b/g
    this.collectMatches(simpleMilestonePattern, text, (match) => {
      const label = match[0].replace(/\s+/g, '')
      mentions.push({
        mentionType: 'milestone_ref',
        normalizedLabel: label,
        spanStart: match.index,
        spanEnd: match.index + match[0].length,
        confidence: 0.85,
        rawText: match[0],
      })
    })
  }

  private applyFilePatterns(text: string, mentions: DetectedMention[]): void {
    // filename.ext 样式
    const filePattern =
      /\b([\w一-鿿-]+\.(?:pdf|docx?|xlsx?|pptx?|png|jpe?g|gif|txt|csv|zip|rar))\b/gi
    this.collectMatches(filePattern, text, (match) => {
      const filename = match[0].toLowerCase()
      mentions.push({
        mentionType: 'file_ref',
        normalizedLabel: filename,
        spanStart: match.index,
        spanEnd: match.index + match[0].length,
        confidence: 0.92,
        rawText: match[0],
      })
    })

    // 中文附件描述："附件1"、"见附件A"、"文件xxx"
    const chineseFilePattern =
      /\b(?:附件|文件|图表|图片)\s*[：:]?\s*([一-鿿\w\s-]+?)(?=[，,。.\n]|$)/gi
    this.collectMatches(chineseFilePattern, text, (match) => {
      const label = match[0].replace(/\s+/g, '')
      mentions.push({
        mentionType: 'attachment_ref',
        normalizedLabel: label,
        spanStart: match.index,
        spanEnd: match.index + match[0].length,
        confidence: 0.7,
        rawText: match[0],
      })
    })
  }

  private applyProjectPatterns(text: string, mentions: DetectedMention[]): void {
    // 项目名称引用："XX项目"结尾的命名实体
    const projectPattern = /\b([一-鿿\w]{2,20}项目)\b/g
    this.collectMatches(projectPattern, text, (match) => {
      const label = match[1]!
      mentions.push({
        mentionType: 'project_name',
        normalizedLabel: label,
        spanStart: match.index,
        spanEnd: match.index + match[0].length,
        confidence: 0.6,
        rawText: match[0],
      })
    })
  }

  // ─── 辅助方法 ────────────────────────────────────────────────────────────

  /**
   * 收集所有正则匹配并调用回调。
   * 使用 exec 循环而非 matchAll 以获得准确的位置信息。
   */
  private collectMatches(
    pattern: RegExp,
    text: string,
    callback: (match: RegExpExecArray) => void,
  ): void {
    const regex = new RegExp(pattern.source, pattern.flags)
    let m: RegExpExecArray | null
    while ((m = regex.exec(text)) !== null) {
      callback(m)
      // 避免零宽匹配无限循环
      if (m[0].length === 0) regex.lastIndex++
    }
  }

  /**
   * 去重：移除完全重叠的 span（保留优先级高的 mentionType）。
   * mention 优先级: task_ref > wbs_ref > risk_ref > date_expression > amount_expression > person_name > milestone_ref > file_ref > project_name
   */
  private deduplicateMentions(
    _extractionId: number,
    _pageRefs: number[],
    mentions: DetectedMention[],
  ): DetectedMention[] {
    const priority: Record<OcrEntityMentionType, number> = {
      task_ref: 10,
      wbs_ref: 9,
      risk_ref: 9,
      date_expression: 8,
      amount_expression: 7,
      person_name: 6,
      milestone_ref: 8,
      file_ref: 5,
      attachment_ref: 5,
      project_name: 4,
      organization_name: 3,
      custom_label: 2,
    }

    // 按 span 起始位置排序，相同起始按优先级降序
    const sorted = [...mentions].sort((a, b) => {
      if (a.spanStart !== b.spanStart) return a.spanStart - b.spanStart
      return (priority[b.mentionType] ?? 0) - (priority[a.mentionType] ?? 0)
    })

    const result: DetectedMention[] = []
    let lastEnd = -1

    for (const m of sorted) {
      // 完全被上一个覆盖，跳过
      if (m.spanEnd <= lastEnd) continue
      // 部分重叠但起始更大，跳过
      if (m.spanStart < lastEnd) continue
      result.push(m)
      lastEnd = m.spanEnd
    }

    return result
  }
}
