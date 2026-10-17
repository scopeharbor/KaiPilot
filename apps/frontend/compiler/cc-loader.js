/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
'use strict'

/**
 * cc-loader.js —— 简体 → 台湾繁体 / 香港繁体 build-time 文本变体编译器。
 *
 * 架构契约（Compiler 层）：
 *   - 把 .tsx 中「单行、含 CJK、祖先无跳过标记」的 JSXText 改写为
 *     <_CC s="原文" tw="台繁" hk="港繁" />，并注入
 *     import _CC from '@/components/locale/cc';
 *     组件名用 babel scope.generateUidIdentifier('CC') 生成，自动避开
 *     文件内所有层级的绑定与引用（_CC → _CC2 → _CC3…）。
 *   - tw 由 opencc-js Converter({ from: 'cn', to: 'twp' }) 生成，
 *     hk 由 Converter({ from: 'cn', to: 'hk' }) 生成，转换后再套用
 *     ../lib/locale/glossary 的词汇覆写。
 *   - JSX 属性（placeholder 等）不在本层处理（归 runtime DOM 层）。
 *
 * 排除规则：
 *   - 只处理 .tsx；排除 node_modules、app/api/、route.、middleware.、
 *     __tests__、content/；
 *   - AST 注释（ast.comments，仅真注释）含 `cc-disable` 整体跳过，
 *     字符串/URL 中的字样不会误触发；
 *   - JSXText 含换行跳过（保留 JSX 空白语义，交给 runtime）；
 *   - JSXText 的祖先 JSXElement 为 SCRIPT/STYLE/NOSCRIPT/TEMPLATE/
 *     TEXTAREA/INPUT/CODE/PRE 之一，或带 data-no-cc / translate="no" /
 *     className(class) 含 ignore-opencc，跳过（与 runtime 对齐）；
 *   - tw 与 hk 转换结果都等于原文不改写；
 *   - CJK 预检 /[\u4e00-\u9fff]/ 先挡无中文文件。
 *
 * 说明：@babel/* 为 v7（CJS 包，Node 20 原生 require 可用，无需
 * require(esm)），converter 与 glossary 在模块级缓存。
 */

const EXCLUDE_PATTERNS = [
  /(^|\/)node_modules(\/|$)/,
  /\/app\/api\//,
  /\/route\./,
  /\/middleware\./,
  /\/__tests__\//,
  /\/content\//,
]

/** CJK 预检：无此区字符的文件不进入转换流程 */
const CJK_RE = /[\u4e00-\u9fff]/

// 模块级缓存：converter 与 glossary 只需初始化一次
let babelCache = null
let convertersCache = null
let glossaryCache = null

function loadBabel() {
  if (!babelCache) {
    // @babel/parser 只有命名导出；traverse / generator 的 default 即主函数
    const parser = require('@babel/parser')
    const traverseModule = require('@babel/traverse')
    const generatorModule = require('@babel/generator')
    babelCache = {
      parser,
      traverse: traverseModule.default || traverseModule,
      generate: generatorModule.default || generatorModule,
    }
  }
  return babelCache
}

function loadConverters() {
  if (!convertersCache) {
    const { Converter } = require('opencc-js')
    convertersCache = {
      tw: Converter({ from: 'cn', to: 'twp' }),
      hk: Converter({ from: 'cn', to: 'hk' }),
    }
  }
  return convertersCache
}

function loadGlossary() {
  if (!glossaryCache) {
    glossaryCache = require('../lib/locale/glossary')
  }
  return glossaryCache
}

/** 路径归一化后按排除规则判定（Windows 反斜杠统一为 /） */
function shouldSkipPath(resourcePath) {
  const normalized = resourcePath.replace(/\\/g, '/')
  if (!normalized.endsWith('.tsx')) return true
  return EXCLUDE_PATTERNS.some((re) => re.test(normalized))
}

/** AST 注释（ast.comments）含 cc-disable → 整档跳过；只认真注释，字符串/URL 不误触发 */
function hasCcDisableComment(ast) {
  const comments = ast && ast.comments
  if (!Array.isArray(comments)) return false
  return comments.some((comment) => {
    if (!comment || typeof comment.value !== 'string') return false
    return comment.value.includes('cc-disable')
  })
}

/** 与 runtime 对齐的跳过标签（textarea 内容为用户数据；input 为自闭合无文本） */
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

/**
 * JSXElement 是否带跳过标记：
 * data-no-cc、translate="no"、className(class) 含 ignore-opencc。
 */
function hasSkipAttr(element) {
  const attributes = element.openingElement && element.openingElement.attributes
  if (!Array.isArray(attributes)) return false
  for (const attr of attributes) {
    if (!attr || attr.type !== 'JSXAttribute') continue
    const name = attr.name
    if (!name || name.type !== 'JSXIdentifier') continue
    const attrName = name.name
    if (attrName === 'data-no-cc') return true
    if (attrName === 'translate' && attr.value && attr.value.type === 'StringLiteral') {
      if (attr.value.value === 'no') return true
    }
    if (attrName === 'className' || attrName === 'class') {
      if (attr.value && attr.value.type === 'StringLiteral') {
        if (attr.value.value.split(/\s+/).includes('ignore-opencc')) return true
      }
    }
  }
  return false
}

/** JSXText 的任意祖先 JSXElement 命中跳过标签或跳过标记 → true */
function shouldSkipAncestors(path) {
  let ancestor = path.parentPath
  while (ancestor) {
    if (ancestor.isJSXElement && ancestor.isJSXElement()) {
      const element = ancestor.node
      const tagName = element.openingElement && element.openingElement.name
      if (tagName && tagName.type === 'JSXIdentifier') {
        if (SKIP_TAGS.has(tagName.name.toUpperCase())) return true
      }
      if (hasSkipAttr(element)) return true
    }
    ancestor = ancestor.parentPath
  }
  return false
}

/**
 * glossary 覆写：OpenCC 转换完整字符串后，把 opencc(entry.s) 的结果
 * 全局替换为 entry[variant]。缺省变体的条目被跳过。
 */
function applyGlossary(text, variant) {
  if (variant !== 'tw' && variant !== 'hk') return text
  let out = text
  for (const entry of loadGlossary()) {
    const target = entry[variant]
    if (target == null) continue
    const needle = loadConverters()[variant](entry.s)
    if (!needle || !out.includes(needle)) continue
    out = out.split(needle).join(target)
  }
  return out
}

/** 单变体转换：OpenCC → glossary 覆写 */
function convertText(text, variant) {
  return applyGlossary(loadConverters()[variant](text), variant)
}

/**
 * 构造 <_CC s={"…"} tw={"…"} hk={"…"} /> 节点。
 * 属性值用 JS 表达式容器（{…}）而非 JSX 字符串字面量：babel 的 JSX
 * 词法不支持字符串内的 \" 转义（v7/v8 均实测报 MissingUnicodeEscape），
 * 而表达式容器走标准 JS 字符串转义，任意字符均安全，渲染语义与
 * s="…" 形式完全一致。
 */
function buildCcElement(text, tw, hk, name) {
  const { parser } = loadBabel()
  const source = `<${name} s={${JSON.stringify(text)}} tw={${JSON.stringify(tw)}} hk={${JSON.stringify(hk)}} />`
  return parser.parseExpression(source, { plugins: ['jsx'] })
}

/** 构造 import 语句节点 */
function buildImportStatement(name) {
  const { parser } = loadBabel()
  const ast = parser.parse(`import ${name} from '@/components/locale/cc';`, {
    sourceType: 'module',
    plugins: ['typescript'],
  })
  return ast.program.body[0]
}

/**
 * 核心纯函数：转换 .tsx 源码，无变化时原样返回。
 * @param {string} code 源文件内容
 * @param {string} resourcePath 文件绝对路径（用于排除规则判定）
 * @returns {string} 转换后的代码；无变化时返回原 code
 */
function transformSource(code, resourcePath) {
  if (typeof code !== 'string' || typeof resourcePath !== 'string') return code
  if (shouldSkipPath(resourcePath)) return code
  if (!CJK_RE.test(code)) return code

  const { parser, traverse, generate } = loadBabel()

  let ast
  try {
    ast = parser.parse(code, {
      sourceType: 'unambiguous',
      plugins: ['jsx', 'typescript'],
    })
  } catch (err) {
    // loader 场景下直接抛出，由构建工具呈现；不静默吞掉语法错误
    err.message = `[cc-loader] 解析失败（${resourcePath}）: ${err.message}`
    throw err
  }

  // cc-disable 只认 AST 注释：字符串/URL 中的字样不误触发
  if (hasCcDisableComment(ast)) return code

  let changed = false
  let importName = '_CC'

  traverse(ast, {
    Program: {
      enter(path) {
        // generateUidIdentifier 避开文件内所有层级的绑定与引用
        // （含嵌套函数 shadow、已有 JSX 引用），同一文件只生成一次
        importName = path.scope.generateUidIdentifier('CC').name
      },
    },
    JSXText(path) {
      const raw = path.node.value
      if (raw.includes('\n') || raw.includes('\r')) return
      if (!CJK_RE.test(raw)) return

      // 祖先 JSXElement 命中跳过标签（script/style/textarea/…）或
      // 跳过标记（data-no-cc / translate="no" / ignore-opencc）→ 跳过
      if (shouldSkipAncestors(path)) return

      const tw = convertText(raw, 'tw')
      const hk = convertText(raw, 'hk')
      // tw 与 hk 转换结果都等于原文 → 无需变体，不改写
      if (tw === raw && hk === raw) return

      changed = true
      path.replaceWith(buildCcElement(raw, tw, hk, importName))
    },
  })

  if (!changed) return code

  ast.program.body.unshift(buildImportStatement(importName))
  const output = generate(ast, {}, code)
  return output.code
}

/**
 * webpack loader 包装：目前为同步转换（transformSource 为同步纯函数）。
 */
function ccLoader(source) {
  return transformSource(source, this && this.resourcePath ? this.resourcePath : '')
}

// 先挂到函数上再导出：TypeScript 7 不再把 `module.exports = fn` 之后的
// `module.exports.x = …` 合并进导出类型，函数 expando 两代都能识别。
ccLoader.transformSource = transformSource
ccLoader.applyGlossary = applyGlossary
module.exports = ccLoader
