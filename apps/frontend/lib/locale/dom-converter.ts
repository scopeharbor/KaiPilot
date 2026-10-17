/**
 * 运行时 DOM 转换层（framework-free，jsdom 可测）。
 * 只在 variant !== 'cn' 时由 VariantRuntime 启动：
 * - lazy 加载 opencc-js（内嵌词典，体积较大，模块级缓存一次加载）；
 * - TreeWalker 初始全扫（文本节点 + 属性白名单）；
 * - MutationObserver 增量（childList / characterData / attributes 白名单）；
 * - document.title 单独处理（位于 head，不在 body 扫描范围内）；
 * - WeakMap<node, 上次转换结果> 防自触发循环：nodeValue 等于记录值 → 跳过，
 *   不等 → 视为外部（React）写入，重新转换；
 * - WeakMap<node, 原文> 备份，供 restore() 还原。
 * 只修改 nodeValue / 白名单属性值，绝不增删 DOM 节点。
 */
import type { ConverterFunction } from 'opencc-js'
import { applyGlossary } from './text-convert'
import { isConvertedOutput, registerConvertedOutput } from './converted-outputs'

export interface DomConverter {
  start(): Promise<void>
  stop(): void
  restore(): void
}

/** 属性转换白名单：只转换这些属性，避免 class/data-* 等被误伤。 */
const ATTRIBUTE_WHITELIST = [
  'placeholder',
  'title',
  'aria-label',
  'aria-placeholder',
  'alt',
] as const

/** 整棵子树不进入的标签：脚本 / 样式 / 模板 / 用户输入与代码内容（文字一律不动）。 */
const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'TEXTAREA',
  'INPUT',
  'CODE',
  'PRE',
])

// TreeWalker / NodeFilter 数值常量（不依赖全局 NodeFilter，jsdom 与浏览器行为一致）
const SHOW_ELEMENT = 0x1
const SHOW_TEXT = 0x4
const FILTER_ACCEPT = 1
const FILTER_REJECT = 2
const FILTER_SKIP = 3

// 可信输出注册表在 converted-outputs（text-convert 也要用，避免循环引用）；这里转出供旧调用方使用
export { registerConvertedOutput } from './converted-outputs'

type OpenCCModule = typeof import('opencc-js')

let openccModulePromise: Promise<OpenCCModule> | null = null
function loadOpenCC(): Promise<OpenCCModule> {
  openccModulePromise ??= import('opencc-js')
  return openccModulePromise
}

/** 初始扫描放到空闲期执行，避免阻塞首帧；jsdom 无 requestIdleCallback，退化为 setTimeout。 */
function schedule(fn: () => void): void {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => fn(), { timeout: 100 })
  } else {
    setTimeout(fn, 0)
  }
}

/**
 * opt-out 标记：命中即该区域完全不转换（文本与白名单属性都不动）。
 * 与标签级跳过不同，这是显式的「此处不要转换」声明。
 */
function isOptOutElement(el: Element): boolean {
  if (el.hasAttribute('data-no-cc')) return true
  if (el.getAttribute('translate') === 'no') return true
  if (el.classList.contains('ignore-opencc')) return true
  return false
}

/**
 * 标签级跳过（产品裁定）：只阻止文本节点转换与子树遍历；元素自身的
 * 白名单属性仍要转换——placeholder 的主要载体就是 input/textarea，
 * 其文字内容 / value 属用户数据不动，但 UI 文案属性必须转。
 */
function isIgnoredTagElement(el: Element): boolean {
  // data-cc：显式声明「这里是要转换的文字」（如 AI 实时输出用 <pre> 保留换行），不按代码跳过
  if (el.hasAttribute('data-cc')) return false
  return SKIP_TAGS.has(el.tagName)
}

/** 元素命中任意跳过规则 → 子树整体不遍历（文本与子元素属性都不转）。 */
function shouldSkipElement(el: Element): boolean {
  return isIgnoredTagElement(el) || isOptOutElement(el)
}

/** 节点或其任意祖先命中跳过规则 → 文本不转换（兜底新增节点 / characterData 路径）。 */
function shouldSkipTree(node: Node): boolean {
  let cur: Node | null = node
  while (cur) {
    if (cur.nodeType === Node.ELEMENT_NODE && shouldSkipElement(cur as Element)) return true
    cur = cur.parentNode
  }
  return false
}

/** 节点或其任意祖先命中 opt-out 标记 → 白名单属性不转换。 */
function shouldSkipAttributes(node: Node): boolean {
  let cur: Node | null = node
  while (cur) {
    if (cur.nodeType === Node.ELEMENT_NODE && isOptOutElement(cur as Element)) return true
    cur = cur.parentNode
  }
  return false
}

export function createDomConverter(variant: 'tw' | 'hk'): DomConverter {
  // —— 防自触发循环：记录每个节点上次写入的转换结果；
  // 外部写入导致 nodeValue 与记录不一致 → 判定为外部写入，重新转换。
  const lastConverted = new WeakMap<Node, string>()
  // 属性级记录（一个元素可能有多个白名单属性，按属性名分别记录）
  const attrLastConverted = new WeakMap<Element, Map<string, string>>()
  // —— 原文备份：restore() 按节点还原。WeakMap 不可遍历，另用 Set 登记被改节点。
  const originals = new WeakMap<Node, string>()
  const attrOriginals = new WeakMap<Element, Map<string, string>>()
  const touchedNodes = new Set<Node>()

  let running = false
  let observer: MutationObserver | null = null
  let startPromise: Promise<void> | null = null
  let converterFn: ConverterFunction | null = null

  /** opencc 转换 + glossary 逐条覆写（与 text-convert 共用规则）。
   * 产出即注册为可信输出（幂等），让后续遇到同值的节点直接跳过、不重复转换。 */
  function convert(text: string): string {
    if (!converterFn) return text
    const out = applyGlossary(text, variant, converterFn)
    registerConvertedOutput(out)
    return out
  }

  function convertTextNode(node: Text): void {
    if (shouldSkipTree(node)) return
    const current = node.nodeValue ?? ''
    if (current === '') return
    if (lastConverted.get(node) === current) return // 自己上次写入的结果，跳过
    if (isConvertedOutput(current)) return // 可信最终输出（如 CC 渲染的 tw 值），跳过且不记录
    const converted = convert(current)
    if (converted === current) return
    if (!touchedNodes.has(node)) {
      touchedNodes.add(node)
      originals.set(node, current)
    }
    lastConverted.set(node, converted) // 先记录再写入，观察器回调看到的是已记录状态
    node.nodeValue = converted
  }

  function attrLastMap(el: Element): Map<string, string> {
    let map = attrLastConverted.get(el)
    if (!map) {
      map = new Map()
      attrLastConverted.set(el, map)
    }
    return map
  }

  function attrOriginalMap(el: Element): Map<string, string> {
    let map = attrOriginals.get(el)
    if (!map) {
      map = new Map()
      attrOriginals.set(el, map)
    }
    return map
  }

  function convertAttribute(el: Element, name: string): void {
    if (shouldSkipAttributes(el)) return
    const current = el.getAttribute(name)
    if (current == null || current === '') return
    if (attrLastMap(el).get(name) === current) return
    if (isConvertedOutput(current)) return // 可信最终输出，跳过且不记录
    const converted = convert(current)
    if (converted === current) return
    if (!attrOriginalMap(el).has(name)) attrOriginalMap(el).set(name, current)
    if (!touchedNodes.has(el)) touchedNodes.add(el)
    attrLastMap(el).set(name, converted) // 先记录再写入，防自触发循环
    el.setAttribute(name, converted)
  }

  function convertAttributes(el: Element): void {
    for (const name of ATTRIBUTE_WHITELIST) {
      if (el.hasAttribute(name)) convertAttribute(el, name)
    }
  }

  /**
   * 处理单个元素：opt-out 标记 → 整棵不动；否则先转换其自身白名单属性，
   * 再按标签级跳过决定是否进入子树（input 等自身属性已转、子树不遍历）。
   */
  function processElement(el: Element): 'reject' | 'enter' {
    if (isOptOutElement(el)) return 'reject'
    convertAttributes(el)
    return isIgnoredTagElement(el) ? 'reject' : 'enter'
  }

  /**
   * TreeWalker 全扫子树：元素命中跳过规则则整棵 REJECT、不进入；
   * 白名单属性在过滤回调内联转换；结果集只保留文本节点。
   * 注意：TreeWalker.nextNode() 从 root 之后的节点开始遍历，root 自身
   * 不会被访问——因此 root 自身的文本 / 属性要先显式处理（新增子树时
   * root 常为单个元素或文本节点，如 document.title 替换出的新文本）。
   */
  function scanSubtree(root: Node): void {
    if (root.nodeType === Node.TEXT_NODE) {
      convertTextNode(root as Text)
      return
    }
    if (root.nodeType === Node.ELEMENT_NODE) {
      if (processElement(root as Element) === 'reject') return
    }
    const walker = document.createTreeWalker(root, SHOW_ELEMENT | SHOW_TEXT, {
      acceptNode(node: Node): number {
        if (node.nodeType === Node.ELEMENT_NODE) {
          return processElement(node as Element) === 'reject' ? FILTER_REJECT : FILTER_SKIP
        }
        if (node.nodeType === Node.TEXT_NODE) {
          // 元素 REJECT 已保证不会进入被跳过子树；此处仅为防御性兜底
          return shouldSkipTree(node) ? FILTER_REJECT : FILTER_ACCEPT
        }
        return FILTER_REJECT
      },
    })
    let node = walker.nextNode()
    while (node) {
      if (node.nodeType === Node.TEXT_NODE) convertTextNode(node as Text)
      node = walker.nextNode()
    }
  }

  function handleMutations(records: MutationRecord[]): void {
    for (const record of records) {
      if (record.type === 'characterData') {
        if (record.target.nodeType === Node.TEXT_NODE) convertTextNode(record.target as Text)
      } else if (record.type === 'childList') {
        for (const added of record.addedNodes) scanSubtree(added)
      } else if (record.type === 'attributes') {
        const name = record.attributeName
        if (name) convertAttribute(record.target as Element, name)
      }
    }
  }

  /** 标题文本节点（title 在 head 中，不在 body 扫描范围内，单独观察与转换）。 */
  function titleTextNode(): Text | null {
    const title = document.querySelector('title')
    if (!title || !title.firstChild) return null
    return title.firstChild.nodeType === Node.TEXT_NODE ? (title.firstChild as Text) : null
  }

  function start(): Promise<void> {
    // 幂等：第二次调用返回同一个进行中的 promise（await start(); await start() 语义一致）；
    // stop() 会把 startPromise 置空，之后再次 start() 会重新完整启动。
    if (startPromise) return startPromise
    running = true
    startPromise = (async () => {
      const mod = await loadOpenCC()
      if (!running) return // start 尚未完成即被 stop，不再干活
      converterFn = mod.Converter({ from: 'cn', to: variant === 'tw' ? 'twp' : 'hk' })
      if (typeof document === 'undefined') return // SSR 环境安全兜底
      schedule(() => {
        if (!running) return
        if (document.body) scanSubtree(document.body)
        const titleNode = titleTextNode()
        if (titleNode) convertTextNode(titleNode)
      })
      observer = new MutationObserver(handleMutations)
      if (document.body) {
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: [...ATTRIBUTE_WHITELIST],
        })
      }
      const title = document.querySelector('title')
      if (title) {
        observer.observe(title, { subtree: true, characterData: true, childList: true })
      }
      // title 元素可能被整棵替换（部分 head 管理库的做法）：观察 head 直属
      // childList，新 title 加入时经 scanSubtree 接手处理（m5 修复）。
      const head = document.head ?? document.documentElement
      if (head) observer.observe(head, { childList: true })
    })()
    return startPromise
  }

  function stop(): void {
    running = false
    observer?.disconnect()
    observer = null
    startPromise = null
  }

  /**
   * 还原全部被改动的节点（文本与白名单属性）并清空登记。
   * 注意：应在 stop() 之后调用，否则观察器会把还原当作外部写入重新转换。
   */
  function restore(): void {
    for (const node of touchedNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const original = originals.get(node)
        if (original != null) node.nodeValue = original
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const map = attrOriginals.get(node as Element)
        if (map) {
          for (const [name, value] of map) (node as Element).setAttribute(name, value)
        }
      }
    }
    touchedNodes.clear()
  }

  return { start, stop, restore }
}
