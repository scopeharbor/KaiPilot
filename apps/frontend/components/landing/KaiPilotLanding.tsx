'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { ArrowRight, Check, Copy, Database, KeyRound, Scale, ShieldCheck } from 'lucide-react'
import {
  COPY,
  DEPLOY_COMMANDS,
  SCENARIOS,
  type DemoScenario,
  type DemoTask,
  type LandingCopy,
  type LandingLang,
} from './landing-content'
import './kaipilot-landing.css'

/**
 * 开项 KaiPilot 介绍页（/welcome，个人版专有）。
 *
 * 结构参照云服务官网：顶栏放「GitHub」与「登录控制台」，首屏是可操作的 AI 立项演示，
 * 往下依次是工作方式、双入口、产品能力、部署与开源说明。
 * 组件只接收地址类参数，不读登录态，方便单测与离线预览；登录态由 /welcome 页面换算成按钮地址。
 */

export const LANDING_LANG_STORAGE_KEY = 'kaipilot-landing-lang'

export interface KaiPilotLandingProps {
  /** 「登录控制台」按钮地址：未登录时是登录页，已登录时是工作台 */
  consoleHref: string
  /** 已登录时按钮文案换成「进入工作台」 */
  authenticated?: boolean
  /** 官方 GitHub 仓库 */
  repoUrl: string
  /** 本实例的源代码地址（AGPL 第 13 条）；没有配置时页脚不显示 */
  sourceUrl?: string | null
  /** 首次渲染的语言；之后按浏览器语言或用户上次的选择切换 */
  initialLang?: LandingLang
  brand?: { lockupLight: string; lockupDark: string }
}

const DEFAULT_BRAND = {
  lockupLight: '/branding/kaipilot-lockup-light.svg',
  lockupDark: '/branding/kaipilot-lockup-dark.svg',
}

function readStoredLang(): LandingLang | null {
  try {
    const value = window.localStorage.getItem(LANDING_LANG_STORAGE_KEY)
    return value === 'zh' || value === 'en' ? value : null
  } catch {
    return null
  }
}

function storeLang(lang: LandingLang) {
  try {
    window.localStorage.setItem(LANDING_LANG_STORAGE_KEY, lang)
  } catch {
    // 无痕窗口等场景写不进去，只影响下次打开时的默认语言
  }
}

/** 取列表第 i 项；越界时退回第一项（列表都是写死的非空常量）。 */
function itemAt<T>(list: readonly T[], i: number): T {
  return (list[i] ?? list[0]) as T
}

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function GitHubMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

function Lockup({ brand, height = 28 }: { brand: KaiPilotLandingProps['brand']; height?: number }) {
  const assets = brand ?? DEFAULT_BRAND
  return (
    <span className="kp-lockup" style={{ height }}>
      <img src={assets.lockupLight} alt="开项 KaiPilot" className="kp-only-light" height={height} />
      <img
        src={assets.lockupDark}
        alt=""
        aria-hidden="true"
        className="kp-only-dark"
        height={height}
      />
    </span>
  )
}

function LangSwitch({
  lang,
  onChange,
  label,
}: {
  lang: LandingLang
  onChange: (lang: LandingLang) => void
  label: string
}) {
  return (
    <div className="kp-lang" role="group" aria-label={label}>
      {(['zh', 'en'] as const).map((value) => (
        <button
          key={value}
          type="button"
          className="kp-lang-option"
          aria-pressed={lang === value}
          onClick={() => onChange(value)}
          lang={value === 'zh' ? 'zh-CN' : 'en'}
        >
          {value === 'zh' ? '中文' : 'EN'}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ 演示：甘特 */

function weekTicks(totalDays: number) {
  const ticks: number[] = []
  for (let day = 0; day < totalDays; day += 5) ticks.push(day)
  return ticks
}

function GanttTable({
  scenario,
  copy,
  animate,
  compact = false,
}: {
  scenario: DemoScenario
  copy: LandingCopy
  animate: boolean
  compact?: boolean
}) {
  const total = scenario.totalDays
  const ticks = weekTicks(total)
  // 周数多时隔周标注，网格线照常每周一条
  const labelEvery = Math.ceil(ticks.length / 5)
  return (
    <div className="kp-gantt-scroll">
      <table
        className={compact ? 'kp-gantt kp-gantt-compact' : 'kp-gantt'}
        data-animate={animate || undefined}
      >
        <thead>
          <tr>
            <th scope="col" className="kp-gantt-code">
              {copy.views.wbsCode}
            </th>
            <th scope="col" className="kp-gantt-name">
              {copy.views.task}
            </th>
            <th scope="col" className="kp-gantt-days">
              {copy.views.days}
            </th>
            <th scope="col" className="kp-gantt-track-head">
              <span className="kp-sr-only">{copy.demo.gantt}</span>
              <span className="kp-gantt-ticks" aria-hidden="true">
                {ticks.map((day, index) =>
                  index % labelEvery === 0 ? (
                    <span key={day} style={{ left: `${(day / total) * 100}%` }}>
                      {copy.demo.weekTick(index + 1)}
                    </span>
                  ) : null,
                )}
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {scenario.tasks.map((task, index) => (
            <GanttRow
              key={task.code}
              task={task}
              total={total}
              ticks={ticks}
              index={index}
              copy={copy}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function GanttRow({
  task,
  total,
  ticks,
  index,
  copy,
}: {
  task: DemoTask
  total: number
  ticks: number[]
  index: number
  copy: LandingCopy
}) {
  const delay = { animationDelay: `${120 + index * 110}ms` }
  return (
    <tr className="kp-gantt-row" style={delay}>
      <td className="kp-gantt-code">{task.code}</td>
      <td className="kp-gantt-name">{task.name}</td>
      <td className="kp-gantt-days">{task.milestone ? '◆' : copy.demo.daysUnit(task.days)}</td>
      <td className="kp-gantt-track">
        <span className="kp-gantt-grid" aria-hidden="true">
          {ticks.map((day) => (
            <span key={day} style={{ left: `${(day / total) * 100}%` }} />
          ))}
        </span>
        {task.milestone ? (
          <span
            className="kp-gantt-milestone"
            style={{ left: `${(task.start / total) * 100}%`, ...delay }}
            title={copy.demo.milestoneLegend}
          />
        ) : (
          <span
            className={task.critical ? 'kp-gantt-bar is-critical' : 'kp-gantt-bar'}
            style={{
              left: `${(task.start / total) * 100}%`,
              width: `${(task.days / total) * 100}%`,
              ...delay,
            }}
            title={task.critical ? copy.demo.criticalLegend : undefined}
          />
        )}
      </td>
    </tr>
  )
}

/* ------------------------------------------------------------------ 演示：AI 立项 */

function DraftDemo({ lang, copy }: { lang: LandingLang; copy: LandingCopy }) {
  const scenarios = SCENARIOS[lang]
  const [index, setIndex] = useState(0)
  const [run, setRun] = useState(0)
  const [stage, setStage] = useState(copy.demo.stages.length)
  const [typedLength, setTypedLength] = useState<number | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const scenario = itemAt(scenarios, index)
  const promptId = useId()

  const start = useCallback((next: number) => {
    setIndex(next)
    setConfirmed(false)
    setRun((value) => value + 1)
  }, [])

  // 每次生成：先把描述逐字打出来，再依次点亮五个阶段；减少动态效果时直接给出结果
  useEffect(() => {
    if (run === 0) return
    const stages = copy.demo.stages.length
    if (prefersReducedMotion()) {
      setTypedLength(null)
      setStage(stages)
      return
    }
    const timers: ReturnType<typeof setTimeout>[] = []
    const text = itemAt(scenarios, index).prompt
    setStage(-1)
    setTypedLength(0)
    const typeStep = Math.max(14, Math.min(36, 900 / text.length))
    for (let i = 1; i <= text.length; i += 1) {
      timers.push(setTimeout(() => setTypedLength(i), i * typeStep))
    }
    const typed = text.length * typeStep + 120
    for (let s = 0; s <= stages; s += 1) {
      timers.push(setTimeout(() => setStage(s), typed + s * 320))
    }
    timers.push(setTimeout(() => setTypedLength(null), typed))
    return () => timers.forEach(clearTimeout)
    // 只在点击「生成」时重放；切换语言不重放
  }, [run])

  const generating = stage < copy.demo.stages.length
  // 「拆解 WBS」阶段之前先显示占位，草案随阶段推进再出现
  const showBody = !generating || stage >= 2
  const shownPrompt = typedLength === null ? scenario.prompt : scenario.prompt.slice(0, typedLength)
  const taskCount = scenario.tasks.length

  return (
    <section className="kp-demo" aria-label={copy.demo.label}>
      <header className="kp-demo-head">
        <span className="kp-demo-title">{copy.demo.label}</span>
        <span className="kp-demo-badge">{copy.demo.badge}</span>
      </header>

      <div className="kp-demo-prompt">
        <span id={promptId} className="kp-demo-prompt-label">
          {copy.demo.promptLabel}
        </span>
        <div className="kp-demo-input-row">
          <p
            className="kp-demo-input"
            aria-labelledby={promptId}
            data-typing={typedLength !== null || undefined}
          >
            {shownPrompt}
          </p>
          <button
            type="button"
            className="kp-btn kp-btn-primary kp-btn-sm"
            onClick={() => start(index)}
            disabled={generating}
          >
            {copy.demo.regenerate}
          </button>
        </div>
        <div className="kp-demo-chips" role="group" aria-label={copy.demo.promptLabel}>
          {scenarios.map((item, i) => (
            <button
              key={item.id}
              type="button"
              className="kp-chip"
              aria-pressed={i === index}
              onClick={() => start(i)}
              disabled={generating}
            >
              {item.chip}
            </button>
          ))}
        </div>
      </div>

      <ol className="kp-demo-stages" aria-label={copy.how.eyebrow}>
        {copy.demo.stages.map((label, i) => (
          <li key={label} data-state={stage > i ? 'done' : stage === i ? 'active' : 'pending'}>
            <span className="kp-demo-stage-dot" aria-hidden="true" />
            <span>{label}</span>
          </li>
        ))}
      </ol>

      {showBody ? (
        <div className="kp-demo-body" key={`${run}-${index}`}>
          <dl className="kp-charter">
            <div>
              <dt>{copy.demo.goal}</dt>
              <dd>{scenario.goal}</dd>
            </div>
            <div>
              <dt>{copy.demo.duration}</dt>
              <dd className="kp-num">{copy.demo.durationValue(scenario.totalDays)}</dd>
            </div>
            <div>
              <dt>{copy.demo.scope}</dt>
              <dd>{scenario.scope}</dd>
            </div>
            <div>
              <dt>{copy.demo.risk}</dt>
              <dd>{scenario.risk}</dd>
            </div>
          </dl>

          <GanttTable scenario={scenario} copy={copy} animate={run > 0} />

          <div className="kp-legend" aria-hidden="true">
            <span>
              <i className="kp-legend-bar is-critical" />
              {copy.demo.criticalLegend}
            </span>
            <span>
              <i className="kp-legend-bar" />
              WBS
            </span>
            <span>
              <i className="kp-legend-diamond" />
              {copy.demo.milestoneLegend}
            </span>
          </div>

          <div className="kp-acceptance">
            <span className="kp-label">{copy.demo.acceptance}</span>
            <ul>
              {scenario.acceptance.map((item) => (
                <li key={item}>
                  <Check size={14} aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <div className="kp-demo-body kp-demo-skeleton" aria-hidden="true">
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i} style={{ width: `${92 - ((i * 23) % 40)}%` }} />
          ))}
        </div>
      )}

      <footer className="kp-demo-foot" data-confirmed={confirmed || undefined}>
        <div className="kp-demo-checks" aria-label={copy.demo.checks}>
          <span className="kp-check-pill">
            <ShieldCheck size={14} aria-hidden="true" />
            {copy.demo.rulesPassed}
          </span>
          <span className="kp-check-pill">
            <ShieldCheck size={14} aria-hidden="true" />
            {copy.demo.hallucinationPassed}
          </span>
        </div>
        <div className="kp-demo-decision">
          <span className="kp-status" role="status" data-state={confirmed ? 'confirmed' : 'draft'}>
            {confirmed ? copy.demo.confirmedStatus(taskCount) : copy.demo.draftStatus}
          </span>
          {confirmed ? (
            <button
              type="button"
              className="kp-btn kp-btn-ghost kp-btn-sm"
              onClick={() => setConfirmed(false)}
            >
              {copy.demo.undo}
            </button>
          ) : (
            <button
              type="button"
              className="kp-btn kp-btn-ink kp-btn-sm"
              onClick={() => setConfirmed(true)}
              disabled={generating}
            >
              <Check size={14} aria-hidden="true" />
              {copy.demo.confirm}
            </button>
          )}
        </div>
      </footer>
    </section>
  )
}

/* ------------------------------------------------------------------ 工作方式 */

function HowItWorks({ copy }: { copy: LandingCopy }) {
  const [active, setActive] = useState(0)
  const step = itemAt(copy.how.steps, active)
  return (
    <section id="how" className="kp-section">
      <div className="kp-wrap">
        <SectionHead eyebrow={copy.how.eyebrow} title={copy.how.title} lede={copy.how.lede} />
        <div className="kp-steps">
          <ol className="kp-step-list">
            {copy.how.steps.map((item, i) => (
              <li key={item.title}>
                <button
                  type="button"
                  className="kp-step"
                  aria-pressed={i === active}
                  onClick={() => setActive(i)}
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                >
                  <span className="kp-step-index kp-num">{i + 1}</span>
                  <span className="kp-step-title">{item.title}</span>
                </button>
              </li>
            ))}
          </ol>
          <div className="kp-step-detail" aria-live="polite">
            <span className="kp-step-detail-index kp-num" aria-hidden="true">
              {String(active + 1).padStart(2, '0')}
            </span>
            <h3>{step.title}</h3>
            <p>{step.detail}</p>
            <ul>
              {step.examples.map((example) => (
                <li key={example}>{example}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ 双入口 */

function DualViews({ lang, copy }: { lang: LandingLang; copy: LandingCopy }) {
  const [view, setView] = useState<'pro' | 'simple'>('pro')
  const [switched, setSwitched] = useState(false)
  const scenario = itemAt(SCENARIOS[lang], 0)
  const columns = ['todo', 'doing', 'done'] as const
  return (
    <section id="views" className="kp-section kp-section-alt">
      <div className="kp-wrap kp-views">
        <div className="kp-views-text">
          <SectionHead
            eyebrow={copy.views.eyebrow}
            title={copy.views.title}
            lede={copy.views.lede}
          />
          <div className="kp-toggle" role="tablist" aria-label={copy.views.eyebrow}>
            {(['pro', 'simple'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                id={`kp-view-tab-${value}`}
                aria-selected={view === value}
                aria-controls="kp-view-panel"
                className="kp-toggle-option"
                onClick={() => {
                  setView(value)
                  setSwitched(true)
                }}
              >
                <span>{value === 'pro' ? copy.views.pro : copy.views.simple}</span>
                <small>{value === 'pro' ? copy.views.proHint : copy.views.simpleHint}</small>
              </button>
            ))}
          </div>
        </div>
        <div
          id="kp-view-panel"
          role="tabpanel"
          aria-labelledby={`kp-view-tab-${view}`}
          className="kp-views-panel"
          data-view={view}
        >
          {view === 'pro' ? (
            <GanttTable scenario={scenario} copy={copy} animate={switched} compact />
          ) : (
            <div className="kp-board">
              {columns.map((column) => (
                <div key={column} className="kp-board-col">
                  <div className="kp-board-head">
                    <span>{copy.views.columns[column]}</span>
                    <span className="kp-num">
                      {scenario.tasks.filter((t) => t.status === column).length}
                    </span>
                  </div>
                  {scenario.tasks
                    .filter((t) => t.status === column)
                    .map((task) => (
                      <div
                        key={task.code}
                        className="kp-card"
                        data-critical={task.critical || undefined}
                      >
                        <span className="kp-card-name">{task.name}</span>
                        <span className="kp-card-meta kp-num">
                          {task.milestone
                            ? `◆ ${copy.demo.milestoneLegend}`
                            : copy.demo.daysUnit(task.days)}
                        </span>
                      </div>
                    ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ 产品能力 */

function Capabilities({ copy }: { copy: LandingCopy }) {
  const list = copy.capabilities.list
  const [activeId, setActiveId] = useState(itemAt(list, 0).id)
  const active = list.find((item) => item.id === activeId) ?? itemAt(list, 0)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  function onKeyDown(event: React.KeyboardEvent, i: number) {
    const delta =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? -1
          : 0
    if (!delta) return
    event.preventDefault()
    const next = (i + delta + list.length) % list.length
    setActiveId(itemAt(list, next).id)
    tabRefs.current[next]?.focus()
  }

  return (
    <section id="capabilities" className="kp-section">
      <div className="kp-wrap">
        <SectionHead
          eyebrow={copy.capabilities.eyebrow}
          title={copy.capabilities.title}
          lede={copy.capabilities.lede}
        />
        <div className="kp-caps">
          <div
            className="kp-caps-tabs"
            role="tablist"
            aria-orientation="vertical"
            aria-label={copy.capabilities.eyebrow}
          >
            {list.map((item, i) => (
              <button
                key={item.id}
                ref={(el) => {
                  tabRefs.current[i] = el
                }}
                type="button"
                role="tab"
                id={`kp-cap-tab-${item.id}`}
                aria-selected={item.id === active.id}
                aria-controls="kp-cap-panel"
                tabIndex={item.id === active.id ? 0 : -1}
                className="kp-caps-tab"
                onClick={() => setActiveId(item.id)}
                onKeyDown={(event) => onKeyDown(event, i)}
              >
                {item.name}
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            ))}
          </div>
          <div
            id="kp-cap-panel"
            role="tabpanel"
            aria-labelledby={`kp-cap-tab-${active.id}`}
            className="kp-caps-panel"
            key={active.id}
          >
            <h3>{active.name}</h3>
            <p>{active.summary}</p>
            <ul>
              {active.items.map((item) => (
                <li key={item}>
                  <Check size={16} aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ 部署 */

function Deploy({ copy }: { copy: LandingCopy }) {
  const [tab, setTab] = useState<'local' | 'compose'>('local')
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const codeRef = useRef<HTMLElement | null>(null)
  const commands = DEPLOY_COMMANDS[tab]

  useEffect(() => {
    if (copyState === 'idle') return
    const timer = setTimeout(() => setCopyState('idle'), 2000)
    return () => clearTimeout(timer)
  }, [copyState])

  function selectCode() {
    const node = codeRef.current
    const selection = typeof window !== 'undefined' ? window.getSelection() : null
    if (!node || !selection) return
    const range = document.createRange()
    range.selectNodeContents(node)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  function onCopy() {
    const done = () => setCopyState('copied')
    const fail = () => {
      selectCode()
      setCopyState('failed')
    }
    try {
      const pending = navigator.clipboard?.writeText(commands)
      if (pending) pending.then(done, fail)
      else fail()
    } catch {
      fail()
    }
  }

  return (
    <section id="deploy" className="kp-section kp-section-alt">
      <div className="kp-wrap kp-deploy">
        <SectionHead
          eyebrow={copy.deploy.eyebrow}
          title={copy.deploy.title}
          lede={copy.deploy.lede}
        />
        <div className="kp-terminal">
          <div className="kp-terminal-bar" role="tablist" aria-label={copy.deploy.eyebrow}>
            {(['local', 'compose'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                className="kp-terminal-tab"
                onClick={() => {
                  setTab(value)
                  setCopyState('idle')
                }}
              >
                {value === 'local' ? copy.deploy.local : copy.deploy.compose}
              </button>
            ))}
            <button type="button" className="kp-terminal-copy" onClick={onCopy}>
              {copyState === 'copied' ? (
                <Check size={14} aria-hidden="true" />
              ) : (
                <Copy size={14} aria-hidden="true" />
              )}
              <span aria-live="polite">
                {copyState === 'copied'
                  ? copy.deploy.copied
                  : copyState === 'failed'
                    ? copy.deploy.copyFailed
                    : copy.deploy.copy}
              </span>
            </button>
          </div>
          <pre className="kp-terminal-code">
            <code ref={codeRef}>
              {commands.split('\n').map((line) => (
                <span key={line} className="kp-terminal-line">
                  {line}
                </span>
              ))}
            </code>
          </pre>
          <p className="kp-terminal-note">
            {tab === 'local' ? copy.deploy.localNote : copy.deploy.composeNote}
          </p>
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ 公共小件 */

function SectionHead({ eyebrow, title, lede }: { eyebrow: string; title: string; lede: string }) {
  return (
    <div className="kp-section-head">
      <span className="kp-eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      <p>{lede}</p>
    </div>
  )
}

/* ------------------------------------------------------------------ 页面 */

export function KaiPilotLanding({
  consoleHref,
  authenticated = false,
  repoUrl,
  sourceUrl = null,
  initialLang = 'zh',
  brand,
}: KaiPilotLandingProps) {
  const [lang, setLang] = useState<LandingLang>(initialLang)
  const copy = COPY[lang]

  // 首次挂载后按上次选择或浏览器语言切换（服务端渲染固定用 initialLang，避免水合不一致）
  useEffect(() => {
    const stored = readStoredLang()
    if (stored) {
      setLang(stored)
      return
    }
    const browser = typeof navigator !== 'undefined' ? navigator.language : ''
    if (browser && !browser.toLowerCase().startsWith('zh')) setLang('en')
  }, [])

  const changeLang = useCallback((next: LandingLang) => {
    setLang(next)
    storeLang(next)
  }, [])

  const consoleLabel = authenticated ? copy.nav.workspace : copy.nav.signIn
  const heroPrimary = authenticated ? copy.hero.primaryAuthed : copy.hero.primary
  const navLinks = useMemo(
    () => [
      { href: '#capabilities', label: copy.nav.capabilities },
      { href: '#how', label: copy.nav.how },
      { href: '#views', label: copy.nav.views },
      { href: '#deploy', label: copy.nav.deploy },
      { href: '#open-source', label: copy.nav.openSource },
    ],
    [copy],
  )

  return (
    <div className="kp-landing" lang={lang === 'zh' ? 'zh-CN' : 'en'} data-kp-landing>
      <header className="kp-nav">
        <div className="kp-wrap kp-nav-inner">
          <a href="#top" className="kp-nav-brand" aria-label="开项 KaiPilot">
            <Lockup brand={brand} height={30} />
          </a>
          <nav className="kp-nav-links" aria-label={copy.nav.capabilities}>
            {navLinks.map((link) => (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ))}
          </nav>
          <div className="kp-nav-actions">
            <LangSwitch lang={lang} onChange={changeLang} label={copy.nav.langLabel} />
            <a
              className="kp-btn kp-btn-ghost kp-btn-sm kp-nav-github"
              href={repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={copy.nav.github}
            >
              <GitHubMark />
              <span className="kp-hide-sm">{copy.nav.github}</span>
            </a>
            <a
              className="kp-btn kp-btn-primary kp-btn-sm"
              href={consoleHref}
              aria-label={consoleLabel}
              data-console-link
            >
              <span className="kp-long">{consoleLabel}</span>
              <span className="kp-short" aria-hidden="true">
                {authenticated ? copy.nav.workspaceShort : copy.nav.signInShort}
              </span>
            </a>
          </div>
        </div>
      </header>

      <main id="top">
        <section className="kp-hero">
          <div className="kp-wrap kp-hero-inner">
            <div className="kp-hero-text">
              <span className="kp-eyebrow">{copy.hero.eyebrow}</span>
              <h1 className="kp-hero-title">
                <span className="kp-hero-lead">{copy.hero.titleLead}</span>
                <span>{copy.hero.titleRest}</span>
              </h1>
              <p className="kp-hero-lede">{copy.hero.lede}</p>
              <div className="kp-hero-ctas">
                <a className="kp-btn kp-btn-primary" href={consoleHref} data-console-link>
                  {heroPrimary}
                  <ArrowRight size={16} aria-hidden="true" />
                </a>
                <a
                  className="kp-btn kp-btn-outline"
                  href={repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <GitHubMark />
                  {copy.hero.secondary}
                </a>
              </div>
              <p className="kp-hero-foot">
                <ShieldCheck size={16} aria-hidden="true" />
                {copy.hero.footnote}
              </p>
            </div>
            <DraftDemo lang={lang} copy={copy} />
          </div>
        </section>

        <HowItWorks copy={copy} />
        <DualViews lang={lang} copy={copy} />
        <Capabilities copy={copy} />
        <Deploy copy={copy} />

        <section id="open-source" className="kp-band">
          <div className="kp-wrap kp-band-inner">
            <div className="kp-band-head">
              <span className="kp-eyebrow">{copy.openSource.eyebrow}</span>
              <h2>{copy.openSource.title}</h2>
            </div>
            <ul className="kp-band-points">
              {copy.openSource.points.map((point, i) => {
                const Icon = [Scale, KeyRound, Database][i] ?? Scale
                return (
                  <li key={point.title}>
                    <Icon size={20} aria-hidden="true" />
                    <h3>{point.title}</h3>
                    <p>{point.detail}</p>
                  </li>
                )
              })}
            </ul>
            <div className="kp-band-ctas">
              <a
                className="kp-btn kp-btn-light"
                href={repoUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <GitHubMark />
                {copy.openSource.github}
              </a>
              <a className="kp-btn kp-btn-primary" href={consoleHref} data-console-link>
                {authenticated ? copy.nav.workspace : copy.openSource.signIn}
                <ArrowRight size={16} aria-hidden="true" />
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="kp-footer">
        <div className="kp-wrap kp-footer-inner">
          <div className="kp-footer-brand">
            <Lockup brand={brand} height={26} />
            <p>{copy.footer.tagline}</p>
            <p className="kp-footer-fine">{copy.footer.codename}</p>
          </div>
          <ul className="kp-footer-links">
            <li>
              <a href={repoUrl} target="_blank" rel="noopener noreferrer">
                {copy.footer.repo}
              </a>
            </li>
            {sourceUrl && sourceUrl !== repoUrl ? (
              <li>
                <a href={sourceUrl} target="_blank" rel="noopener noreferrer" data-source-code-link>
                  {copy.footer.source}
                </a>
              </li>
            ) : null}
            <li>
              <a
                href={`${repoUrl.replace(/\/$/, '')}/blob/main/LICENSE`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {copy.footer.license}
              </a>
            </li>
            <li>
              <a href={consoleHref}>{authenticated ? copy.nav.workspace : copy.footer.signIn}</a>
            </li>
          </ul>
        </div>
      </footer>
    </div>
  )
}
