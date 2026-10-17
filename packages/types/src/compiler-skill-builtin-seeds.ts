/**
 * compiler-skill-builtin-seeds —— 官方内置 Skill 种子目录契约与确定性纯函数（V3 Skill System 第五块地基）。
 *
 * 定义 BuiltinSkillSeed / BuiltinKnowledgeEntry 接口（实现约定，不进共享 Skill/KnowledgeBundle 契约）、
 * 确定性纯函数 listBuiltinSeeds / resolveSeedContent / compareSeedVersion、
 * 以及首个实例「软件开发」Skill（skillKey: "skill-sw-dev"）的完整内容定义。
 *
 * 零运行时依赖原则：导入 ./compiler-skill 的顶层类型，不重新定义、不调 Date.now()。
 *
 * @aiproj/types 零依赖约束
 */

import type { SkillCategory, ActivationRule, KnowledgeBundle } from './compiler-skill.js'

// ── 内置知识条目局部接口（实现约定，不进共享 KnowledgeBundle 契约） ──

export interface BuiltinKnowledgeEntry {
  /** 条目稳定 ID。 */
  id: string
  /** 标题。 */
  title: string
  /** 正文（简体中文，100–300 字）。 */
  content: string
  /** 对齐 PRD Stage 1–6 注入点（可选元信息，本 change 不注入）。 */
  stage?: number
  /** 来源标注（可选；底座未落地时用 L1 规范引用）。 */
  sourceRefs?: {
    layer: 'L1' | 'L2' | 'L3' | 'L4'
    sourceId: string
    section?: string
  }[]
  /** 来源类型：官方手写（底座未落地时固定值）。 */
  provenance: 'official'
}

export interface BuiltinSkillSeed {
  skillKey: string
  name: string
  version: string
  description: string
  category: SkillCategory
  tags: string[]
  dependencies: string[]
  activation: ActivationRule
  basePriority: number
  knowledge: {
    rules: BuiltinKnowledgeEntry[]
    patterns: BuiltinKnowledgeEntry[]
    antiPatterns: BuiltinKnowledgeEntry[]
    examples: BuiltinKnowledgeEntry[]
    checklists: BuiltinKnowledgeEntry[]
    rubric: BuiltinKnowledgeEntry[]
  }
}

// ── 确定性纯函数 ──────────────────────────────────────────────────────

/**
 * 返回官方内置 Skill 种子目录（封闭目录，非跨组织分发）。
 *
 * @returns BuiltinSkillSeed 数组（含「软件开发」「营销活动」「敏捷项目管理」「瀑布项目管理」「建筑项目」「产品研发」「DevOps」「数据项目」八个内置 Skill，首期封闭）
 */
export function listBuiltinSeeds(): BuiltinSkillSeed[] {
  return [
    SOFTWARE_DEVELOPMENT_SEED,
    MARKETING_SEED,
    AGILE_PROJECT_MANAGEMENT_SEED,
    WATERFALL_PROJECT_MANAGEMENT_SEED,
    CONSTRUCTION_SEED,
    PRODUCT_RD_SEED,
    DEVOPS_SEED,
    DATA_PROJECT_SEED,
  ]
}

/**
 * 把内置结构化条目数组投影为 KnowledgeBundle 的顶层形状（unknown[]），
 * 供 SkillRegistryService / BuiltinSeedService 持久化。
 *
 * 每个 BuiltinKnowledgeEntry 被投影为 { id, title, content, stage, provenance, sourceRefs }。
 *
 * @param seed 内置种子
 * @returns KnowledgeBundle 顶层形状（六类为 unknown[]）
 */
export function resolveSeedContent(seed: BuiltinSkillSeed): KnowledgeBundle {
  const project = (entries: BuiltinKnowledgeEntry[]): unknown[] =>
    entries.map((e) => ({
      id: e.id,
      title: e.title,
      content: e.content,
      stage: e.stage,
      provenance: e.provenance,
      sourceRefs: e.sourceRefs,
    }))

  return {
    rules: project(seed.knowledge.rules),
    patterns: project(seed.knowledge.patterns),
    antiPatterns: project(seed.knowledge.antiPatterns),
    examples: project(seed.knowledge.examples),
    checklists: project(seed.knowledge.checklists),
    rubric: project(seed.knowledge.rubric),
  }
}

/**
 * 语义版本比较。
 *
 * 按 major.minor.patch 逐段比较：a > b 返回 1，a < b 返回 -1，相等返回 0。
 * 非法段（非数字）视作 0。
 *
 * @param a 版本字符串 A
 * @param b 版本字符串 B
 * @returns a > b 时 1，a < b 时 -1，相等时 0
 */
export function compareSeedVersion(a: string, b: string): number {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  const [aMajor, aMinor, aPatch] = pa
  const [bMajor, bMinor, bPatch] = pb
  if (aMajor !== bMajor) return aMajor > bMajor ? 1 : -1
  if (aMinor !== bMinor) return aMinor > bMinor ? 1 : -1
  if (aPatch !== bPatch) return aPatch > bPatch ? 1 : -1
  return 0
}

function parseSemver(v: string): [number, number, number] {
  const parts = v.split('.').map(Number)
  const p0 = parts[0]
  const p1 = parts[1]
  const p2 = parts[2]
  return [
    p0 !== undefined && Number.isFinite(p0) ? p0 : 0,
    p1 !== undefined && Number.isFinite(p1) ? p1 : 0,
    p2 !== undefined && Number.isFinite(p2) ? p2 : 0,
  ]
}

// ── 「软件开发」Skill 完整内容定义 ────────────────────────────────────

const SOFTWARE_DEVELOPMENT_SEED: BuiltinSkillSeed = {
  skillKey: 'skill-sw-dev',
  name: '软件开发',
  version: '1.0.0',
  description:
    '覆盖软件工程全生命周期的领域知识包：从需求分析、架构设计、编码实现到测试交付与运维回顾。适用于任何软件开发项目，提供规则、模式、反模式、示例、检查清单与评分标准。',
  category: {
    primary: 'domain',
    secondary: 'software_engineering',
  },
  tags: ['软件开发', '软件工程', '编程', '架构', 'DevOps', '测试', '安全'],
  dependencies: [],
  activation: {
    projectTypes: ['软件开发'],
    domains: ['software_engineering'],
    priority: 100,
  },
  basePriority: 100,
  knowledge: {
    // ── rules（规则）8 条 ──
    rules: [
      {
        id: 'sw-rule-001',
        title: '需求功能性与非功能性分类',
        content:
          '所有需求必须明确划分为功能需求（系统"做什么"）与非功能需求（系统"怎么做"——性能、安全、可用性、可维护性等），在项目章程或需求规格中以独立章节列出。非功能需求必须有可量化的验收标准（如"API P95 延迟 ≤ 200ms"、"系统可用性 ≥ 99.9%"），模糊的非功能需求（如"系统要快"）视为未完成——必须拆解为可测量的指标。功能需求与对应的非功能需求应建立追溯矩阵，确保每条功能都有配套的质量属性约束，避免"功能做完了但跑不起来"的局面。',
        stage: 1,
        sourceRefs: [{ layer: 'L1', sourceId: 'iso-25010', section: 'quality-model' }],
        provenance: 'official',
      },
      {
        id: 'sw-rule-002',
        title: '架构单一职责原则',
        content:
          '每个模块、服务、类或组件应有且只有一个引起其变化的原因（Single Responsibility Principle）。违反单一职责会导致变更波及面过大——改一个功能需同时修改多个不相关的模块、测试用例膨胀、团队并行开发时冲突频繁。在架构评审中将"单一职责"设为必查项：检查每个模块是否只服务于一个明确的业务能力或技术关注点。如果模块描述中出现了"和"字，大概率已违反该原则。拆分粒度以"一个业务概念一个模块"为参考，但不过度拆分到"一个函数一个文件"的极端。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'solid-principles', section: 'srp' }],
        provenance: 'official',
      },
      {
        id: 'sw-rule-003',
        title: 'API契约优先设计',
        content:
          '前后端分离或服务间通信时，必须遵循"契约优先"原则：先定义 API 契约（OpenAPI 3.x / GraphQL Schema / gRPC proto），再开始实现。契约应包含请求/响应完整结构、错误码枚举、鉴权方式、限流策略、版本号与废弃策略，且纳入版本管理（与代码同仓库或独立契约仓库）。契约变更必须走评审流程——所有消费者（前端、下游服务、外部集成方）需在评审中确认兼容性。实现阶段不得擅自修改契约；如需调整，先改契约再改实现。契约测试（Contract Test）应在 CI 中自动执行，验证实现与契约的一致性。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'openapi-3.1', section: 'specification' }],
        provenance: 'official',
      },
      {
        id: 'sw-rule-004',
        title: '依赖方向约束',
        content:
          '代码依赖方向必须从外到内、从具体到抽象：表现层 → 应用层 → 领域层 → 基础设施层。领域层（核心业务规则）不得依赖任何外层或基础设施细节（ORM、HTTP 框架、数据库驱动）；基础设施层实现领域层定义的接口（依赖反转 DIP）。任何跨层依赖必须通过接口/抽象类桥接——Controller 不得直接写 SQL、Service 不得直接操作 DOM、Domain Entity 不得 import ORM 装饰器。架构评审和 CI 静态分析（如 dependency-cruiser）应自动检查依赖方向违规。引入新依赖（npm/pip package）时必须评估其所在层——通用工具库（lodash/date-fns）可全局使用，框架特定库限定在对应层。',
        stage: 4,
        sourceRefs: [{ layer: 'L1', sourceId: 'clean-architecture', section: 'dependency-rule' }],
        provenance: 'official',
      },
      {
        id: 'sw-rule-005',
        title: '测试金字塔',
        content:
          '测试策略严格遵循金字塔结构：大量单元测试（≥ 70%，后端 ≥ 90%）验证函数/方法级逻辑、适量集成测试（约 20%）验证模块间协作与数据库/缓存交互、少量端到端测试（≤ 10%）验证关键用户流程。单元测试应在毫秒级完成且不依赖外部服务——数据库、网络、文件系统、系统时间均需 mock/stub。E2E 测试不得用于替代单元测试覆盖核心业务逻辑；若发现核心逻辑缺少单元测试，先补单测再考虑 E2E。CI 门禁按层级分阶段运行：单测（最快，每次提交）→ 集成测试（每次 PR）→ E2E（合并前/每日构建）。反模式：用 E2E 覆盖所有分支——导致 CI 慢、定位难、维护成本高。',
        stage: 5,
        sourceRefs: [{ layer: 'L1', sourceId: 'test-pyramid', section: 'practical-guide' }],
        provenance: 'official',
      },
      {
        id: 'sw-rule-006',
        title: '命名规范',
        content:
          '代码标识符必须自解释且遵循团队约定。变量/函数/方法用 camelCase（如 getUserById），类/接口/类型用 PascalCase（如 UserService），常量用 UPPER_SNAKE_CASE（如 MAX_RETRY_COUNT），文件名前端用 kebab-case（如 user-profile.tsx）后端用 snake_case（如 user_service.ts）。禁止单字母变量名（循环索引 i/j/k 除外）、无意义缩写（如 usr 代替 user、msg 在有歧义时不缩写）、拼音命名、否定式布尔名（用 isDisabled 不用 isNotEnabled）。布尔变量以 is/has/can/should 开头。函数名以动词开头（get/set/create/delete/update/validate/compute）。命名评审是代码评审的第一道检查——名称不清楚的代码不必往下看。',
        stage: 5,
        sourceRefs: [{ layer: 'L1', sourceId: 'clean-code', section: 'naming' }],
        provenance: 'official',
      },
      {
        id: 'sw-rule-007',
        title: '错误处理',
        content:
          '所有可恢复的错误必须被显式处理（try-catch / Result 类型 / error propagation），不得静默吞掉异常。不可恢复的错误（OOM、磁盘满、栈溢出）应快速失败（fail-fast）并记录完整诊断信息（堆栈、上下文、时间戳）。面向用户的错误消息必须安全脱敏——不泄露内部实现细节（栈追踪、SQL 语句、文件路径、内部 IP）。区分三类错误：可恢复（网络超时→重试）、可降级（推荐服务不可用→返回默认推荐）、不可恢复（数据库连接失败→快速失败并告警）。每个 API 端点必须有明确的错误码枚举，客户端据此做出差异化处理。全局错误处理器（error boundary / exception filter）作为最后一道防线，统一格式化未捕获异常。',
        stage: 5,
        sourceRefs: [
          { layer: 'L1', sourceId: 'error-handling-patterns', section: 'best-practices' },
        ],
        provenance: 'official',
      },
      {
        id: 'sw-rule-008',
        title: '安全输入校验',
        content:
          '所有外部输入必须在系统边界层进行严格校验与净化——包括 HTTP 请求参数/Header/Body、文件上传内容、WebSocket 消息、消息队列 payload、环境变量、URL 查询参数。校验策略采用"白名单优于黑名单"：先定义合法格式再拒绝不合规输入，而非枚举已知攻击模式。校验维度：类型（字符串/数字/布尔/对象）、长度（最小/最大）、格式（正则/日期/邮箱/URL）、范围（数值 min/max）、枚举（仅允许白名单值）、业务规则（startDate ≤ endDate）。校验失败返回明确错误码（VALIDATION_ERROR）并列出所有违规字段，不得只返回第一个错误。SQL/HTML/JS/Shell 特殊字符必须转义或使用参数化查询。文件上传额外校验：MIME 类型白名单、大小上限、病毒扫描（如集成 ClamAV）。',
        stage: 5,
        sourceRefs: [{ layer: 'L1', sourceId: 'owasp-top10-2021', section: 'input-validation' }],
        provenance: 'official',
      },
    ],

    // ── patterns（模式）8 条 ──
    patterns: [
      {
        id: 'sw-pattern-001',
        title: '微服务与单体与Serverless选型',
        content:
          '项目初期按多维度评估架构选型——不盲从任何一种范式。团队规模维度：< 10 人团队优先考虑单体/模块化单体，避免微服务带来的运维与通信复杂度超出团队能力。系统复杂度维度：业务模块边界清晰且确实需要独立部署/扩展时再拆分微服务，否则在单体中通过包/模块边界实现相同隔离效果。部署频率维度：需要独立部署、独立扩缩容的模块适合微服务；所有模块总是同步发版的适合单体。运维能力维度：缺乏容器编排（K8s）、服务网格、分布式监控经验→单体或 Serverless。成本维度：Serverless 按量付费适合低频/突发负载，常驻高流量→预留实例或传统部署更经济。选型结论记录为 ADR，包含选择理由、替代方案与风险缓解。',
        stage: 3,
        sourceRefs: [
          { layer: 'L1', sourceId: 'architecture-styles', section: 'selection-framework' },
        ],
        provenance: 'official',
      },
      {
        id: 'sw-pattern-002',
        title: '分层架构',
        content:
          '将系统按职责划分为表现层（UI/API Controller）、应用层（用例编排/事务管理）、领域层（业务规则/领域实体/值对象）和基础设施层（数据持久化/外部服务/消息队列/缓存）。每层只依赖其直接下层——通过接口定义边界，上层调用接口不依赖实现。依赖方向不可逆：领域层定义了 Repository 接口，基础设施层提供 ORM 实现；领域层不知道数据库存在。分层架构适合大多数企业应用和中型项目：结构清晰、新人容易理解、各层可独立测试（mock 下层接口）。常见变异：严格分层（只能调下一层）vs 宽松分层（可跨层调基础设施层工具，如日志/验证库）。权衡：严格分层增加代码量但保护领域纯净性，宽松分层减少样板代码但需团队纪律。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'layered-architecture', section: 'core-pattern' }],
        provenance: 'official',
      },
      {
        id: 'sw-pattern-003',
        title: '事件驱动架构',
        content:
          '通过领域事件解耦服务/模块间的通信：生产者（Producer）将事件发布到消息通道（Message Broker / Event Bus / Stream），消费者（Consumer）异步订阅并处理。事件命名使用过去式（OrderPlaced / UserRegistered），表示"已发生的事实"。每个事件包含事件 ID、发生时间戳、聚合根 ID、事件类型与 payload 数据。适用于高扩展性、松耦合、最终一致性的系统——如电商下单后异步触发库存扣减、积分累计、通知发送。关键设计约束：消费者必须幂等（同一条事件重复投递时结果不变）、事件顺序在同一个聚合根内保证、跨聚合根只保证最终一致性。引入事件后需配套事件溯源（Event Sourcing）或发件箱模式（Outbox Pattern）确保可靠投递。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'event-driven', section: 'core-concepts' }],
        provenance: 'official',
      },
      {
        id: 'sw-pattern-004',
        title: 'CQRS命令查询职责分离',
        content:
          '将读操作（Query）与写操作（Command）分离到不同模型：写模型（Command Model）聚焦业务规则校验、领域事件生成与数据一致性，使用聚合根/领域实体建模；读模型（Query Model）优化查询性能与展示格式，可直接使用 SQL 视图/物化视图/专用读库/搜索引擎（Elasticsearch）。Command 不返回业务数据（只返回成功/失败与 ID），Query 不修改数据。适用于读写负载差异大（读远多于写）、查询涉及多表聚合/跨服务、搜索场景复杂的系统。警告：CQRS 引入架构复杂度显著增加——双模型同步、最终一致性处理、命令与事件协作。小项目（< 5 个聚合根、查询简单）慎用，单体中的 Service 分层通常已足够。实施前确认有明确的读写性能瓶颈数据。',
        stage: 4,
        sourceRefs: [
          { layer: 'L1', sourceId: 'cqrs-pattern', section: 'microservice-applicability' },
        ],
        provenance: 'official',
      },
      {
        id: 'sw-pattern-005',
        title: '仓库模式',
        content:
          '在领域层与数据持久化之间引入仓储抽象（Repository）：领域层只依赖仓储接口（IUserRepository），具体实现（TypeORM / Prisma / 原生 SQL）放在基础设施层。仓储接口以领域语言命名方法（findByEmail / findActiveUsers），不暴露底层持久化细节（不出现 SQL / QueryBuilder / MongoDB collection 字样）。好处：领域层完全可单元测试（mock 仓储接口）、切换持久化方案只需新建实现类（SQLite → PostgreSQL 零改领域代码）、查询逻辑集中管理避免散落各处。分页/排序/过滤参数通过 Criteria 对象传入而非裸 SQL 字符串。反模式：仓储返回 IQueryable / QueryBuilder（泄露抽象——调用方可构造任意查询绕过仓储约束）。权衡：简单 CRUD 用仓储显重——可退化为通用 Repository<T> 基类，但核心聚合根应保留专属仓储。',
        stage: 4,
        sourceRefs: [{ layer: 'L1', sourceId: 'repository-pattern', section: 'ddd-integration' }],
        provenance: 'official',
      },
      {
        id: 'sw-pattern-006',
        title: '工厂模式',
        content:
          '当对象创建逻辑复杂（多步骤构造、条件分支、依赖组装、校验规则）时，使用工厂模式封装创建过程，使调用方不关心具体构造细节。常见变体：简单工厂——根据参数选择具体子类；工厂方法——子类决定实例化哪个具体类；抽象工厂——创建一组相关对象。在领域驱动设计中，工厂常用于：复杂聚合根构造（需要校验不变量/生成 ID/设置默认值）、DTO 组装（多源数据合并）、测试数据构建（Builder 模式是工厂的变体）。好处：创建逻辑集中一处、构造校验不遗漏、调用方代码简洁。注意：简单对象（只有 2-3 个属性无校验）直接用构造函数/对象字面量即可，工厂反而过度设计。',
        stage: 4,
        sourceRefs: [{ layer: 'L1', sourceId: 'gof-design-patterns', section: 'factory-method' }],
        provenance: 'official',
      },
      {
        id: 'sw-pattern-007',
        title: '策略模式',
        content:
          '定义一组可互换的算法/行为，封装为独立策略类，运行时根据上下文动态选择执行。策略接口定义统一的执行契约（如 execute(data): Result），各具体策略实现不同算法。上下文（Context）持有策略引用，委托执行而不关心具体策略。经典场景：多种支付方式（支付宝/微信/银行卡）、通知渠道（邮件/短信/站内信/Webhook）、认证方式（密码/OTP/SSO/OAuth）、费率计算（阶梯/固定/比例）、导出格式（PDF/Excel/CSV）。新增策略只需新建类实现接口，无需修改上下文（开闭原则 OCP）。策略实例可通过工厂模式创建或依赖注入容器管理。测试每种策略独立、可并行。注意：策略过多（>10）时考虑分组或元策略模式。',
        stage: 4,
        sourceRefs: [{ layer: 'L1', sourceId: 'gof-design-patterns', section: 'strategy' }],
        provenance: 'official',
      },
      {
        id: 'sw-pattern-008',
        title: '观察者模式',
        content:
          '建立一对多的依赖关系：当被观察对象（Subject/Observable）状态变化时，所有注册的观察者（Observer）自动收到通知并更新。经典实现：Subject 维护观察者列表，提供 attach/detach/notify 方法；Observer 实现 update 方法。现代变体：事件总线（EventEmitter / EventBus）——Subject 不直接维护 Observer 列表，而是 emit 事件到总线，由总线负责分发。适用于：UI 状态联动（Model 变更→多个 View 自动刷新）、领域事件发布（订单创建→通知库存/物流/积分/分析模块）、配置热更新（Config Center 变更→所有使用该配置的服务收到通知）。注意：同步通知（Observer 阻塞 Subject）简单但耦合执行时间，异步通知（消息队列/事件循环）解耦但需处理最终一致性。避免观察者链（A 通知 B，B 通知 C，C 通知 A——死循环）。',
        stage: 4,
        sourceRefs: [{ layer: 'L1', sourceId: 'gof-design-patterns', section: 'observer' }],
        provenance: 'official',
      },
    ],

    // ── antiPatterns（反模式）8 条 ──
    antiPatterns: [
      {
        id: 'sw-antipat-001',
        title: '大泥球',
        content:
          '代码无清晰模块边界、无分层结构、无一致设计原则，所有逻辑像泥巴一样糊在一起。典型症状：修改一个"小功能"需要改动几十个文件且无法预测影响面、新人入职数月仍无法独立完成任何任务、技术债务以指数速度累积。根本原因通常不是技术而是流程——无架构评审、无代码评审、持续"先上线再重构"但永远没时间重构。预防策略：项目启动第一周即建立分层架构和模块边界（即使只有 3 个模块）、强制执行代码评审（至少一人 Approve）、每迭代分配 20% 时间偿还技术债、新人入职第一周的任务是"理解架构并画出当前模块依赖图"——如果画不出来说明架构已退化。',
        stage: 2,
        sourceRefs: [
          { layer: 'L1', sourceId: 'anti-patterns-catalog', section: 'big-ball-of-mud' },
        ],
        provenance: 'official',
      },
      {
        id: 'sw-antipat-002',
        title: '上帝对象',
        content:
          '一个类/模块/Service 承担了过多职责——它知道一切、做一切、控制一切。典型症状：单个文件数千行、所有业务逻辑集中在一个 UserService / OrderService、类名中包含 "Manager" "Handler" "Util" 往往是上帝对象的前兆、测试该对象需要 mock 几十个依赖。后果：修改任何功能都可能破坏不相关的行为、测试运行慢且脆弱、多个开发者同时修改同一文件导致频繁合并冲突。预防策略：严格遵循单一职责原则、定期运行复杂度扫描（圈复杂度 > 10 即应拆分）、代码评审时对超过 300 行的类要求拆分理由、按领域概念而非技术概念划分类边界（UserAuthService / UserProfileService 优于 UserService）。',
        stage: 2,
        sourceRefs: [{ layer: 'L1', sourceId: 'anti-patterns-catalog', section: 'god-object' }],
        provenance: 'official',
      },
      {
        id: 'sw-antipat-003',
        title: '过早优化',
        content:
          '在没有性能数据支撑的情况下对代码进行复杂优化——引入缓存层、手写复杂算法替代标准库、为"未来可能的"高并发做过度设计。Knuth 名言："过早优化是万恶之源。"真实代价：代码可读性下降（优化后的代码通常更晦涩）、维护成本上升、优化方向可能错误（凭直觉猜测的瓶颈通常不是真正的瓶颈）。正确做法：先写出清晰、正确、简单的代码 → 通过性能测试/监控定位真实瓶颈（P95 延迟、CPU/内存 profile）→ 在瓶颈处针对性地优化 → 优化后再次测量验证效果。优化必须可逆：用 feature flag 包裹优化逻辑，出问题时一键切回原实现。例外：架构层面的性能决策（如选 Redis 还是 MySQL 做缓存）需提前评估，这不属于过早优化。',
        stage: 5,
        sourceRefs: [
          { layer: 'L1', sourceId: 'anti-patterns-catalog', section: 'premature-optimization' },
        ],
        provenance: 'official',
      },
      {
        id: 'sw-antipat-004',
        title: '硬编码配置',
        content:
          '将数据库连接串、API 密钥/Secret、第三方服务 URL、业务阈值（如"超时 30 秒"）、功能开关、环境差异化参数直接写死在代码中。症状：切换环境（dev/staging/prod）需要修改代码并重新构建/部署、配置散落在数十个文件各处难以审计和轮换、敏感信息（密钥/密码）暴露在代码仓库历史中。预防策略：所有配置通过环境变量或配置中心注入（K8s ConfigMap/Secrets、AWS Parameter Store、HashiCorp Vault）、代码中只读不写配置值、敏感值加密存储且定期轮换、CI 扫描禁止硬编码密钥模式（regex 检测 private key/API key 格式）、配置变更与代码变更走不同流程（配置可热更新）。开发环境提供 .env.example 模板文件（不含真实密钥），真实 .env 在 .gitignore 中。',
        stage: 5,
        sourceRefs: [{ layer: 'L1', sourceId: 'twelve-factor-app', section: 'config' }],
        provenance: 'official',
      },
      {
        id: 'sw-antipat-005',
        title: '忽略错误',
        content:
          '对错误采取空 catch 块（catch(e) {}）、只打 log 不处理（console.error 然后继续执行）、返回 null/undefined 而不区分"数据不存在"与"查询出错"等处理方式。症状：生产环境出现不可解释的行为——数据静默丢失、状态不一致、用户看到空白页面而非错误提示、问题定位需数小时因为错误在调用链深处被吞掉。预防策略：每个错误分支必须显式决策——可恢复（重试/降级）、不可恢复（快速失败并告警）、可传播（抛给上层决定）。使用 Result/Optional 类型强制调用方处理异常路径。lint 规则禁止空 catch 块和未使用的 error 变量。全局异常处理器记录所有未捕获异常并告警，但不应替代各层的显式错误处理——全局处理器是最后的安全网而非日常处理方式。',
        stage: 5,
        sourceRefs: [
          { layer: 'L1', sourceId: 'error-handling-patterns', section: 'anti-patterns' },
        ],
        provenance: 'official',
      },
      {
        id: 'sw-antipat-006',
        title: '瀑布式测试',
        content:
          '将所有测试活动推迟到开发阶段全部完成后集中执行——先写完所有代码，再用数周时间"补测试"。后果：缺陷发现时间晚（需求阶段的缺陷在测试阶段才发现，修复成本是当时的 10-100 倍）、测试阶段成为瓶颈导致发布延期、开发后期压力巨大且质量下降、测试人员与开发人员对立而非协作。正确做法：测试活动与开发活动并行——每完成一个函数立即写单元测试（TDD 或至少同步）、每完成一个 API 端点立即写集成测试、每完成一个用户故事立即写验收测试。CI 门禁在每次提交时自动运行全量测试套件——不通过的提交无法合并。在 Sprint 计划中为测试任务分配明确的故事点和时间，不把测试视为"代码写完后顺便做的事"。',
        stage: 5,
        sourceRefs: [{ layer: 'L1', sourceId: 'shift-left-testing', section: 'overview' }],
        provenance: 'official',
      },
      {
        id: 'sw-antipat-007',
        title: '技术债累积',
        content:
          '持续以"现在赶进度，以后重构"为由跳过代码清理、跳过测试编写、跳过文档更新、跳过架构评审。每笔技术债看似微不足道，但利息以复利计算——三个月后迭代速度明显下降、六个月后每次改动都胆战心惊、一年后团队讨论的不是"做什么"而是"怎么还敢动这段代码"。技术债不是"不做"而是"欠条"：每笔债务必须记录（TODO-DEBT 标注或 backlog 条目），纳入 Sprint 排期，设定偿还期限。预防策略：每迭代分配固定比例（建议 20%）偿还技术债、DoD（Definition of Done）中明确包含"无新增技术债"、架构评审中检查技术债趋势、季度大扫除（Code Freeze 一周专门还债）。注意：不是所有"不够完美"都是技术债——只有影响迭代速度或质量的才计入。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'technical-debt', section: 'management-strategies' }],
        provenance: 'official',
      },
      {
        id: 'sw-antipat-008',
        title: '绕过抽象层',
        content:
          '上层代码绕过接口/抽象层直接依赖底层实现细节——Controller 直接执行 SQL 查询、Service 直接操作 DOM 元素、业务逻辑中 import 具体 ORM 实体类而非接口。后果：更换底层实现（如换数据库、换 UI 框架）需要改动所有上层代码——抽象层形同虚设、单元测试无法 mock 底层依赖、架构图中的分层在实际代码中不存在。根本原因：开发者对抽象层不信任或觉得"就这一处直接调用问题不大"——但一处变成十处、十处变成惯例。预防策略：代码评审中设置"依赖方向检查"专项（可使用 dependency-cruiser 等工具自动化）、架构 ADR 中明确每层的允许依赖列表、新人 onboarding 时讲解分层原则并用实际代码示例演示违规与合规写法。如果确实需要绕过抽象层（如紧急性能修复），必须标记 TODO-DEBT 并计划重构。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'clean-architecture', section: 'boundaries' }],
        provenance: 'official',
      },
    ],

    // ── examples（示例）8 条 ──
    examples: [
      {
        id: 'sw-example-001',
        title: '软件WBS示例',
        content:
          '典型软件开发项目的 WBS 结构（7 个一级阶段，可裁剪）。阶段 1——项目启动：项目章程（目标/范围/成功标准）、干系人登记册（RACI 矩阵）、团队组建（角色/职责/通讯计划）。阶段 2——需求分析：用户故事地图、验收标准（Given-When-Then）、功能规格文档、非功能需求清单（性能/安全/可用性量化指标）、原型/线框图（低保真→高保真）。阶段 3——架构设计：技术选型 ADR（语言/框架/数据库/消息队列）、系统架构图（C4 模型 Context/Container/Component 三层）、API 契约（OpenAPI/GraphQL Schema）、数据库 ER 图与迁移计划、部署架构（环境拓扑/CI/CD 流程）。阶段 4——迭代开发 Sprint 1-N：每 Sprint 含 Sprint 计划会（≤ 2h）、每日站会（≤ 15min）、开发与单元测试、代码评审、Sprint 评审会（Demo）和回顾会。阶段 5——测试：集成测试、性能测试（压力/负载/浸泡）、安全测试（SAST/DAST/依赖扫描）、用户验收测试 UAT、缺陷管理（严重程度/优先级分类）。阶段 6——部署上线：灰度/金丝雀发布策略、监控与告警配置、回滚方案与演练、数据迁移脚本（含回滚）。阶段 7——项目收尾：文档归档、知识转移（Runbook/新人指南）、项目复盘（What went well / What to improve）、团队解散/转岗计划。',
        stage: 1,
        sourceRefs: [{ layer: 'L1', sourceId: 'pmbok-7', section: 'wbs' }],
        provenance: 'official',
      },
      {
        id: 'sw-example-002',
        title: '用户故事模板',
        content:
          '标准用户故事模板：作为<角色>，我希望<功能>，以便<价值/目的>。验收标准使用 Given-When-Then 格式编写。完整示例——故事：作为项目管理员，我希望按 Sprint 筛选任务列表，以便快速了解当前迭代的进度和瓶颈。验收标准：Given 项目"电商平台"有 Sprint 1（8 月 1 日-14 日）、Sprint 2（8 月 15 日-28 日）且各有 15 个任务；When 管理员在任务列表页选择 Sprint 2 筛选；Then 列表仅显示 Sprint 2 的 15 个任务，Sprint 1 的任务隐藏，页面标题显示"Sprint 2（8/15-8/28）"。边界条件：无 Sprint 的项目显示"暂无 Sprint，请先创建 Sprint"；选择"Sprint 2"后 URL 参数同步更新为 ?sprint=2（支持分享链接）；切换 Sprint 筛选时保留其他筛选条件（状态/指派人/搜索关键词）。非功能需求：筛选切换响应时间 ≤ 200ms、支持键盘快捷键 Alt+S 打开 Sprint 筛选下拉。',
        stage: 1,
        sourceRefs: [{ layer: 'L1', sourceId: 'user-stories-applied', section: 'writing-stories' }],
        provenance: 'official',
      },
      {
        id: 'sw-example-003',
        title: 'Sprint计划示例',
        content:
          'Sprint 计划模板（2 周 Sprint）。Sprint 目标（一句话，可度量）："完成用户认证模块 MVP——支持邮箱密码登录、JWT 签发与刷新、登录页面 UI、RBAC 权限校验中间件"。团队容量计算：5 人 × 8 工作日 × 6 有效工时 = 240 小时，扣除 Sprint 会议（计划会 10h + 每日站会 7.5h + 评审会 5h + 回顾会 5h = 27.5h），净可用 212.5 小时 ≈ 42 故事点（按 1 点 ≈ 5 小时估算）。待办项排序（按优先级，含点数与负责人）：S1-1 设计认证 API 契约（2 点/张三）、S1-2 实现 JWT 签发与校验（5 点/李四）、S1-3 实现登录页面（3 点/王五）、S1-4 前端 Auth Store（2 点/赵六）、S1-5 路由守卫（2 点/赵六）、S1-6 Token 刷新机制（3 点/李四）、S1-7 RBAC 中间件（5 点/张三）、S1-8 登录失败锁定（3 点/王五）、S1-9 E2E 测试（5 点/孙七）、S1-10 文档更新（2 点/孙七）。总计 32 点，留 10 点 buffer 应对突发。DoD：代码提交+通过评审+单元测试覆盖率 ≥ 90%+集成测试通过+API 文档更新+无新增 lint 警告。风险：张三周二/周三请假→S1-1 和 S1-7 需李四 backup。不在本次 Sprint 范围：OAuth 第三方登录、MFA 多因素认证、密码找回流程（移至 S2）。',
        stage: 1,
        sourceRefs: [{ layer: 'L1', sourceId: 'scrum-guide', section: 'sprint-planning' }],
        provenance: 'official',
      },
      {
        id: 'sw-example-004',
        title: 'ADR架构决策记录',
        content:
          'ADR 模板与示例。标题：ADR-004：选择 PostgreSQL 替代 SQLite 作为生产数据库。状态：已接受（2026-03-15）。上下文：当前 SQLite 在并发写入场景下性能不足（10+ 并发用户时出现 SQLITE_BUSY）、缺少地理空间查询支持（用户需求中的位置相关功能无法实现）、运维团队已有 PostgreSQL 运维经验。决策：V2 版本迁移到 PostgreSQL 15，保留 SQLite 作为开发/测试环境默认数据库（降低本地开发门槛）。迁移通过 Lucid ORM 完成——V1 已预留 PostgreSQL 适配，大部分代码无需修改。后果——正面：支持更高并发写入（连接池管理）、原生 PostGIS 支持地理空间查询、更成熟的备份/恢复生态（pg_dump/WAL 归档/PITR）。负面：增加运维复杂度（需管理 PostgreSQL 集群/连接池/备份策略）、开发环境需额外安装 PostgreSQL 或使用 Docker。缓解：提供 docker-compose.yml 一键启动 PostgreSQL 开发环境、保持 SQLite 兼容模式作为 CI 快速测试选项。替代方案：MySQL——语法差异较大且团队无经验；MongoDB——不适合本项目的关系密集型数据模型。',
        stage: 4,
        sourceRefs: [{ layer: 'L1', sourceId: 'adr-pattern', section: 'template' }],
        provenance: 'official',
      },
      {
        id: 'sw-example-005',
        title: '风险登记示例',
        content:
          '软件开发项目典型风险登记册模板（含概率/影响/等级/缓解/触发条件/负责人）。风险 R1——新技术栈学习曲线：团队首次使用 Next.js 14 App Router + Server Components，学习成本可能影响前两个 Sprint 的交付速度。概率 40%（中）/ 影响高 / 等级 红色。缓解措施：Sprint 0 安排 3 天技术 Spike、指定 1 名有 React 经验的成员为"技术导师"、前两个 Sprint 容量预留 20% buffer。触发条件：Sprint 1 结束时计划完成率 < 60%。负责人：技术 Lead。风险 R2——核心开发者离职：后端核心开发者（李四）是唯一掌握认证/权限系统细节的人。概率 15%（低）/ 影响极高 / 等级 红色。缓解：强制结对编程（李四+孙七）、认证模块文档在本 Sprint 完成（Bus Factor ≥ 2）、关键设计决策记录在 ADR 中。触发条件：李四请假超过 3 天时检查文档覆盖度。风险 R3——第三方 API 不稳定：AI Gateway 依赖的外部模型 API 可能变更接口格式或限流策略。概率 25%（低-中）/ 影响中 / 等级 黄色。缓解：Adapter 抽象层隔离外部 API 变更、实现降级策略（模型不可用时返回缓存建议/提示用户稍后重试）、每日自动运行 API 连通性测试。触发条件：连续 3 次 API 调用失败或 P95 延迟 > 10s。风险 R4——需求变更频繁：产品方在开发中期提出重大需求调整。概率 50%（中-高）/ 影响中 / 等级 黄色。缓解：Sprint 中期不接受范围变更（需等 Sprint 结束）、变更请求走评审流程（评估对进度/架构/测试的影响）、预留 10% 容量应对小幅调整。触发条件：单 Sprint 内收到 3 个以上变更请求。',
        stage: 1,
        sourceRefs: [{ layer: 'L1', sourceId: 'pmbok-7', section: 'risk-register' }],
        provenance: 'official',
      },
      {
        id: 'sw-example-006',
        title: '验收标准示例',
        content:
          '功能"用户登录"的完整验收标准（7 个场景，覆盖正常/异常/边界/安全）。场景 1 正常登录：输入正确邮箱密码 → JWT + 跳转 Dashboard。场景 2 密码错误：返回 401，"邮箱或密码错误"。场景 3 账号锁定：5 次失败 → 锁定 15 分钟。场景 4 已登录重定向：有 JWT 访问 /login → 跳转 Dashboard。场景 5 Token 过期：401 → 自动 refresh，双过期则跳转登录页。场景 6 SQL 注入防护：输入 admin\'-- 或 OR 1=1-- 被当作普通字符串。场景 7 并发登录：多设备各自独立 JWT，互不影响。',
        stage: 1,
        sourceRefs: [{ layer: 'L1', sourceId: 'acceptance-testing', section: 'gwt-format' }],
        provenance: 'official',
      },
      {
        id: 'sw-example-007',
        title: '任务拆分示例',
        content:
          'Epic "用户认证系统"拆分为 10 个可独立交付的任务。T1（2 点）设计认证 API 契约——产出：OpenAPI 3.0 文档（POST /auth/login、POST /auth/register、POST /auth/refresh、POST /auth/logout），含请求/响应 schema、错误码枚举、限流策略（每 IP 每分钟 20 次）。T2（3 点）实现 JWT 签发与校验 Service——签发 access_token（RS256 签名，含 userId/orgId/roles，15min 有效期）和 refresh_token（opaque token 存 DB，7 天有效）、校验中间件（解析/验签/查库/注入 request.user）、refresh 流程（轮换 refresh_token 防重放）。T3（2 点）实现登录页面 UI——邮箱输入、密码输入（带显示/隐藏切换）、"记住我"复选框、登录按钮（loading 状态）、错误提示（红色 Alert）、注册/忘记密码链接。T4（1 点）前端 Auth Store（Zustand）——存储 user 对象/JWT/refresh_token、login/logout/refresh actions、persist 到 localStorage（注意 XSS 风险——httpOnly cookie 是更安全选择）。T5（1 点）路由守卫——未登录用户访问受保护路由→重定向 /login（带 redirect 参数）、已登录用户访问 /login→重定向 Dashboard、Token 即将过期（< 2min）→自动 refresh。T6（1 点）Token 刷新后台定时器——每 10 分钟检查 Token 剩余有效期，< 5 分钟时自动刷新。T7（2 点）密码重置流程——"忘记密码"页面（输入邮箱→发送重置链接）、重置链接（含一次性 token，30min 有效期）、新密码设置页面（复杂度校验）。T8（2 点）RBAC 权限校验中间件——从 JWT 提取 roles、按路由/资源/操作匹配权限、无权限返回 403、Admin 可模拟其他角色（impersonate 功能，需审计日志）。T9（1 点）登录失败锁定——记录失败尝试（IP + 账号维度）、5 次失败→锁定 15min、锁定期间正确密码也拒绝（防暴力破解）、成功后重置计数器。T10（2 点）E2E 测试——覆盖登录成功/失败/锁定/Token 刷新/权限拦截 5 个核心流程。',
        stage: 1,
        sourceRefs: [{ layer: 'L1', sourceId: 'agile-estimation', section: 'task-breakdown' }],
        provenance: 'official',
      },
      {
        id: 'sw-example-008',
        title: '燃尽图示例',
        content:
          'Sprint 燃尽图使用指南。横轴：Sprint 工作日（Day 1 到 Day 10），纵轴：剩余故事点（从 Sprint 计划总点数开始）。理想燃尽线：从 (Day 0, 总点数) 到 (Day 10, 0) 的直线——代表每天完成等量点数。实际燃尽线：每日站会后更新——将当天"已完成"（符合 DoD、已合并到主分支）的故事点从剩余中扣除，绘制 (Day N, 剩余点数) 数据点并连线。解读规则——实际线持续高于理想线（剩余点数多于预期）：进度滞后，需在 Sprint 中期（Day 5）评审是否调整范围（移除低优先级任务）或寻求帮助（增加资源/简化技术方案）；差距超过 30% 应触发风险预警。实际线持续低于理想线：Sprint 计划时高估了任务复杂度（故事点偏大），应作为回顾会讨论项（改进估算准确度），而非"做得快是好事"——说明计划质量有问题。Sprint 末期（Day 8-10）燃尽线趋于平坦：任务接近完成但遇到阻碍（等待外部依赖/测试发现严重 Bug），需立即升级。燃尽图只是"信息辐射器"而非考核工具——不要用燃尽图评估个人绩效（会导致故事点虚高、完成定义注水）。推荐在物理白板或数字仪表板上公开展示，全团队可见。',
        stage: 5,
        sourceRefs: [{ layer: 'L1', sourceId: 'scrum-guide', section: 'burndown-chart' }],
        provenance: 'official',
      },
    ],

    // ── checklists（检查清单）8 条 ──
    checklists: [
      {
        id: 'sw-checklist-001',
        title: '需求评审检查清单',
        content:
          '需求评审通过标准（8 项，全部通过方可进入设计阶段）。1. 完整性检查：所有功能需求是否有对应的验收标准（Given-When-Then 格式）？非功能需求（性能/安全/可用性/可维护性）是否已量化（如"API 响应 P95 ≤ 200ms"）而非模糊表述（如"系统要快"）？2. 优先级检查：需求是否按 MoSCoW 方法（Must have / Should have / Could have / Won\'t have this time）排列优先级？Must have 是否确实为不可削减的最小可交付集？3. 一致性检查：是否存在相互冲突的需求（如"实时同步"与"离线可用"并存却未说明优先级）？术语是否统一（同一概念在不同需求中使用同一名称）？4. 干系人检查：是否有遗漏的干系人视角（运维团队——部署/监控需求、安全团队——合规/审计需求、法务——数据隐私需求、最终用户——UX/可用性需求）？5. 依赖与假设检查：外部依赖（第三方 API、其他团队交付物、硬件/环境）是否明确记录？假设（"用户会使用 Chrome 浏览器"）是否经过验证？6. 可测试性检查：每个需求是否可被独立测试？模糊需求（如"界面友好"、"性能良好"）是否已拆解为具体可测指标？7. 边界与异常检查：是否覆盖了空数据、极大值、并发冲突、网络中断等边界场景？8. 需求来源与追溯：每个需求是否标注了来源（用户访谈/竞品分析/合规要求）？需求变更时是否可追溯到原始决策？',
        stage: 1,
        sourceRefs: [
          { layer: 'L1', sourceId: 'requirements-engineering', section: 'review-checklist' },
        ],
        provenance: 'official',
      },
      {
        id: 'sw-checklist-002',
        title: '架构评审检查清单',
        content:
          '架构评审通过标准（9 项，按风险权重排序）。1. 架构图完整性——是否使用 C4 模型（Context/Container/Component）清晰标注了系统边界、模块/服务间通信方式（同步 HTTP/gRPC / 异步消息队列）与数据流方向？非技术人员（PM/干系人）是否能从 Context 图理解系统与外部系统的关系？2. 单一职责验证——每个模块/服务是否只有一个明确的业务职责？能否用一句话描述每个模块的"做什么"而不出现"和"字？3. 依赖方向检查——依赖箭头是否从外层指向内层（表现层 → 应用层 → 领域层 → 基础设施层）？领域层是否完全独立于任何框架/数据库？是否存在循环依赖？4. 技术选型可追溯——每个关键技术选型（语言/框架/数据库/消息队列/缓存）是否有 ADR 记录（决策背景/替代方案/后果）？选型是否与团队技能匹配或已制定学习计划？5. 故障模式分析——是否存在单点故障（SPOF——单个服务/数据库/网络链路挂了整个系统不可用）？关键路径是否有降级方案（如推荐服务挂了→返回默认推荐列表）？6. 数据架构——存储方案是否匹配读写模式（关系型→PostgreSQL、文档→MongoDB、缓存→Redis、搜索→Elasticsearch）？数据一致性策略（强一致 vs 最终一致）是否明确？数据库迁移是否有回滚方案？7. 安全架构——认证/授权边界是否在架构图中体现（API Gateway / BFF 层负责认证，服务间通过 mTLS 或内部 JWT 通信）？敏感数据（密钥/用户 PII）的加密/脱敏策略是否明确？8. 扩展性评估——水平扩展瓶颈在哪里（无状态服务可水平扩，数据库/消息队列需提前规划分片/集群）？是否有容量规划（预期用户量/并发量/数据量级）？9. 运维可观测性——监控（Metrics——RED 指标 Rate/Error/Duration）、日志（结构化 JSON + traceId 贯穿所有服务）、追踪（分布式 Tracing——Span/ParentSpan 链路）是否在架构中预留接入点？',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'c4-model', section: 'review-checklist' }],
        provenance: 'official',
      },
      {
        id: 'sw-checklist-003',
        title: '代码评审检查清单',
        content:
          '代码评审通过标准（10 项，评审者逐项检查并在通过项后打勾）。1. 自动化门禁——所有 CI 检查是否通过（lint / typecheck / format / build / test）？未通过的 PR 不应进入人工评审。2. 命名清晰度——变量/函数/类/文件名是否自解释？是否存在单字母变量（非循环索引）、无意义缩写、拼音命名？布尔变量是否以 is/has/can/should 开头？3. 函数设计——函数是否短小专注（通常 ≤ 30 行为佳，超过 50 行需理由）？参数是否 ≤ 4 个（超过建议用对象参数）？是否有副作用（修改全局状态/写文件/调外部 API）且副作用在函数名中体现？4. 错误处理——是否每个可能失败的操作都有错误处理？是否存在空 catch 块？用户可见的错误消息是否脱敏（不含栈追踪/内部路径/SQL）？5. 安全——外部输入是否经过校验与净化（类型/长度/格式/范围）？SQL 查询是否使用参数化（非字符串拼接）？敏感数据（密钥/token/密码）是否硬编码？6. 复杂度——是否存在过深嵌套（> 3 层 if/for/while）？圈复杂度是否可接受（≤ 10）？是否有可提取的重复代码块（≥ 3 次相同逻辑）？7. 测试——核心逻辑是否有单元测试？边界条件是否被测试（空值/极值/超时/并发）？测试是否可重复执行（无随机性、不依赖执行顺序）？8. 依赖方向——是否引入了不应有的依赖（领域层 import 了 ORM 装饰器、Controller 直接查库）？新引入的第三方依赖是否经过评审（包体积/维护状态/许可证）？9. 遗留物——是否有调试代码（console.log / debugger / 注释掉的代码）？是否有 TODO/FIXME 未关联任务编号（应用 TODO-DEBT-XX 格式）？10. 文档与注释——对外 API 是否有文档注释（参数/返回值/异常说明）？复杂算法是否有解释性注释（"为什么这样做"而非"做了什么"）？',
        stage: 5,
        sourceRefs: [{ layer: 'L1', sourceId: 'code-review-best-practices', section: 'checklist' }],
        provenance: 'official',
      },
      {
        id: 'sw-checklist-004',
        title: '发布就绪检查清单',
        content:
          '发布就绪检查清单（11 项，所有项通过方可执行生产发布）。1. 测试门禁——所有 P0/P1 测试套件通过（单元测试/集成测试/E2E 测试）？性能基准测试无退化（P95 延迟不超过基线的 110%）？2. 数据库变更——迁移脚本（UP）是否已准备且经过 dev/staging 环境验证？回滚脚本（DOWN）是否已准备且测试通过？数据迁移是否有备份（生产库发布前完整备份）？3. 配置变更——新增/修改的环境变量是否已记录（含默认值和描述）？Feature Flag 是否已配置（灰度比例、目标用户群）？密钥/证书是否已轮换（如即将过期）？4. 依赖检查——第三方服务/API 是否可用（手动验证或自动化 health check）？npm/pip 依赖是否有已知高危漏洞（npm audit / dependabot）？5. 监控与告警——新增 API 端点的监控 Dashboard 是否已配置（RED 指标）？告警规则是否已配置（错误率 > 5% / P95 延迟翻倍 / 磁盘 > 80%）？On-Call 值班表是否已确认？6. 回滚方案——回滚步骤是否已编写（具体命令/操作顺序/预期耗时）？回滚演练是否在上一个 staging 发布中成功执行？回滚后数据一致性如何保证（迁移回滚/缓存失效/消息重处理）？7. 灰度策略——灰度比例（5% → 20% → 50% → 100% 逐步放量）与每阶段观察时间（≥ 30min）是否已明确？灰度期间的异常指标阈值和自动回滚条件是否已设定？8. 沟通——发布窗口是否已通知干系人（PM/运维/客服/市场）？Release Notes 是否已编写（含新增功能/修复 Bug/已知问题/升级注意事项）？9. 安全扫描——SAST（静态应用安全测试）是否未发现 High/Critical 漏洞？DAST（动态应用安全测试——OWASP ZAP 等）是否未发现高危漏洞？10. 合规——数据隐私（GDPR/PIPL）相关变更是否经过法务评审？许可证合规（第三方依赖的开源许可证是否与项目兼容）？11. 负载能力——是否已完成容量评估（预期流量 vs 当前容量）？自动扩缩容策略是否已配置（K8s HPA / AWS Auto Scaling）？',
        stage: 6,
        sourceRefs: [
          { layer: 'L1', sourceId: 'release-management', section: 'readiness-checklist' },
        ],
        provenance: 'official',
      },
      {
        id: 'sw-checklist-005',
        title: '测试就绪检查清单',
        content:
          '测试就绪检查清单（9 项，进入测试阶段前逐项确认）。1. 覆盖率基线——后端 Service 单元测试覆盖率 ≥ 90%（权限相关 ≥ 95%）、前端语句覆盖率 ≥ 80%/分支覆盖率 ≥ 70%（权限组件 ≥ 95%）、集成测试覆盖所有 API 端点（至少 happy path + 2 个异常场景）。覆盖率报告是否在 CI 中自动生成且低于阈值时构建失败？2. 测试金字塔比例——单元测试 : 集成测试 : E2E 测试比例是否大致符合 70:20:10？是否有 E2E 测试替代单元测试覆盖核心逻辑的反模式（需逐个审查 E2E 用例）？3. 边界条件覆盖——是否测试了空值（null/undefined/空字符串/空数组）、极值（最大整数/最小整数/超长字符串/0）、并发冲突（两个用户同时修改同一资源）、超时场景（外部服务超时/数据库超时）、大数据量（分页边界/1000+ 条记录）？4. 权限测试——是否覆盖所有角色的正向与反向测试（Admin 可以操作、Member 不能越权、Viewer 只读、未登录 401）？5. 环境隔离——测试数据库是否独立于开发/生产数据库（使用独立 test.sqlite 或 test 数据库）？测试是否可并行执行（不共享可变状态）？测试数据是否在每次测试前后自动清理/重置？6. 测试确定性——测试是否可重复执行（不依赖系统时间——使用 fake timers、不依赖随机数——使用 seeded random、不依赖网络——使用 mock server）？测试之间是否有隐式依赖（测试 A 必须在测试 B 之前运行）？7. 性能——单元测试是否在毫秒级完成（单个测试 > 100ms 需优化或标记为集成测试）？全量测试套件是否在 5 分钟内完成（CI 反馈时间目标）？慢测试（> 1s）是否已标记 skip 或在 CI 中独立分组运行？8. 测试数据管理——Fixture/Factory 是否覆盖了典型场景和边界场景？是否使用了 Test Data Builder 模式（链式调用按需构建）？测试数据是否接近生产数据形态（结构相似、量级有代表性）？9. 失败诊断——测试失败时的错误信息是否清晰（包含预期值 vs 实际值、上下文信息）？是否有 flaky test（间歇性失败）的记录和修复计划？',
        stage: 5,
        sourceRefs: [{ layer: 'L1', sourceId: 'test-strategy', section: 'readiness' }],
        provenance: 'official',
      },
      {
        id: 'sw-checklist-006',
        title: '安全检查清单',
        content:
          '安全检查清单（10 项，按 OWASP Top 10 优先级排列）。1. 输入校验——所有外部输入（HTTP 参数/Header/Body、文件上传、WebSocket 消息、环境变量）是否在边界层进行了白名单式校验与净化？SQL/HTML/JS/Shell 特殊字符是否已转义或使用参数化查询？2. 认证与会话——JWT 签名算法是否使用非对称加密（RS256/ES256）而非 HS256（共享密钥风险）？Token 有效期是否合理（access_token ≤ 15min、refresh_token ≤ 7 天）？是否支持 Token 主动失效（登出时加入黑名单或缩短有效期）？3. 授权——每个 API 端点是否有明确的权限要求（RBAC role + 资源 ownership）？是否存在 IDOR（不安全的直接对象引用——用户 A 可通过修改 URL 中的 ID 访问用户 B 的资源）？批量操作是否逐一校验权限（而非只校验列表的 ownership）？4. 敏感数据保护——密钥/Token/密码是否使用 AES-256-GCM 或 bcrypt/argon2 加密存储？传输中是否强制 HTTPS（HSTS 头 + 证书有效）？日志/错误消息/API 响应中是否不含敏感数据（密钥/token/PII/内部 IP/栈追踪）？5. 依赖安全——是否有已知漏洞的第三方依赖（运行 npm audit / pip audit / OWASP Dependency-Check 并修复 High/Critical）？依赖更新频率（至少每月检查一次）？6. CORS 与 CSRF——CORS 是否配置了明确的允许来源（不设 * 通配）？是否使用了 CSRF Token（非 API 的 Web 页面）或 SameSite Cookie 属性？7. 文件安全——文件上传是否有类型白名单（MIME type + 文件头魔数双重校验）？是否有大小上限？是否在隔离环境（沙箱）处理？用户提供的文件名是否经过净化（移除路径穿越 ../ 等）？8. 速率限制——登录/注册/密码重置/短信发送等敏感端点是否有速率限制（按 IP/用户/全局维度）？API 全局限流是否配置（防止 DDoS/资源耗尽）？9. 安全头——HTTP 响应是否包含安全头：Content-Security-Policy（防 XSS）、X-Content-Type-Options: nosniff、X-Frame-Options: DENY（防 Clickjacking）、Strict-Transport-Security（强制 HTTPS）？10. 安全审计——关键操作（登录/权限变更/数据导出/删除）是否有审计日志（操作人/时间/操作类型/IP/User-Agent/结果）？审计日志是否防篡改（只追加/签名/独立存储）？',
        stage: 5,
        sourceRefs: [{ layer: 'L1', sourceId: 'owasp-top10-2021', section: 'full-checklist' }],
        provenance: 'official',
      },
      {
        id: 'sw-checklist-007',
        title: '性能检查清单',
        content:
          '性能检查清单（10 项，上线前与上线后持续检查）。1. API 响应时间——关键端点（登录/项目列表/任务 CRUD/WBS 树/甘特图数据）的 P50/P95/P99 延迟是否在目标内？是否有基准测试数据（至少 3 次运行取中位数）？2. 数据库查询——是否有 N+1 查询问题（ORM 懒加载导致的循环查询——启用 query log 检查）？频繁查询的字段是否已建索引（检查 EXPLAIN / query plan——是否使用 Index Scan 而非 Seq Scan）？慢查询（> 100ms）是否已记录并分析（数据库慢查询日志）？3. 缓存策略——热点数据（用户信息/项目配置/权限角色）是否有缓存层（Redis/内存缓存）？缓存过期策略（TTL）和失效策略（主动失效 vs 被动过期）是否明确？缓存穿透/击穿/雪崩是否有防护（空值缓存/互斥锁/随机 TTL）？4. 分页与限量——列表接口是否强制分页（默认 pageSize=20，最大 100）？是否有无分页的全量查询接口（需评审必要性——导出/报表场景除外）？5. 静态资源——前端 JS/CSS/Font/Image 是否开启了压缩（gzip/brotli）？是否配置了缓存头（Cache-Control: max-age + 内容哈希文件名实现永久缓存）？是否使用 CDN 分发静态资源？6. 前端性能——首屏加载时间（FCP/LCP）是否达标（LCP ≤ 2.5s）？JavaScript Bundle 大小是否在合理范围（主 bundle ≤ 200KB gzipped）？是否有代码分割（route-based / component-based lazy loading）？7. 大数据量场景——1000 条任务场景下：甘特图渲染 < 3s、滚动 60fps、WBS 树展开/折叠无卡顿、列表排序/筛选 < 500ms？是否使用了虚拟滚动（virtual scroll）处理大列表？8. 并发——是否有并发压测数据（模拟 N 个并发用户——从 10 到 1000 逐步加压）？系统在目标并发下的 CPU/内存/数据库连接数是否健康？是否有资源泄漏（内存持续增长、连接池耗尽）？9. 异步处理——耗时操作（文件处理/报告生成/邮件发送/外部 API 调用）是否异步化（消息队列/后台 Job）而非阻塞 HTTP 请求？异步任务的队列深度/处理速率/失败率是否有监控？10. 性能监控——是否配置了 APM（Application Performance Monitoring——如 OpenTelemetry + Jaeger/Grafana）？关键指标 Dashboard（P95 延迟趋势/QPS/错误率/资源利用率）是否可用？是否有性能退化告警（P95 较基线上升 20% 触发告警）？',
        stage: 6,
        sourceRefs: [{ layer: 'L1', sourceId: 'web-performance', section: 'checklist' }],
        provenance: 'official',
      },
      {
        id: 'sw-checklist-008',
        title: '运维就绪检查清单',
        content:
          '运维就绪检查清单（10 项，系统移交运维团队前的最终检查）。1. 可观测性——日志是否结构化（JSON 格式，每行一个事件，含 timestamp/traceId/level/message/context）？是否所有服务使用统一的 traceId 贯穿调用链（前端 → API Gateway → Service A → Service B → Database）？2. 健康检查——是否有 /health（存活检查——进程在运行）和 /ready（就绪检查——数据库/缓存/消息队列连接正常）端点？K8s livenessProbe 和 readinessProbe 是否已配置（含合理的 initialDelaySeconds 和 periodSeconds）？3. 优雅关闭——服务收到 SIGTERM 后是否停止接收新请求、等待正在处理的请求完成（最长等待时间如 30s）、关闭数据库连接/消息队列连接、然后退出？K8s terminationGracePeriodSeconds 是否大于应用的最大优雅关闭时间？4. 备份与恢复——数据库是否有定期自动备份（全量 + 增量/WAL 归档）？备份恢复流程是否经过演练（最近一次恢复测试的日期和结果）？备份保留策略（如每日备份保留 7 天、每周备份保留 4 周、每月备份保留 12 个月）是否明确？5. 监控仪表板——关键业务指标（注册数/登录数/项目创建数/任务完成率）和关键技术指标（QPS/错误率/P95 延迟/CPU/内存/磁盘）是否在一个统一的 Dashboard 中展示？Dashboard 是否在非工作时间也能被 On-Call 人员快速访问？6. 告警——告警规则是否覆盖：服务不可用（/health 失败连续 3 次）、错误率飙升（5xx > 5% 持续 5min）、P95 延迟翻倍（较前 1h 均值）、磁盘使用 > 80%、内存使用 > 90%、证书即将过期（< 30 天）？告警通知渠道（PagerDuty/企业微信/钉钉/邮件）是否已配置？告警是否有分级（P0 立即响应 / P1 30min 内响应 / P2 下一个工作日处理）？7. Runbook——常见故障场景的诊断与恢复步骤是否已编写（数据库连接失败/Redis 不可用/磁盘满/证书过期/第三方 API 不可用）？Runbook 是否包含：症状描述、诊断命令（kubectl/logs/metrics 查询）、恢复步骤（回滚/扩缩容/重启/切换备用服务）、预计恢复时间？8. 容量规划——当前资源配置（CPU/内存/实例数）是否满足预期流量（含 20% 余量）？水平自动扩缩容（HPA）是否已配置（CPU > 70% 扩容、< 30% 缩容）？是否有压力测试数据支撑容量规划（最大 QPS 和对应的资源消耗）？9. 密钥管理——密钥/证书是否集中管理（K8s Secrets / Vault / AWS Secrets Manager）而非散落在配置文件/环境变量中？是否有密钥轮换计划（至少每 90 天）？密钥泄露时的应急轮换流程是否已定义？10. 灾难恢复——是否有灾难恢复计划（DR Plan——RPO 恢复点目标 / RTO 恢复时间目标）？异地备份/多区域部署是否根据业务需求评估？最近一次灾难恢复演练的日期和结果？',
        stage: 6,
        sourceRefs: [{ layer: 'L1', sourceId: 'sre-handbook', section: 'production-readiness' }],
        provenance: 'official',
      },
    ],

    // ── rubric（评分维度）8 个维度 ──
    rubric: [
      {
        id: 'sw-rubric-001',
        title: '需求质量评估标准',
        content:
          '评估项目需求工程的质量。1 分——需求模糊、大量"待澄清"标注、无验收标准、非功能需求缺失、干系人未确认。典型表现：需求文档只有标题没有细节、用"系统要快"代替性能指标、开发过程中频繁因需求不清而返工。3 分——大部分功能需求有验收标准、非功能需求部分量化但覆盖不全、需求优先级已排序但缺少 MoSCoW 分类。典型表现：验收标准存在但不规范（不是 Given-When-Then 格式）、非功能需求只覆盖了性能但遗漏了安全和可用性。5 分——所有需求有明确可测量的验收标准（Given-When-Then 格式）、非功能需求全面量化（性能/安全/可用性/可维护性/合规）、优先级清晰（MoSCoW 分类且 Must have 确实是不可削减的最小集）、干系人已签字确认、无遗漏的干系人视角、需求可追溯（每个需求可追溯到来源和关联的架构决策）。评分要点：完整性（是否有遗漏领域）、可测试性（验收标准是否可自动化验证）、优先级明确性（Must have 是否真的必须）、干系人覆盖度（是否遗漏关键视角）。',
        stage: 6,
        sourceRefs: [
          { layer: 'L1', sourceId: 'requirements-engineering', section: 'quality-rubric' },
        ],
        provenance: 'official',
      },
      {
        id: 'sw-rubric-002',
        title: '架构合理性评估标准',
        content:
          '评估系统架构设计的合理性和可执行性。1 分——无架构设计文档或架构图、模块边界模糊（所有逻辑在一个或两个 Service 中）、依赖关系混乱（循环依赖/领域层依赖 ORM）、技术选型无理由（"因为流行"）。典型表现：新人问"系统架构是什么"时无人能回答、修改一个模块需要改不相关的模块、数据库换了整个系统重写。3 分——有基本架构图和分层设计但部分依赖方向不正确（如 Controller 直接查库）、有关键 ADR 但覆盖不全（只有数据库选型记录缺少框架/通信方式/部署架构）、架构图与实际代码部分不一致。典型表现：架构图只在项目启动时画过、后来代码演进而图未更新。5 分——架构图完整且与代码一致（C4 模型 Context/Container/Component 三层）、依赖方向正确且通过 CI 静态检查（dependency-cruiser）、所有关键技术选型有 ADR 记录（决策背景/替代方案/后果）、架构评审定期执行（至少每季度或每次重大变更前）、架构符合团队技能水平或已制定学习计划。评分要点：模块边界清晰度、依赖方向正确性（是否可自动化验证）、决策可追溯性（ADR 完整性）、架构-代码一致性（是否定期同步）。',
        stage: 6,
        sourceRefs: [{ layer: 'L1', sourceId: 'c4-model', section: 'architecture-assessment' }],
        provenance: 'official',
      },
      {
        id: 'sw-rubric-003',
        title: '可维护性评估标准',
        content:
          '评估代码库的长期可维护性。1 分——代码重复严重（相似逻辑在多处复制粘贴）、命名混乱（单字母变量/拼音/无意义缩写）、无注释或注释已过期、函数过长（> 100 行）、God Object 普遍存在（单个文件数千行）、无代码评审或评审走过场。典型表现：修改一个 Bug 引入三个新 Bug、新人入职数月仍无法独立提交代码、技术债无人追踪。3 分——大部分代码可读且命名基本规范、存在部分 God Object 但正在拆分、有代码评审流程但执行不够严格、技术债有记录但偿还进度慢。典型表现：代码评审存在但有时"先合并后补"、技术债 backlog 很长但每迭代只处理 1-2 条。5 分——代码自解释（命名即文档）、命名规范统一且通过 lint 强制、函数短小专注（≤ 30 行为主流）、无重复代码（DRY 原则通过静态分析检查）、测试覆盖充分（覆盖率达标且测试可读性好）、技术债有系统追踪（TODO-DEBT 标注 + backlog 条目 + 偿还时间表）、代码评审严格（至少一人 Approve 且检查项覆盖命名/设计/安全/测试）、新人 onboarding 文档完善且第一周即可提交小改动。评分要点：可读性（新人理解速度）、复杂度（圈复杂度/文件大小分布）、重复度（DRY 违反率）、技术债管理（追踪与偿还速度）。',
        stage: 6,
        sourceRefs: [{ layer: 'L1', sourceId: 'code-quality', section: 'maintainability-rubric' }],
        provenance: 'official',
      },
      {
        id: 'sw-rubric-004',
        title: '可测试性评估标准',
        content:
          '评估系统可测试性——包括代码设计对测试的友好程度和实际测试质量。1 分——代码紧耦合外部依赖（直接在业务逻辑中 new 数据库连接/new HTTP 客户端）、无法进行单元测试（必须启动完整应用才能验证任何逻辑）、无自动化测试或仅有少量 E2E 测试（"点点点测试"）。典型表现：改一行代码需手动启动应用、登录、操作到目标页面才能验证。3 分——核心模块有单元测试但覆盖率不足（< 50% 或仅覆盖 happy path）、测试依赖真实外部服务（数据库/第三方 API 未 mock）、测试速度慢（全量 > 10min）、存在 flaky test（间歇性失败未修复）。典型表现：测试存在但不全面、CI 偶尔因 flaky test 失败需重试。5 分——代码设计支持可测试性（依赖注入/接口抽象/纯函数优先）、测试金字塔比例合理（单元:集成:E2E ≈ 70:20:10）、覆盖率达标（后端 ≥ 90%、前端语句 ≥ 80%/分支 ≥ 70%、权限组件 ≥ 95%）、测试快速确定性（单测毫秒级、全量 < 5min、无不稳定测试）、边界条件覆盖（空值/极值/并发/超时均被测试）、测试可读性好（Given-When-Then 或 Arrange-Act-Assert 结构清晰）。评分要点：可测性设计（依赖注入/接口抽象）、覆盖率（按层级分别考察）、测试速度（反馈时间）、稳定性（无 flaky test）、边界覆盖度。',
        stage: 6,
        sourceRefs: [{ layer: 'L1', sourceId: 'test-strategy', section: 'quality-rubric' }],
        provenance: 'official',
      },
      {
        id: 'sw-rubric-005',
        title: '安全性评估标准',
        content:
          '评估系统的安全防护水平。1 分——存在已知高危漏洞（SQL 注入/XSS/CSRF/明文密钥在代码仓库）、无输入校验（信任所有外部输入）、无认证或认证实现有缺陷（如自创加密算法）、无安全审计。典型表现：安全扫描报告大量 High/Critical 未修复、密钥在 GitHub 公开仓库中可搜索到。3 分——基本安全措施到位（输入校验/参数化查询/JWT 认证/HTTPS）、但缺少系统化的安全审计和渗透测试、部分安全头缺失（CSP/HSTS）、依赖安全扫描未定期执行。典型表现：OWASP Top 10 主要风险已覆盖但深度不足、安全配置依赖开发者个人意识而非自动化检查。5 分——输入校验完整且采用白名单策略、敏感数据全生命周期加密（传输 TLS 1.3 + 存储 AES-256-GCM + 日志脱敏）、认证授权正确实现（JWT RS256 + RBAC + 资源级权限）、安全头完整配置（CSP/HSTS/X-Frame-Options/X-Content-Type-Options）、安全扫描集成 CI（SAST/DAST/依赖扫描——每次 PR 自动执行、High/Critical 阻断合并）、定期渗透测试（至少每年一次）、安全审计日志完整（关键操作可追溯、日志防篡改）、最小权限原则（服务账号只授予必需权限）、密钥定期轮换（≤ 90 天）且泄露时有应急轮换流程。评分要点：输入校验完整性、数据保护（加密/脱敏）、认证授权正确性、安全扫描自动化程度、审计可追溯性。',
        stage: 6,
        sourceRefs: [{ layer: 'L1', sourceId: 'owasp-top10-2021', section: 'maturity-model' }],
        provenance: 'official',
      },
      {
        id: 'sw-rubric-006',
        title: '性能评估标准',
        content:
          '评估系统的性能水平和性能工程成熟度。1 分——API 响应超时频繁（P95 > 5s）、前端渲染卡顿（滚动 < 30fps、首屏 > 10s）、无性能测试（不知道系统能支撑多少用户）、无数据库索引（全表扫描）。典型表现：用户抱怨"系统慢"但团队无性能数据回应、性能优化靠猜测（加缓存/加机器但不知道瓶颈在哪）。3 分——关键路径性能可接受（核心 API P95 < 1s）、有基本性能测试但缺少基准和持续监控、数据库有基本索引但未系统化优化、前端有代码分割但未做性能预算。典型表现：性能在低负载下 OK 但没做过压力测试、性能数据依赖用户反馈而非主动监控。5 分——性能基准明确且写入 SLA（核心 API P95 ≤ 200ms、列表 API P95 ≤ 500ms、报表类 API P95 ≤ 2s）、数据库查询全部使用索引（EXPLAIN 验证无 Seq Scan 在关键表）、缓存策略合理（热点数据缓存命中率 > 90%）、前端性能达标（LCP ≤ 2.5s、甘特图 1000 任务 < 3s 首屏且 60fps 滚动）、有性能监控与告警（P95 延迟趋势/错误率/QPS Dashboard + 退化自动告警）、性能测试集成 CI（每次 PR 运行基准测试——性能退化 > 10% 阻断合并）、有压力测试数据支撑容量规划（知道当前架构的极限 QPS 和扩展方案）。评分要点：响应时间（P50/P95/P99）、吞吐量（极限 QPS）、资源效率（CPU/内存/连接数）、性能工程成熟度（基准/监控/告警/CI 门禁）。',
        stage: 6,
        sourceRefs: [{ layer: 'L1', sourceId: 'web-performance', section: 'maturity-model' }],
        provenance: 'official',
      },
      {
        id: 'sw-rubric-007',
        title: '文档完整性评估标准',
        content:
          '评估项目文档的完整性和可用性。1 分——无 API 文档（前端靠看后端代码猜接口）、无架构文档（架构只存在于最初开发者的脑子里）、无部署文档（只有一个人知道怎么发布）、无新人上手文档（新人靠问问题学习，效率极低）。典型表现：关键人员请假/离职时相关工作停滞、新人第一周只能看代码无法动手。3 分——有基础 API 文档（Swagger/OpenAPI 自动生成）但缺少描述和示例、有架构图但可能已过时（与实际代码不一致）、有 README 但覆盖不全（缺少环境搭建细节/常见问题）。典型表现：文档存在但质量参差——有些模块文档完善、有些模块空白。5 分——API 文档完整且与代码同步（OpenAPI/Swagger + 请求/响应示例 + 错误码说明 + 认证说明、CI 验证文档与实现一致）、架构决策有完整 ADR（决策背景/选项/理由/后果——按时间排序、可追溯演进路径）、部署与运维 Runbook 完整（环境搭建/发布流程/回滚步骤/常见故障诊断——新人按 Runbook 可独立完成发布）、新人上手文档可用（环境搭建 ≤ 30min、第一个 Bug 修复 ≤ 2h）、文档更新与代码变更同步（PR 中涉及 API/架构/部署变更时要求同步更新文档）。评分要点：API 文档覆盖率与同步性、架构文档完整性（ADR 数量与质量）、运维文档可操作性（Runbook 是否可独立执行）、新人上手效率（从入职到第一个 PR 的时间）。',
        stage: 6,
        sourceRefs: [{ layer: 'L1', sourceId: 'documentation', section: 'quality-rubric' }],
        provenance: 'official',
      },
      {
        id: 'sw-rubric-008',
        title: '交付可预测性评估标准',
        content:
          '评估项目交付的节奏可预测性和团队成熟度。1 分——进度完全不可预测（承诺的日期与实际交付偏差 > 100%）、频繁延期（连续 3 个以上 Sprint 未达成目标）、无估算基准（故事点随意分配、无历史数据参考）、干系人对交付时间毫无信心。典型表现：每次问"什么时候能上线"答案都不一样、发布前一周发现"还有大量工作没做"、团队士气低落（不断延期导致）。3 分——有估算（故事点/理想人天）但准确度波动大（完成率在 50%-150% 之间跳跃）、燃尽图偶尔偏离理想线但在 Sprint 结束前勉强完成、干系人对交付节奏有一定信心但仍有"惊喜"。典型表现：大部分 Sprint 能完成大部分任务、但偶尔出现重大偏差（如某个 Sprint 完成率仅 30%）。5 分——Sprint 目标稳定达成（连续 6 个以上 Sprint 完成率在 80-120% 区间）、故事点估算有历史数据支撑（使用 Yesterday\'s Weather——取下 3 个 Sprint 的平均完成点数作为下个 Sprint 的计划容量）、燃尽图趋势健康（实际线围绕理想线小幅波动而非大幅偏离）、风险提前识别与缓解（Sprint 计划中列出 Top 3 风险及缓解措施、Sprint 中期评审风险状态）、团队 Velocity 稳定（波动 ≤ 20%）或波动有合理解释（人员变动/技术攻坚）、干系人对交付节奏有信心（发布日期承诺后无需反复调整）。评分要点：Sprint 目标达成率、估算准确性（计划 vs 实际故事点偏差）、风险前瞻性（识别与缓解的及时性）、干系人信心（发布承诺的可信度）。',
        stage: 6,
        sourceRefs: [{ layer: 'L1', sourceId: 'agile-metrics', section: 'predictability-rubric' }],
        provenance: 'official',
      },
    ],
  },
}

const MARKETING_SEED: BuiltinSkillSeed = {
  skillKey: 'skill-marketing',
  name: '营销活动',
  version: '1.0.0',
  description:
    '覆盖现代营销活动管理全生命周期的领域知识包：从市场细分与目标定位、Campaign策划与创意开发、渠道组合与预算分配、数据追踪与归因分析到品牌管理与合规治理。适用于产品上市、品牌传播、数字营销增长与活动运营等各类营销项目。',
  category: {
    primary: 'domain',
    secondary: 'marketing',
  },
  tags: [
    '营销',
    'Marketing',
    '营销活动',
    '市场',
    '品牌',
    '数字营销',
    '增长',
    '内容营销',
    'ROI',
    '用户增长',
    'Martech',
  ],
  dependencies: [],
  activation: {
    projectTypes: ['营销', '市场营销', '营销活动', 'Marketing', 'Marketing Campaign', 'Campaign'],
    domains: ['marketing', 'campaign'],
    priority: 80,
  },
  basePriority: 80,
  knowledge: {
    // ── rules（规则）8 条 ──
    rules: [
      {
        id: 'mk-rule-001',
        title: '目标受众定义与细分',
        content:
          '营销活动启动前必须完成目标受众定义与细分：基于人口统计（年龄/性别/收入/教育）、地理（城市/区域/气候）、心理图（生活方式/价值观/性格）和行为（购买频率/品牌忠诚度/使用场景）四维至少完成三维的受众画像。每个细分市场需有定量规模预估（TAM/SAM/SOM）和定性需求描述（核心痛点与决策驱动因素）。受众细分必须是可触达、可度量、有商业实质且差异化的——不能仅凭直觉划分为"25-35岁女性"而不验证该群体对产品的实际需求。科特勒在《营销管理》第16版中强调：没有明确目标受众的营销活动等同于"向黑暗中喊话"——信息无法精准触达，资源无法高效配置。细分完成后以用户画像卡片或Empathy Map形式归档，纳入Campaign Brief进行团队对齐。',
        stage: 1,
        sourceRefs: [
          {
            layer: 'L1',
            sourceId: 'kotler-marketing-management',
            section: 'segmentation-targeting',
          },
        ],
        provenance: 'official',
      },
      {
        id: 'mk-rule-002',
        title: '品牌一致性与调性规范',
        content:
          '所有营销物料和触达点必须遵循品牌一致性原则——视觉（Logo/色彩/字体/图像风格）、语调（品牌声音——正式/亲切/幽默/权威）、信息框架（核心价值主张与差异化）三者统一。品牌不一致会导致消费者认知混乱：卡戴维（David Aaker）的品牌资产模型指出，品牌一致性是品牌认知度和品牌联想的基础——每一次不一致的曝光都是对品牌资产的一次磨损。操作层面：建立品牌规范手册（Brand Guideline）并纳入Campaign制作流程的检查节点——所有出街物料（KV/海报/视频/社媒/着陆页）在发布前由品牌负责人或品牌经理进行一致性确认。在跨渠道Campaign中，同一Campaign的主题信息在TV、社交、搜索、邮件等渠道必须使用统一的Big Idea表达，但允许渠道适配形式——TikTok可以是挑战赛形式，LinkedIn可以是白皮书形式，核心信息不变。',
        stage: 2,
        sourceRefs: [{ layer: 'L1', sourceId: 'aaker-brand-equity', section: 'brand-consistency' }],
        provenance: 'official',
      },
      {
        id: 'mk-rule-003',
        title: '数据驱动决策与归因',
        content:
          '营销决策必须建立在数据而非直觉之上——每个Campaign启动前有明确的KPI框架（目标指标 + 领先指标 + 滞后指标），运行中有实时或准实时数据看板，结束后有完整复盘报告。归因模型（首次触达/末次触达/线性/时间衰减/U型/算法归因）必须根据业务特性在Campaign启动前选定，不得事后挑选"看起来最好"的归因——这会引入确认偏差。Google Ads与Meta Ads等平台的归因窗口差异必须在跨渠道分析中统一基准。对于无法直接归因的品牌类推广活动（如户外广告/电视广告），使用品牌提升调研（Brand Lift Study）或增量测试（Geographic Holdout Test）作为替代度量方案，不得仅凭"曝光量"作为成功标准。数据追踪基础设施（UTM参数体系/Pixel埋点/Conversion API/CRM数据打通）是Campaign的必要非充分条件——缺失任何一环都视为Campaign未就绪（见检查清单mk-cl-004）。',
        stage: 3,
        sourceRefs: [
          { layer: 'L1', sourceId: 'ama-marketing-analytics', section: 'attribution-models' },
        ],
        provenance: 'official',
      },
      {
        id: 'mk-rule-004',
        title: '广告合规与广告法',
        content:
          '所有营销物料必须遵守《中华人民共和国广告法》（2021年修订版）及目标市场所在地的广告法规。核心红线：不得使用"国家级"、"最高级"、"最佳"等绝对化用语（广告法第九条）、不得虚假宣传或误导消费者（第四条）、比较广告必须有客观依据且不得贬低竞争对手、特殊行业（医疗/保健品/金融/教育/酒类）须满足行业特定的审查和标注要求。在数字广告中，程序化投放须确保广告不出现在品牌安全风险环境中（如暴力/仇恨言论内容旁——使用GARM品牌安全框架进行排除）。KOL/KOC合作须明确标注"广告"或"合作"标识——隐晦营销（不标注广告的合作内容）违反广告法和各平台社区规范（如小红书蒲公英平台、抖音巨量星图的合规要求）。跨境Campaign需额外评估目标市场法规差异——欧盟GDPR/ePrivacy对数字广告有更严格的用户同意要求，美国FTC对Endorsement有明确披露指南。违规成本不仅是罚款——品牌声誉损失和消费者信任崩塌的代价远超罚款金额。',
        stage: 4,
        sourceRefs: [
          { layer: 'L1', sourceId: 'advertising-law-cn-2021', section: 'core-provisions' },
          { layer: 'L1', sourceId: 'garm-brand-safety', section: 'framework' },
        ],
        provenance: 'official',
      },
      {
        id: 'mk-rule-005',
        title: '预算分配与ROI度量',
        content:
          '营销预算分配应遵循"70-20-10"法则作为基准框架——70%投入已验证的高效渠道（成熟Campaign的历史ROI数据支撑）、20%投入增长型/新兴渠道（有早期正信号但尚未完全验证）、10%投入实验性/创新渠道（高风险高回报的探索型投入）。每个渠道的ROI必须独立度量且计入渠道间协同效应——例如品牌搜索量激增可能源于同期户外广告投放，不能将品牌搜索带来的转化仅归功于搜索引擎广告。ROI度量公式统一（Campaign产生的增量收入或等值价值 - 总营销投入）/ 总营销投入 × 100%。注意识别"增量"——不仅看关联转化，更要通过增量测试（A/B Test、地理分组测试、PSM倾向评分匹配）剥离自然转化。LTV/CAC比值（用户生命周期价值/获客成本）是更长期的营销效率指标——CAC包含所有营销和销售成本，LTV基于真实留存和付费数据（禁止使用未经验证的模型推算值）。营销预算应设硬性上限（占营收比例≤行业的合理区间），但上限不应成为放弃高ROI机会的理由——ROI > 3 时考虑"无上限预算"模型。',
        stage: 3,
        sourceRefs: [
          { layer: 'L1', sourceId: 'kotler-marketing-management', section: 'budget-allocation' },
          {
            layer: 'L1',
            sourceId: 'byron-sharp-how-brands-grow',
            section: 'mental-physical-availability',
          },
        ],
        provenance: 'official',
      },
      {
        id: 'mk-rule-006',
        title: '多渠道一致性',
        content:
          '消费者在与品牌的每一个触点上体验到的信息必须一致且连贯——同一Campaign在微博、微信、抖音、小红书、淘宝、京东、官方网站、线下门店的Big Idea、Visual Language和Call-to-Action要形成"同一声音、多种表达"而非"各自为政、互相矛盾"。营销渠道矩阵管理遵循"一个核心策略、各路触点适配"原则：Campaign核心策略（目标受众/核心信息/成功指标/时间节奏）由策略团队统一制定，各渠道PM基于核心策略制定渠道专属执行方案（允许形式适配但禁止信息偏离）。每周跨渠道同步会议检查各渠道素材和文案是否对齐、消费者反馈是否存在渠道间矛盾。特别关注：电商大促期间，站外预热信息和站内促销机制的配合——预热承诺的优惠必须在站内一致履行，否则引发消费者投诉和平台处罚。在CRM层面，用户在不同渠道的行为数据应打通——用户在小红书看到广告后搜索进入天猫的行为链应被完整追踪，避免渠道间的"数据孤岛"导致同一用户被不同渠道重复推送相同内容而消耗预算和用户体验。',
        stage: 4,
        sourceRefs: [
          { layer: 'L1', sourceId: 'omnichannel-marketing', section: 'cross-channel-consistency' },
        ],
        provenance: 'official',
      },
      {
        id: 'mk-rule-007',
        title: '隐私合规与用户授权',
        content:
          '所有面向用户的营销触达必须建立在合法合规的用户授权基础上。在中国境内遵守《个人信息保护法》（PIPL）——营销短信/电话/邮件必须为用户明确同意（Opt-in而非Opt-out），提供清晰的退订机制且退订操作不得比订阅操作更复杂。如涉及欧盟用户需同时满足GDPR——数据处理须有合法基础（Consent/Legitimate Interest/Contractual Necessity），用户有权访问、更正、删除和导出其个人数据。在Cookie和Tracking层面——网站必须在用户未同意前不加载营销追踪脚本（如Google Analytics/Facebook Pixel），CMP（同意管理平台）Banner须提供"全部拒绝"和"逐项选择"选项。"暗黑模式"（Dark Pattern）——将拒绝按钮设置为灰色小字、将同意按钮设置为亮色大字等——在PIPL和GDPR下均属违规。第三方数据合作时须进行DPIA（数据保护影响评估），确保数据共享有合法基础且最小化——"能用一个字段解决的不传两个字段"。数据泄露应急流程必须在Campaign启动前到位——明确通知受影响用户的时效（PIPL要求及时通知）、通知监管机构的流程和数据泄露隔离措施。',
        stage: 4,
        sourceRefs: [
          { layer: 'L1', sourceId: 'pipl-cn-2021', section: 'personal-information-rights' },
          { layer: 'L1', sourceId: 'gdpr-eu', section: 'consent-and-rights' },
        ],
        provenance: 'official',
      },
      {
        id: 'mk-rule-008',
        title: 'A/B测试与优化循环',
        content:
          '营销优化必须遵循科学实验方法论——每次只改变一个变量（单一变量原则），运行时间足够长以达到统计显著性（通常要求样本量使p<0.05且统计功效≥80%），在测试开始前确定"胜出标准"（如转化率提升≥5%且置信区间不含0即采用变体）。A/B测试的常见陷阱：测试时间过短——未覆盖完整的用户行为周期（工作日/周末/发薪日等行为差异）导致假阳性；"Peeking Problem"——在测试未达到预定样本量前持续查看结果并提前结束测试，导致虚假的"胜出"（实际长期回归均值后不显著）；多变量同时测试但未控制多重比较——每增加一个变体和指标，Type I错误率（假阳性）随之上限膨胀。建议使用正规A/B测试工具或平台（如Optimizely、Google Optimize、自研Feature Flag系统）而非手动切流量——确保流量分配的随机性、同质性和用户桶独立性。测试频率：每个Campaign中至少设定一个A/B测试项（素材/标题/CTA/受众/Landing Page），将优化融入日常运营而非"季度优化专项"——持续小赢胜过一次大改。',
        stage: 5,
        sourceRefs: [
          { layer: 'L1', sourceId: 'ab-testing-best-practices', section: 'experimental-design' },
        ],
        provenance: 'official',
      },
    ],

    // ── patterns（模式）8 条 ──
    patterns: [
      {
        id: 'mk-pat-001',
        title: 'AIDA注意力-兴趣-欲望-行动模型',
        content:
          'AIDA是沿用超过百年的经典营销传播阶梯模型，由E. St. Elmo Lewis于1898年提出，至今仍是广告创意和用户旅程设计的基础框架。（1）Attention注意力——通过视觉冲击、痛点共鸣、数据震撼或名人效应在信息过载环境中抓住目标受众的前3秒。数字广告中标题和缩略图是注意力的决定性因素——Facebook广告的图片文本占比不超过20%（否则投放量受限）、短视频前3秒必须出现"钩子"（hook）。（2）Interest兴趣——引发注意后通过利益点（产品如何解决用户问题）、故事性（用户情境代入）或好奇心（信息缺口理论——Loewenstein 1994）让受众产生继续了解的意愿。落地页的前3屏是兴趣维持的关键——"看到标题点进来，前3屏找不到共鸣点就走"（平均跳出率分析）。（3）Desire欲望——将兴趣转化为购买欲望——通过产品体验展示（Demo/测评/UGC）、社会证明（销量/评价/名人背书）、稀缺性（限量/限时/独家）和情感连接（品牌价值观/生活方式代入）强化。电商详情页中的"用户评价区"和"热销标"是Desire阶段的经典工具。（4）Action行动——通过低摩擦转化路径（一键购买/表单预填/多种支付方式）和紧迫感CTA（"限时优惠"、"仅剩X件"、"已有X人在看"）推动转化。注意：AIDA在现代营销中被改良为AIDAS（+Satisfaction满意度——购买后体验）和AISDALSLove等更复杂模型，但其底层逻辑——消费者从"不知道你"到"购买你"必须经历心理阶段——仍是营销策划的基准检查工具。',
        stage: 2,
        sourceRefs: [{ layer: 'L1', sourceId: 'marketing-models', section: 'aida-framework' }],
        provenance: 'official',
      },
      {
        id: 'mk-pat-002',
        title: 'AARRR海盗漏斗',
        content:
          'AARRR（Pirate Metrics）由Dave McClure于2007年提出，是增长营销的核心度量框架，覆盖用户全生命周期的五个关键节点。（1）Acquisition获客——用户从哪些渠道发现你？渠道效率通过CAC（获客成本）和渠道转化率度量。关键策略：内容营销（SEO/社交媒体/PR）、付费广告（SEM/信息流/程序化）、病毒传播和商务合作。获客渠道必须有UTM标记以追踪来源。（2）Activation激活——用户首次体验到"Aha Moment"——核心价值被感知的瞬间。激活率的定义因产品而异：社交产品的"添加X个好友"、电商的"首次下单"、SaaS的"完成核心任务"。激活优化是增长中最被低估的环节——改善激活体验的ROI通常远高于增加获客预算。（3）Retention留存——用户是否持续回来？次日/7日/30日留存率是产品-市场匹配的核心信号。留存驱动因素：持续内容供给（新内容/新功能）、用户习惯养成（Hook Model——Trigger-Action-Reward-Investment循环）、社区网络效应（用户越多体验越好）。（4）Revenue收入——用户是否产生收入？收入模式（订阅/一次性购买/广告/交易佣金）决定度量方式。关注LTV（用户生命周期价值）和ARPU/ARPPU。定价策略（免费增值/Freemium/分层定价）直接影响Revenue层级。（5）Referral推荐——用户是否推荐他人？NPS（净推荐值）、病毒系数（K-factor——每个用户平均带来多少新用户）、推荐计划的转化漏斗。AARRR不是严格的线性漏斗——用户可能在任一环节进入和退出；其价值在于为跨团队协作（产品/营销/运营/客服）提供统一的增长语言和指标框架。',
        stage: 2,
        sourceRefs: [
          { layer: 'L1', sourceId: 'mcclure-pirate-metrics', section: 'aarrr-framework' },
        ],
        provenance: 'official',
      },
      {
        id: 'mk-pat-003',
        title: 'STP细分-目标-定位模型',
        content:
          'STP（Segmentation-Targeting-Positioning）是营销战略的基础三部曲，由菲利普·科特勒系统化推广。（1）Segmentation市场细分——基于地理/人口统计/心理图/行为四维将异质的大市场切割为同质的细分市场集群。有效的市场细分必须满足：可度量（市场规模与购买力可量化）、可触达（可通过现有渠道有效覆盖）、足够大（规模足以支撑盈利）、可区分（不同细分对营销组合反应不同）、可操作（组织有能力为该细分提供服务）。常见的B2C细分变量：生活阶段（学生/新婚/育儿/空巢）、价值观（环保主义/极简/享乐）、使用频率（重度/中度/轻度/潜在用户）。（2）Targeting目标市场选择——在细分市场中基于市场吸引力（规模/增长率/利润率/竞争强度/进入壁垒）和企业适应度（资源/能力/品牌资产/战略匹配）两条标准综合评估选出1-3个优先服务的细分市场。四种目标市场覆盖策略：无差异化（Mass Marketing——用一个方案覆盖所有）、差异化（多细分各一个定制方案）、集中化（只做一个细分做深）和微营销（一对一/本地化——大数据时代的新可能）。（3）Positioning定位——为目标市场在消费者心智中占据一个独特的、有价值的位置。定位描述的标准格式："对于[目标市场]，我们的[品牌/产品]是[品类]中[差异化点]的，因为[支持理由]"。定位不等于口号（Tagline）——口号是定位的创意表达，定位是战略决策。Perceptual Map（感知图）是定位中的可视化工具——将竞品按两个关键维度（如价格-质量、传统-创新）映射在二维平面上，找出消费者心智中的"空白地带"。',
        stage: 1,
        sourceRefs: [
          { layer: 'L1', sourceId: 'kotler-marketing-management', section: 'stp-framework' },
        ],
        provenance: 'official',
      },
      {
        id: 'mk-pat-004',
        title: '4P与4C营销组合',
        content:
          '4P（产品/价格/渠道/促销）与4C（消费者/成本/便利性/沟通）是营销组合设计中互斥又互补的双重视角。（1）Product产品 vs Consumer消费者——企业从产品功能/质量/设计/品牌/包装/服务出发，但核心价值取决于消费者感知到的"问题解决方案"。Jobs-to-be-Done（JTBD）框架强调消费者"雇佣"产品来完成某项任务——产品的竞争不仅是品类内，更是"所有能完成这个任务的手段"。（2）Price价格 vs Cost成本——企业的定价策略（成本导向/竞争导向/价值导向/动态定价）对比消费者的总获取成本（货币成本+时间成本+体力成本+心理成本+机会成本）。价格弹性分析必须在定价前完成——涨价10%客户流失率上升多少？价格不是越便宜越好——高价格是质量的暗示信号，奢侈品行业尤其如此。（3）Place渠道 vs Convenience便利性——企业重视渠道覆盖的广度和深度（线下分销网络/线上平台入驻/DTC自营），消费者关心的是"我在什么渠道、什么时候、用什么方式能最方便地获得产品"。全渠道零售（Omnichannel）的核心是将渠道选择权交还给消费者——线上下单线下提货（Click-and-Collect）、线下体验线上购买（Showrooming）。（4）Promotion促销 vs Communication沟通——企业的促销组合（广告/公关/直效营销/销售促进/KOL/事件营销）与消费者对"品牌在与我对话"的沟通体验。品牌与消费者的关系从"促销=单向推送"进化为"沟通=双向对话"——社交媒体、客服、社区、UGC都是沟通的一部分，不仅仅是一张促销海报。',
        stage: 2,
        sourceRefs: [
          { layer: 'L1', sourceId: 'kotler-marketing-management', section: 'marketing-mix' },
        ],
        provenance: 'official',
      },
      {
        id: 'mk-pat-005',
        title: '内容营销飞轮',
        content:
          '内容营销飞轮（Content Marketing Flywheel）由HubSpot推广，将传统漏斗的"获客→转化→留存"线性模型升级为自增强的飞轮。（1）吸引（Attract）——通过高质量的SEO内容、社交媒体/短视频、播客、在线课程、免费工具等手段吸引潜在客户。内容策略必须以用户搜索意图为导向（Informational/Navigational/Commercial/Transactional四类Search Intent），而非"企业想说什么"。通过工具（搜索引擎关键词研究工具+社交媒体话题监测）发现目标用户真正在问的问题，然后针对性产出回答型内容。（2）参与（Engage）——通过邮件Newsletter、营销自动化工作流、互动工具（测评/计算器/配置器）、Webinar、社群运营将访客转化为线索并持续培育。Lead Scoring（线索评分）在参与阶段至关重要——基于用户的行为（访问了什么页面、下载了什么内容、参加了什么活动）和行为频率（最近一次互动时间+互动频次）为线索打分，高分线索触发SDR/Sales跟进，低分线索继续培育。（3）愉悦（Delight）——通过客户成功（Customer Success）内容（帮助中心/知识库/进阶使用指南/最佳实践案例）、社区（用户论坛/社群）、忠诚计划（积分/特权/内测资格）让现有客户成为品牌的推荐者。愉悦阶段的目标不是"减少流失"而是"创造推荐"——满意客户的口碑是信任度最高的免费获客渠道。飞轮的关键设计是"力"与"摩擦力"：增加飞轮"力"——优质内容提升SEO排名带来更多自然流量、客户评价带来更多social proof；减少"摩擦力"——复杂的注册流程、响应缓慢的客服、模糊的定价页面。飞轮一旦达到逃逸速度，自然增长将显著降低每获客成本。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'hubspot-flywheel', section: 'inbound-marketing' }],
        provenance: 'official',
      },
      {
        id: 'mk-pat-006',
        title: '增长黑客环路',
        content:
          '增长黑客（Growth Hacking）由Sean Ellis于2010年提出，核心是通过跨职能（产品+工程+数据+营销）的快速实验实现规模化增长的迭代方法论。增长环路的标准流程：（1）数据分析与机会识别——通过产品分析工具（Amplitude/Mixpanel/自建数据仓库SQL查询）和用户研究（NPS调研/流失访谈/热力图/用户操作录制）发现增长杠铃（leverage point）——小优化撬动大增长的潜力点。典型的杠铃点：注册流程的转化漏点（每步流失率）、新用户激活路径中用户放弃的环节（如"上传头像"是否可延迟）。（2）假设生成——按"如果[策略]，[用户群体]会[行为]，因为[理由]"格式撰写实验假设。假设必须可验证、有时间限制、有底线成功标准。按ICE评分模型（Impact影响力/Confidence信心/Ease实施容易度——每项1-10分，取三者平均）优先排序实验队列。（3）快速实验——以最小可行工作量（MMP——Minimum Marketable Prototype）投入测试。优秀实验者的核心能力是"设计一个能学到东西的实验"而非"设计一个会赢的实验"——失败的实验如果能排除一个错误假设同样有价值。（4）度量与分析——实验结束后严格按预定标准评估结果的统计显著性和实际显著性。统计显著（p<0.05）不等于商业显著（提升了0.1%但耗费了工程师2周——可能不值得推广到全体用户）。（5）规模化——胜出实验从"部分用户"扩展到"全体用户"，并文档化"为什么这个策略有效"供组织学习。长期运行的增长环路会累积成"增长引擎"——SEO内容引擎、病毒传播引擎、付费增长引擎或销售引擎，不同引擎需要不同的投入结构和优化KPI。',
        stage: 5,
        sourceRefs: [
          { layer: 'L1', sourceId: 'ellis-growth-hacking', section: 'high-tempo-testing' },
        ],
        provenance: 'official',
      },
      {
        id: 'mk-pat-007',
        title: '归因模型体系',
        content:
          '营销归因是将转化功劳分配给转化路径上各触达点的分析方法——核心解决"我的营销预算花在哪些渠道，实际贡献了多少转化"的问责问题。主要归因模型：（1）单触达模型——首次触达归因（First Touch）：100%功劳归首个引入渠道——适用于品牌认知度驱动的业务。末次触达归因（Last Touch）：100%功劳归最后转化前一个渠道——最简单但严重低估了上层渠道对"种草"的贡献。（2）多触达模型——线性归因（Linear）：各触达点平分功劳，简单公平但不反映渠道真实影响力差异。时间衰减（Time Decay）：越接近转化的触达点分得越多的功劳——对于长决策周期产品（汽车/房产/B2B）相对合理。U型归因（Position-Based）：首次和末次各40%，中间渠道平分20%——兼顾认知创建与转化收口。（3）数据驱动归因（DDA——Data-Driven Attribution）：基于Shapley值等博弈论算法计算每个渠道在转化中的边际贡献——Google Ads DDA和Meta的Conversion Lift均属此类。归因模型选择的约束：跨设备追踪的局限性——用户可能在手机看到广告但在电脑完成购买，跨设备归因需要统一的用户ID（登录态）或概率匹配（IP/设备指纹——越来越受限）。iOS 14.5+ ATT框架（App Tracking Transparency）和Android Privacy Sandbox等隐私政策大幅限制了广告标识符（IDFA/GAID）的使用，迫使数字广告从"用户级确定性归因"转向"聚合级建模归因"。面对归因不完美——坚持"数据+判断"双引擎，不迷信模型数字但也不回归无数据的拍脑袋。',
        stage: 5,
        sourceRefs: [
          { layer: 'L1', sourceId: 'ama-marketing-analytics', section: 'multi-touch-attribution' },
        ],
        provenance: 'official',
      },
      {
        id: 'mk-pat-008',
        title: '生命周期营销',
        content:
          '用户生命周期营销（Lifecycle Marketing）是根据用户与品牌的关系阶段提供差异化营销策略的系统框架。（1）新用户引入阶段——核心目标是帮助用户完成"初次成功体验"（First Value Realization），缩短Time-to-Value。营销策略：Onboarding引导系列（邮件/App In-App Message/教程）、新手专属优惠、新用户社区。（2）成长阶段——用户已体验过核心价值、正在形成使用习惯。营销策略：功能发现推荐（基于行为数据推荐用户的"下一个自然功能"——如Spotify的Discover Weekly）、进阶使用案例输出（Blog/Webinar）、升级到更高套餐的时机教育（基于用量数据提示"你即将超出当前套餐限制"）。（3）成熟阶段——高频/高价值用户（Power User），是口碑和收入的主力贡献者。营销策略：VIP体验（优先客服/内测资格/年度用户庆典）、UGC激励与展示、推荐计划（Referral Program——推荐双方均获奖励）、品牌大使计划（挑选最具影响力的用户深度合作）。（4）休眠阶段——使用频率或消费金额下降的用户。营销策略：Re-engagement系列（"我们想念你"邮件/推送——包含个性化内容/优惠）、流失原因调研（NPS/CES问卷——为什么减少使用）、产品改进反馈邀请（让用户感觉被倾听且未来可以看到自己的建议被采纳）。（5）流失阶段——已流失的用户。营销策略：Win-back系列（突出流失期间产品的重要更新/特别回归优惠）、流失面谈（Closure Interview——即使不回来也了解原因）。生命周期营销的核心原则：在正确的时间通过正确的渠道向正确的用户发送正确的信息——不是"尽可能多地触达"而是"在用户需要时恰好出现"。实现生命周期营销需要CRM系统、营销自动化工具和跨团队协作（产品/运营/客服/数据）。',
        stage: 4,
        sourceRefs: [
          {
            layer: 'L1',
            sourceId: 'lifecycle-marketing',
            section: 'customer-journey-orchestration',
          },
        ],
        provenance: 'official',
      },
    ],

    // ── antiPatterns（反模式）8 条 ──
    antiPatterns: [
      {
        id: 'mk-ap-001',
        title: '无目标受众群发',
        content:
          '不进行受众细分和精准定向，对所有人群发送同一营销信息——即"spray and pray"（广撒网，碰运气）。典型症状：邮件列表中所有人收到相同Newsletter（不管他是潜在客户还是已流失6个月）、社交媒体广告的定向设置为"18-65岁全中国"且无兴趣/行为标签筛选、新品上市Campaign的PR通稿同时发给科技媒体/生活方式媒体/财经媒体——内容对谁都不够相关。后果：低转化率（信息与受众需求不匹配）、高退订/屏蔽率（用户感到骚扰——"关我什么事"）、品牌形象受损（"这个品牌不懂我"）、预算效率极低——99%的曝光给了永远不会购买的人群。营销铁律：同一个信息对不需要它的人来说是垃圾广告，对需要它的人来说是有价值的信息——差异在于"你是否找到了需要它的人"。纠正方法：建立RFM模型（Recency-Frequency-Monetary——最近一次消费时间/消费频率/消费金额）进行客户分层、利用Lookalike Audience/LAL相似人群扩展从种子人群（已购客户名单）找到特征相似的高潜力人群、设置频率上限（同一用户每周收到同一品牌广告的次数不超过3次——频次过高不仅浪费且产生负面品牌联想）。',
        stage: 2,
        sourceRefs: [
          { layer: 'L1', sourceId: 'marketing-anti-patterns', section: 'spray-and-pray' },
        ],
        provenance: 'official',
      },
      {
        id: 'mk-ap-002',
        title: '指标虚荣',
        content:
          '沉迷于"虚荣指标"（Vanity Metrics）——数字看起来好看但对实际业务增长无实质影响的度量——典型如社交媒体粉丝数、页面浏览量、曝光量、下载量、点赞数。症状：月报中展示"本月微博阅读量500万"但不提任何业务转化指标、Campaign总结强调"视频播放量1000万"但播放完成率<10%且无品牌搜索量提升证据、团队热衷于讨论"怎样涨粉"而非"怎样将粉丝转化为付费用户"。"数据好看"不等于"Campaign成功"——100万曝光如果触达的是错误人群，ROI可能是负的。正确度量：NSM北极星指标（North Star Metric——驱动业务增长的单一核心指标）、OEC总体评估准则（Overall Evaluation Criterion——综合关键指标评估实验效果）和Guardrail Metrics护栏指标（优化NSM同时确保这些指标不恶化——如用户满意度/退款率/客服咨询量）。纠正方法：每个报告数字背后追问"So What?——这个数字增长对收入和用户留存有什么影响？"、建立指标心智模型将指标分层（虚荣指标→业务指标→价值指标）并聚焦后两层、设定渠道专属转化指标（不是每个渠道都应以购买转化为目标——品牌认知类渠道以搜索量提升为指标）。',
        stage: 5,
        sourceRefs: [
          { layer: 'L1', sourceId: 'lean-analytics', section: 'vanity-vs-actionable-metrics' },
        ],
        provenance: 'official',
      },
      {
        id: 'mk-ap-003',
        title: '渠道孤岛',
        content:
          '各营销渠道独立运作、独立汇报、独立优化而未形成协同效应——微博团队不知道微信社群在做什么活动、电商团队不知道抖音在做预热、品牌团队不知道效果广告投放的落地页设计。典型症状：每个渠道有自己的KPI且互相冲突——品牌团队追求"高端调性"而效果广告团队投放的落地页是"低价大促"风格导致用户认知割裂；用户在微信公众号看到"新品上市8折优惠"但到天猫旗舰店发现是原价（渠道信息不同步）；SEO团队优化了"最佳性价比产品"排名但SEM团队购买了缺乏该信息的广告创意导致搜索广告点击率远低于自然搜索结果。后果：消费者体验碎片化——同一个品牌在不同触点变成了"不同品牌"；预算浪费——上半部分漏斗（品牌认知）产生兴趣的用户因下半部分漏斗（转化）信息不连贯而流失；测量失真——同一用户在不同渠道的行为被当作多个独立用户优化反而增加了重复频率（频次过高→骚扰）。纠正方法：建立"全渠道战略委员会"——每月一次跨渠道对齐会、统一的Campaign策划模板要求各渠道PM在同一框架下制定渠道计划而非各自独立策划、统一的UTM参数体系和全渠道追踪Dashboard。',
        stage: 2,
        sourceRefs: [{ layer: 'L1', sourceId: 'omnichannel-marketing', section: 'silo-breaking' }],
        provenance: 'official',
      },
      {
        id: 'mk-ap-004',
        title: '品牌不一致',
        content:
          '同一品牌在不同时间、不同渠道、不同Campaign中传达了互相冲突的视觉形象、语调或核心信息——消费者无法形成一致的品牌联想。典型症状：品牌Logo在微信公众号用某个版本、TikTok用另一个版本——同一Campaign里的Logo颜色都不一样；品牌价值观主张"环保可持续"，但产品包装使用不可降解材料——消费者在社交媒体抗议后品牌回应仓促且含糊；时尚品牌2019年定位"轻奢"，2020年改为"性价比"，2021年又改为"设计师联名"——三年三种方向导致消费者不知道这个品牌代表什么。后果：品牌资产被稀释——每次不一致的曝光不是"加法"而是"减法"——消费者对品牌的印象变得模糊而非清晰；区分度下降——在竞争市场中模糊的品牌等于不存在的品牌；消费者信任下降——不一致意味着品牌缺乏稳定的内核，不值得消费者建立长期关系。纠正方法：建立品牌规范手册（Brand Bible），纳入Onboarding培训（不仅给创意团队全员可读——产品/销售/客服也应了解品牌底线）、建立品牌巡检机制——每季度抽样检查各渠道的物料与品牌规范的一致性并打分、品牌一致性作为新品或新Campaign上线前的Checklist必须项（见检查清单mk-cl-005）。',
        stage: 2,
        sourceRefs: [
          { layer: 'L1', sourceId: 'aaker-brand-equity', section: 'brand-consistency-pitfalls' },
        ],
        provenance: 'official',
      },
      {
        id: 'mk-ap-005',
        title: '只拉新不留存',
        content:
          '将绝大多数营销预算和时间投向新用户获取，而忽视现有用户的留存、激活和价值深挖——"漏桶"式增长：上面不断倒水（新用户），下面不断漏水（老用户流失），桶里的水（用户总量和收入）始终不增长。典型症状：获客预算每年增长30%以上但DAU/MAU比值维持或下降、新用户Offer远优于老用户权益——老用户感到"被背叛"而流失、客户成功/留存团队的Headcount远低于获客团队且被视为"成本中心"而非"增长中心"。经典的营销数据：获取一个新用户的成本（CAC）是留存一个老用户成本的5-25倍（取决于行业——B2B SaaS通常在5-7倍、消费品在3-5倍）。Bain & Company数据显示：提升5%的用户留存率可以提升25%-95%的利润——因为老用户购买频率和客单价更高、服务成本更低、推荐概率更高。纠正方法：将留存指标（次日/7日/30日/90日留存率和用户流失率Churn Rate）设为与获客指标同级别的KPI、实施"用户留存审计"——按月/季度分析流失用户的共同特征（什么行为/渠道/套餐的用户更可能流失）并针对性干预、将一部分获客预算（建议15-25%）重新分配给存留/忠诚度计划——不是"削减获客"而是"同样重视留存"。',
        stage: 3,
        sourceRefs: [
          { layer: 'L1', sourceId: 'reichheld-loyalty-effect', section: 'retention-economics' },
        ],
        provenance: 'official',
      },
      {
        id: 'mk-ap-006',
        title: '创意无迭代',
        content:
          '广告创意"一套物料打天下"——制作一个版本的广告素材在所有渠道长时间投放，不进行A/B测试、迭代优化和素材疲劳度管理。典型症状：同一套广告素材投放超过3个月无任何更新、广告频次（同一用户看到同一条广告的次数）超过5次而不替换——用户从"感兴趣"到"无视"再到"负面情绪"（广告疲劳Ad Fatigue）；不区分渠道特性——同一段30秒TVC既在抖音前贴片又在信息流中使用——后者用户在前3秒已滑走因为TVC铺垫太长不适合快节奏信息流。后果：随着频次上升点击率（CTR）和转化率（CVR）持续下降导致实际CPM/CPA上升——预算效率逐日退化；竞争对手用更鲜活的创意抢夺注意力；用户对品牌的感知变为"陈旧/过时"。纠正方法：每次Campaign产出至少3套创意变体（不同角度/不同人群/不同渠道适配）并进行A/B测试、设定素材疲劳度阈值（CTR/CPM劣化到初始值的70%或频次≥4时自动替换新素材）、建立"创意水库"——日常储备和测试新创意素材而非每次Campaign开始前临时赶制。创意资产管理系统（DAM——Digital Asset Management）和动态创意优化工具（DCO——Dynamic Creative Optimization）在规模化投放中是必要的技术支撑。',
        stage: 4,
        sourceRefs: [
          { layer: 'L1', sourceId: 'creative-strategy', section: 'creative-fatigue-management' },
        ],
        provenance: 'official',
      },
      {
        id: 'mk-ap-007',
        title: '预算无追踪',
        content:
          '营销预算按"去年预算+20%"或"老板拍一个数"分配而不基于ROI追踪和量化分析进行动态调整。典型症状：各渠道预算年初一次性分完——年中某个渠道ROI已被证明为负但仍"按计划花完预算"因为"预算花不完明年会被砍"；预算分配基于渠道PM的谈判能力（谁更会说谁拿更多）而非数据驱动的增量ROI分析；停止某渠道投放时无法回答"停止后对总收入的净影响是什么"——因为无归因、无增量分析、无对照组。后果：每年大量营销预算花在零回报或负回报的渠道上——资源错配的系统性浪费；高ROI渠道因"预算被低ROI渠道占满"而无法扩大投入——错失增长机会；预算审批流程变成了"猜谜"——财务部不信任营销部的预算请求、营销部认为财务部不懂营销——两败俱伤。纠正方法：每季度进行一次"零基预算"（Zero-Based Budgeting）——不以前期预算为基准而是"如果今天是第一天，我们会如何分配预算"、采用"响应曲线"分析——每个渠道的投入产出关系不是线性的（有边际收益递增和递减区间——找到最优投入区间而非越多越好）、实施"预算灵活性"——在验证到高ROI渠道时紧急追加预算（但追加团队有数据举证责任）而非按照年计划僵化执行。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'marketing-roi', section: 'budget-accountability' }],
        provenance: 'official',
      },
      {
        id: 'mk-ap-008',
        title: '忽视竞品',
        content:
          '营销团队只关注自身策划和执行，不进行系统化的竞品监测和分析——"蒙眼狂奔"。典型症状：团队无法快速回答"竞品最近的营销主题是什么"、"竞品在哪几个渠道加大投放了"、"竞品最新的定价调整对我们有什么影响"等基本竞品情报问题；新品上市前未分析竞品同类产品的上市策略和市场反应——导致重蹈竞品已犯过的错误；社交媒体危机管理无竞品对标——不知道竞品在类似危机中的成功和失败处。后果：品牌在竞争中失去差异化——因不知道竞品在做什么而"碰巧"做出信息相似的Campaign——消费者无法区分；定价策略被动——不掌握竞品价格动态而在促销季被竞品抢走份额；市场机会错失——竞品因某些原因退出了某个细分市场（放弃该产品线/舆论危机）但团队因不了解而在该细分无动作。纠正方法：建立竞品情报系统（Competitive Intelligence）——不要求专职团队但要求每月至少一次竞品矩阵更新（竞品的Campaign/渠道/定价/舆情/产品动态）；使用合法的竞品监测工具（社交媒体监听/SEM竞品分析/电商价格监测/APP Store更新监控）；每月团队会议预留15分钟进行"竞品动态速览"环节——不是长篇大论而是保持团队的竞争意识。',
        stage: 3,
        sourceRefs: [
          { layer: 'L1', sourceId: 'competitive-intelligence', section: 'continuous-monitoring' },
        ],
        provenance: 'official',
      },
    ],

    // ── examples（示例）8 条 ──
    examples: [
      {
        id: 'mk-ex-001',
        title: '新品上市营销WBS',
        content:
          '典型新品上市营销Campaign的WBS结构（6个一级阶段）。阶段1——市场研究与定位（2-3周）：目标受众细分与画像（定量调研N≥300 + 定性深访N≥10）、竞品上市策略复盘分析、产品核心卖点提炼（RTB——Reason to Believe + 差异化定位语句）、定价策略（成本导向参考 + 价值导向定价 + 竞品对标）。阶段2——Big Idea与创意开发（2-3周）：品牌传播核心概念（Big Idea——一句话能打动目标用户的创意表达）、KV（Key Visual——主视觉）设计（≥3套方案A/B测试）、主视频/TVC脚本与制作（15s/30s/60s多渠道版本）、Slogan与产品命名最终确认、KOL/KOC合作名单筛选与Brief（按矩阵模型——头部造势/腰部种草/尾部铺量）。阶段3——渠道策略与物料准备（2-3周）：各渠道传播物料套件（社交媒体套件/电商套件/PR套件/户外及线下物料）、媒介排期（Media Plan——按预热期/爆发期/延续期三阶段编排）、DAM资产管理——所有物料标记版本/渠道/有效期/责任人。阶段4——预热期执行（1-2周）：悬念或预热内容发布（Teaser）、KOL/KOC内容分批上线、电商预售页面开启及预热流量引导、PR稿件及媒体定向下发。阶段5——爆发期执行（核心1-3天+延续1-2周）：全渠道同步上线（Launch Day）、媒体采买集中放量（程序化竞价策略——爆发期CPM可适度上浮20-30%以抢占优质流量）、实时数据监控与优化（分渠道/分素材/分时段的CTR/CVR/CPA看板、每4小时一次优化决策——暂停低效素材/追加高效渠道预算）、用户反馈与舆情监控（社交媒体评论/电商评价/客服咨询高频问题——及时调整FAQ和话术）。阶段6——复盘与收尾（1周）：Campaign全渠道ROI核算（含归因分析——区分自然转化和增量转化）、素材效果排名（为下次Campaign积累最佳实践）、消费者洞察提炼（触达人群的画像实际数据 vs 预设受众画像——修正下次策略）、Campaign复盘报告（What went well/What to improve/Action Items for next campaign）并与全团队分享。',
        stage: 1,
        sourceRefs: [{ layer: 'L1', sourceId: 'product-launch-playbook', section: 'wbs-template' }],
        provenance: 'official',
      },
      {
        id: 'mk-ex-002',
        title: '内容营销日历',
        content:
          '季度内容营销日历模板与操作指南。日历核心要素——日期/内容主题/内容形式/目标受众/发布渠道/负责团队/关键KPI/状态追踪。示例：7月第二周周一——主题"用户案例：某消费品牌如何通过我们的产品3个月降低获客成本40%"——形式：深度案例研究长文(3000字+客户访谈引用) + 短视频精华版(60s) + 信息图一页总结——目标受众：B2B营销决策者——发布渠道：官网博客 + 微信公众号 + LinkedIn + 行业垂直社区——负责团队：内容组(采访撰写)/设计组(信息图)/视频组(短视频)——KPI：阅读量/下载量/销售线索转化数/客户案例被销售团队使用的次数。日历构建方法：（1）先确定季度营销主题（Q3聚焦"降本增效"——与客户的年度预算季对齐）;（2）将主题拆分为月度子主题（7月——获客效率、8月——工具赋能、9月——数据驱动）;（3）每周设定内容组合——"Hero-Hub-Hygiene"模型（Google内容策略框架）——Hero：少量高投入高影响力的重磅内容（如原创行业报告、年度大会演讲）、Hub：定期推送的系列内容（如每周行业洞察、产品更新日志）、Hygiene：日常SEO长尾内容（回答用户的常用搜索问题）；（4）在日历上标注"内容-渠道"矩阵——不是每个内容适合每个渠道，一篇深度行业分析在LinkedIn可能引发讨论但TikTok完全不适合；（5）预留"新闻劫持"（Newsjacking）的灵活度——当行业突发重大新闻时（如政策变化/竞品上市/技术突破），快速产出响应内容插入日历（响应时间≤24h——超过时效性后意义大降）；（6）每月回顾日历执行率和内容效果——按"生产量/触达量/互动量/转化量"四层漏斗评估内容ROI，淘汰低效内容形式。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'content-strategy', section: 'editorial-calendar' }],
        provenance: 'official',
      },
      {
        id: 'mk-ex-003',
        title: '社交媒体Campaign',
        content:
          '社交媒体整合Campaign完整执行方案——以"618电商大促"为例。1. 目标设定：总GMV目标/新客获取目标/品牌搜索量提升目标/社交互动量目标——四维目标各自有KPI和衡量方法。2. 平台策略矩阵：微博——话题营销+明星/KOL引爆+品牌官方实时互动（话题阅读量+互动率）；微信——公众号长图文深度内容+视频号直播+社群限量优惠券裂变（文章阅读+直播观看+社群转化）；抖音——达人种草短视频矩阵(10+达人)+品牌自播间日播+信息流精准投放（完播率+直播间进入率+GPM——千次展示GMV）；小红书——KOC铺量笔记(50+篇)+品牌专业号互动+搜索优化（笔记互动量+品牌搜索量+搜索占位）。3. 内容节奏——预热期(5.26-5.31)：悬念海报+达人预告+猜价格/猜新品互动；爆发期(6.1-6.3开门红+6.16-6.18高潮)：限时秒杀+实时战报+用户UGC有奖征集；返场期(6.19-6.20)：最后一波优惠+感谢信+用户好评精选展示。4. 社交互动机制：话题打卡挑战(发布带话题的购物开箱有奖)、品牌联合互动(与其他非竞品品牌在社交媒体互相"串门"扩大潜在受众)、实时客服(大促期间消费者问题量激增——安排额外客服人力/智能客服FAQ更新)。5. 数据追踪架构：每个平台的内容带有独特UTM参数和追踪链接(避免平台间混控)、社交媒体渠道贡献的GMV通过Last Click + 辅助转化模型综合评估(社交媒体的转化路径通常更长——用户种草后可能几天后才在天猫搜索下单)。',
        stage: 4,
        sourceRefs: [
          { layer: 'L1', sourceId: 'social-media-marketing', section: 'campaign-blueprint' },
        ],
        provenance: 'official',
      },
      {
        id: 'mk-ex-004',
        title: 'SEO-SEM投放方案',
        content:
          'SEO(搜索引擎优化)+SEM(搜索引擎营销)整合投放方案——"自然排名与付费广告协同最大化搜索流量份额"。1. SEO部分：(a)关键词策略——基于Search Intent四分类(Informational/Navigational/Commercial/Transactional)构建关键词矩阵，高转化意向Commercial/Transactional词优先优化(如"最好的项目管理工具"、"项目管理软件价格")。(b)技术SEO——页面加载速度(LCP≤2.5s)、移动端适配、结构化数据标记(Schema.org——Product/Article/FAQ/Review类型)、XML Sitemap与robots.txt管理、死链监控与修复。(c)内容SEO——围绕核心关键词创建"Pillar-Cluster"内容结构——Pillar Page是一篇全面的"终极指南"(如"2026年项目管理软件终极指南")、Cluster Pages围绕Pillar的子主题深入(如"甘特图工具对比"、"敏捷项目管理工具推荐"、"WBS分解工具")，内链互相连接形成主题权威性。(d)站外SEO——高质量反向链接建设(行业媒体投稿/合作品牌的资源页/被新闻引用的数据报告)、本地SEO(如果适用——Google My Business/百度商家)。2. SEM部分：(a)账户结构——品牌词(保护品牌搜索流量不被竞品截获——即使自然排名第一也要投)、竞品词(在搜索结果页拦截竞品流量——注意广告法和平台政策限制)、通用词(品类/需求词——获客主力)、长尾词(搜索量低但转化意图精准——低CPC高ROI)。(b)广告创意——每个Ad Group至少3条广告变体(A/B测试)、广告文案与对应Landing Page信息一致(质量分Quality Score优化)、广告附加信息(通话/地址/促销/结构化摘要——提高广告点击率和信息密度)。(c)出价与预算——根据ROI目标反推目标CPA/tCPA出价、分时段出价调整(工作日9-18点高出价/夜间及周末低出价——基于历史数据的分时转化率分布)、搜索再营销(RLSA——对访问过网站但未转化的用户在搜索时提高出价)。3. SEO+SEM协同：(a)数据共享——SEM的高转化关键词反馈给SEO内容团队优化自然排名、SEO的高CTR标题模式被SEM广告文案借鉴。(b)总搜索流量份额最大化——在SEO排名未进入前三的关键词上加强SEM投放"兜底"，随着SEO排名提升可适度降低SEM出价。',
        stage: 4,
        sourceRefs: [
          { layer: 'L1', sourceId: 'seo-sem-playbook', section: 'integrated-search-strategy' },
        ],
        provenance: 'official',
      },
      {
        id: 'mk-ex-005',
        title: 'KOL-达人合作Brief',
        content:
          'KOL/达人合作的标准化Brief模板——确保品牌信息传达和达人创作自由的平衡。1. Campaign背景(1-2段)：为什么做这次Campaign？产品核心卖点是什么？目标用户是谁？Campaign的整体创意主题(Big Idea)一句话表述。2. 合作目标：本次合作的KPI是什么(曝光量/互动量/链接点击/优惠码使用/App下载——取决于Campaign目标)？注意：不要堆砌所有指标——1-2个核心KPI，其余为参考指标。3. 核心信息要点(3-5条Must-Mention)：达人必须在内容中涵盖的关键信息点——例如"产品A的核心技术是X，区别于竞品的B和C"、"上市期间用专属码可享受8折优惠"、"购买链接在个人简介"等。但注意——Must-Mention不应超过5条(超过5条限制达人自然表达，内容会变得像"读PPT")。4. 创意参考(非强制)：提供2-3个内容方向提示(如"开箱测评角度——从收到包裹到第一周使用体验"、"使用前后对比——遇到什么问题→使用后如何解决")，但允许达人在框架内自由发挥——达人最了解自己的粉丝喜好什么内容。达人的创造力是合作的最大价值，过度脚本化会扼杀创造力使内容失去真实感(authenticity)而引发粉丝反感("一看就是广告")。5. 禁忌事项(Must-Not-Do)：不得提及的产品或话题(避免引发争议或法律风险)、不得使用的竞品名称、不得夸大功效或使用禁用词(广告法——"最"、"第一"等绝对化用词不能出现)、不得在未标注广告标识的情况下发布。6. 排期与审稿流程：初稿提交日→品牌反馈日(≤2个工作日——拖延会压缩达人制作时间)→终稿确认日→发布日及发布时间段（考虑粉丝在线高峰时段）。品牌反馈应为"合规审稿"而非"创意审稿"——仅检查必须信息是否准确、是否违反广告法及平台规则，不指导达人"你应该这样拍"——除非达人主动寻求创意建议。7. 内容使用权约定：品牌是否有权将达人内容用于品牌官方渠道二次传播(付费投放Dark Post/官网转载/线下物料)? 使用期限是多久? 是否需要额外付费?——在Brief和合同中提前约定避免后期纠纷。',
        stage: 4,
        sourceRefs: [{ layer: 'L1', sourceId: 'influencer-marketing', section: 'brief-template' }],
        provenance: 'official',
      },
      {
        id: 'mk-ex-006',
        title: '邮件自动化流程',
        content:
          '营销自动化（Marketing Automation）中邮件工作流的标准设计与示例。工具：Mailchimp/HubSpot/ConvertKit/自建营销引擎。核心自动化流程设计：（1）欢迎序列(Welcome Series)——新订阅/注册用户收到3封邮件系列(Day 0-立即: 欢迎+核心价值一句话+下一步引导；Day 2: 用户案例或最佳入门内容+CTA；Day 5: "你试过了吗？"——基于用户是否完成关键行为的条件分支——已完成→进阶内容推荐；未完成→温和提醒+帮助入口)。（2）弃购挽回(Abandoned Cart)——用户加入购物车但未完成下单后触发3封邮件序列(Hour 1: "你的购物车还在等你"——含购物车直链+免运费/限时优惠；Hour 24: 社会证明——"X个人已购买了这个产品"+用户评价；Hour 72: "最后机会"——优惠即将过期+客服入口——可能是价格/尺寸/功能犹豫可协助)。关键设计：每封邮件的间隔和内容递进应预设并A/B测试，不能3封全是"快回来买吧"。(3) 沉睡用户唤醒(Re-engagement)——用户超过X天（按行业和平均购买周期设定——电商通常30-60天）未进行任何互动(打开邮件/登录/购买)。触发流程：Day X——"我们想念你"+过去时段内的产品更新/新功能+专属回归优惠；Day X+7——"你的账户还在吗"——明确告知如再无互动将停止发送邮件(尊重用户选择同时制造轻度紧迫感)；Day X+14——最终告别邮件+如用户仍未回应→移入"抑制列表"(Suppression List)不再触达(保护邮件发送信誉度——ISP会将持续发送给不互动用户视为垃圾邮件行为降低整体送达率)。(4) 订阅到期续费(Subscription Renewal)——SaaS/会员制业务在订阅到期前14/7/3/1天分别触发提醒邮件，内容从"提醒"(到期前14天)→"价值回顾"(前7天——你这半年通过使用我们的产品取得了什么成果)→"到期预警"(前3天——到期后你将失去哪些功能)→"最后一天"(前1天——续费入口+客服支持)。所有自动化邮件必须包含退订链接(邮件底部——CAN-SPAM Act和GDPR的法定要求)、个性化变量(收件人姓名/公司/最近互动内容——提高打开率和相关性)、发送时间优化(基于用户历史打开时间数据的Send Time Optimization)。',
        stage: 4,
        sourceRefs: [
          { layer: 'L1', sourceId: 'email-marketing-automation', section: 'workflow-design' },
        ],
        provenance: 'official',
      },
      {
        id: 'mk-ex-007',
        title: '线下活动执行',
        content:
          '线下营销活动——新品发布会/行业展会/快闪店/体验活动——的执行方案模板。1. 活动策划阶段：(a)活动目标与体验设计——参与者通过这次活动获得什么体验？活动后记住什么（Takeaway）？体验动线设计——从入场→签到→暖场→核心环节→互动→离场→后续跟进的全触点体验地图（Experience Journey Map）。(b)场地选择与布置——场地容量(目标人数×1.2留余量)、交通便利性(参与者到达的摩擦成本影响出席率)、场地技术条件(音响/灯光/LED屏幕/WiFi——提前1周全要素彩排)、布置风格与品牌调性一致。(c)供应商管理——搭建/AV/餐饮/安保/礼仪/摄影摄像各供应商的RFP(招标书)和合同管理、供应商备选方案(Plan B——如主要搭建商出问题时的替代方案)、供应商时间线与交付物清单。2. 活动执行阶段：(a)活动前24小时——全要素彩排(Full Rehearsal)走完整流程，包括PPT/视频/灯光/音响/主持人串词的合成。彩排中发现的问题即时修正，不可留到活动当天——活动当天只能执行不能彩排。(b)活动当天——Run Sheet(分秒级执行表)是唯一行动依据，每个工作人员知道自己每一分钟在什么位置做什么——不允许任何"即兴发挥"。预留30分钟/环节的Buffer以应对突发延迟。实时社交媒体发布(图文/短视频/直播)——现场发生的同时线上受众也在参与，专属活动Hashtag统一管理。(c)活动结束——立即(≤24h)向参与者发送感谢邮件/短信(感谢参与+活动回顾链接+后续行动CTA)、活动内容的长图文/精彩瞬间视频/演讲稿整理并发布到品牌官方渠道进行二次传播。3. 活动复盘：(a)定量：实际出席率vs计划、活动后1周/1月的品牌搜索量或网站流量变化、活动产生的媒体/社交曝光量、活动带来的销售线索数及最终转化率。(b)定性：参与者满意度调研(NPS或CSAT——活动后24h内发送，记忆最新鲜)、团队成员Debrief(活动结束后48h内——趁记忆新鲜)、供应商评价(是否继续合作或替换)。',
        stage: 4,
        sourceRefs: [{ layer: 'L1', sourceId: 'event-marketing', section: 'execution-playbook' }],
        provenance: 'official',
      },
      {
        id: 'mk-ex-008',
        title: '品牌联名合作',
        content:
          '品牌联名（Co-Branding/跨界合作）的策划与执行方案。1. 联名伙伴选择标准：(a)品牌调性兼容——两个品牌的价值观、受众层次、审美风格是否兼容而非冲突？"奢侈品牌×快餐品牌"可以产生反差惊喜，但需要双方有共识的艺术表达——否则一方受众觉得被"拉低了"、另一方觉得"太高冷"。(b)受众互补但非重叠——联名的商业目的是交叉获取对方受众，如果双方受众重叠率>70%——联名只是在现有受众中创造新鲜感而非扩展新市场，商业价值有限。(c)合作动机的双赢性——双方清晰地知道各自从联名中获得了什么(品牌A获得品牌B的年轻用户渗透、品牌B获得品牌A的高端背书)，单方面获利的联名合作不会长久。(d)法律和知识产权——联名产品/内容的IP归属、收益分成、使用期限和终止条款在合同中明确。2. 联名形式选择：产品联名(共同开发联名限定产品——如联名款包装/口味/设计)、内容联名(共同制作Campaign内容——如联名广告/短视频/播客/报告)、活动联名(共同举办线下/线上活动——如联名Pop-up快闪店/联名发布会)、会员权益联名(双方会员互通——如品牌A会员享受品牌B的专属折扣)、技术联名(底层技术整合——如"搭载了X技术的Y产品")。3. 联名排期与执行：(a)预热期——暗示/猜谜互动(让受众猜联名伙伴——联名宣布前制造期待感)、双方社交媒体同步预热。(b)发布期——联名产品/内容全渠道同步上线、双方渠道互相导流(互相在对方渠道发内容/直播)、联名引发的社交话题和媒体报道管理。(c)Post-Launch——联名限定的稀缺性管理(联名产品是否为限量——限量带来紧迫感但限制了商业规模)、联名的长期品牌影响评估(联名对各自品牌资产的净影响——是增强了品牌联想还是稀释了品牌独特性)。4. 联名的风险控制：一方出现公关危机时波及联名伙伴——在协议中约定危机情况下的合作中止和赔偿责任；联名产品引发消费者负面反应——如被指"圈钱联名"无诚意——提前进行消费者调研验证联名概念的接受度。',
        stage: 4,
        sourceRefs: [
          { layer: 'L1', sourceId: 'cobranding-strategy', section: 'partnership-framework' },
        ],
        provenance: 'official',
      },
    ],

    // ── checklists（检查清单）8 条 ──
    checklists: [
      {
        id: 'mk-cl-001',
        title: 'Campaign策划就绪检查清单',
        content:
          'Campaign策划阶段就绪标准（10项，全部通过方可进入执行阶段）。1. 商业目标清晰——Campaign的核心目标是否SMART化表述（如"上市后30天内实现10万新注册用户，CAC≤50元"），而非模糊表述（如"提升品牌知名度"）？目标是否可被衡量且与整体业务KPI（收入/用户增长/市场份额）有直接关联？2. 目标受众明确——受众是否已通过至少三维（人口统计/心理图/行为）完成细分和画像？是否有定量数据（市场规模/触达成本/购买力）支撑目标受众的选择？3. 核心信息与Big Idea——Campaign能否用"一句话"概括其核心信息（即"电梯测试"——15秒内向一个不知情的人解释清楚且能引发兴趣）？核心信息是否与品牌定位一致且对目标受众有相关性和差异化？4. 竞品分析——是否已完成竞品近期Campaign的复盘（信息/渠道/效果/消费者反应）？本Campaign在信息/形式/渠道上是否有明确与竞品的差异点？5. 预算与资源——预算是否已按渠道/阶段/物料拆分且预留≥10%的弹性余量？关键团队（创意/媒介/数据/执行/法务）是否已确认参与时间与排期？6. 时间线与里程碑——是否有从策划到复盘的全周期时间线？关键决策点（创意确认/物料完稿/媒介锁量/上线日）是否有明确的Owner和Deadline？7. 风险评估——是否识别了Top 3-5风险（创意延迟/竞品同期大Campaign挤压/渠道投放审核不通过/供应链无法支撑销量）？每个风险是否有缓解计划（Plan B）和触发条件（什么情况下启动Plan B）？8. 法务与合规预审——所有物料概念是否已通过法务/合规初步审查（广告法禁用词/行业特定规定/合作方IP使用授权）？是否确认了目标投放国家和地区的广告合规差异？9. 数据追踪基础设施——Campaign所有触达点的UTM参数体系是否已设计且统一？Conversion Tracking（Pixel/API/线下Code）是否已布设且测试通过？归因模型（首次/末次/线性/时间衰减/DDA）是否已选定且与Campaign目标一致？10. 干系人对齐——所有关键决策者（CMO/品牌负责人/销售负责人/产品负责人/法务）是否已Review并确认Campaign策略？是否有未解决的重大分歧？',
        stage: 1,
        sourceRefs: [
          { layer: 'L1', sourceId: 'campaign-planning', section: 'readiness-checklist' },
        ],
        provenance: 'official',
      },
      {
        id: 'mk-cl-002',
        title: '创意物料就绪检查清单',
        content:
          '创意物料在发布前的就绪标准（9项）。1. 品牌一致性——所有物料的Logo/色彩/字体/图像风格是否符合品牌规范手册？同一Campaign内的物料是否在视觉调性上统一（消费者能识别它们属于同一个Campaign）？"品牌印象测试"——将物料拿给不了解Campaign的同事看5秒后问他"这是哪个品牌的？"——答对率≥80%为达标。2. 信息准确性——产品名称/功能描述/价格/优惠条款/法律要求文字是否100%准确且与其他渠道（官网/电商详情页/客服话术）一致？"联系方式/下载链接/二维码"是否可正常使用？所有链接是否通过逐个点击测试？3. 多层次适配——是否针对不同渠道（信息流/TV/户外/社交媒体/电商）准备了适配的尺寸/格式/长度/信息密度？横版视频(16:9)和竖版视频(9:16)是否独立制作？4. 移动端优先——所有数字物料在移动端的显示效果是否优于或至少等于桌面端？文字大小/按钮位置/加载速度是否通过移动端体验测试？5. 多版本与动态素材——是否有至少3套创意变体可以进行A/B测试？对于程序化广告——是否已准备动态创意(Dynamic Creative)的模块化组件（不同标题+不同图片+不同CTA的组合矩阵）？6. 无障碍与包容性——图片是否有Alt Text(无障碍阅读——对屏幕阅读器用户友好)？视频是否有字幕（不仅是听障需求——大多数社交媒体用户在不方便开声音的场景下观看）？物料的种族/性别/年龄/体型代表是否多元包容而非单一刻板印象？7. 文件归档与版本管理——所有物料的最终版本是否已归档到DAM（数字资产管理）系统命名规范——Campaign名称_渠道_尺寸_语言_版本号_日期（如"Launch2026_Douyin_Feed_16x9_CN_v3_0725"）？历史版本是否保留（可追溯创意迭代过程）？8. 版权和许可——所有使用的字体/图片/音乐/视频素材是否拥有商业使用许可？合作方素材（KOL内容/联名品牌Logo/IP形象）的使用边界和期限是否已确认且合同覆盖？9. 内部预审——物料在正式投放前是否已由至少3人（创意负责人/品牌负责人/法务或合规）审核并书面确认？是否预留了修改和重新审查的时间（最少24小时）？',
        stage: 4,
        sourceRefs: [{ layer: 'L1', sourceId: 'creative-production', section: 'asset-readiness' }],
        provenance: 'official',
      },
      {
        id: 'mk-cl-003',
        title: '渠道配置就绪检查清单',
        content:
          '各营销渠道在Campaign上线前的配置就绪检查（10项——按平台逐个检查或按渠道类型统一检查）。1. 社交媒体平台——品牌官方账号是否可以正常登录和发布？是否有至少一个后备管理员账号（防止唯一管理员账号被封/丢失导致Campaign无法发布）？如果是首次使用某平台——账号是否已完成企业认证/蓝V认证且认证状态正常？2. 广告投放平台(巨量引擎/腾讯广告/Google Ads/Meta Ads)——广告账户余额是否充足（预留至少Campaign预算的120%以避免中途欠费暂停）？受众定向设置是否正确（排除已购买用户/内部员工/不相关地域）？竞价策略（oCPM/oCPC/Target CPA/Maximize Conversions）是否已设置且与Campaign目标匹配？3. 网站/落地页——Landing Page是否已部署且全部功能正常（表单提交/购买按钮/链接跳转/CDN缓存已刷新最新版本）？加载速度（LCP/FCP）是否在移动端/桌面端均达标？是否有独立的Tracking代码（Pixel/GTM）且事件触发测试通过？4. 邮件发送平台——邮件模板是否在多个邮件客户端（Gmail/Outlook/Apple Mail/QQ邮箱）和移动端呈现正常？所有链接是否已添加UTM参数且点击可正常跳转？是否设置了退订链接（法规要求）和发送频率控制——不在同一日向同一用户发送多封Campaign邮件？5. 电商平台——产品库存是否已确认可以支撑Campaign期间的预期销量（含超卖容错）？促销价格/优惠券/满减活动是否已在后台配置且正确关联到目标SKU？KA商家联系人和平台运营接口人是否已知Campaign排期并在Campaign期间可以紧急响应（如突发违规/图片审核不通过/价格错误）？6. KOL/达人——达人是否已确认发布排期和发布时间段（精确到小时——考虑粉丝活跃峰值）？达人发布的草稿是否已通过品牌方审稿且所有修改意见已落实？是否有达人备用方案（如主达人临时无法发布——≥1个备用达人已签合同或意向确认）？7. 程序化广告——DSP/SSP/Ad Exchange的出价和预算是否已配置？是否设置了频次上限（同一用户每日/每周/每月最多看到广告的次数）和投放时段限制？品牌安全设置（GARM框架类别排除/关键词排除/投放环境白名单/黑名单）是否已配置？8. CRM/SCRM——是否已清理和筛选了目标触达人群列表（去重/去无效/去已退订/去黑名单——发送前净化）？个性化变量（姓名/公司/最近购买产品等）的数据源是否准确且已测试渲染？自动化流程（Workflow）的触发条件和分支逻辑是否已测试？9. 线下/户外——物料是否已到达所有投放点位且安装/上刊完毕？各点位的亮灯/供电/维护状态是否已确认？点位周边是否有遮挡物或竞品"抢位"（如竞品在相邻点位投放更醒目广告）？10. 全渠道跨平台检查项——全渠道的UTM参数命名是否统一（utm_campaign/utm_source/utm_medium/utm_content/utm_term的一致性）、Campaign期间各平台的价格/时间/优惠条款是否跨平台同步一致——检查每个触达点看到的信息是否"同一Campaign"。',
        stage: 5,
        sourceRefs: [{ layer: 'L1', sourceId: 'campaign-execution', section: 'channel-readiness' }],
        provenance: 'official',
      },
      {
        id: 'mk-cl-004',
        title: '数据追踪就绪检查清单',
        content:
          'Campaign数据追踪基础设施就绪检查（10项——数据是评价Campaign成功与否的唯一客观依据，数据缺失等于盲飞）。1. UTM参数体系——所有可点链接（广告/邮件/KOL/社媒Bio/QR Code）是否带有统一的UTM参数（utm_source/utm_medium/utm_campaign必须——utm_content/utm_term推荐）？UTM命名规范是否统一（如utm_campaign=新品上市_2026Q3 而非 新品上市-2026Q3 或 2026Q3新品——命名不一致导致分析时无法按Campaign聚合）？2. 网站/App埋点——关键转化行为（注册/下单/加购/下载/表单提交/关键页面浏览）的Event Tracking是否已部署且实时数据流正常？是否有"验证埋点"的系统化测试流程（每个Event至少在UAT环境中触发一次并在数据分析平台即时验证——而非"应该没问题"的假设性上线）？3. 转化API(Conversion API)——除浏览器端Pixel外，服务器端Conversion API（Meta CAPI/Google Enhanced Conversions/TikTok Events API等）是否已部署——补充浏览器端因广告拦截器/Cookie限制/网络波动而丢失的转化数据？Conversion API发送的数据与Pixel数据是否有去重机制（使用同一event_id）？4. 归因窗口设置——各广告平台的归因窗口（Click-through Window/View-through Window）是否已统一或已记录差异以便分析时调整？移动App安装归因（MMP——AppsFlyer/Adjust/Branch等移动监测合作伙伴）的配置和链接是否正确？5. 数据看板就绪——是否已搭建Campaign期间的核心指标实时或准实时看板（至少包含——曝光/点击/CTR/CPC/CPM/转化量/CVR/CPA/ROAS）？看板是否有分渠道/分素材/分时段的钻取能力（deep dive）？6. A/B测试工具——是否已配置A/B测试工具（广告平台的Split Test/Landing Page的A/B Test/邮件A/B Test）和胜出标准（统计显著性和商业显著性的双重标准）？7. 欺诈/异常流量过滤——是否已启用广告平台的Invalid Click过滤？是否有第三方品牌安全/流量质量监测工具（IAS/DoubleVerify/MOAT等——视预算级别选择）？数据中出现异常（如某渠道的CTR突然暴涨/某地区的转化率异常高）时是否有预定义的检查流程？8. CRM/用户数据——CRM系统是否已准备好接收和正确处理Campaign带来的新线索（数据字段映射/自动分配/去重规则）？销售团队是否已被告知Campaign排期和预期线索量？9. 隐私合规数据追踪——CMP(Consent Management Platform)是否已正确配置且用户授权状态被技术栈（GTM/Pixel/Analytics）尊重？用户拒绝追踪后是否确实停止了追踪代码的加载（Cookie Scan工具验证）？敏感数据的加密和脱敏传输是否已部署？10. 数据备份与故障恢复——是否有单独的数据备份确保Campaign期间数据不丢失？如果追踪Pixels/API出现技术故障（如代码发布bug导致Event停止发送）——是否有监控告警（如连续15分钟无Event数据→告警）和回滚流程？',
        stage: 4,
        sourceRefs: [
          { layer: 'L1', sourceId: 'martech-data-foundation', section: 'tracking-readiness' },
        ],
        provenance: 'official',
      },
      {
        id: 'mk-cl-005',
        title: '上线前就绪检查清单',
        content:
          'Campaign上线前最后一小时的总检查清单（Go/No-Go Decisions的决策框架——任何一项不通过则推迟上线或启动Plan B）。1. "一票否决"项——以下任一为"否"则Go→No-Go：(a)所有渠道的最终物料是否已通过品牌负责人和法务的最终书面/系统审批？(b)是否所有面向用户的渠道（网站/App/小程序/落地页）经测试100%功能正常且没有严重Bug（页脚链接失效不算严重但价格显示错误算严重）？(c)Campaign涉及的核心支付/下单/注册流程是否在最近30分钟内测试通过（最后一次Sanity Check）？(d)是否有任何已知的、可能严重损害Campaign效果的未解决问题（如服务器负载预期不足、核心物料仍在审核中）？(e)是否所有有权"一键中止"Campaign的关键人（CMO/法务负责人/安全负责人）已知Campaign上线时间且联系畅通？2. "Go with Caution"项——以下有问题则"Go但加强监控"：(a)部分物料的某些尺寸版本尚未完成但非核心渠道——上线但优先补发？(b)某些渠道的定向设置在少量受众段出现预警（如受众规模过小）——先上线低预算尽快调整？(c)某些数据看板的历史数据加载有延迟但实时数据正常——确认不影响实时决策？3. 各渠道"最后开关"确认（逐一核对）：所有广告Campaign是否处于"Active"而非"Paused"状态？所有社交帖子是否已排期或已手动发布（而非留在草稿箱）？所有自动化邮件Workflow是否已激活（从"Paused"切换到"Active"）？电商平台的促销价格/库存/优惠券是否已生效且前端展示正确？4. 全天值班安排——Campaign上线后的第一个24小时是否有人员安排——至少一人负责全面监控、各渠道PM（或备份）可随时在线响应？是否有明确的"异常升级路径"（什么异常找什么人、什么情况升级到CMO——如价格显示错误/严重的负面舆情爆发/数据大量丢失或异常）？On-Call联系方式和时间表是否已共享到整个Campaign团队？5. 跨部门通知——Campaign上线是否已通知到所有需要知情的部门——客服/销售/供应链/产品/IT运维？各部门是否已知晓Campaign期间各自的职责和响应SLA？最后的同步消息——建议在统一的团队沟通渠道发布"XX Campaign 正式上线，祝我们好运!"——简单的仪式感拉升团队士气。',
        stage: 5,
        sourceRefs: [{ layer: 'L1', sourceId: 'campaign-launch', section: 'go-nogo-checklist' }],
        provenance: 'official',
      },
      {
        id: 'mk-cl-006',
        title: '投放中监控检查清单',
        content:
          'Campaign投放期间的日常监控检查清单（10项——每日清晨检查Day+1数据，投放期高频检查）。1. 核心KPI检查——昨日各渠道的实际CPM/CPC/CTR/CVR/CPA/ROI与计划的偏差是否在±20%以内？超过偏差阈值的渠道是否需要暂停或调整出价/受众/创意？2. 花费节奏——昨日花费是否与预期花费节奏一致（总预算/投放天数=日均预算——昨日花费是否在日均预算的80%-120%区间）？花费超速（花费>日均150%）——可能受众太宽或出价太高，可能需要立即调整；花费滞后（花费<日均50%）——可能受众太窄或出价太低或审核未通过。3. 素材疲劳度——各投放素材的频次（同一用户看到的平均次数）是否在阈值内（FB/IG≤3,TikTok≤4,Display≤5——不同平台阈值不同）？CTR是否随频次上升而下降（频次3的CTR/频次1的CTR<70%→对该人群切换新素材）？是否有新素材正在排队A/B测试以准备替换疲劳素材？4. 受众与频次分段——高价值受众（老客/网站访问者/Lookalike种子人群）的触达率是否达标？是否有受众段因过度触达（频次≥阈值）而被用户大量屏蔽/举报（查看渠道的Negative Feedback指标）？5. 落地页——Landing Page的加载速度/跳出率/停留时长/转化漏斗各步流失率是否在健康范围内？如果某个渠道或受众段的Landing Page数据显著劣于其他段——是否是Landing Page与该渠道/受众的信息不匹配（如广告强调"便宜"而落地页展示的是"高端"价格）？6. 电商/转化漏斗——各渠道引流的用户从"商品浏览→加购→创建订单→付款成功"的每一步转化率是否正常？加购率正常但付款率骤降——可能付款环节出错（支付失败/优惠券无法使用/页面Bug）。立即检查并修复。7. 网络舆情——品牌社交媒体评论/电商评价/客服反馈中是否出现了Campaign相关的负面集中投诉（如"广告虚假宣传"、"优惠券不能用"、"发货延迟"——消费者集中在某个问题上表达不满）？每小时或至少每4小时做一次舆情快速扫描——早发现早响应，避免负面舆情发酵成大危机。8. 第三方/联盟渠道——如果使用了联盟营销/第三方电商平台/分销商合作——各合作方的上线状态、费用执行情况和流量质量是否符合预期？是否有作弊流量（异常高的点击但零转化）？9. 竞争态势——竞品在同周期是否有大规模Campaign上线？是否有竞品针对本Campaign的"拦截投放"（竞品购买了本品牌搜索词）？是否需要调整竞价或创作反制素材？10. 记录每日状态——当天的主要数据和事件是否记录到Campaign日志（Google Docs/Notion/飞书多维表格）以便复盘时"重播"Campaign期间的全过程？Campaign日志的意义：复盘时看到的最终数据是"结果"，日志记录的是"过程"——从过程到结果的完整叙事是Campaign学习的最宝贵资产。',
        stage: 5,
        sourceRefs: [
          { layer: 'L1', sourceId: 'campaign-optimization', section: 'in-flight-monitoring' },
        ],
        provenance: 'official',
      },
      {
        id: 'mk-cl-007',
        title: 'Campaign复盘检查清单',
        content:
          'Campaign结束后完整复盘的标准化流程（11项）。1. 目标达成度——Campaign各项KPI的实际值vs目标值的达成率是多少？达成了哪些、未达成哪些？未达成的原因是可控制的（执行问题/决策偏差）还是不可控制的（市场变化/竞品突发动作/平台算法变更）？2. ROI核算——Campaign整体ROI（增量收入/Campaign总投入）和分渠道ROI分别是多少？ROI计算中是否采用了统一的归因模型？是否同时报告了不同归因模型下的ROI差异（如Last Click vs Multi-Touch的差异通常很大——展示差异本身就是洞察）？3. 渠道效率排名——各渠道按CPA/ROI/增量贡献的综合排名是什么？哪个渠道是"惊喜"（远超预期）？哪个渠道是"失望"（低于预期）？效率差异的原因是什么（受众匹配/素材适配/竞价环境/执行质量）？4. 素材效果排名——各素材的CTR/CVR/CPA排名？高效果素材的共性特征是什么（可以提炼为下次的创意原则）？低效果素材的失败原因是信息/视觉/受众错配//频率控制？5. 受众分析——触达人群的实际画像vs预设受众画像是否一致？是否有意料之外的"高价值人群段"被发现（如预期受众是25-35岁但实际转化最好的年龄段是36-45——数据告诉了我们什么）？6. 花费与预算——总花费vs预算的偏差是多少（超支/少花/持平）？是否有预算被浪费在效率极低的渠道或时段？时机（周几/几点/哪周）的转化效率最优和最差分别是什么？7. 数据质量——Campaign期间是否有数据追踪中断、数据丢失或数据异常？如果有——对ROI核算的影响有多大？如何防止下次再次发生？8. 消费者反馈——消费者在Campaign期间的直接反馈（社交评论/评价/NPS/客服工单）提炼出了哪些洞察？消费者对Campaign的"意想不到的解读或使用方式"是什么？是否有消费者UGC可以授权品牌二次使用？9. 竞品Benchmark——本Campaign的表现与已知的行业基准或竞品Campaign相比如何？我们做得更好的是哪些？更差的是哪些？市场份额是否因Campaign而变动？10. 团队协作评估——Campaign中的跨团队/跨部门协作顺畅度如何？沟通效率/响应速度/决策流程是否有值得改进的地方？有没有哪个环节总是"卡住"——指示流程或人员配置的瓶颈？11. 可复制经验——本次Campaign中发现的哪些成功策略可以标准化并复制到未来Campaign中（如某个受众定向策略/某个创意模式/某个投放节奏）？哪些错误是"永不再犯"级别的必须列入团队红线规则？复盘报告必须归档到组织知识库并纳入下一Campaign的策划参考资料——不重复造轮子、不重复犯同样的错误。',
        stage: 6,
        sourceRefs: [
          { layer: 'L1', sourceId: 'campaign-measurement', section: 'post-mortem-checklist' },
        ],
        provenance: 'official',
      },
      {
        id: 'mk-cl-008',
        title: '预算与合规检查清单',
        content:
          '营销预算管控与法律/平台合规的检查清单（10项——钱花在哪里必须清楚，法律红线不能碰）。1. 预算审批流程——Campaign预算是否已通过正式的预算审批流程（有审批记录和书面/系统确认）？是否在组织内部有唯一的预算归属和成本中心代码？2. 分渠道预算上限——每个渠道的预算是否设定了硬性上限（Hard Cap——防止某个渠道"跑飞"消耗掉其他渠道的预算）？是否在各投放平台上已设置了账户/广告系列预算上限？3. 合约与PO——与外部供应商/媒体/KOL/代理商的合同和采购订单（PO）是否已签署且明确约定了交付物、付款条件、验收标准和违约责任？合同中是否包含了"付款与业绩挂钩"条款（Performance-Based Payment——特别是KOL合作和效果类广告）？4. 预算追踪——是否有按日/按周追踪"实际花费vs计划花费"的机制和可视化看板？预算偏差超过±10%时是否有预警和审批流程（追加或削减预算）？5. 付款计划——所有外部供应商的付款计划（预付款/里程碑付款/尾款）与Campaign现金流出是否匹配？预付款比例是否在组织财务政策允许范围内（通常≤30%总合同额，少数行业惯例如大型户外媒体可能需要更高）？6. 广告法合规——所有物料文字和声称为何在广告法下可辩护（无"最""第一""唯一""国家级"等绝对化用语）？特殊行业（如保健品/化妆品/金融/酒类）是否有行业特定审批号和标明？7. 平台政策合规——各投放平台的广告审核政策是否已查阅且物料设计符合要求（如Facebook的"20%文字规则"虽已取消但图片文字过多的广告仍会被降权、抖音的"虚假夸大"判定标准）？8. 数据隐私合规——Campaign中收集的用户数据（表单/注册/购买）的存储、使用和共享是否符合PIPL/GDPR的法定要求？是否有数据保护影响评估（DPIA——如涉及敏感数据或大规模处理）？9. 素材版权合规——Campaign使用的字体（特别是商业字体如方正/汉仪/蒙纳——字库公司对未授权商用追责严格）、图片/插画/音乐/视频素材是否100%拥有商业使用授权（或为免版权素材——来源可查证）？KOL合作内容的品牌二次使用是不是已经写入合同？10. 合规文档归档——所有审批邮件/合同/License/合规确认是否已归档到中心化文档系统（不在个人电脑或邮件中——人员变动后新接手者无法找到）以备内部审计和外部监管查询？',
        stage: 5,
        sourceRefs: [
          { layer: 'L1', sourceId: 'marketing-compliance', section: 'budget-legal-checklist' },
        ],
        provenance: 'official',
      },
    ],

    // ── rubric（评分维度）8 个维度 ──
    rubric: [
      {
        id: 'mk-rub-001',
        title: '触达效果评估标准',
        content:
          '评估Campaign的触达效果——信息是否精准到达了目标受众。1分——受众触达宽泛而无效：频次分布极度不均（1%用户看到广告20次/99%用户从未看到）、TA浓度低（触达人群中目标受众占比<30%）、有效触达率（Reach@3+——触达频次≥3的有效用户占比）<20%、触达成本（CPM/CPV）高于行业基准50%+。典型表现：预算花完了但目标用户说"没看到"。3分——触达基本达到预期：TA浓度50-70%、有效触达率40-60%、分渠道受众匹配度尚可但有个别渠道的受众偏差较大、触达成本的渠道间差异可解释（高端渠道CPM高但受众质量更高）。典型表现：大部分渠道的受众定向发挥了作用但精准度有提升空间——如Lookalike Audience的种子人群不够优质导致相似人群也不够精准。5分——精准触达：TA浓度≥80%、有效触达率≥70%、通过增量测试验证触达确实是"增量"（触达组vs对照组的品牌认知度差异）、各渠道的触达数据和受众反馈（如广告互动/评论/分享中的受众自我描述）持续校准预设受众画像。评分要点：TA精准度（是否触达了想触达的人）、频次管理质量（既不过量也不不足）、触达效率（每触达一个目标用户的成本）。',
        stage: 6,
        sourceRefs: [
          { layer: 'L1', sourceId: 'campaign-measurement', section: 'reach-effectiveness-rubric' },
        ],
        provenance: 'official',
      },
      {
        id: 'mk-rub-002',
        title: '转化率评估标准',
        content:
          '评估Campaign从触达到期望行为（注册/下载/购买/留资）的转化效率。1分——转化漏斗严重泄露：整体转化率（CVR——从曝光到转化的比例）低于行业基准50%+、漏斗关键步骤的流失率高的环节悬而未决（如Landing Page跳出率>70%、加购-付款转化率<50%——大量用户在付款前放弃）、线索到成交的跟进周期超过1个月（B2B场景）且转化率<1%。典型表现：花了很多钱曝光和点击但最终转化为零星的——Campaign是"烟花"（亮一下就没了）。3分——转化漏斗有改善空间：整体CVR与行业基准持平或略低、漏斗的中段或后段有1-2个明确的漏点且已有优化假设、线索跟进流程存在但不够自动化仍依靠人工。典型表现：转化率还行但明显可以通过优化Landing Page/Checkout流程/邮件跟进提升10-20%。5分——转化漏斗高效且持续优化：整体CVR高于行业基准20%+、全漏斗各步骤的转化率和流失原因有数据支撑且定期Review、各受众段的转化率差异有明确洞察（什么特征的用户更容易转化——可用于优化获客定向）、A/B测试的优化节奏稳定（每月至少一个转化率优化实验并记录胜出经验）。评分要点：漏斗完整性（各步骤有数据）、转化率水平（与行业基准比较）、优化能力（转化率是否有持续的向上趋势）、支付/注册最终完成率（从意图到完成的最小摩擦）。',
        stage: 6,
        sourceRefs: [
          { layer: 'L1', sourceId: 'campaign-measurement', section: 'conversion-rubric' },
        ],
        provenance: 'official',
      },
      {
        id: 'mk-rub-003',
        title: '内容质量分评估标准',
        content:
          '评估Campaign产出的创意和内容的质量（超越数据的定性+定量综合评分）。1分——内容低劣：创意缺乏原创性（与竞品或行业通用模板高度雷同——"一看就知道是套模板"）、目标受众看到后无共鸣（大量"不感兴趣"或"举报"）、内容与品牌调性冲突或拉低品牌感知质量、物料有文字/设计/事实错误、视频内容完播率<15%（短视频）或<30%（中长视频）。典型表现：消费者在评论区说"又是广告"、"标题党"、"内容与广告不符"——内容信任度低。3分——内容合格但不出彩：创意有一定原创性和基本功（视觉质量可接受/文案通顺/信息正确）、目标受众的基本互动率在行业平均水平、完播率/分享率/正面评论占比在正常区间、但缺乏"惊喜感"和突破性创意——用户看到后不会主动分享给别人。典型表现：内容做得"正确"但没人记住——做完后自己看"是挺好的但就这样吧"。5分——内容卓越：创意具有独特性和突破性（行业内引发讨论"你看过XX品牌的Campaign了吗"——成为话题和案例）、目标受众的互动率/分享率/正面评论占比远超行业基准、完播率>60%（短视频）或>50%（中长视频——用户愿意花时间看完）、有UGC自发模仿/讨论/二次创作扩散Campaign概念——内容超越了品牌媒体变成用户自发的文化。评分要点：原创性（与行业通用模板的差异度）、共情力（受众是否有情感共鸣——不是"制作精良"就是好内容）、传播力（受众是否主动分享——分享率是最诚实的"内容好"投票）、品牌关联度（内容好但用户记不住是哪个品牌的——不是有效内容）。',
        stage: 6,
        sourceRefs: [
          { layer: 'L1', sourceId: 'creative-effectiveness', section: 'content-quality-rubric' },
        ],
        provenance: 'official',
      },
      {
        id: 'mk-rub-004',
        title: '品牌声量评估标准',
        content:
          '评估Campaign对品牌认知度/搜索量/媒体声量的提升——衡量"除了转化，Campaign为品牌资产积累了什么"。1分——品牌声量无提升或负提升：Campaign期间及后1个月的品牌搜索量（百度指数/微信指数/Google Trends）无变化或下降、社交媒体品牌提及量无增长或出现大量负面提及（负面/SOV负面声量份额>30%）、消费者品牌回忆测试的"无提示第一提及率"（Top-of-Mind Awareness）无变化或低于竞品。典型表现：Campaign像是在真空里发生——目标受众"对，我看到了一个广告但不记得是哪个品牌"（品牌关联度弱）。3分——品牌声量有中等提升：品牌搜索量提升20-50%但Campaign结束后迅速回落（"烟花效应"——没有持续的声量积累）、社交媒体正面提及有所增加但主要集中在品牌已有粉丝群（未有效"破圈"触达新人群）、Sentiment（消费者情感倾向——正面/中性/负面的比例）在正面方向有可观察的变化。典型表现：Campaign给品牌带来了一波关注但未能转化为持续的品牌资产积累。5分——品牌声量显著且持续提升：品牌搜索量在Campaign后1-3个月维持在高于Campaign前50%+的水平（不只是Campaign期间的短期脉冲——说明消费者记住了品牌并主动探索）、社交媒体品牌提及的增量来自品牌现有粉丝以外的新人群（破圈增长）、消费者品牌回忆测试的无提示提及率和品牌联想清晰度显著改善、品牌声量增长与其他品牌健康指标（NPS/复购率/推荐率）形成协同效应。评分要点：搜索量变化（最诚实的品牌兴趣指标——因为搜索行为是用户主动发起的）、提及量的人群来源（新人群vs已有粉丝——破圈能力的证明）、声量的持续性（脉冲vs积累——评估Campaign是"昙花一现"还是"品牌建设"）。',
        stage: 6,
        sourceRefs: [{ layer: 'L1', sourceId: 'brand-measurement', section: 'brand-lift-rubric' }],
        provenance: 'official',
      },
      {
        id: 'mk-rub-005',
        title: 'ROI效率评估标准',
        content:
          '评估营销投入的综合回报效率——不仅看"赚了多少"而是"每花一块钱赚回了几块钱"。1分——ROI为负或严重低于基准：Campaign整体ROI<1（投入多于回报——且不计品牌长期价值的贡献已为负）、大部分渠道ROI低于基准线且无法追溯到合理原因（如"战略投入"的目的确实不计较短期ROI但应有其他度量方式验证战略价值）、CAC（获客成本）远高于LTV（用户生命周期价值——CAC:LTV>1:1.5意味着获客在毁灭价值而非创造价值）。典型表现：钱花了但没有增长——收入和利润与不投广告时无显著差异。3分——ROI勉强达标：Campaign整体ROI在1-3区间（投入1元回报1-3元——算上运营成本可能刚打平或微利）、部分渠道ROI亮眼(>5)部分渠道严重拖后腿(<0.5)、CAC:LTV比值在可接受范围但无竞争优势（行业内竞品的CAC更低或LTV更高）。典型表现：Campaign能"打平"——不亏但也不足以支撑"加大投入"的决策。5分——ROI高效且可预测：Campaign整体ROI≥3（不同行业基准差异大——快消品3算优秀、奢侈品可能2就算好——应使用品类对标的相对标准而非绝对数字）、高效渠道的ROI可复制和可预测（"投入X元→产出Y元"的关系在不同时间/不同Campaign中相对稳定——可基于ROI预测做预算决策）、LTV:CAC比值≥3:1（每一元获客成本带来至少三元的用户生命周期价值——提供足够的安全边际）、ROI分析中包含了渠道协同效应和品牌长期价值的合理估计。评分要点：ROI绝对水平（vs行业基准）、可预测性（历史ROI的稳定性）、增量验证（是否通过增量测试——没有增量测试的ROI数字本质上是被自然转化夸大的）、品牌长期价值在ROI计量中的权重（品牌Campaign不能仅以短期ROI衡量）。',
        stage: 6,
        sourceRefs: [{ layer: 'L1', sourceId: 'marketing-roi', section: 'efficiency-rubric' }],
        provenance: 'official',
      },
      {
        id: 'mk-rub-006',
        title: '渠道协同度评估标准',
        content:
          '评估跨渠道营销的协同效果和各渠道之间的相互增强效应——"1+1>2"的程度。1分——渠道冲突大于协同：各渠道独立优化导致互相倾轧（搜索团队购买的关键词价格被展示广告团队推高——因为展示广告驱动了无效点击；电商大促价格在预热期就已泄漏并被竞品针对性降价）、消费者跨渠道体验碎片化、"助攻渠道"（Assisting Channels——辅助产生兴趣但非最终转化渠道）在归因模型中被严重低估导致预算被错误地砍掉。典型表现：每个渠道单独看"还行"，合在一起"不如分开"——内部竞争和内耗。3分——有基本协同但远未系统化：Campaign的核心信息和视觉在不同渠道基本一致（无明显冲突）、主要转化渠道的"助攻"来源有粗略数据（知道哪些渠道贡献了Assisted Conversion但未基于此数据进行预算调整）、有跨渠道沟通机制但不频繁或不够深入。典型表现：渠道间"不互相伤害"但也不互相加强——各自做各自的分内事。5分——渠道高度协同形成"飞轮"：某渠道的活动数据实时反馈到其他渠道的优化（如搜索引擎的实时热搜关键词→社交媒体内容的即时选题；电商的实时畅销产品→信息流广告投放的创意方向）、助攻渠道的贡献被量化且在预算分配中有明确权重（助攻力强的"种草渠道"即使直接转化低也被充足预算支撑）、消费者跨渠道体验无缝——从社媒→搜索→官网→电商的旅程中同一消费者在不同渠道被识别为同一人进行序列化沟通(Sequential Messaging)而非重复推送相同内容。评分要点：跨渠道数据打通程度、助攻渠道是否被合理估值和预算支持、消费者跨渠道体验一致性、渠道间是否存在系统性内部竞争和浪费。',
        stage: 6,
        sourceRefs: [{ layer: 'L1', sourceId: 'omnichannel-marketing', section: 'synergy-rubric' }],
        provenance: 'official',
      },
      {
        id: 'mk-rub-007',
        title: '创意创新度评估标准',
        content:
          '评估Campaign创意的创新水平——是否突破了"安全但无聊"的行业惯性创造了与众不同的消费者体验。1分——创意无创新：创意完全依赖行业惯例和"安全公式"（行业里已经做烂了的手法——标品广告=产品+模特+Logo+联系方式）、无任何实验性或突破性元素、创意创新的"风险预算"为零——品牌只做"已验证的安全方案"导致所有Campaign看着都跟竞品一样。典型表现：消费者根本分不清你的广告和竞品的广告有什么区别——"哦，又一个XX品牌在模仿YY品牌的Campaign"。3分——创意有某些创新点但不够大胆：在某些元素上（如视觉风格/互动形式/音乐/文案角度）有新颖尝试、核心创意概念（Big Idea）有一定原创性但执行时被"安全化"——创意者的最初概念被层层审批削平了棱角变成了半新不旧。典型表现：有些地方能让人"哦这个角度还不错"但整体不让人"哇"或"我要告诉别人"。5分——创意突破性创新：Big Idea本身是行业话题级——竞品和行业媒体开会讨论它、消费者主动参与/模仿/二创——Campaign超越品牌本身成为了文化现象或社会话题、创新不仅是在"表面的形式"（如用VR做广告）而是"形式服务于洞察"——创新让消费者对品牌的核心信息有了更深的感知和记忆。评分要点：原创性（是否别人没做过或没做好的）、消费者参与度（是否激发了用户的主动行为和传播）、创新与品牌核心信息的相关性（"为创新而创新"的猎奇不是好创新——创新服务于信息传达）、文化影响力（是否突破了广告圈进入了更广泛的消费者文化）。',
        stage: 6,
        sourceRefs: [
          { layer: 'L1', sourceId: 'creative-effectiveness', section: 'innovation-rubric' },
        ],
        provenance: 'official',
      },
      {
        id: 'mk-rub-008',
        title: '合规遵从度评估标准',
        content:
          '评估Campaign在法律、平台政策和品牌内部规范三个层面的合规表现——合规不是"创意杀手"而是品牌长青的基础保障。1分——存在严重合规问题或隐患：有广告法违规的明确风险（使用绝对化用语/虚假宣传/未标注广告标识的付费合作——任何一条被监管查处将导致罚款/下架/平台封禁）、实际已收到了平台违规警告或消费者正式投诉、数据隐私使用未经用户同意（PIPL/GDPR高度违规风险——可能面临营收4%或2千万欧元（取高者）的罚款）、合同或授权有重大漏洞（如使用了未授权商业字体/图片——可能面临字库公司维权诉讼）。典型表现：Campaign团队用"应该没问题"来回答合规问题——风险不可控。3分——基本合规但流程可加强：主要合规风险已覆盖（有法务审核材料/广告审核通过/用户数据收集有同意基础）、但合规检查依赖"个人意识"而非系统流程——如果负责检查的人疏忽则漏洞可能漏过、少数物料的版权或授权有"灰色地带"（如图片来自免费但来源不明的网站）、合规检查和归档不够规范——审计时找不全审批记录。典型表现：总的说"我们注意合规的"但细问流程经不起推敲。5分——合规体系完善且文化内化：所有物料有法务/合规的系统化审核节点和审批记录（不依赖人脑记忆）、合规自查制度定期更新（新法规/新平台政策一出即组织学习和自查）、全团队（不仅是法务/创意团队——包括媒介/执行/数据分析）有定期的合规培训和常见违规案例警示、Campaign审核流程自动化——系统检查并标记合规问题（而非纯人工逐字审查）、合规事件的应急响应计划完备——违规后多少小时内进行下架/修改/公开回应/监管沟通有明确流程。"合规=品牌声誉的底线"已成为团队的核心文化而非"法务的事"。评分要点：合规制度是否存在且系统化、流程的执行记录和可审计性、团队合规意识的普及度和培训频率、应急响应的速度（违规后的处理时效）。',
        stage: 6,
        sourceRefs: [
          { layer: 'L1', sourceId: 'marketing-compliance', section: 'compliance-maturity-rubric' },
        ],
        provenance: 'official',
      },
    ],
  },
}

const AGILE_PROJECT_MANAGEMENT_SEED: BuiltinSkillSeed = {
  skillKey: 'skill-pm-agile',
  name: '敏捷项目管理',
  version: '1.0.0',
  description:
    '敏捷项目管理领域专家Skill，涵盖Scrum框架、Kanban方法、用户故事、迭代规划、持续改进与团队协作的完整方法论体系',
  category: {
    primary: 'methodology',
    secondary: 'agile',
  },
  tags: ['敏捷', 'Scrum', 'Kanban', '迭代', '项目管理'],
  dependencies: [],
  activation: {
    projectTypes: ['Scrum', 'Kanban', '敏捷'],
    domains: ['agile', 'project_management'],
    priority: 90,
  },
  basePriority: 90,
  knowledge: {
    // ── rules（规则）8 条 ──
    rules: [
      {
        id: 'pm-agile-rule-001',
        title: 'INVEST原则——用户故事质量准则',
        content:
          '所有用户故事必须满足 INVEST 原则：Independent（独立——故事之间可独立开发与交付，减少依赖）；Negotiable（可协商——故事是对话的引子而非详细规格，细节在 Sprint 计划会中协商）；Valuable（有价值——每个故事对用户或干系人有明确可衡量的价值）；Estimable（可估算——团队能估算故事相对大小，若无法估算说明知识不足需做 Spike）；Small（小粒度——故事应在单个 Sprint 内可完成，过大的故事应拆分为更小粒度）；Testable（可测试——有明确的验收标准且可自动化验证）。违反 INVEST 的故事（如 Epic 级大故事直接进入 Sprint）应标记为未就绪并退回待办梳理。评审时逐个故事用 INVEST 维度打分，不达标不进入 Sprint。',
        stage: 1,
        sourceRefs: [{ layer: 'L1', sourceId: 'agile-practices', section: 'invest-principle' }],
        provenance: 'official',
      },
      {
        id: 'pm-agile-rule-002',
        title: '待办优先级与估算规则',
        content:
          '产品待办列表（Product Backlog）必须按优先级排序并持续梳理。优先级基于价值/风险/依赖/成本四维综合评定：价值（对用户/业务的直接贡献）权重最高，其次是风险（不早点做可能导致的损失）、依赖（阻塞其他任务的程度）、成本（估算故事点或理想人日）。估算必须使用相对估算（故事点/理想人日/T-Shirt Size）而非绝对工时——相对估算是团队对复杂度的共识表达，不是"需要多少天"的承诺。高优先级且大粒度的 Epic 应拆解为可在一个 Sprint 内完成的故事；低优先级的大粒度项可保留待拆。待办列表应满足 DEEP 原则：Detailed appropriately（恰当地详细）—高优先级项详细、低优先级项粗略；Estimated（已估算）；Emergent（涌现的）—随项目进展持续更新；Prioritized（已排序）。',
        stage: 1,
        sourceRefs: [{ layer: 'L1', sourceId: 'scrum-guide', section: 'product-backlog' }],
        provenance: 'official',
      },
      {
        id: 'pm-agile-rule-003',
        title: 'Sprint范围保护规则',
        content:
          'Sprint 目标一旦在 Sprint 计划会上达成共识，Sprint 范围内已承诺的待办项必须在 Sprint 期间受到保护——不得由外部干系人单方面增删改。Sprint 目标不变、Sprint 范围可变的前提：Product Owner 与开发团队协商一致（范围互换而非范围膨胀——用一个同规模未开始的任务换入替代一个待替换任务）。紧急变更（如生产事故/法规 deadline 突然提前）触发异常流程：中止当前 Sprint（极罕见——Scrum Guide 明确"只有 Sprint 目标变得过时"才可中止）并启动新的 Sprint 计划会。Sprint 中期（Day 5）评审范围健康度：若发现高优先级任务受阻而低优先级任务的工时可释放，由 Scrum Master 协调优先级互换但总点数不变。禁止行为：管理层在 Sprint 中期直接追加"紧急需求"绕过 PO 和团队——这摧毁 Sprint 承诺的可信度和团队士气。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'scrum-guide', section: 'sprint-backlog' }],
        provenance: 'official',
      },
      {
        id: 'pm-agile-rule-004',
        title: '每日站会三问规则',
        content:
          '每日站会（Daily Scrum）必须严格控制在 15 分钟内，每位团队成员回答三个问题：昨天我为 Sprint 目标做了什么（完成的、有进展的）？今天我将做什么以推动 Sprint 目标（具体的、可验证的行动）？我看到什么障碍（Impediment）阻碍了我或团队进度（技术瓶颈、外部依赖阻塞、缺少决策/信息、资源不足）？站会不是汇报会——是对齐、协调、暴露障碍的同步点。Scrum Master 的职责不是问这三问（团队成员互相沟通），而是确保站会发生（时间/地点/时长）并记录障碍到 Impediment Board——会后立即着手消除障碍（不是"Sprint 结束再说"）。站会期间不深入讨论技术方案（会后拉相关人单独沟通）、不解决问题（只暴露障碍）、不评估个人绩效。推荐同一时间同一地点（物理或虚拟）举行——仪式感降低认知负荷。分布式团队用 Slack 异步文字站会替代但效果打折扣——文字缺少语境和紧迫感，建议视频站会。',
        stage: 5,
        sourceRefs: [{ layer: 'L1', sourceId: 'scrum-guide', section: 'daily-scrum' }],
        provenance: 'official',
      },
      {
        id: 'pm-agile-rule-005',
        title: '完成定义（DoD）共识规则',
        content:
          '每个 Sprint 必须建立明确、可验证、团队共识的完成定义（Definition of Done），且所有增量在 Sprint 评审前必须满足 DoD。DoD 最低要求：代码通过代码评审（至少一人 Approve）、所有自动化测试（单元/集成/E2E）通过且覆盖率不降低、无新增 lint 警告或技术债（TODO-DEBT 有跟踪编号可追溯）、相关文档已更新（API 文档/架构图/ADR 如有变更）、Product Owner 已验收（功能行为符合验收标准）。DoD 是透明度机制——没有"90% 完成"（意味着有工作没做完但被认为做完了），未满足 DoD 的增量不得在 Sprint 评审中 Demo 为"完成"。DoD 应随时间演进——每个 Sprint 回顾会上评审 DoD 是否过时（如团队引入了新的测试类型应更新 DoD 纳入测试通过要求）。组织级 DoD 为基线，团队可在此基础上增加更严格的标准但不得放宽。',
        stage: 4,
        sourceRefs: [{ layer: 'L1', sourceId: 'scrum-guide', section: 'definition-of-done' }],
        provenance: 'official',
      },
      {
        id: 'pm-agile-rule-006',
        title: 'WIP限制规则——拉动非推动',
        content:
          '在制品（Work In Progress）限制是 Kanban 方法的核心实践：每个流程阶段必须设定 WIP 上限（如"开发中 ≤ 3 张卡片"、"测试中 ≤ 2 张卡片"），达到上限时团队停止拉取新工作而转向帮助瓶颈节点——拉动（pull）非推动（push）。WIP 限制的收益：减少多任务切换带来的认知损耗（每个人同时只做 1-2 件事）、暴露流程瓶颈（"测试"列拥堵说明测试是瓶颈——需增加测试资源或改进自动化）、缩短前置时间（Lead Time）——从"开始开发"到"交付上线"的周期更短因为等待队列更短。WIP 上限根据团队规模和并行能力设定：经验初始值 = 团队人数 × 1-1.5（如 5 人团队的开发 WIP ≤ 7），运营中根据 Little\‘s Law（平均周期时间 = WIP 数量 / 吞吐率）动态调整。WIP 限制对知识工作者有效——编程和测试需要深度注意力和不中断的心流状态，频繁切换摧毁效率。反模式：仅在 Kanban 板上写 WIP 限制但实际不遵守（"紧急就破例"——每次破例都是对规则的一次否定）。',
        stage: 5,
        sourceRefs: [{ layer: 'L1', sourceId: 'kanban-guide', section: 'wip-limits' }],
        provenance: 'official',
      },
      {
        id: 'pm-agile-rule-007',
        title: '故事点相对估算规则',
        content:
          '故事点估算必须使用相对值（比较两个故事 A vs B 哪个更大/更复杂/更不确定——而非绝对工时）。估算采用修正斐波那契数列（1, 2, 3, 5, 8, 13, 20, 40, 100）或 T-Shirt Size（XS, S, M, L, XL），基线故事为"团队最熟悉的简单故事 = 2 点"。规划扑克（Planning Poker）是标准估算技术：全员同时亮牌避免锚定效应、最大与最小估算者各陈述理由（发现知识不对称）、重新估算直到收敛（允许多轮但不超过 3 轮以避免分析瘫痪）。故事点不是工时（1 点 != 1 人日）——点是复杂度、不确定性和工作量的综合度量，不同团队的点不可比较（团队 A 的 5 点 != 团队 B 的 5 点）。估算的准确度不重要——重要的是共识（团队对工作量有共同理解）和相对一致性（Sprint 之间的点可比较趋势）。绝对不准的估算（如以小时计）同样不准反而更耗时——因为开发者对工时的估算偏差远大于相对估算。',
        stage: 1,
        sourceRefs: [{ layer: 'L1', sourceId: 'agile-estimation', section: 'story-points' }],
        provenance: 'official',
      },
      {
        id: 'pm-agile-rule-008',
        title: '持续集成规则',
        content:
          '每位开发者必须每天至少一次将代码变更合并到主干（trunk/main），每次合并触发自动化构建与全量测试——构建失败必须在 10 分钟内修复（否则回滚变更）。持续集成（CI）的核心价值：降低集成风险——频繁小批次合并比数周一次的大批次合并冲突少、问题定位快；加速反馈——提交后数分钟即知是否破坏构建；保持代码库始终可发布——主干上的 HEAD 应是可部署状态。CI 门禁必经步骤：lint（代码风格）/ typecheck（类型检查）/ build（编译产物无错误）/ test（全量自动化测试套件）/ security-scan（依赖漏洞扫描——至少检查 High/Critical）。CI 失败禁止合并到主干（block merge）——没有例外，没有"先合并 CI 失败明天修"。反模式：长生命周期分支（Feature Branch 存活 > 1 天）——合并时冲突地狱；CI 运行时间 > 10 分钟——超过阈值团队开始提交后不管不顾；跳过 CI（"就改了一行注释"——lint 也可能对新注释告警）。',
        stage: 5,
        sourceRefs: [
          { layer: 'L1', sourceId: 'agile-practices', section: 'continuous-integration' },
        ],
        provenance: 'official',
      },
    ],

    // ── patterns（模式）8 条 ──
    patterns: [
      {
        id: 'pm-agile-pat-001',
        title: 'Scrum框架——三角色·四事件·三工件',
        content:
          'Scrum 是轻量级框架，由三个角色、四个事件、三个工件构成。三角色：（1）Product Owner——最大化产品价值，管理产品待办列表（排序/梳理/沟通愿景），唯一有权决定待办优先级的人，在 Sprint 评审会确认"完成"；（2）Scrum Master——服务团队/PO/组织的仆人式领导者，确保 Scrum 被理解和实践，消除障碍，促进 Scrum 事件高效运行，无管理权但有影响力；（3）开发团队——自组织跨职能（3-9 人为佳），负责在每个 Sprint 交付"完成"的增量。四事件：（1）Sprint 计划会——Sprint 起点，时间盒 ≤ 8h（2 周 Sprint 减半至 4h），PO 讲目标和高优先级待办→团队选容量和拆任务→输出 Sprint 目标和 Sprint Backlog；（2）每日站会——≤ 15min，暴露障碍与对齐；（3）Sprint 评审会——≤ 4h，Demo 增量给干系人并收集反馈，更新待办列表；（4）Sprint 回顾会——≤ 3h，团队自查协作/工具/流程，产出 Top 1-3 改进行动项。三工件：（1）产品待办列表——所有需求的排序列表，PO 负责；（2）Sprint 待办列表——Sprint 内选定任务 + 交付 Sprint 目标的行动计划；（3）增量——Sprint 结束时的可交付物（满足 DoD）。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'scrum-guide', section: 'scrum-framework' }],
        provenance: 'official',
      },
      {
        id: 'pm-agile-pat-002',
        title: 'Kanban方法六项核心实践',
        content:
          'Kanban 方法是渐进的变革管理方法，六项核心实践：（1）可视化工作流——用看板（Kanban Board）映射现有工作流程，每列代表一个流程状态（如待办→分析→开发→测试→发布），卡片代表工作项（用户故事/任务/Bug）；（2）限制在制品（WIP）——每列设 WIP 上限，暴露瓶颈并防止过量负载（见 pm-agile-rule-006）；（3）管理流动——度量前置时间（Lead Time：从"请求到交付"）和周期时间（Cycle Time：从"开始工作到交付"），通过累积流图（Cumulative Flow Diagram——CFD）可视化 WIP/吞吐率/平均周期时间的趋势；（4）使流程策略显式化——将团队对"拉取标准"、"完成定义"、"阻塞处理"的共识写成明确文本（贴在物理看板旁或工具化）；（5）实施反馈环路——每日站会（看板前开）、服务交付评审（对每张卡片负责）、运营评审（数据驱动决定流程变更）；（6）协作改进、实验性演化——用科学方法（PDCA：Plan-Do-Check-Act）渐进改进，每次只改一件事并度量效果。Kanban 不要求现有 Scrum 角色和事件的改变——从现状出发渐进优化（"从你现在做的事情开始"）。适用于：运维/维护类工作、不适用固定 Sprint 节奏的项目、与 Scrum 混合为 Scrumban。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'kanban-guide', section: 'core-practices' }],
        provenance: 'official',
      },
      {
        id: 'pm-agile-pat-003',
        title: '用户故事地图——从用户旅程到发布计划',
        content:
          '用户故事地图（User Story Mapping）是将一维待办列表重构为二维地图以建立从用户视角到发布计划的全局视野。构建步骤：（1）定义用户活动的骨架——用户从头到尾的核心活动序列（如"注册→浏览商品→下单→支付→查看订单"），水平排列，每一活动是用户的宏观目标；（2）在每个骨架步骤下垂直排列用户任务——完成该活动所需的具体操作（如"下单"下列出"选择收货地址"、"选择支付方式"、"确认订单金额"），按优先级从上到下排列；（3）划分发布切片（Release Slice）——在地图上横向切出第一个 MVP 发布（包含每列最顶部的任务——最小可用集）、第二个发布（向下加一层）、第三个发布…依此类推；（4）识别依赖与风险——某列底部任务被早期发布需要（如"支付"需"信用卡验证"），则"信用卡验证"应上移。输出：优先级可见（上方高优先→先发布）、整体规划可追溯（为什么这个发布包含这些故事——因为要实现这个用户旅程片段）、范围谈判有依据（砍掉整个发布切片而非随机砍故事）。地图应贴在墙上/在线白板（Miro/Mural），全团队和干系人都看得见——物理性促进对齐。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'agile-practices', section: 'story-mapping' }],
        provenance: 'official',
      },
      {
        id: 'pm-agile-pat-004',
        title: 'MVP最小可行产品策略',
        content:
          'MVP（Minimum Viable Product）是最大化经证实的认知（Validated Learning）的最小增量——用最少的工作验证最大的假设。关键特质：不是"最粗糙的产品"而是"学习产品假设的最小实验"；必须有明确的验证假设（如"用户会为自动生成周报功能付费吗？"）和可测量的成功指标（如"7 天内 20% 用户点击了生成周报按钮"）；发布后测量数据决定 Pivot（转向）还是 Persevere（坚持）。MVP 切分方法：（1）按用户旅程切片——仅实现一个完整的端到端用户旅程而非实现所有功能的浅层；（2）按用户角色切片——先服务一个用户角色（如先做"管理员"再做"会员"）；（3）按人工替代切片——先用人工操作替代自动化（如人工审核替代 AI 自动审核）再逐步自动化；（4）按平台切片——先做一个平台（Web 先于移动端）验证核心价值。MVP 不是"先做一个烂版本以后再改"——那丢了 MVP 的学习目的：你无法从没人用的"烂版本"中学到任何东西。反模式：MVP 过于最小（无法验证任何假设——那是概念验证 PoC 不是 MVP）、MVP 无测量设计（做完了不知道从哪学）。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'agile-practices', section: 'mvp' }],
        provenance: 'official',
      },
      {
        id: 'pm-agile-pat-005',
        title: '时间盒（Timeboxing）模式',
        content:
          '时间盒是敏捷的核心约束机制：为活动设置固定的最大持续时间，时间到则必须停止并转到下一步——聚焦产出而非完美。Scrum 时间盒：Sprint ≤ 1 个月（常 1-2 周）、Sprint 计划会 ≤ 8h（2 周 Sprint 减半至 4h）、每日站会 ≤ 15min、Sprint 评审会 ≤ 4h、Sprint 回顾会 ≤ 3h。时间盒不是目标（不是"熬到时间到就下班"）而是约束——迫使团队在有限时间内做出优先级决策（"剩下的时间不够做全部——我们做最重要的"）。时间盒的力：防止帕金森定律（工作膨胀以填满可用时间）、促进频繁的决策点（每个时间盒结束交付可工作软件→获得反馈→调整方向）、降低浪费（一个 Sprint 方向错了最多浪费 2 周而非 6 个月）。时间盒的参数（长度/频率）应根据团队规模和项目阶段调整——创业探索期 Sprint 可以是 1 周（更快反馈）；成熟产品维护 Sprint 可以是 2 周。打破时间盒的代价（计划会拖到 2 天）远超"准备不充分"的代价——超时说明 Sprint 目标不清或待办未梳理，应在回顾会反思而非当下延长。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'scrum-guide', section: 'timeboxing' }],
        provenance: 'official',
      },
      {
        id: 'pm-agile-pat-006',
        title: '速率驱动迭代规划',
        content:
          '使用历史速率（Velocity）数据而非直觉来规划 Sprint 容量：速率 = 团队每个 Sprint 实际完成的故事点（过去 3-5 个 Sprint 的平均值，丢弃异常值——如含假期/大版本发布的 Sprint）。Yesterday\‘s Weather 规则：取最近 3 个 Sprint 完成点数的平均值（不是中位数——平均值对近期变化更敏感）作为下个 Sprint 的目标容量。速率规划步骤：（1）计算昨晚速率（平均完成点数）；（2）检查下 Sprint 的团队可用性（有人请假/培训/On-Call）调整容量百分比（5 人团队 1 人请假 1 周 → 容量 = 80% × 平均速率）；（3）从产品待办顶部按优先级取故事直到累计点数 = 调整后容量；（4）留 10% buffer 应对突发（干扰/依赖延迟/紧急 Bug）。速率不是考核指标——速率上升可能是故事点通胀或 DoD 注水（"完成"标准降低）、速率下降可能是代码复杂度增加或技术债累积——应根据回顾会定性分析而非数字直接奖惩。坏速率模式：锯齿形波动（Sprint A 超额→Sprint B 完成少→Sprint C 再超额——说明 Sprint 边界不清晰任务跨 Sprint）、单调递减（技术债累积使新功能越来越难加）。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'agile-metrics', section: 'velocity-planning' }],
        provenance: 'official',
      },
      {
        id: 'pm-agile-pat-007',
        title: 'Spike技术探索模式',
        content:
          'Spike 是时间盒限定的技术探索活动——用于获取足够信息以降低某项待办项的估算不确定性。两种类型：技术 Spike——研究某种技术方案是否可行（如"React Server Components 能支持我们的实时状态同步需求吗？"）；功能 Spike——通过原型验证用户是否接受某种交互方式（如"用户会用拖拽方式管理 WBS 层级吗"——做一个可交互原型给 3 个用户试用）。Spike 规则：必须有明确问题（"我能用 WebSocket 替代 HTTP Polling 吗"——不是"研究一下实时通信"）；必须有时间盒（≤ 1 天，如果 1 天无法回答说明问题太泛需拆分）；输出是信息而非可工作软件（"结论：WebSocket 可行，但需要额外基础设施——消息队列 + 连接状态管理，估算该功能复杂度为 8 点"——记录为 ADR 或 Spike 报告）；Spike 的点数不算入 Sprint 速率（Spike 不交付产品增量——它交付知识）。反模式：以"Spike"之名行无约束研究之实——没有时间盒的 Spike 是黑洞；每个 Sprint 都有大量 Spike——说明团队缺乏技术方向或不敢做决策，应由技术 Lead 或架构评审承担技术选型责任。',
        stage: 4,
        sourceRefs: [{ layer: 'L1', sourceId: 'agile-practices', section: 'spikes' }],
        provenance: 'official',
      },
      {
        id: 'pm-agile-pat-008',
        title: '回顾会双循环模式——PRIME',
        content:
          '回顾会（Sprint Retrospective）采用 PRIME 双循环结构确保不止发现问题更产出行动。外循环（设定方向——5-10min）：回顾上次回顾会的行动项完成情况（完成率 < 50% 说明行动项太大/太模糊/没人负责——先修复这个）。内循环（发现问题与行动——50-70min）：（1）P——Prime Directive 开场："无论我们发现了什么，我们理解并真诚相信每个人都尽力在当前的知识/技能/资源/状况下做到了最好。"——建立心理安全；（2）R——收集数据：用时间轴/心情曲线/海星图（Start Doing/Stop Doing/Keep Doing/More of/Less of）可视化 Sprint 中的事件与感受——客观事件（哪天部署失败/哪天需求变了）和主观感受（哪天士气低迷/哪天协作顺畅）同样重要；（3）I——生成洞见：对数据模式提问"为什么部署在 Sprint 末密集发生？"→ 收敛到 2-3 个根因——用 5 Whys 或鱼骨图辅助。模式识别：若连续三个 Sprint 出现同一类问题说明回顾会没有产生有效行动——排除行动（无负责人/无 deadline/太模糊）；（4）M——决定行动：产出 ≤ 3 个 SMART 行动项（Specific 具体动作、Measurable 可度量完成、Achievable 当前 Sprint 可完成、Relevant 与根因直接相关、Time-bound 有明确截止日）——行动项纳入下个 Sprint 的 Sprint Backlog 作为任务。E——结束收尾：回顾回顾会本身——本次回顾会有效吗（1-5 分）？下次如何改进回顾会？',
        stage: 6,
        sourceRefs: [{ layer: 'L1', sourceId: 'agile-practices', section: 'retrospectives' }],
        provenance: 'official',
      },
    ],

    // ── antiPatterns（反模式）8 条 ──
    antiPatterns: [
      {
        id: 'pm-agile-ant-001',
        title: 'Sprint范围扩张——承诺蜕变为建议',
        content:
          'Sprint 中期被外部干系人（管理层/大客户/其他部门 Leader）以"紧急/战略需要"为由不断追加任务至 Sprint Backlog，导致 Sprint 目标从"承诺"退化为"我们可以试试"的建议。症状：Sprint 计划时的 30 故事点到 Day 3 膨胀为 45 点——团队加班但 Sprint 永远完不成、Sprint 评审会变成"我们做了哪些但还有更多没做"的道歉会、团队学会"预留 30% 容量给未知突击任务"实际废掉了速率规划的有效性。根因：PO 没有权力或没有意愿说"不"（或者 PO 认为自己只是"需求传声筒"而非价值仲裁者）、管理层未受过 Scrum 培训不理解 Sprint 承诺的价值。伤害：团队士气崩溃（永远在做"别人的紧急"而非自己的 Sprint 目标——丧失自主感）、速率无法参考（因为 Sprint 范围不再固定）、预测性归零（发布日期永远不知道——延迟常态化）。纠正方法：PO 成为单一需求入口——所有需求必须先到 PO 评估价值/紧急度/与 Sprint 目标的关系；紧急需求走异常流程（Sprint 中止或范围互换——见 pm-agile-rule-003）；站会时公开可视化 Sprint 范围变更次数与来源——透明让"施压者"的施压可见。',
        stage: 2,
        sourceRefs: [{ layer: 'L1', sourceId: 'scrum-guide', section: 'anti-patterns' }],
        provenance: 'official',
      },
      {
        id: 'pm-agile-ant-002',
        title: '站会退化——从对齐到汇报',
        content:
          '每日站会从团队协同同步退化为"每个人向 Scrum Master / Tech Lead / Manager 汇报昨日工作"——站会变成微管理工具而非自组织团队的同步仪式。症状：团队成员眼睛只看 Scrum Master（不互相说话）、昨天做了什么 + 今天要做什么说完即沉默（不问同伴是否需要帮助）、障碍在没有主动暴露的情况下不被提起（"说了他们也帮不上"）、Scrum Master 或 Manager 在站会中逐一点评和指派任务（"张三你今天帮李四把这个 Bug 修了"——摧毁自组织）、站会超过 15 分钟因为"每个汇报都有追问和点评"。根因：Scrum Master 和团队未理解站会是"开发团队的同步对齐"而非"管理者获取状态"——传统命令-控制式管理文化渗透进敏捷仪式。纠正方法：Scrum Master 退到边缘（站会时间到了就说"到时间了"）不主动追问；团队成员面向彼此说话；站会后 Scrum Master 一对一跟进未暴露障碍的沉默成员（建立心理安全）；Coach 管理者"如果你想了解状态——来看 Sprint Backlog / 燃尽图 / 看板，数字比口头汇报准确"；极端情况——Scrum Master 不对团队说一句话（只计时）让团队自己跑通 3 问。',
        stage: 2,
        sourceRefs: [{ layer: 'L1', sourceId: 'scrum-guide', section: 'anti-patterns' }],
        provenance: 'official',
      },
      {
        id: 'pm-agile-ant-003',
        title: 'Product Owner缺席——需求真空',
        content:
          'Product Owner 以"太忙/同时管 5 个产品/不懂技术"为由长期缺席 Sprint 计划会/评审会/日常待办梳理，导致团队在需求真空中工作。症状：Sprint 计划会没人能讲"这个 Sprint 我们为什么做这些——目标是什么"（PO 没来只有 BA 或者干脆团队自己选）、站会中开发者在互相追问"这个验收标准是谁写的——PO 确认过吗"（PO 从未看过）、Sprint 评审会 PO 缺席或最后 5 分钟进来看了个 Demo 说"这不是我想要的"（没有 Sprint 中途的持续反馈）、待办列表超过 3 个月未梳理——顶部故事是 3 个月前写的且验收标准是开发者补的。伤害：开发方向靠猜——做出来的不符合干系人期望导致返工、团队失去"为什么而做"的动机（使命感缺失）、待办列表腐烂——Sprint 计划会花一半时间在现场梳理待办（因为 PO 没提前做）。纠正方法：PO 的参与度作为 Sprint 健康度量（PO 出席 Sprint 计划会和评审会率 < 80% → 触发 Scrum Master 升级给管理层）；如组织确实无法配置专职 PO——PO 代理模式（BA 或 Tech Lead 充当日常 PO 但重大优先级决策必须 PO 审批）、但至少保证 Sprint 评审会 PO 在场（干系人反馈的第一手获取者）。',
        stage: 2,
        sourceRefs: [{ layer: 'L1', sourceId: 'scrum-guide', section: 'product-owner' }],
        provenance: 'official',
      },
      {
        id: 'pm-agile-ant-004',
        title: '估算当承诺——故事点通货膨胀',
        content:
          '将故事点估算当作交付承诺或绩效考核指标——"这个 Sprint 你们估了 40 点所以必须完成 40 点"或"李四每个 Sprint 才完成 8 点，张三能完成 15 点——张三更高效"。症状：故事点通胀——团队学会"之前类似故事估 3 点现在估 5 点"因为点数被用于变相 KPI、Sprint 计划会讨论焦点从"这个故事的验收标准是什么 / 有没有遗漏的依赖"变成"这个估 5 还是 8？快决定别拖会"、团队只挑低复杂度高点数故事——计算"点数投资回报率"而非按优先级做。根因：管理层/PO 不理解故事点的相对性——"数字不绝对但为何不追求绝对准确？"；组织 KPI 文化——总得有个指标衡量"生产力"没故事点就没人天数反之亦然。伤害：估算失去意义——点数不再反映复杂度只反映"虚拟绩效"、有价值但难估算的故事被团队规避（宁可做 3 个 2 点简单故事不做 1 个 8 点复杂故事——尽管后者对客户价值更高）、故事点跨团队比较完全不可行但管理者仍试图——造成不公和团队间恶性竞赛。纠正方法：故事点数据只在团队内部使用且不关联绩效考核；用定性指标（Sprint 目标达成 / 干系人满意度 / 市场指标增长）替代定量指标衡量团队产出；Scrum Master 作为保护者——如有管理者试图用故事点做考核，Scrum Master 应一对一解释并阻挡。',
        stage: 2,
        sourceRefs: [{ layer: 'L1', sourceId: 'agile-estimation', section: 'anti-patterns' }],
        provenance: 'official',
      },
      {
        id: 'pm-agile-ant-005',
        title: '无WIP限制——瀑布式Kanban',
        content:
          '看板有列有卡片但无 WIP 限制或 WIP 限制设得太大形同虚设——团队仍然把工作"推动"到下一列而非"拉取"下一项。症状："开发中"列始终有 10+ 张卡片（团队才 5 人——意味着每人同时做 ≥ 2 个任务且不止）、"测试中"列堆积 8 张卡片但"发布"列 0 张——瓶颈在测试但没人去帮忙测试因为"开发列还有任务"、前置时间不可预测——卡在"A 开发 1 天后在 B 列排队等 Code Review 3 天然后排队等测试 5 天（真正工作时间才占周期的 10%——等待占 90%）。根因：团队和 PO 习惯"启动越多工作越安全"心理模式——因为"不启动万一有空闲怎么办"；管理者喜欢看"每个人都忙"的画面——人忙但工作流动慢。伤害：每个任务的实际完成周期从 2 天膨胀到 2 周——交付速度比看似慢的团队（WIP 限制严格、每时只做 1 件）反而更慢；多任务并行导致认知超载——程序员的短期记忆容量有限，同时维护 3-4 个上下文错误率急剧升高；瓶颈无法暴露——因为 WIP 没上限你永远不知道"正常"是什么样。纠正方法：将 WIP 限制设为当前实际在制品数量的一半——强制体验限制感知；站会花 1 分钟看 WIP 超标情况（谁有多张卡可以释放给队友帮助）；每天在 CFD 上标注 WIP 与前置时间关系——让数据说话。',
        stage: 2,
        sourceRefs: [{ layer: 'L1', sourceId: 'kanban-guide', section: 'anti-patterns' }],
        provenance: 'official',
      },
      {
        id: 'pm-agile-ant-006',
        title: '回顾会无行动项——只抱怨不改进',
        content:
          '回顾会产生大量情绪与观察但最终无具体行动项或行动项形同虚设（没人负责/无 deadline/太模糊如"加强沟通"）。症状：连续 3 次回顾会讨论同一个问题（说明上次行动没执行或无效——但团队未追究为什么）；团队对回顾会逐渐失去兴趣（"说来说去也没什么变化"——回顾会参与度下降、时间越来越短、最后变成走过场）；行动项被记录在便利贴上再也没人看第二次——回顾会结束时"下次再改进"而下次重复同样模式。根因：团队缺乏回顾后的执行问责机制——Scrum Master 没有把行动项放入 Sprint Backlog（或者放入了但优先级排在所有"真正"任务之后从不被做）；行动项过大（"改善代码质量"——无法在一个 Sprint 内执行）、无负责人（"团队"作为负责人 = 没有人是负责人）、无度量（"沟通改善了"——无法验证是否真的改善）。伤害：团队失去持续改进的能力——不进则退、问题累积到爆发（离职/重大事故）才被重视；心理安全被侵蚀——团队觉得"说了也没用何必说"安全感降低。纠正方法：SMART 行动项（见 pm-agile-pat-008 PRIME 模式）、下一 Sprint 计划会首先检查上 Sprint 的行动项完成情况（计为 Sprint 容量的 5-10%——正式分配容量给改进）、回顾会上公开跟踪行动项趋势——完成率 < 50% 触发"行动项有效性"讨论。',
        stage: 2,
        sourceRefs: [
          { layer: 'L1', sourceId: 'agile-practices', section: 'retrospective-anti-patterns' },
        ],
        provenance: 'official',
      },
      {
        id: 'pm-agile-ant-007',
        title: '文档驱动——重文档轻软件的反敏捷',
        content:
          '组织要求在代码编写前先产出一整套详细的需求规格书（PRD 30-50 页含所有 UI 截图）、技术设计文档（含所有类图和时序图）、测试计划文档——且这些文档须"审批签字"后才能开始开发。这就是"敏捷的皮囊 + 瀑布的灵魂"。症状：Sprint 0 或 Sprint 前（"准备阶段"）耗时 2-4 周写文档无人写代码——迭代开发变成"先分析→再设计→再实现→再测试"的瀑布阶段在 Sprint 名下的伪装；需求文档一旦"签字"后变更极其困难（因为文档的"签字"心理暗示"已讨论清楚不能改"）——违背"欢迎需求变更哪怕是开发后期"的敏捷原则。伤害：文档与代码分离——写完文档后开发过程中发现的细节不会反哺到文档（文档成为一次性合规产出而非活的资产）；团队大部分时间在写和维护文档而非交付可工作软件——文档的阅读者是未来的"审计人员"而非开发团队自己。纠正方法：区分"共享文档"（为团队自己建立共识——白板/便利贴/用户故事地图——轻量活文档）和"合规文档"（为外部审计/法律合规——确有需要时再写）——不要把合规要求当日常工作方式；文档与代码同步——API 文档由 OpenAPI 自动生成、架构图由 C4 PlantUML 从注释生成——文档活在代码仓库中随代码演进；需求文档采用活文档（Living Documentation）——验收标准可自动化的自动化、业务规则直接体现在 BDD 测试中。',
        stage: 2,
        sourceRefs: [
          {
            layer: 'L1',
            sourceId: 'agile-manifesto',
            section: 'working-software-over-documentation',
          },
        ],
        provenance: 'official',
      },
      {
        id: 'pm-agile-ant-008',
        title: '速率作考核——度量驱动行为扭曲',
        content:
          '组织将 Sprint 速率（Velocity）或"完成故事点数"作为团队的 KPI/OKR 考核指标——直接或间接地（奖金/晋升/年终评级与此挂钩）。这是敏捷度量中最有害的反模式——因为任何被当成目标的度量都会失效（Goodhart\‘s Law：当一个度量成为目标，它就不再是好的度量）。必然的行为扭曲：故事点通胀（同样的工作估的越来越多——见 pm-agile-ant-004）、DoD 注水（降低"完成"标准——代码评审变成"你看过了吗？嗯。Approved"、自动化测试覆盖率门禁被"先合并 CI 明天修"绕过）、拒接高风险高价值工作（新型复杂功能被团队规避——因为影响速率稳定性）、团队间恶性竞赛（A 团队 50 点 vs B 团队 30 点——A 得分高但实际交付价值可能更低（故事点虚高））。伤害：故事点作为规划工具完全失效（管理者和团队都失去对速率的信任——但管理者仍忍不住参考"高速率"团队）；伤害心理安全——团队不信任管理层使用速率数据的方式，开始"游戏化"度量系统；长期：优秀开发者离开（厌恶在考核性度量下工作）留下的是"擅长玩数字"的人。纠正方法：速率仅用于团队内部规划，不向管理层报告原始数字（或报告但脱敏——"团队容量趋势向上/向下"而非具体数字）；对管理层的敏捷度量改为交付价值度量（Feature 使用率 / 客户满意度 / 市场响应速度 / 缺陷逃逸率）——这些度量不会被游戏化；明确声明（最好在 Scrum 培训和员工手册中）：故事点数据永不被用于个人或团队绩效考核。',
        stage: 2,
        sourceRefs: [{ layer: 'L1', sourceId: 'agile-metrics', section: 'anti-patterns' }],
        provenance: 'official',
      },
    ],

    // ── examples（示例）8 条 ──
    examples: [
      {
        id: 'pm-agile-exa-001',
        title: '用户故事标准模板与反例',
        content:
          '用户故事标准格式："作为<用户角色>，我希望<功能>，以便<价值/目的>"。完整示例——故事："作为项目管理员，我希望按 Sprint 拖拽 Story 卡片到看板不同泳道，以便在 Sprint 评审会前 5 分钟内快速调整展示顺序让 Demo 更流畅。" 验收标准（Given-When-Then）：Given Sprint 2 的看板中有 15 张卡片分布在待办/开发/测试/完成四列；When 管理员将"用户认证"卡片从待办列拖拽到测试列；Then 卡片出现在测试列第一位、前端通知后端更新卡片状态（乐观更新 + 失败回滚）、其他团队成员看板同步响应 ≤ 2s。反例（坏故事）："做一个看板"——无用户角色（谁用？管理员还是所有团队成员？）、无价值描述（为什么要做？）、无验收标准（什么算做好？）、不可估算（"看板"是 Epic 应拆解为拖拽/筛选/泳道/实时同步等独立故事）。',
        stage: 1,
        sourceRefs: [{ layer: 'L1', sourceId: 'agile-practices', section: 'user-stories' }],
        provenance: 'official',
      },
      {
        id: 'pm-agile-exa-002',
        title: 'Given-When-Then验收标准编写指南',
        content:
          'Given-When-Then 格式是 BDD（行为驱动开发）的核心表达形式——验收标准应该由 Product Owner、测试人员和开发者协作编写。"用户故事优先级排序"功能验收标准示例。场景 1——正常流程：Given 产品待办列表中有 20 个故事且各有故事点估算（1/2/3/5/8/13）和业务价值分（1-10）；When PO 打开排序面板（拖拽界面——不输入数字）；Then PO 可将"用户认证"（8 点/价值 9）拖拽到第一位、"统计报表"（13 点/价值 6）拖到第 15 位、拖拽释放后排序立即保存且列表刷新（≤ 500ms）、排序变更记录到审计日志（操作人/时间/IP）。场景 2——边界条件：Given 待办列表仅 1 个故事；When PO 打开排序面板；Then 该故事不可拖拽（灰色显示 + tooltip"至少 2 个故事才支持排序"）。场景 3——异常处理：Given 待办列表 10 个故事；When PO 拖拽故事到第 5 位期间网络断开；Then 前端显示"保存失败，请检查网络连接"Snackbar、排序回滚到拖拽前状态、故事高亮恢复原位置。场景 4——并发冲突：Given PO A 正在排序面板调整顺序、同时 PO B（多 PO 场景，极少见但不排除）修改了故事 3 的标题；When PO A 完成排序保存；Then 后端检测到乐观锁版本冲突→返回 409 Conflict（告知排序已基于旧数据——刷新列表后重新排序）。',
        stage: 1,
        sourceRefs: [{ layer: 'L1', sourceId: 'agile-practices', section: 'acceptance-criteria' }],
        provenance: 'official',
      },
      {
        id: 'pm-agile-exa-003',
        title: 'Sprint计划会示例——电商平台Sprint 3',
        content:
          'Sprint 计划会完整流程示例。背景：电商平台项目、第 3 个 Sprint（团队 Velocity 前两个 Sprint 为 28 点和 32 点——平均 30 点）、5 人开发团队 2 周 Sprint（10 个工作日）。Sprint 目标（PO 在计划会前已准备好）——"完成用户订单详情页与物流追踪 MVP：用户可在订单详情页查看订单状态时间轴、物流单号和地图追踪——支撑客服团队即将上线的订单查询功能"。可用容量：5 人 × 10 天 - 1 人请假 2 天 = 48 人天 × 6 有效工时 = 288 小时，扣 Sprint 会议（计划会 4h + 站会 7.5h + 评审 2h + 回顾 2h = 15.5h × 5 人 = 77.5h），净可用 ≈ 210h，按 Yesterday\‘s Weather 平均速率 30 点选故事。待办选择（按优先级）：S3-1——订单详情页 UI（5 点）含订单基本信息/商品列表/金额汇总/操作按钮（退款/开发票）；S3-2——订单状态时间轴组件（3 点——已有通用时间轴组件可复用）；S3-3——物流单号对接（5 点——对接第三方物流 API + 适配层 + 错误降级）；S3-4——地图物流追踪（8 点——集成地图 SDK、实时位置轮询、路径动画）；S3-5——客服订单查询入口（3 点——订单号搜索 + 近期订单列表）；S3-6——订单状态变更 Webhook 通知（3 点——后端状态变更→Websocket 推送客服端更新）；S3-7——E2E 测试（3 点——覆盖订单查询/物流追踪/Webhook 推送核心流程）。总计 30 点。不在 Sprint：订单退款流程（8 点——依赖第三方支付退款 API 尚在商务谈判中）、发票开具（5 点——依赖税务系统 API 下月上线）。风险：物流 API 对接文档周二才提供（缓解：S3-4 先做 UI 和模拟数据——周三 API 到后再接真实数据）。',
        stage: 1,
        sourceRefs: [{ layer: 'L1', sourceId: 'scrum-guide', section: 'sprint-planning' }],
        provenance: 'official',
      },
      {
        id: 'pm-agile-exa-004',
        title: '产品待办梳理（Backlog Refinement）示例',
        content:
          '待办梳理会（Product Backlog Refinement）——Sprint 中每周进行 1-2h 的持续活动（不是 Sprint 事件而是持续行为）。示例：电商平台 Sprint 3 第 5 天待办梳理。步骤 1——检查顶部待办就绪度（下个 Sprint 候选故事）：PO 逐条评估"这个故事放在下个 Sprint 是否有足够信息让团队估算和执行？"——找出信息不足的故事（如"退款流程——仅写了标题无验收标准"）标记为"需 PO 补充验收标准（周三前）"。步骤 2——拆解大粒度故事：Epic"用户评价系统"过大（PO 估计 > 40 点）拆分为——E1（8 点——评价 UI：星级评分 + 文字输入 + 图片上传）、E2（5 点——评价展示：列表 + 筛选 + 排序）、E3（3 点——评价审核：敏感词过滤 + 人工审核队列）、E4（5 点——评价激励：评价送积分——依赖积分系统）。排列优先级：E1 下 Sprint 做、E2 第三个 Sprint、E3 和 E4 排后。步骤 3——更新估算：团队对顶部故事做规划扑克（非正式——快速多轮 ≤ 1min 每故事）——故事"物流追踪地图"从 5 点上调至 8 点（因为发现地图 SDK 无内置路径动画需自己实现贝塞尔曲线）。步骤 4——识别依赖与技术风险：故事"订单退款"依赖第三方支付 API——API 对接文档预计 10 天后提供→标记风险并记录在 Sprint 风险登记册。输出：就绪的下个 Sprint 候选故事清单 + 待 PO 补充信息的故事 + 新增依赖与风险。注意：待办梳理会不是 Sprint 计划会——不承诺范围、不讨论实现方案细节、不分配任务、不限时长（但通常 ≤ 2h——超过说明待办质量太差需要 PO 深度工作)。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'scrum-guide', section: 'backlog-refinement' }],
        provenance: 'official',
      },
      {
        id: 'pm-agile-exa-005',
        title: '燃尽图（Burndown Chart）实战读法',
        content:
          'Sprint 燃尽图横轴为 Sprint 工作日（1-10），纵轴为剩余故事点（从 Sprint 总点数开始）。理想线：从 (0, 总点数) 到 (10, 0) 的直线。实例：Sprint 3（总 30 点）。Day 1-2——实际线高于理想线（剩余 28→25 点未变化而理想线已降至 24）——因为团队在 Day 1 上午开 Sprint 计划会未产出、Day 2 才统一环境（正常启动慢）。Day 3-6——实际线贴近理想线但略高于它（剩余 22→12 点 vs 理想 21→12）——稳态产出良好。Day 7——预期下降趋势停滞（剩余 12 点 Day 6→12 点 Day 7）——站会检查发现"地图追踪 SDK 集成需 Android 原生模块编译——等待 DevOps 配置 CI 环境"——障碍记录到 Impediment Board、Scrum Master 升级。Day 8——剩余从 12 骤降至 5（陡降）——一对 8 点的"物流追踪地图"终于在 CI 环境就绪后通过测试——异常陡降说明任务粒度太大（8 点故事整个 Sprint 被阻塞直到最后才完成——应在 Sprint 计划时拆分为更小粒度）。Day 9-10——剩余从 5 降至 0——小粒度收尾任务（文案修正/样式微调/文档更新）。回顾会讨论要点：（1）"为何 8 点故事直到 Day 8 才完成？我们没有在 Sprint 计划时识别 CI 环境依赖"→行动项——Sprint 计划时增加"环境依赖检查"步骤；（2）"任务粒度不均衡—8 点故事应在 Sprint 计划时拆为可 1-2 天完成的小任务"→行动项——DoR 新增"每个 Sprint Backlog 任务 ≤ 3 故事点或 ≤ 2 天工作量"。',
        stage: 5,
        sourceRefs: [{ layer: 'L1', sourceId: 'scrum-guide', section: 'burndown-chart' }],
        provenance: 'official',
      },
      {
        id: 'pm-agile-exa-006',
        title: '回顾会行动项SMART示例',
        content:
          '回顾会产出 SMART 行动项的标准示例（从模糊到精准）。模糊行动项："加强代码评审质量"——不 Specific（怎么加强？）、不 Measurable（怎么度量？）、不 Achievable（一个 Sprint 能做到什么？）、不 Time-bound（什么时候完成？）。SMART 重构：行动项 1——"每个 PR 必须至少有 1 条有意义的评审评论（非 LGTM 或 Approved 无内容）。度量方式：下 Sprint 的回顾会上抽查 10 个已合并 PR 中断言 ≥ 8 个包含有意义的评论。负责人：Tech Lead（张三）。截止日：Sprint 4 最后一天。" 行动项 2——"团队每天 11:00-11:15 进行‘代码评审时间‘（相当于团队站会后的代码评审仪式——每人选 1 个队友的 PR 做一次深度评审）。度量方式：站会后询问是否有未评审 PR > 1 天的——如有则标记并加急。负责人：Scrum Master（李四）负责提醒。截止日：Sprint 4 每个工作日。" 行动项 3——"本周三 16:00-17:00 张三分享‘代码评审最佳实践‘30min + 团队练习 30min（评审一个真实 PR 并讨论）——建立团队对‘好评审‘的共同标准。度量方式：周三分享后匿名 Survey（1-5 分了解评审标准）。输出：一页纸‘团队代码评审共识‘（贴在物理看板旁/钉在 Slack Channel）。负责人：张三。截止日：Sprint 4 本周三 17:00。" 注意：不是每个回顾会产出 3 个行动项——产出 1 个高质量行动项 > 产出 3 个永远不会做的行动项。行动项纳入 Sprint Backlog——分配故事点或标记为"改进任务"。',
        stage: 6,
        sourceRefs: [
          { layer: 'L1', sourceId: 'agile-practices', section: 'retrospective-actions' },
        ],
        provenance: 'official',
      },
      {
        id: 'pm-agile-exa-007',
        title: 'MVP切分实战——任务管理工具',
        content:
          '从零构建任务管理工具的 MVP 切分实例。完整愿景：AI 驱动的专业项目管理平台（最终形态）。MVP 版本 1——1 个 Sprint（2 周）"一个用户能在看板上创建、拖动、删除任务"。假设验证："项目管理员真的需要 Kanban 而非传统的 WBS 吗？"（先上 Kanban 而非 WBS 因为 Kanban 建设成本更低——先验证用户接受 Kanban 作为管理方式）。包含功能：一个项目、三个默认列（待办/进行中/已完成）、创建任务（标题/描述——纯文本框）、拖动任务到不同列（乐观更新 + DnD 库）、删除任务（二次确认弹窗）、数据持久化（本地 SQLite）。不包含：多项目/团队协作/WBS/甘特/权限/AI——这些是假设验证后决定投入的功能。度量指标：7 天活跃用户数 > 10、任务创建到完成的前置时间、用户反馈表（"你当前最大的痛点是什么 / 你希望下一个加什么功能"）。MVP 版本 2——如果版本 1 验证了"用户接受 Kanban"，版本 2 加多项目、WBS 树（因为早期用户的反馈表中"需要层级化任务分解"占比最高——WBS 从 Optional 升为 Must have）、简单甘特图。MVP 版本 3——如果版本 2 验证了"专业 PM 愿意从 Excel/Jira 迁移"，版本 3 加 AI 一句话生成项目（差异化卖点）。要点：每个版本的"最小"定义不同——不是砍功能砍到什么都没有而是保留足够的价值让用户愿意用、愿意反馈——没有反馈的 MVP = 失败的 MVP。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'agile-practices', section: 'mvp-slicing' }],
        provenance: 'official',
      },
      {
        id: 'pm-agile-exa-008',
        title: '规划扑克（Planning Poker）实战流程',
        content:
          '规划扑克估算一个用户故事"用户可将多张任务卡片批量导出为 Excel"的完整流程（5 人团队）。步骤 1——PO 朗读故事："作为项目管理员，我希望选中多个任务并导出为 Excel（含任务标题/负责人/状态/截止日/耗时），以便生成周报发给干系人" + 验收标准（Given 项目中有 20 个任务 含不同状态和负责人；When 管理员用 Shift+点击多选 7 个任务 然后点‘导出选中项‘按钮；Then 浏览器下载 Excel 文件（.xlsx）含 7 行数据且列顺序为标题-负责人-状态-截止日-创建日期、文件名格式为 ‘tasks_export_2026-07-24.xlsx‘）。步骤 2——团队提问（≤ 3min）："导出是同步还是异步？——20 个任务以内同步，超过 20 个后台生成 + 通知下载"、"需支持自定义列吗？——MVP 固定列，自定义列为 P2 后续"、"需要支持 .csv 还是只要 .xlsx？——Excel（.xlsx）为 MVP，CSV 后续。" 步骤 3——估算轮次 1：每人选牌——张三 3 点（"后端有现成的 Excel 生成库——2h 够了"）、李四 5 点（"前端多选交互和文件下载处理——4h"）、王五 3（与张三同）、赵六 8（"我们从未做过浏览器下载文件——需要确认浏览器兼容性和下载安全策略"）、孙七 5（与李四同）。最大与最小发言：赵六——"我打 8 因为上次文件导出我们遇到 CORS 问题耗了半天——风险在浏览器下载而非 Excel 生成"；张三——"上次是 PDF 导出走 Server 端所以 CORS 复杂——Excel 可以在客户端生成用 Blob 下载不走 CORS"。步骤 4——估算轮次 2（基于新信息）：张三 3、李四 3（"赵六提到了浏览器下载的坑——但我们可以用客户端生成绕过，3 点是稳的"）、王五 3、赵六 5（"客户端生成 Excel 如果用户选了 1000 个任务会不会 OOM？我们不在 MVP 做——但需确认极限"）、孙七 5。未收敛——再次讨论"超大数据量"问题：PO 确认"MVP 导出上限 50 个任务——50 行 Excel 客户端生成没问题"。轮次 3：全员 3 点。估算 3 点。产出：估算 3 点 + 非功能约束（导出上限 50 个任务、响应时间 ≤ 2s）记录到故事的验收标准中。3 轮总耗时 8min——合理。',
        stage: 1,
        sourceRefs: [{ layer: 'L1', sourceId: 'agile-estimation', section: 'planning-poker' }],
        provenance: 'official',
      },
    ],

    // ── checklists（检查清单）8 条 ──
    checklists: [
      {
        id: 'pm-agile-chk-001',
        title: 'Sprint计划就绪检查清单',
        content:
          'Sprint 计划会就绪标准（8 项，全部通过方可进入计划会）。1. 产品待办就绪——是否顶部待办（Top 20 项）已梳理且每条有验收标准（Given-When-Then 格式）和故事点估算？是否超过 50% 的顶部待办缺少验收标准或估算——如是则推迟 Sprint 计划会（至少 80% 就绪）？2. Sprint 目标草案——PO 是否准备了 1-2 句 Sprint 目标草案（对齐产品愿景和干系人期望、有清晰的可度量结果）？目标是否排他（不是"做 A 而且也做 B 但如果时间不够就先做 C"的模糊清单）？3. 团队容量——是否已知下 Sprint 的团队可用性（请假/培训/On-Call/外部会议）？是否已计算昨晚速率（过去 3 个 Sprint 平均完成点数）和调整后目标容量（可用性百分比 × 平均速率）？4. 关键干系人——PO 是否已邀请必要的干系人参与计划会（至少 PO + 开发团队 + Scrum Master；可选：业务代表/架构师/UX——如果 Sprint 有关键 UX 或架构决策）？5. 上 Sprint 状态——是否已关闭上 Sprint（所有故事已验收或退回待办）？是否有跨 Sprint 的未完成任务需在本 Sprint 重新规划？6. 环境与工具——计划会所需的工具是否就绪（电子待办列表/故事地图/白板/投票工具——线上/线下）？是否提前发了日历邀请含会议链接和议程？7. Definition of Ready——团队是否对齐 DoR 标准（故事在进入 Sprint 前须满足的条件——验收标准完整、可估算、可独立交付、无外部阻塞依赖、UI 设计已完成）？8. 回顾会行动项——上 Sprint 回顾会的行动项结果是否已报告（完成率/效果评估）？未完成的行动项是否重新计划或废弃？',
        stage: 1,
        sourceRefs: [
          { layer: 'L1', sourceId: 'scrum-guide', section: 'sprint-planning-checklists' },
        ],
        provenance: 'official',
      },
      {
        id: 'pm-agile-chk-002',
        title: 'DoR定义就绪检查清单',
        content:
          'Definition of Ready——用户故事在进入 Sprint 前必须满足的就绪标准（8 项，不满足的故事标记为"未就绪"退回待办）。1. 用户故事格式——是否使用了"作为-我希望-以便"标准格式描述？用户角色是否明确（不是"作为用户"——太泛；应具体如"作为项目管理员"）？2. 验收标准完整——是否有 Given-When-Then 格式的验收标准且覆盖正常流程、边界条件和至少 2 个异常场景？验收标准是否可自动化测试（不是"系统应运行良好"——无法测试）？3. 用户价值明确——"以便"子句是否描述了可理解的价值（不是"以便系统能工作"的循环解释——而是"以便在 30 秒内找到上个月的所有待审批任务"）？4. 可独立交付——故事是否可以独立开发/测试/部署而不依赖其他未完成的故事？如依赖另一故事——是否明确标注依赖并确保被依赖故事优先级更高？5. 估算已完成——故事是否由开发团队估算了故事点（非 PO/Scrum Master 单独估算）？对于无法估算的故事（"对新技术完全未知"）——是否已安排 Spike？6. 可行性已确认——技术方案（至少高层次——用什么技术栈/有已知阻碍吗）团队是否讨论过并认为可行？如果有重大不确定性是否已有 Spike 结论？7. UI/UX 设计可用——如需 UI 变更——高保真设计稿/线框图是否已由 UX 提供且通过 PO 评审？交互流程（包括空状态/加载/错误/边界）是否覆盖完整？8. 外部依赖就绪——故事是否需要第三方 API（且 API 文档已提供）？是否需要其他团队交付物（且交付日期在 Sprint 范围内）？依赖方是否已承诺交付日期？',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'scrum-guide', section: 'definition-of-ready' }],
        provenance: 'official',
      },
      {
        id: 'pm-agile-chk-003',
        title: 'Sprint评审检查清单',
        content:
          'Sprint 评审会就绪与进行标准（8 项）。1. 增量就绪——所有计划完成的待办项是否已满足 DoD 且可在 Demo 环境中演示？演示环境是否与生产环境配置接近（避免"Demo 能用但生产不能"）？2. 演示流程——是否已排练演示流程（按用户旅程而非按任务编号排列——Demo 应该是"用户可以做 X"而非"我们完成了任务 S5-1"）？演示是否控制在时间盒的 60%（留 40% 给反馈和讨论）？3. 干系人邀请——是否已邀请所有关键干系人（PO、业务代表、管理层、客户代表——如适用）？是否提前发送了会议议程（评审会不是报告会是协作活动——让干系人带着问题和反馈来）？4. 未完成处理——未完成的待办项是否已明确说明原因（阻碍因素/低估复杂度/PO 改变优先级）？是否记录了未完成项的处置——退回待办（优先级重排）还是放到下 Sprint？5. 反馈收集——是否有系统化的反馈收集方式（不是"有人有什么问题吗"沉默结束——而是引导每个干系人/组提至少一条反馈）？反馈是否记录到待办列表或产品待办的想法区（不要求当场决定）？6. 产品待办更新——是否基于 Demo 反馈和最新业务变化更新了产品待办列表的优先级排序？是否有"看完 Demo 后认为原来排在下 Sprint 的故事不再重要"的案例——当场调整优先级？7. 市场/竞品变化——PO 是否分享了自上次评审以来的市场变化/竞品动态/用户反馈（如适用）？这些变化是否影响产品方向——是否调整后续 Sprint 目标？8. 下次评审日期——是否确认了下个 Sprint 评审会的日期和时间（将干系人日历提前锁住）？是否收集了本次评审会的改进建议（"希望下回提前看到故事列表以便准备问题"等）？',
        stage: 5,
        sourceRefs: [{ layer: 'L1', sourceId: 'scrum-guide', section: 'sprint-review' }],
        provenance: 'official',
      },
      {
        id: 'pm-agile-chk-004',
        title: 'Sprint回顾检查清单',
        content:
          'Sprint 回顾会有效性的 8 项检查标准。1. 心理安全——回顾会前是否确认了 Prime Directive（"每个人都尽最大努力做好"）并获得全员口头认同？是否确保无管理者参与回顾会（除非团队主动邀请）——管理者的存在会抑制诚实反馈？2. 数据收集——是否采用了结构化的数据收集方法（时间轴/心情曲线/海星图 Start-Stop-Keep-More-Less）而非开放式"大家觉得怎么样"？是否同时收集了客观事件（部署失败次数/加班天数/中断次数）和主观感受（士气/协作/知识共享）？3. 全员参与——是否所有团队成员（开发/测试/UX/DevOps 如有）都至少发言一次？沉默成员是否被温和邀请分享（"王五你今天相对安静——有什么想补充的吗？"）而非点名逼问？4. 根因分析——是否从表面问题追溯到至少一个深层根因（使用 5 Whys 或鱼骨图）？是否有"连续超过 2 次回顾会出现同一问题"的标志——说明之前根因没找到？5. 行动项质量——是否产出至少 1 个、至多 3 个 SMART 行动项？每个行动项是否有负责人（一个人不是"团队"）、截止日、可验证的完成标准？前次回顾会的行动项完成率是否 < 50%——如果是，本次回顾会第一个讨论项应为"为何行动项不执行"？6. 正向发现——是否识别了 Sprint 中做得好的事情（不是只聚焦问题——正向发现是复制成功的来源）？正向发现是否也产出了行动项（"Keep Doing——继续坚持代码评审的‘至少一人深度评审‘规则"）？7. 回顾会时间——是否在时间盒（≤ 3h）内完成？是否有某个环节严重超时（如"问题讨论"变成了无休止辩论）——Scrum Master 应介入引导收敛？8. 回顾会改进——是否用最后的 5min 评估回顾会本身（1-5 分——本次回顾会有多有效？下次回顾会的格式创新——Mad/Sad/Glad 或 Sailboat 或 4Ls 等不同形式以防形式疲劳）？',
        stage: 6,
        sourceRefs: [
          { layer: 'L1', sourceId: 'agile-practices', section: 'retrospective-checklist' },
        ],
        provenance: 'official',
      },
      {
        id: 'pm-agile-chk-005',
        title: '发布就绪检查清单——敏捷版',
        content:
          '增量发布（Sprint 交付/持续部署）就绪标准（8 项）。1. DoD 全部满足——Sprint Backlog 中标记为"完成"的故事是否全部满足 DoD（代码评审/自动化测试/文档更新/PO 验收）？是否有任何故事被标记为"完成"但未走完代码评审（"先合并后补审"——回退）？2. 回归测试——全量自动化测试套件是否通过（单元/集成/E2E）？是否有针对本 Sprint 新增功能的手动探索性测试（ET Session——至少 1 小时覆盖正常/异常/边界/并发）？3. 安全扫描——依赖漏洞扫描（npm audit / OWASP Dependency-Check）是否无 High/Critical 新增漏洞？SAST（静态应用安全测试）是否无新增高危漏洞？如有无法修复的已知漏洞——是否已记录且评估风险？4. 性能基线——核心用户旅程的性能是否无退化（P95 延迟不超过基线的 110%）？如果是首个发布——是否设定了性能基线数据（P50/P95/P99 首次采集）？5. 数据变更——是否涉及数据库迁移（schema 或数据变更）？迁移脚本（UP）是否已在预发布环境成功执行？回滚脚本（DOWN）是否已准备且验证？敏感数据（用户 PII）是否有备份计划？6. 配置与 Feature Flag——新增/修改的环境变量是否已记录（含默认值和示例）？本 Sprint 涉及的新功能是否有 Feature Flag 包裹（如需灰度——可单独关闭而不影响其他功能）？7. 发布说明——Release Notes 是否已编写（含新增功能/改进/已修复 Bug/已知问题/升级注意事项——面向用户而非开发者语言）？发布说明是否由 PO/Sprint 团队 Review 过？8. 监控与告警——新增 API 端点的监控（RED 指标——Rate/Error/Duration）是否已配置？关键业务事件（如"订单状态变更"成功率/延迟）是否有监控 Dashboard？是否有夜间/Sprint 末发布的"On-Call 支持计划"（至少一人监控告警和用户反馈）？',
        stage: 5,
        sourceRefs: [{ layer: 'L1', sourceId: 'agile-practices', section: 'release-readiness' }],
        provenance: 'official',
      },
      {
        id: 'pm-agile-chk-006',
        title: 'DEEP待办健康度检查清单',
        content:
          '产品待办列表（Product Backlog）DEEP 健康度评估的 8 项检查。1. Detailed appropriately——顶部 20% 的待办故事是否足够详细（有验收标准、可估算、依赖已知）以至可以进入下个 Sprint？底部 20% 的待办故事是否保持粗粒度（Epic/Feature 级别——不过早投资细节因为可能会被砍）？2. Estimated——顶部待办是否全部有故事点估算？底部待办（> 3 个 Sprint 以外）是否至少有 T-Shirt Size（S/M/L/XL）或粗糙的故事点数（如"约 13 点+——粗略"）——不需要精确但需要相对数量级？3. Emergent——待办列表是否在上次 Sprint 评审后更新过（新发现的需求/用户反馈/市场变化）？是否有超过 30 天的未更新故事（说明可能已过时——标记并复查）？4. Prioritized——待办是否按单一优先级排序（不是"P1/P2/P3 分组"——组内无序等于没排序）？顶部 10 条故事是否可以明确回答"为什么 A 排在 B 前面"——基于价值/学习/风险的明确理由？5. 大小均衡——顶部 Sprint 候选故事中是否有 ≥ 13 点的故事（应拆分为 < 8 点）？是否有大量 1 点故事（可能过细粒度——考虑合并为更连贯的用户故事）？6. 无僵尸故事——是否有超过 3 个月未更新且无人记得为什么存在的"僵尸故事"（标记并归档——留着污染待办）？7. 干系人可见——待办列表是否对干系人可见（电子化或大屏展示——透明性）？干系人是否知道如何反馈和提新需求（流程是否通畅——不是"找 PO 口头说"然后 PO 忘了记）？8. PO 单一负责人——待办列表是否只有一个 PO 负责（不是多个人可修改优先级——那等于没人负责）？PO 是否承诺了待办梳理频率（≥ 每周一次梳理 + 每次 Sprint 评审后立即更新）？',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'scrum-guide', section: 'product-backlog-health' }],
        provenance: 'official',
      },
      {
        id: 'pm-agile-chk-007',
        title: '每日站会有效性检查清单',
        content:
          '站会是否真正有效（而不仅是"发生"）的 8 项检查。1. 时间控制——是否 ≤ 15 分钟？是否有计时器（物理番茄钟/手机倒计时/屏幕插件——将时间可视化）？超时频率——若连续 3 天超时须在回顾会讨论。2. 聚焦 Sprint 目标——团队成员的回答是否与 Sprint 目标关联（"今天我做 X 以推动我们的 Sprint 目标中的 Y"——而非无关联的任务流水账）？是否有成员连续 3 天回答同一句话（"昨天做 X、今天继续做 X、无阻碍"）——说明任务粒度太大需拆解或成员卡住了不说。3. 障碍暴露——是否有成员暴露了障碍（Impediment）？暴露的障碍是否被 Scrum Master 记录到 Impediment Board 且会后立即开始处理？是否有障碍被重复暴露超过 2 天未解决——说明 Scrum Master 未履职或组织阻碍超出 Scrum Master 能力范围需管理层介入。4. 互相说话——团队成员说话时是否面向彼此（而非 Scrum Master/Tech Lead）？是否有成员主动对队友说"我昨天遇到你的模块的问题——能会后聊 5 分钟吗"（协作信号健康）。5. 会后协作——站会结束后是否自然地有人留下来继续讨论（"你刚才说的障碍我们看一下"——课后交谈说明站会暴露了有用信息）？而不是所有人说完立刻散。6. 参与度——是否全员到场（或明确请假）？迟到者的频率（> 2 次/Sprint——Scrum Master 应私下问原因——不是责备而是了解是否有合理障碍如跨时区）。7. 物理性——是否有物理或数字看板（Kanban Board/Sprint 待办列表）展示在站会可见位置？站会过程中是否有人指着看板上的某张卡片说"这张卡我今天拉"——看板是道具而非背景。8. 节奏感——站会是否每天同一时间同一地点（或同一视频链接）发生——习惯减少决策疲劳？站会是否是团队的"心跳"而非"负担"——团队期待站会（对齐感）还是恐惧站会（汇报感）？可用匿名 Survey 每 3 个 Sprint 问一次。',
        stage: 5,
        sourceRefs: [
          { layer: 'L1', sourceId: 'scrum-guide', section: 'daily-scrum-effectiveness' },
        ],
        provenance: 'official',
      },
      {
        id: 'pm-agile-chk-008',
        title: '看板健康度检查清单',
        content:
          'Kanban 系统健康度评估的 8 项检查（同时适用于 Scrum 团队的 Sprint 看板）。1. WIP 合规——每列的 WIP 上限是否在最近一次看板巡检中未超过（或超过时有记录的原因和行动计划）？是否设定了"WIP 超标自动报警"——当某列卡片数 = WIP 限制时该列标黄色、> WIP 限制时标红色且站会必须讨论？2. 流动指标——是否定期（每周）查看 CFD（累积流图）以评估 WIP/前置时间/吞吐率的趋势？平均周期时间（Cycle Time）是否稳定或下降？如果周期时间上升——是否识别了瓶颈环节？3. 阻塞卡片——是否有被阻塞超过 3 天的卡片？阻塞原因是否明确（外部依赖等待/技术阻塞/需求不明确）？是否有专门的"阻塞"列或特殊颜色标记阻塞卡片使阻塞可见——阻塞卡片数是否已成为站会的必看指标？4. 卡片粒度——是否有超过 Sprint 1/3 容量的大卡片（Epic 级）在 Kanban 上流动——应拆分或标记为"需拆解"？是否有小于 1 小时工作量的卡片（粒度太细增加管理开销）？5. 流程阶段映射——Kanban 上的列是否映射了团队实际的工作流程（不是理论流程——是真正发生的工作流转）？是否有隐藏的流程阶段（如"等待代码评审"和"代码评审中"是两个不同状态但混在同一列——无法度量等待时间 vs 工作时间）？6. 拉取信号——是否每一列都有明确的拉取标准（何时可以从上游列拉取新卡片——如"开发列 < WIP 上限 且 至少有一张卡片在测试列已测试通过并移到发布列"）？拉取标准是否显式写在了看板旁（数字或物理）？7. 服务等级——是否有基于服务等级（Expedite/Fixed Date/Standard/Intangible）的卡片分类？Expedite（加急）卡片的使用频率是否合理（≤ 1 张在流动——超过说明加急常态化）？8. 回顾反馈——Kanban 的列/WIP/拉取标准是否在上次回顾会被讨论？是否有流程改进后的度量数据（如"WIP 从 8 降至 5 后平均周期时间从 5 天降至 3 天"）？看板本身是否是持续改进的一等公民（不是"设了就忘了"）？',
        stage: 5,
        sourceRefs: [{ layer: 'L1', sourceId: 'kanban-guide', section: 'kanban-health' }],
        provenance: 'official',
      },
    ],

    // ── rubric（评分维度）8 个维度 ──
    rubric: [
      {
        id: 'pm-agile-rub-001',
        title: '产品待办质量评估标准',
        content:
          '评估产品待办列表（Product Backlog）的质量与健康度。1 分——待办不存在或形式存在但非结构化（一个标题列表或几十条未处理的原始需求邮件）、无优先级排序（所有需求标记为"P1"或未标记）、无估算（对交付时间完全靠管理层拍脑袋）、PO 缺席或未履职（待办 3 个月未更新）。典型表现：开发团队自己从一堆需求邮件/Slack 消息里挑东西做、Sprint 计划会花一半时间现场整理待办（因为 PO 没提前梳理）。3 分——有待办列表且有基本优先级（顶部故事和底部区分清楚）、大部分顶部故事有估算（但底部没有）、有定期梳理（至少每月一次）但梳理质量不高（梳理后仍有大量不清晰的故事进入 Sprint）、PO 部分参与（出现 Sprint 计划会但不参与日常梳理）。典型表现：Sprint 计划会时 PO 能说出目标但顶部 10 条有 3 条团队需要临时追问/澄清、梳理会时 PO 经常说"这个需求是老板提的我不确定细节但我排前面"——PO 不是需求传声筒。5 分——待办满足 DEEP 全部标准（见 pm-agile-chk-006）、顶部 20% 故事已为"就绪"状态满足 DoR、每 Sprint 有 ≥ 2h 正式梳理 + PO 日常非正式梳理、所有故事可追溯到用户价值或业务目标（"为什么做这个——因为提升转化率 2%"）、干系人可访问待办且知道如何提交和查阅需求。评分要点：排序准确性（是否基于价值/风险/依赖）、详细度梯度（高优先级详细低优先级粗糙）、PO 参与度及时性（梳理频率与质量）、干系人可见性与反馈闭环。',
        stage: 6,
        sourceRefs: [{ layer: 'L1', sourceId: 'agile-metrics', section: 'backlog-quality-rubric' }],
        provenance: 'official',
      },
      {
        id: 'pm-agile-rub-002',
        title: '可预测性评估标准',
        content:
          '评估团队交付节奏的可预测性和 Sprint 承诺可靠性。1 分——完全不可预测：Sprint 实际交付一般仅达计划的 30-50%、每 Sprint 的目标和范围差异极大（"这个 Sprint 做了计划中的 3 个任务 + 临时的 8 个紧急——说是 8/10 完成"）、发布日期毫无可信度（"可能 3 个月也可能 6 个月——看情况"）、干系人完全失去信心（开始绕过敏捷流程——直接找开发者"你能不能偷偷帮我做这个"）。3 分——部分可预测：Sprint 完成率在 50-80% 间波动（有偏离但不太大）、速率参考有效但有较大变异（标准差 > 速率的 30%）、可有粗粒度的发布预测（"大概 Q3 能上线但不确定 Q3 什么时候"）、干系人半信半疑。典型表现：大部分 Sprint 完成大部分任务但偶尔某个 Sprint 完成率 20%（因为重大突发事件或估算严重失准）。5 分——高度可预测：连续 6+ Sprint 完成率在 80-100% 区间（偶尔 100%+ 是因为完成了少量未计划的微小改进）、速率变异系数 ≤ 20%（标准差/均值 ≤ 20%）、发布计划有高置信度区间（"6 月 15 日-21 日之间发布，80% 概率"——基于蒙特卡洛模拟"我们还有 150 点，按速率 30 点/Sprint 约 5 个 Sprint，历史波动 ±1 个 Sprint"）、干系人对团队承诺有高度信任（不要求额外承诺/不绕过 Scrum 流程）。',
        stage: 6,
        sourceRefs: [{ layer: 'L1', sourceId: 'agile-metrics', section: 'predictability-rubric' }],
        provenance: 'official',
      },
      {
        id: 'pm-agile-rub-003',
        title: '速率稳定性评估标准',
        content:
          '评估团队 Sprint 速率（Velocity）的稳定性——稳定性不是指"每 Sprint 数字一样"而是指"波动有合理原因且可解释"。1 分——速率极度不稳定：变异系数 > 50%（Sprint 间点数剧烈波动如 20→45→15→40）、无 Sprint 间可比性（速率不能用于任何规划）、波动原因不明（团队不知道为何某 Sprint 特别高或特别低）。典型表现：故事点定义漂移（Sprint 1 的 3 点 != Sprint 3 的 3 点——因为团队换人了但没重新校准基线）、DoD 不固定（某些 Sprint "完成"包含代码评审和测试、某些 Sprint "完成"只是代码写完了）。3 分——速率有些波动但可解释：变异系数 20-50%、波动原因部分可追溯（"Sprint 4 速率降到 15 因为全员培训 3 天"——合理；"Sprint 6 速率 48 因为两个大故事估低了实际花了一整个 Sprint 最后一天同时完成——不合理"）、速率对 Sprint 规划有参考价值但需谨慎调整。典型表现：速率平均值有参考意义但团队还需手动判断每个 Sprint 的容量预期。5 分——速率稳定性高且可解释：变异系数 ≤ 20%、每个 Sprint 实际与计划的偏差可追溯到具体原因（人员变动/技术复杂度超出预期/外部依赖延迟——都在 Sprint 回顾会记录）、团队有共同的故事点基线（每 3-6 个月或团队人员变动 > 30% 时重新校准基线故事）、速率数据用于 Yesterday\‘s Weather 选容量 + 蒙特卡洛模拟做发布预测（而非直接"速率 30 所以 5 个 Sprint 后发布"）。',
        stage: 6,
        sourceRefs: [
          { layer: 'L1', sourceId: 'agile-metrics', section: 'velocity-stability-rubric' },
        ],
        provenance: 'official',
      },
      {
        id: 'pm-agile-rub-004',
        title: 'DoD满足度评估标准',
        content:
          '评估团队对 Definition of Done 的遵守程度和 DoD 本身的适宜性。1 分——无 DoD 或有 DoD 但从未被检查：代码合并无代码评审（或评审形同虚设——"LGTM" 2 秒过）、测试覆盖率持续下降（或根本没有测试覆盖率度量）、发布后频繁出现"在 Sprint 评审时没问题上线后才出问题"——说明 Sprint 评审在非生产等价环境进行。典型表现："理论上完成了但实际上永远有尾巴"——每个 Sprint 有 2-3 个故事的后续 Bug 修补在下个 Sprint 大量出现。3 分——有 DoD 且大部分故事满足但有遗漏：核心故事满足 DoD（代码评审+测试+文档）但非核心故事偶尔走捷径（"只是个配置变更不需要评审"）、测试覆盖率要求有但监控不足（只在 CI 显示数字但低于门禁不阻断合并）、发布后 Bug 发生率可接受但有改进空间。典型表现：团队有"DoD 警察"角色（Scrum Master 或某成员提醒大家检查 DoD）但失去该角色时就会漏。5 分——DoD 全面且自动化验证：DoD 检查项尽可能自动化（CI 检查测试覆盖率/代码评审状态/必要文档更新并由自动化门禁阻断不满足的故事标记为"未完成"）、DoD 每 Sprint 回顾会评估是否需要更新（最近一次更新在 3 个 Sprint 以内）、发布后逃逸缺陷率 < 5%（每 Sprint 发布后发现来自前 Sprint 的缺陷 < 总故事数的 5%）。',
        stage: 6,
        sourceRefs: [{ layer: 'L1', sourceId: 'scrum-guide', section: 'dod-compliance-rubric' }],
        provenance: 'official',
      },
      {
        id: 'pm-agile-rub-005',
        title: '改进落地率评估标准',
        content:
          '评估团队持续改进（来自回顾会行动项）的落地执行能力和改进文化成熟度。1 分——回顾会形同虚设：无行动项或行动项从未完成（完成率 0-20%）、连续 3+ Sprint 讨论同一问题而无进展、团队成员表示"说了也没用"（心理安全被侵蚀——回顾会信任破产）。典型表现：回顾会产出"加强测试"或"改进沟通"这种无法执行的模糊宣言——下次回顾会重新说"上回说的都没做"。3 分——有行动项且部分执行：行动项完成率 50-80%（SMART 级别有改进空间——部分太模糊或太大无法在一个 Sprint 内完成）、有可观察的改进（如"上次行动——PR 评审 < 1 天的比例从 40% 提升到 70%"）但改进速度不够快、回顾会仍偶尔产出模糊行动项。典型表现：团队对改进有认真态度但执行力不稳定——某些 Sprint 的改进被"真正的工作"挤掉。5 分——改进文化成熟：回顾会行动项完成率 ≥ 80% 且行动项始终 SMART、有可量化的改进证据（如"自从 3 个 Sprint 前行动项‘设立站会后 15min 代码评审时间‘落地后——PR 平均评审等待时间从 1.8 天降至 0.7 天"）、改进成为 Sprint 容量的固定组成部分（至少 5% 容量分配给回顾会行动项——而非挤占"真正交付"时间的变量）。评分要点：行动项 SMART 程度、完成率趋势（上升/平/下降）、改进的量化证据（不是"感觉变好了"）。',
        stage: 6,
        sourceRefs: [
          { layer: 'L1', sourceId: 'agile-practices', section: 'continuous-improvement-rubric' },
        ],
        provenance: 'official',
      },
      {
        id: 'pm-agile-rub-006',
        title: '自组织度评估标准',
        content:
          '评估团队的自我管理/自组织（Self-Organization）水平——在没有外部指令的情况下自行决定"谁做什么"、"如何协作"和"如何改进"的程度。1 分——完全被管理：任务由 Tech Lead/Manager 每日分配到个人（团队成员无选择权）、站会变成管理者的"任务指派会"、Scrum Master 是"项目助理"而非仆人式领导者（帮忙订会议室/催进度而非消除障碍）。典型表现：站会中每个人向 Tech Lead 汇报进度——Tech Lead 告诉每个人"你今天做这个"、开发者不敢或不愿自己做技术选择。3 分——部分自组织：Sprint 计划会里团队参与任务选择但实际执行中仍需大量外部指导、团队有能力解决技术问题但在流程/协作问题上仍依赖 Scrum Master 提出解决、团队成员间有互助但仍有"这不是我的事"的心态。典型表现：团队在"怎么做"上有自主权但在"做什么"和"为什么"上仍依赖 PO/Tech Lead 决定。5 分——高度自组织：团队自己从 Sprint Backlog 拉取任务（不是被分配——是根据能力/兴趣/学习目标自愿承担）、在 Sprint 过程中团队自行重分配任务以解决瓶颈（无需 Scrum Master 介入——"张三测试列堵了——李四我这边开发完成了来帮你测"）、团队向 PO 提出需求改进建议（"这个故事的验收标准缺少并发场景——我们在 Plan 时补上"）而非等待 PO 完美。',
        stage: 6,
        sourceRefs: [{ layer: 'L1', sourceId: 'scrum-guide', section: 'self-organization' }],
        provenance: 'official',
      },
      {
        id: 'pm-agile-rub-007',
        title: 'PO协作频率评估标准',
        content:
          '评估 Product Owner 与开发团队的协作紧密程度——PO 不是"需求文档写完扔给团队就消失"而是持续参与。1 分——PO 极少与团队协作：仅出现在 Sprint 计划会和评审会（还经常迟到或早退）、团队在 Sprint 期间联系 PO 需通过邮件预约（"下周才有空"——但问题今天就要决策）、PO 从不参加站会（站会暴露的需 PO 决策的障碍 Scrum Master 代为转达——有信息失真和延迟）。典型表现：Sprint 第 5 天团队发现两个验收标准矛盾——发消息给 PO，PO 第 8 天才回复"按方案 A 做"——但团队已在第 6 天猜了一个方案做了——PO 说"不是我要的"。3 分——PO 定期参与但频率不足：PO 参加计划会和评审会、Sprint 期间有定期沟通（如每周一次的"PO 答疑时间"）、非紧急问题 2 天内可得到 PO 回复、PO 偶尔出现但未参与站会或待办梳理。典型表现：团队能联系到 PO 但需要主动发起——PO 是被动的需求答疑者而非主动的价值合作者。5 分——PO 深度嵌入团队：PO 每天与团队同地（或在线有即时通讯 SLA——非紧急 ≤ 2h 响应）、PO 参与站会（至少每周 2-3 次——不是每站会都来但经常来）、PO 与团队一起进行待办梳理（不是"你们梳理我 approve"——而是一起讨论验收标准、价值假设、粒度切分）、PO 在 Sprint 期间向团队提供快速反馈（"我刚看了你的 Demo——方向对的但按钮位置放在右上角——因为 xx"）。',
        stage: 6,
        sourceRefs: [{ layer: 'L1', sourceId: 'scrum-guide', section: 'po-engagement-rubric' }],
        provenance: 'official',
      },
      {
        id: 'pm-agile-rub-008',
        title: '持续改进成熟度评估标准',
        content:
          '评估团队和组织对持续改进（Continuous Improvement / Kaizen）的深层次文化成熟度——不仅回顾会有行动项而是"改进 = 每天的工作方式"。1 分——无改进文化：回顾会被取消或压缩（"这 Sprint 没时间开回顾了——下次一起"）、提案改进被"我们没资源"或"这不是我们的问题"否决、问题被发现后不追根因——"不是我们造成的"推给其他团队或供应商。典型表现：事故复盘（Postmortem）流于形式（"根因：人为操作失误"——不追问为什么人会失误——工具/流程/信息/培训的哪个环节出了问题）、团队对外部依赖的持续故障无改变（"邮件服务又挂了——但这不是我们的系统"——不追问"能否添加备用邮件服务"）。3 分——有改进意愿但制度化不够：回顾会定期发生且产出行动项但改进局限于团队内（影响组织的阻碍无法解决）、事故复盘有一定深度但行动项落在"下次注意"而非系统性改变、改进速度受限于 Sprint 压力（"改进很重要但在交付之下"）。典型表现：改进被视为"交付之余做的事"而非"使交付更快的事"。5 分——改进文化制度化且深入组织：改进已从 Sprint 回顾会扩展到所有 Scrum 事件（计划会——这个计划会花了 6h 比目标 4h 多——该怎么改进计划会的效率？）、Organizational Impediment 升级路径畅通（团队无法解决的障碍可升级到管理层并获得响应）、事故复盘采用"无责文化"（Blameless Postmortem）且行动项有跟踪与度量、有专门的"改进预算"（如每 Sprint 10% 容量分配给改进——不仅是回顾会行动项还包括技术健康/自动化投资/知识分享）。',
        stage: 6,
        sourceRefs: [
          { layer: 'L1', sourceId: 'agile-practices', section: 'continuous-improvement-maturity' },
        ],
        provenance: 'official',
      },
    ],
  },
}

// ── 「建筑项目」Skill 完整内容定义 ────────────────────────────────────

const CONSTRUCTION_SEED: BuiltinSkillSeed = {
  skillKey: 'skill-construction',
  name: '建筑项目',
  version: '1.0.0',
  description:
    '覆盖建筑工程全生命周期的领域知识包：从施工组织设计、进度控制、质量管理、安全生产到竣工验收与绿色施工。适用于房屋建筑、市政工程、工业厂房等各类建筑工程项目。',
  category: {
    primary: 'domain',
    secondary: 'construction',
  },
  tags: [
    '建筑',
    'Construction',
    '建筑工程',
    '土木工程',
    '施工管理',
    '工程监理',
    'BIM',
    '质量验收',
    '安全生产',
    '造价管理',
    '绿色建筑',
  ],
  dependencies: [],
  activation: {
    projectTypes: ['建筑', '建筑工程', '土木工程', 'Construction', '施工', '建设'],
    domains: ['construction', 'civil_engineering', 'building'],
    priority: 80,
  },
  basePriority: 80,
  knowledge: {
    // ── rules（规则）8 条 ──
    rules: [
      {
        id: 'cs-rule-001',
        title: '安全生产红线与强制标准',
        content:
          '建筑施工必须严守安全生产红线：落实"安全第一、预防为主、综合治理"方针，严格执行《建筑施工安全检查标准》（JGJ 59）。所有进场人员须经三级安全教育（公司、项目部、班组）并考核合格后方可上岗。特种作业人员（电工、焊工、起重工、架子工等）必须持有效特种作业操作证。危险性较大的分部分项工程（深基坑、高支模、起重吊装、脚手架等）必须编制专项施工方案并组织专家论证。现场须设置明显的安全警示标志，临边洞口必须设置防护栏杆或盖板，高处作业人员必须正确佩戴安全带并做到高挂低用。发生事故必须按"四不放过"原则处理：事故原因未查清不放过、责任人员未处理不放过、整改措施未落实不放过、有关人员未受到教育不放过。',
        stage: 2,
        sourceRefs: [{ layer: 'L1', sourceId: 'jgj-59', section: 'safety-check-standard' }],
        provenance: 'official',
      },
      {
        id: 'cs-rule-002',
        title: '质量三检制与验收规范',
        content:
          '建筑工程施工质量实行"自检、互检、交接检"三检制度：班组完成每道工序后先由操作工人自检，再由班组内部互检，最后由下一道工序班组进行交接检——三道检查均合格后方可报监理验收。隐蔽工程（钢筋、防水、地基基础等）必须在覆盖前经监理工程师验收签认，未经签认不得进行下道工序。关键工序（混凝土浇筑、钢结构焊接、防水施工等）实行旁站监理制度，监理人员全程在场监督。工程质量验收严格执行GB 50300《建筑工程施工质量验收统一标准》，按检验批→分项工程→分部工程→单位工程逐级验收。任何质量缺陷须按"发现→记录→分析原因→制定方案→实施整改→复验闭合"闭环处理，不得隐瞒或擅自修补。检测报告、验收记录须完整归档且签字盖章齐全。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'gb-50300', section: 'quality-acceptance' }],
        provenance: 'official',
      },
      {
        id: 'cs-rule-003',
        title: '进度计划与资源均衡',
        content:
          '施工进度计划编制须遵循"整体规划、分层细化、动态调整"原则。先依据合同工期和里程碑节点倒排总体进度计划（一级网络计划），再分解为月度、周度计划（二级、三级计划），最终细化为日作业计划。进度控制采用前锋线比较法或挣值法（EV）监控偏差：当关键线路延误超过总工期的5%或自由时差被完全消耗时，必须启动赶工措施——增加作业班次、增加施工段、优化工序搭接或调整施工方案。资源均衡原则：劳动力、材料、机械设备按S曲线分布——进场→高峰→退场三阶段，避免出现劳动力骤然增减（窝工或抢工）。多工种交叉作业时编制详细的综合施工进度计划，明确各专业插入时间和退出时间，减少相互干扰和等工。进度计划须经建设、监理、施工三方签认后作为进度控制的合同依据。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'gb-t-50326', section: 'schedule-management' }],
        provenance: 'official',
      },
      {
        id: 'cs-rule-004',
        title: '造价控制与变更签证',
        content:
          '工程造价控制实行"估算→概算→预算→结算→决算"五阶段递进控制。施工阶段造价控制的核心是变更管理和签证管理：设计变更须经"提出→审核→批准→实施→计量→计价"六步流程，变更单须注明变更原因、部位、工程量增减、造价影响和工期影响。现场签证须在事件发生后7日内办理，逾期视为放弃——签证单须附现场照片、测量数据、计算书等支撑资料，不得签"情况属实"等模糊用语。材料价格调整按合同约定方式执行——固定价格合同不调价、可调价合同按信息价或市场价指数调整。工程进度款支付采用"计量→审核→支付"流程，按月或按节点支付，保留5%-10%的质量保证金至缺陷责任期满。竣工结算须在竣工后28天内提交完整结算资料，逾期按合同约定承担违约责任。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'gb-50500', section: 'cost-control' }],
        provenance: 'official',
      },
      {
        id: 'cs-rule-005',
        title: '设计变更与工程洽商',
        content:
          '设计变更是施工阶段造价和工期变化的首要原因，必须严格管控。变更分类：A类（重大变更——改变结构体系、建筑功能、主要材料设备）须原设计审批部门重新审批；B类（一般变更——局部修改不涉及结构安全和使用功能）由设计代表和建设单位现场确认；C类（微小变更——尺寸调整、材料代换等）由监理工程师现场签认。无论哪类变更，均须先办洽商后施工——严禁先施工后补单（"先干后签"行为一经发现须停工整改）。设计变更洽商单须编号连续、签字盖章齐全、附图清晰、工程量计算准确。涉及造价的变更须注明增减金额并附明细计算书。所有变更须在施工日志中记录变更单编号和实施时间，竣工图须反映所有已实施的变更。变更频繁的分部分项工程应在进度例会上专题分析原因并制定减少变更的措施。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'gb-t-50326', section: 'change-management' }],
        provenance: 'official',
      },
      {
        id: 'cs-rule-006',
        title: '材料进场检验与取样',
        content:
          '建筑工程材料实行进场检验制度：所有进场材料须有出厂合格证、质量证明文件和检测报告（"三证"齐全）。材料进场后由监理工程师见证取样送检——取样方法、数量、部位须符合规范要求（如钢筋每批次每炉号每60t取一组、混凝土每100m³取一组试块、防水卷材每5000m²取一组）。未经检验或检验不合格的材料严禁使用，已进场的不合格材料须挂"不合格"标识并限期退场。涉及结构安全和重要使用功能的材料（钢筋、水泥、防水材料、保温材料等）须实行见证取样检验——由监理工程师全程监督取样封样送检。检测单位须具有相应资质且与施工单位无隶属关系。材料检验报告须纳入工程档案，与进场台账一一对应。新材料、特殊材料须有省级以上建设行政主管部门的推广证书或专家论证意见。',
        stage: 2,
        sourceRefs: [{ layer: 'L1', sourceId: 'gb-50204', section: 'material-inspection' }],
        provenance: 'official',
      },
      {
        id: 'cs-rule-007',
        title: '危大工程专项方案',
        content:
          '危险性较大的分部分项工程（简称"危大工程"）须按住房城乡建设部37号令《危险性较大的分部分项工程安全管理规定》执行专项方案管理。危大工程范围包括：基坑开挖深度≥3m、模板支撑高度≥5m或跨度≥10m、起重吊装单件重量≥10kN、脚手架高度≥24m、拆除爆破工程等。专项施工方案须由施工单位技术负责人审核、总监理工程师审批后实施，超过一定规模的危大工程（深基坑≥5m、模板支撑高度≥8m、起重吊装≥30kN等）须组织专家论证。方案须包含：工程概况、编制依据、施工计划、施工工艺技术、安全保证措施、施工管理及作业人员配备、验收要求、应急处置措施、计算书及图纸。实施中严格按方案施工——方案与实际不符的须立即停工整改或重新报审。',
        stage: 2,
        sourceRefs: [{ layer: 'L1', sourceId: 'mohurd-37', section: 'hazardous-works' }],
        provenance: 'official',
      },
      {
        id: 'cs-rule-008',
        title: '绿色施工与环保合规',
        content:
          '建筑工程绿色施工须执行《建筑工程绿色施工规范》（GB/T 50905）和《建筑工程绿色施工评价标准》（GB/T 50640）。绿色施工四节一环保：节能（选用节能设备、优化施工组织减少能耗）、节地（合理布置施工平面减少临时占地、土方平衡减少取弃土）、节水（雨水收集利用、循环水养护、节水器具）、节材（精确下料减少损耗、周转材料复用、建筑垃圾分类回收利用）、环境保护（扬尘控制—洒水覆盖、噪声控制—低噪设备隔声围挡、光污染—遮光罩、水污染—沉淀池处理）。施工组织设计中须有绿色施工专章，明确"四节一环保"的具体指标和措施。绿色施工措施费在工程预算中单独列项。施工过程留存影像资料和监测数据作为绿色施工评价依据。扬尘控制执行"六个百分百"：施工区域百分百围挡、物料百分百覆盖、出入车辆百分百冲洗、施工道路百分百硬化、拆除百分百湿法作业、渣土车辆百分百密闭运输。',
        stage: 2,
        sourceRefs: [
          { layer: 'L1', sourceId: 'gb-t-50905', section: 'green-construction' },
          { layer: 'L1', sourceId: 'gb-t-50640', section: 'green-evaluation' },
        ],
        provenance: 'official',
      },
    ],

    // ── patterns（模式）8 条 ──
    patterns: [
      {
        id: 'cs-pat-001',
        title: '施工组织设计编制',
        content:
          '施工组织设计是指导施工全过程的技术经济纲领性文件，按GB/T 50502《建筑施工组织设计规范》编制。内容须包含：工程概况（建筑规模、结构形式、工期目标、质量目标、安全目标）、施工部署（施工区段划分、施工顺序、流水节拍）、施工进度计划（网络图或横道图、关键线路、里程碑节点）、资源配置计划（劳动力/材料/机械/资金需求曲线）、施工总平面布置（临时设施/道路/堆场/塔吊位置/水电管线）、主要施工方案（地基基础/主体结构/装饰装修/机电安装等分部方案）、质量安全保证措施、绿色施工措施、应急预案。编制流程：熟悉图纸与合同→现场踏勘→确定施工部署→编制进度计划→资源配置→平面布置→审核审批。施工组织设计须在开工前完成审批，施工中如条件重大变化须及时修订。超过一定规模的工程须组织专家评审。',
        stage: 1,
        sourceRefs: [
          { layer: 'L1', sourceId: 'gb-t-50502', section: 'construction-organization-plan' },
        ],
        provenance: 'official',
      },
      {
        id: 'cs-pat-002',
        title: 'BIM协同管理',
        content:
          'BIM（建筑信息模型）协同管理以三维数字模型为核心集成建筑全生命周期信息。施工阶段BIM应用包括：碰撞检查——在虚拟模型中检测结构/机电/管线碰撞提前解决避免现场返工（节约造价5%-10%）；4D施工模拟——将3D模型与进度计划关联，可视化施工过程优化工序搭接和场地利用；5D造价管理——模型关联工程量清单实现动态成本跟踪；预制加工——基于BIM模型驱动数控设备进行钢结构/管道/幕墙预制加工提高精度和效率；现场管理——模型+移动端进行质量安全检查/问题定位与跟踪闭环；竣工交付——交付含完整施工信息的竣工BIM模型作为运维阶段数字孪生基础。BIM协同平台（如BIM 360/鲁班/广联达等）实现多方实时协同：设计→施工→监理→业主在同一平台操作更新。',
        stage: 2,
        sourceRefs: [
          { layer: 'L1', sourceId: 'bim-standard', section: 'collaborative-management' },
        ],
        provenance: 'official',
      },
      {
        id: 'cs-pat-003',
        title: '工程量清单计价',
        content:
          '工程量清单计价是国际通行的工程造价计价模式，按GB 50500《建设工程工程量清单计价规范》执行。核心原则：量价分离——招标人提供统一的工程量清单（量的风险由招标人承担），投标人自主报价（价的风险由投标人承担）。清单由五部分组成：分部分项工程量清单（按统一编码和项目特征描述）、措施项目清单（技术措施+组织措施）、其他项目清单（暂列金/暂估价/计日工/总承包服务费）、规费项目清单（社会保险/住房公积金等不可竞争费）、税金项目清单（增值税及附加）。综合单价包含：人工费+材料费+施工机具使用费+企业管理费+利润+一定范围的风险费用。投标报价不得低于成本价（低于所有投标人平均价一定比例视为低于成本——评标委员会有权否决）。',
        stage: 1,
        sourceRefs: [{ layer: 'L1', sourceId: 'gb-50500', section: 'bill-of-quantities' }],
        provenance: 'official',
      },
      {
        id: 'cs-pat-004',
        title: '关键链与缓冲区',
        content:
          '关键链项目管理（CCPM）在建筑项目中通过设置缓冲区应对不确定性，比传统关键路径法更有效。三类缓冲：项目缓冲（PB）——置于关键链末端，吸收关键链上各任务的不确定性累积影响，通常为关键链总工期的25%-33%；汇入缓冲（FB）——置于非关键链汇入关键链的接口处，保护关键链不被非关键线路延迟影响；资源缓冲（RB）——在关键链上关键资源切换处设置预警信号（非时间缓冲）确保资源按时到位。缓冲消耗监控采用三色区管理：绿色区（缓冲消耗<1/3）正常无需行动；黄色区（1/3-2/3）评估是否需要赶工措施；红色区（>2/3）立即启动应急预案。与传统方法相比，CCPM减少了学生症候群（工作拖延到最后期限）和帕金森定律（工作膨胀填满可用时间）对工期的影响，在多标段大型项目中效果尤为显著。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'ccpm-method', section: 'buffer-management' }],
        provenance: 'official',
      },
      {
        id: 'cs-pat-005',
        title: '合同管理模式',
        content:
          '建筑工程合同管理涵盖招标→签约→履约→变更→索赔→结算全过程。常见合同计价模式：固定总价合同——风险主要由承包商承担，适用于图纸明确、工程量确定的小型工程；可调价合同——按物价指数或信息价调整，适用于工期较长（>1年）的工程；成本加酬金合同——成本实报实销+管理费+利润，适用于紧急抢修或研究性工程；工程量清单综合单价合同——量按实计、价按投标价——国内最普遍的计价模式。合同管理要点：合同交底——签约后向项目全体管理人员解读关键条款（付款条件/变更程序/索赔时限/违约责任）；履约跟踪——建立合同执行台账记录每项条款的执行状态和到期提醒；变更索赔管理——按合同约定的程序和时限提交索赔通知和详细索赔报告；分包合同管理——分包合同须与总包合同背靠背（相应条款同步约束）避免总包承担分包造成的风险。FIDIC合同条件（红皮书/黄皮书/银皮书）为国际工程合同范本。',
        stage: 1,
        sourceRefs: [
          { layer: 'L1', sourceId: 'fidic-2017', section: 'contract-management' },
          { layer: 'L1', sourceId: 'gb-t-50326', section: 'contract-management' },
        ],
        provenance: 'official',
      },
      {
        id: 'cs-pat-006',
        title: '进度S曲线与挣值',
        content:
          '进度S曲线和挣值管理（EVM）是建筑工程进度-成本联合监控的核心工具。S曲线：以时间为横轴、累计完成百分比（或投资额）为纵轴——实际进度曲线在计划曲线右侧说明进度滞后，左侧说明超前。挣值三个基本参数：计划值PV（Plan Value——计划完成工作的预算）、挣值EV（Earn Value——实际完成工作的预算）、实际成本AC（Actual Cost——实际花费）。四个评价指标：进度偏差SV=EV-PV（正超前负滞后）、成本偏差CV=EV-AC（正节约负超支）、进度绩效指数SPI=EV/PV（<1滞后>1超前）、成本绩效指数CPI=EV/AC（<1超支>1节约）。当SPI<0.9或CPI<0.9时启动预警和纠偏措施。竣工估算EAC=AC+(BAC-EV)/CPI（按当前效率预测竣工成本），竣工工期预测ETC=(BAC-EV)/SPI。挣值分析须每月进行一次，与进度款支付联动——当SPI和CPI同时<1时暂停付款审核进度计划。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'pmbok-7', section: 'earned-value' }],
        provenance: 'official',
      },
      {
        id: 'cs-pat-007',
        title: '质量验收划分',
        content:
          '建筑工程质量验收按GB 50300划分为：检验批→分项工程→分部工程→单位工程四级。检验批是同条件下一定数量样本的集合（如一层柱钢筋绑扎、一个施工段混凝土浇筑），是质量验收的最小单位——由专业监理工程师组织施工单位项目专业质量负责人验收。分项工程由若干检验批组成（如钢筋工程包含钢筋加工、钢筋连接、钢筋安装等检验批）——由专业监理工程师组织。分部工程按专业性质和建筑部位划分（地基与基础、主体结构、建筑装饰装修、建筑屋面、建筑给排水及供暖、建筑电气、智能建筑、通风与空调、电梯）——由总监理工程师组织施工单位项目负责人和技术质量负责人验收。单位工程是具备独立使用功能的完整建筑物或构筑物——由建设单位项目负责人组织设计/勘察/施工/监理五方验收并报建设行政主管部门备案。各层级验收均须有完整的验收记录，签字盖章齐全。验收不合格须按"返工重做→重新验收"或"加固处理→设计认可→验收"路径处理。',
        stage: 4,
        sourceRefs: [{ layer: 'L1', sourceId: 'gb-50300', section: 'acceptance-division' }],
        provenance: 'official',
      },
      {
        id: 'cs-pat-008',
        title: '竣工验收流程',
        content:
          '建筑工程竣工验收是建设程序的最后环节，是投资成果转入使用的标志。验收条件：完成工程设计和合同约定的全部内容；施工单位自评合格并提交竣工报告；监理单位评估合格并提交质量评估报告；勘察设计单位提交质量检查报告；规划/消防/环保/人防/防雷等专项验收通过；工程资料完整归档（含竣工图）；施工单位签署工程质量保修书；住宅工程还须通过分户验收。验收程序：施工单位自评→提交竣工报告→监理组织预验收→整改预验收问题→建设单位组织正式验收（五方责任主体+相关专家+政府监督机构）→验收会议（各责任主体汇报→分组现场检查→汇总意见→形成验收结论）→验收备案（建设行政主管部门）。竣工验收须有政府质量监督机构监督。验收合格后28天内办理备案手续。住宅工程交付时须向业主提供"两书"：住宅质量保证书和住宅使用说明书。',
        stage: 6,
        sourceRefs: [
          { layer: 'L1', sourceId: 'gb-50300', section: 'completion-acceptance' },
          { layer: 'L1', sourceId: 'construction-law', section: 'completio' },
        ],
        provenance: 'official',
      },
    ],

    // ── antiPatterns（反模式）8 条 ──
    antiPatterns: [
      {
        id: 'cs-ap-001',
        title: '边设计边施工',
        content:
          '"三边工程"（边设计、边施工、边修改）是建筑工程最危险的反模式。危害：设计深度不足导致施工中大量变更——窝工返工、造价失控、工期延误；结构体系或关键节点未经完整计算分析即施工——安全风险不可控；各专业设计不同步（建筑图出了结构图还在改、机电图跟上时已施工完主体——碰撞返工代价巨大）。典型案例：某商业综合体项目因投资方急于开工，在初步设计阶段即进场施工，导致基础施工后上部结构方案推翻重来——损失基础工程约800万元且工期延误4个月。防治措施：坚持"先设计后施工"不可妥协——基础未完成施工图设计审批不得开工；实行设计阶段门禁：方案设计→初步设计→施工图设计→图纸审查→技术交底，每个阶段完成后方可进入下一阶段；施工中发现的设计问题走"提疑→设计回复→设计变更→实施"流程不得擅改。EPC模式下设计施工一体化须在合同中明确设计深度和变更程序。',
        stage: 1,
        sourceRefs: [
          { layer: 'L1', sourceId: 'construction-law', section: 'design-before-construction' },
        ],
        provenance: 'official',
      },
      {
        id: 'cs-ap-002',
        title: '低价中标高价索赔',
        content:
          '"低价中标、高价索赔"是建筑市场恶性竞争的典型反模式。投标人以低于成本价或远低于市场价中标，进场后通过大量变更、签证、索赔甚至偷工减料来获取利润。手法包括：利用设计图纸缺陷扩大变更量——"图纸标注不明处"按最高价做法申报；利用合同漏洞——模糊条款作有利解释；拖延工期向发包方索赔赶工费；材料以次充好套取差价；虚报工程量和计日工。防治措施：招标时设置最高限价和最低控制价（低于所有投标均价一定比例或低于最高限价一定比例的报价否决——防止恶意低价）；评标采用综合评估法——价格分权重控制在30%-50%而非最低价中标；签约前进行清标——详细核对投标报价的完整性和合理性；施工阶段严格变更签证审批——量价分离审核、监理和造价咨询双重把关；合同约定不平衡报价扣减——投标时报价偏离市场价±20%以上的项目在变更时按市场价调整。',
        stage: 1,
        sourceRefs: [{ layer: 'L1', sourceId: 'bidding-law', section: 'price-manipulation' }],
        provenance: 'official',
      },
      {
        id: 'cs-ap-003',
        title: '进度压缩牺牲质量',
        content:
          '为追赶工期而压缩合理施工工序间隔时间，以牺牲质量换取进度。典型行为：混凝土浇筑后未达到规定强度即拆模加载（规范要求悬挑构件达到100%设计强度方可拆模，一般构件≥75%）；回填土未分层夯实即进行上层施工——导致不均匀沉降和地面开裂；防水层未充分干燥即进行下一层施工——导致渗漏隐患；钢结构焊接后未充分冷却即受力加载——焊接应力释放导致变形；装饰工程湿作业未干燥即进行涂料施工——空鼓脱落。防治措施：建立工序最小间隔时间清单——每道工序标注规范要求的最短技术间歇时间（混凝土养护时间、砂浆干燥时间、焊接冷却时间等）并在进度计划中预留；进度检查不仅看产出更看工序间隔是否符合规范——质检员对关键工序间隔时间进行旁站记录；当进度与质量冲突时质量优先——工期延误通过增加资源、优化方案弥补而非压缩技术间隔；赶工方案须经技术负责人审批确保不违反质量底线。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'gb-50204', section: 'curing-time' }],
        provenance: 'official',
      },
      {
        id: 'cs-ap-004',
        title: '资料后补造假',
        content:
          '施工资料滞后于施工进度甚至竣工后集中补做——"做资料"代替"记资料"。危害：资料与工程实际脱节——检测报告日期在取样日期之前、隐蔽验收记录在覆盖日期之后、材料进场台账与实物不符；资料无法反映真实工程质量——质量问题被"做"成合格；竣工图不反映现场实际（变更未在图上标注）——运维阶段依据错误的竣工图作业产生安全风险；法律责任——工程资料是工程质量终身责任追溯的核心证据，资料造假是刑事犯罪（刑法第229条提供虚假证明文件罪）。防治措施：资料与施工同步——各工序完成同时形成资料，日清周结月归档；资料员驻场实时收集而非后补；监理对资料同步性进行日常检查——进度款支付前核查资料完整性；使用项目管理信息系统强制流程约束——上道工序资料未录入系统无法启动下道工序；电子档案+纸质档案双备份防丢失；竣工图须在施工中随变更即时标注而非竣工后重画。',
        stage: 2,
        sourceRefs: [
          { layer: 'L1', sourceId: 'construction-law', section: 'documentation-integrity' },
        ],
        provenance: 'official',
      },
      {
        id: 'cs-ap-005',
        title: '隐蔽工程不验收',
        content:
          '隐蔽工程（钢筋绑扎、防水层、预埋管线、地基验槽等）在覆盖前未经监理验收签认即进行下道工序。危害：钢筋数量/规格/间距/保护层厚度等关键指标未验证即被混凝土覆盖——结构安全隐患不可逆；防水层缺陷被后续层覆盖后渗漏维修极其困难且代价巨大（需要凿除上层所有构造层）；预埋管线位置偏差或遗漏导致后期凿墙开洞破坏结构；地基持力层土质与勘察报告不符未被发现——建筑物沉降风险。典型案例：某住宅项目地下室底板防水施工后未经闭水试验即浇筑保护层——交工后大面积渗漏，维修费用约300万元且影响使用功能。防治措施：建立隐蔽工程清单——所有须验收的隐蔽工程名称、验收标准、验收程序清单化并公示在现场；隐蔽工程验收实行"报验→验收→签认→覆盖"四步流程——未经签认不得覆盖；关键隐蔽工程（地基验槽、钢筋、防水）监理须全程旁站；影像资料留存——每道隐蔽工程拍摄带日期水印的照片或视频归档。',
        stage: 4,
        sourceRefs: [{ layer: 'L1', sourceId: 'gb-50204', section: 'hidden-works-inspection' }],
        provenance: 'official',
      },
      {
        id: 'cs-ap-006',
        title: '材料以次充好',
        content:
          '施工中替换使用低于设计要求的材料以获取差价利润。典型手法：钢筋代换——用同直径三级钢替换四级钢（强度差20%）、小厂钢筋冒充大厂钢筋；混凝土标号降低——C30浇成C25（抗压强度降低约17%）；防水材料换品牌——国标换非标、厚度缩水；保温材料密度不足——容重不达标导致保温性能下降；电缆截面缩水——铜芯直径变小导致过流发热；管材壁厚不足——承压能力降低。防治措施：材料进场"三证"核验（出厂合格证、质量证明文件、型式检验报告）且与合同品牌型号规格逐一核对；见证取样送检——每批次材料在监理见证下现场取样送第三方检测机构；建立材料样品库——封样样品与进场材料比对；品牌锁定——主要材料在合同中明确品牌及型号范围，代换须经设计同意并重新核算；发现以次充好行为从严处罚——清除出场+合同违约金+不良行为记录上报建设行政主管部门。',
        stage: 2,
        sourceRefs: [{ layer: 'L1', sourceId: 'gb-50204', section: 'material-substitution' }],
        provenance: 'official',
      },
      {
        id: 'cs-ap-007',
        title: '专业分包无协调',
        content:
          '各专业分包（土建/机电/消防/智能化/幕墙/电梯/精装修等）各自为政缺乏协调统筹，施工现场混乱冲突。典型问题：机电管线与结构梁碰撞——梁已浇筑完成管线无法穿越需凿洞（破坏结构）；消防管与暖通风管抢空间——标高冲突返工；幕墙预埋件遗漏——结构完成后补埋化学螺栓（费用增加且可靠性降低）；精装修进场时土建未完成湿作业——装饰面受污损返工；各专业进度不协同——土建完成但机电滞后导致工期延误。防治措施：实行施工总承包管理——总包对全部专业分包进度/质量/安全统一协调管理；建立综合管线布置图（CSD）——所有专业管线在图纸上先综合排布确定标高路径避免现场碰撞；定期召开专业协调会——每周至少一次各专业分包负责人参加协调会解决接口问题；建立工作面交接制度——上道工序完成经下道工序接收签认后方可移交；BIM综合应用——三维管线综合排布+碰撞检测+4D进度模拟。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'gb-t-50326', section: 'subcontract-coordination' }],
        provenance: 'official',
      },
      {
        id: 'cs-ap-008',
        title: '安全投入削减',
        content:
          '为降低成本而削减安全生产投入——减少安全防护设施、降低劳保用品标准、减少安全培训、压缩安全人员配置。典型行为：脚手架连墙件数量不足、安全网破损不更换、临边洞口防护缺失、安全帽安全带以次充好、特种作业人员无证上岗、安全员配备不足（<1万m²配1人的法规要求）、安全教育走形式（签字即教育）、应急预案有文本无演练。事故数据表明：建筑安全事故中高处坠落占50%以上、物体打击占15%、起重伤害占8%——这些均与安全投入不足直接相关。防治措施：安全文明施工费单独列项不参与竞争——投标时按不可竞争费报列；安全费用使用台账——每笔安全支出记录明细并由监理审核；开工前安全条件审查——安全费用计划未审批、安全措施未到位不开工；安全费用不得挪作他用——违规挪用按合同违约处罚；建立安全投入最低标准清单——每个施工阶段必须到位的安全设施和人员配置；定期安全投入审计——独立第三方对安全费用使用合规性进行审计。',
        stage: 2,
        sourceRefs: [
          { layer: 'L1', sourceId: 'construction-safety-law', section: 'safety-investment' },
          { layer: 'L1', sourceId: 'jgj-59', section: 'safety-cost' },
        ],
        provenance: 'official',
      },
    ],

    // ── examples（示例）8 条 ──
    examples: [
      {
        id: 'cs-ex-001',
        title: '住宅项目WBS模板',
        content:
          '典型住宅建筑项目WBS（工作分解结构）7大阶段模板。阶段1——前期准备：立项与可行性研究、土地获取与规划许可、勘察设计招标、施工图设计审查、施工许可办理。阶段2——地基与基础：土方开挖与支护、桩基施工（灌注桩或预制桩）、承台与基础梁、地下室结构（如有）、地下防水、回填土。阶段3——主体结构：剪力墙/框架柱→梁板梯→砌体填充→构造柱圈梁→主体结构验收。阶段4——屋面工程：找坡找平→保温层→防水层→保护层→屋面设备基础。阶段5——装饰装修：内外墙抹灰→门窗安装→地面→涂饰→吊顶→细部装修。阶段6——机电安装：给排水管道→电气配管穿线→暖通管道→设备安装→智能化系统→电梯安装→消防系统→调试。阶段7——室外配套：小区道路→给排水管网→供配电→景观绿化→围墙大门→竣工验收→交房。每阶段下分解到分部→分项→检验批层级，每个分项有明确的责任人、起止时间、资源需求和质量验收标准。住宅项目约200-300个分项工程。',
        stage: 1,
        sourceRefs: [{ layer: 'L1', sourceId: 'pmbok-7', section: 'wbs' }],
        provenance: 'official',
      },
      {
        id: 'cs-ex-002',
        title: '商业综合体进度计划',
        content:
          '某大型商业综合体（建筑面积15万m²，地下3层、地上5层裙楼+2栋塔楼）施工总进度计划。总工期：28个月。关键线路：桩基施工（3月）→地下室结构（4月）→裙楼主体结构（5月）→塔楼主体结构（6月）→屋面与幕墙（4月）→机电安装与装修（6月）→调试与验收（2月）。里程碑节点：开工后6月完成正负零（地下室出地面）、12月裙楼封顶、18月塔楼封顶、24月外立面完成亮相、28月竣工备案。施工部署：分A/B/C三个施工区平行施工——A区裙楼（商业）先完工先开业、B/C区塔楼（办公+酒店）同步施工。资源高峰：劳动力高峰约1200人（结构施工期）、塔吊5台、混凝土泵车4台。进度控制：每周进度例会+前锋线检查+挣值分析；关键线路每延误1周启动赶工程序——增加作业班次/增加施工段/优化方案。雨季施工预留每月3天不可抗力延误余量。',
        stage: 1,
        sourceRefs: [{ layer: 'L1', sourceId: 'pmbok-7', section: 'schedule-management' }],
        provenance: 'official',
      },
      {
        id: 'cs-ex-003',
        title: '市政道路施工组织',
        content:
          '某市政主干道（长度3.2km、红线宽60m、双向8车道+非机动车道+人行道+绿化带）施工组织方案。施工部署分4个施工段平行流水：第1段K0+000-K0+800（起点立交）、第2段K0+800-K1+600（跨河桥）、第3段K1+600-K2+400（下穿隧道）、第4段K2+400-K3+200（填挖方段）。总体施工顺序：施工便道→清表与地基处理→雨污水管道→路基填挖→底基层→基层→面层（分三层沥青摊铺）→附属设施（路缘石/人行道/绿化/照明/标线/信号灯）。关键控制点：跨河桥桩基施工须在枯水期完成（避开汛期——11月-次年3月）；下穿隧道开挖须降水到位且支护紧跟——监测周边建筑物沉降；路基填方分层压实每层≤30cm压实度≥95%（重型击实标准）；沥青摊铺须连续作业减少冷接缝——下面层与上面层间洒粘层油保证粘结。管线协调：与给水/燃气/电力/通信等管线单位协调迁改时间——管线迁改完成后方可进行该段路基施工。交通导改方案：施工期间保证双向2车道通行+临时信号灯+限速标志+夜间警示灯。',
        stage: 2,
        sourceRefs: [
          { layer: 'L1', sourceId: 'cjj-1', section: 'road-construction' },
          { layer: 'L1', sourceId: 'jtg-3450', section: 'subgrade-works' },
        ],
        provenance: 'official',
      },
      {
        id: 'cs-ex-004',
        title: '工业厂房预算编制',
        content:
          '某单层钢结构工业厂房（建筑面积8000m²、跨度24m×3跨、檐高12m、内设10t吊车）预算编制实例。按GB 50500清单计价规范编制。分部分项工程费：土方工程（挖填运）约45万元、基础工程（独立基础+基础梁）约120万元、钢结构工程（钢柱钢梁钢檩条+支撑+除锈防火涂装）约380万元、围护工程（彩钢墙面板+屋面板+保温棉+采光板）约95万元、地面工程（碎石垫层+混凝土面层+硬化剂）约80万元、门窗工程（工业提升门+铝合金窗）约30万元、给排水工程约15万元、电气工程（配电+照明+防雷接地）约50万元、消防工程（消火栓+灭火器+报警）约20万元。措施项目费：脚手架+模板+垂直运输+大型机械进退场约55万元。其他项目费：暂列金50万元、计日工10万元。规费：社会保险+住房公积金约28万元。税金：增值税约72万元。总造价约1000万元，单方造价约1250元/m²（钢结构工业厂房经济指标在1000-1500元/m²为合理区间）。',
        stage: 1,
        sourceRefs: [{ layer: 'L1', sourceId: 'gb-50500', section: 'budget-estimate' }],
        provenance: 'official',
      },
      {
        id: 'cs-ex-005',
        title: '装修工程阶段划分',
        content:
          '住宅精装修工程施工阶段划分与工序流程（以一套100m²住宅为例，工期约60天）。阶段1——开工准备与拆除（3天）：施工放线（1:1实地放样）→拆除需改造的非承重墙→清除原墙面涂料铲除→垃圾清运。阶段2——水电改造（7天）：水电管线开槽→布管穿线→水管打压试验（0.8MPa保持30min压降≤0.05MPa）→电线路绝缘电阻测试（≥0.5MΩ）→预埋隐蔽验收。阶段3——瓦工（15天）：墙地面找平→防水施工（卫生间墙面≥1.8m高、闭水试验48h）→贴墙砖（先墙后地、墙砖压地砖）→贴地砖→门槛石窗台石安装→养护。阶段4——木工（10天）：吊顶龙骨→造型制作→门窗套安装→定制柜体安装。阶段5——油工（12天）：墙面批刮腻子3遍→打磨→底漆1遍→面漆2遍→木器漆。阶段6——安装工程（8天）：灯具/开关插座/卫浴洁具/厨房电器/热水器/空调/地暖/柜门/踢脚线/五金件。阶段7——开荒保洁与验收（3天）：全面清洁→空气质量检测（甲醛/TVOC/苯/氡）→交付验收。各阶段之间留1-2天技术间歇（防水干燥/腻子干燥/漆干燥等）。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'gb-50210', section: 'decoration-work' }],
        provenance: 'official',
      },
      {
        id: 'cs-ex-006',
        title: '桥梁工程里程碑',
        content:
          '某预应力混凝土连续梁桥（主跨80m+120m+80m三跨、总长280m、桥宽33m双向6车道）施工里程碑计划。总工期24个月。里程碑1——施工准备与临时工程（2月）：施工便道/便桥→预制场建设→混凝土拌合站→试验室→测量控制网→桩基施工平台搭设。里程碑2——基础与下部结构（7月）：桩基（钻孔灌注桩Φ2.0m深65m共48根）→承台→墩身→盖梁。里程碑3——上部结构（9月）：0号块支架现浇→挂篮悬浇施工（每节段3-4m、共2×14对节段、每节段周期约10天）→边跨现浇段→合龙段（先边跨后中跨、温度最低时合龙）。里程碑4——桥面系与附属（4月）：桥面防水→沥青铺装→伸缩缝→护栏→照明→排水→标线标牌。里程碑5——荷载试验与验收（2月）：静载试验（最大试验荷载为设计荷载的1.0-1.2倍）→动载试验（跑车/跳车/刹车）→竣工验收。关键控制：悬浇施工线形控制——每节段浇前测标高、浇后测标高、张拉后测标高——三阶段测量数据与理论值对比偏差>10mm调整下一节段立模标高；合龙温度15-20℃、合龙口临时锁定劲性骨架→浇混凝土→张拉合龙束；桩基施工防止塌孔和断桩——泥浆护壁比重1.1-1.3、清孔沉渣厚度≤5cm。',
        stage: 2,
        sourceRefs: [
          { layer: 'L1', sourceId: 'jtg-3650', section: 'bridge-construction' },
          { layer: 'L1', sourceId: 'jtg-t-3650-02', section: 'cantilever-casting' },
        ],
        provenance: 'official',
      },
      {
        id: 'cs-ex-007',
        title: '机电安装工序',
        content:
          '大型公共建筑机电安装工程工序与协调流程（以10万m²甲级写字楼为例）。机电系统包含：给排水（生活给水、中水、热水、污废水、雨水）、暖通空调（制冷机房、冷却塔、锅炉房、空调机组、风机盘管、新风、排烟）、强电（变配电、动力、照明、防雷接地）、弱电（消防报警、楼宇自控、安防监控、门禁、综合布线、广播、信息发布、停车管理）、消防（消火栓、自动喷淋、气体灭火、消防水泵）。工序：预埋阶段——结构施工时预埋套管/穿墙管/接地板/线管盒；安装阶段——主管道/主桥架/干线电缆→支管/支桥架/支线→设备安装→终端安装；调试阶段——单机试运转→系统联动调试→综合效能测试→带负荷试运行。协调要点：综合管线排布（CSD）——所有专业管线在走廊/管井/机房等空间有限处先进行综合排布，遵循"小管让大管、有压让无压、电上水下、风上水管"原则；机房设备运输路径——设备订货时确认外形尺寸能否通过建筑门洞/通道/电梯/吊装口；BIM综合应用——管线碰撞检测+预留洞核查+检修空间检查+安装顺序模拟。',
        stage: 3,
        sourceRefs: [
          { layer: 'L1', sourceId: 'gb-50243', section: 'ventilation-installation' },
          { layer: 'L1', sourceId: 'gb-50303', section: 'electrical-installation' },
        ],
        provenance: 'official',
      },
      {
        id: 'cs-ex-008',
        title: '景观工程施工方案',
        content:
          '某住宅小区景观工程施工方案（绿化面积2万m²、硬质铺装8000m²、水景500m²、景观亭2座、儿童活动场1处）。施工部署：土方造型→地下管线→硬质铺装→水景结构→绿化种植→景观小品→照明→细部收口。关键工序：土方造型按设计等高线放样——堆坡高度与设计偏差≤10cm、坡度≥1.5%保证排水；硬质铺装基层压实度≥93%（重型击实）、混凝土垫层强度C15厚度10-15cm、面层石材或砖铺贴用1:3干硬性水泥砂浆、缝隙均匀（3-5mm）横平竖直；水景结构防水钢筋混凝土池壁+防水涂料+保护层——闭水试验48h不漏为合格；绿化种植：乔木土球直径≥胸径8-10倍、种植穴底施基肥+回填松土、定根水浇透、支撑牢固（三角支撑或井字支撑）、反季节种植须搭遮阴网+喷水降温+生根剂处理；草坪铺设：地坪细整平→轻碾→铺草皮→拍实→浇透水→前两周每日浇水保持湿润。养护期：乔木6个月、灌木3个月、草坪1个月——养护期内植物死亡由施工单位免费更换。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'cjj-82', section: 'landscape-construction' }],
        provenance: 'official',
      },
    ],

    // ── checklists（检查清单）8 条 ──
    checklists: [
      {
        id: 'cs-cl-001',
        title: '开工前准备',
        content:
          '建筑工程开工前准备检查清单（10项，全部通过方可签发开工令）。1. 施工许可——建设工程规划许可证、施工许可证是否已取得并在有效期内？2. 图纸会审——施工图是否已通过审图机构审查？图纸会审纪要是否已签认？3. 施工组织设计——施工组织设计是否已编制完成并审批？危大工程专项方案是否已论证通过？4. 现场三通一平——施工道路通、给排水通、电力通、场地平整是否已完成？5. 测量放线——规划红线桩、建筑定位桩、高程控制点是否已交桩复测并签认？6. 人员到位——项目经理、技术负责人、安全员、质量员、施工员、材料员、资料员等关键岗位人员是否已到岗并录入实名制系统？7. 分包确定——各专业分包是否已确定并签订合同？分包单位资质和人员资格是否核查通过？8. 材料准备——首批材料（钢筋、水泥、砂石、砖等）是否已订货且首批进场时间满足开工需要？9. 机械设备——桩机、塔吊、挖掘机等大型设备是否已进场安装调试或已确定进场时间？10. 试验室——现场试验室或委托检测机构是否已确定？配合比设计是否已完成？',
        stage: 1,
        sourceRefs: [{ layer: 'L1', sourceId: 'gb-t-50326', section: 'preparation' }],
        provenance: 'official',
      },
      {
        id: 'cs-cl-002',
        title: '基础施工就绪',
        content:
          '地基与基础工程施工就绪检查清单（9项）。1. 地基验槽——基底土质是否与勘察报告相符？持力层是否到位？基底标高偏差是否在规范允许范围（-50mm）？如有异常（软土、空洞、地下水）是否已处理并经设计确认？2. 降水排水——基坑降水是否已降至基底以下≥0.5m？排水沟和集水井是否设置且有效运行？3. 桩基检测——工程桩是否已完成承载力检测（静载试验或高应变）和完整性检测（低应变或超声波）且结果合格？桩位偏差是否在规范允许范围？4. 垫层施工——垫层混凝土是否浇筑完成且达到设计强度（≥C15、厚度≥100mm）？5. 防水层——地下防水层是否铺设完成且搭接长度满足要求（≥100mm）？阴阳角是否做附加层？保护层是否施工完成？6. 钢筋绑扎——钢筋规格/数量/间距/保护层厚度是否符合设计？接头位置和接头百分率是否符合规范？7. 模板安装——模板刚度/稳定性/缝隙/脱模剂是否满足要求？截面尺寸偏差是否符合规范？8. 预埋预留——柱墙插筋/设备基础预埋件/穿墙管/接地板/水电预埋管是否按图施工并固定牢固？9. 混凝土浇筑——浇筑方案（顺序/分层厚度/振捣方式）是否已交底？混凝土供应（搅拌站/配合比/运输时间）是否已落实？旁站监理人员是否已安排？',
        stage: 2,
        sourceRefs: [{ layer: 'L1', sourceId: 'gb-50204', section: 'foundation-readiness' }],
        provenance: 'official',
      },
      {
        id: 'cs-cl-003',
        title: '主体施工就绪',
        content:
          '主体结构施工就绪检查清单（9项，每层施工循环执行）。1. 测量放线——轴线/标高/垂直度控制线是否已施放并经复核？层高偏差是否符合规范（层高≤10mm、全高≤30mm）？2. 钢筋工程——钢筋规格/数量/间距/锚固长度/搭接长度/保护层垫块是否符合设计图纸和规范？钢筋隐蔽验收是否已完成签认？3. 模板工程——模板平整度/垂直度/截面尺寸/起拱度是否符合规范？支撑体系是否稳定可靠（间距/步距/剪刀撑/扫地杆）？拆模时混凝土强度是否达到规范要求（板≥50%设计强度、梁拱壳≥75%、悬挑构件≥100%）？4. 混凝土工程——浇筑前模板内杂物是否清理干净？浇筑振捣是否密实（不欠振不漏振）？施工缝留置位置是否合理？浇筑后养护是否及时（12h内开始、养护≥7天/抗渗混凝土≥14天）？5. 砌体工程——砖/砌块含水率是否适宜（过干吸走砂浆水份影响粘结）？砌筑方式（错缝/灰缝饱满度≥80%）是否符合规范？拉结筋是否按规范设置（沿高每500mm、伸入墙内≥1m）？6. 构造柱/圈梁——构造柱钢筋/圈梁钢筋是否与主体结构预埋筋连接？浇筑前砌体马牙槎是否留设？7. 预埋预留——水电管盒/空调洞/油烟洞/燃气洞/弱电箱/等电位端子箱等是否按图预埋预留？8. 垂直度/平整度——每层施工完成后实测实量（垂直度≤5mm/2m、平整度≤4mm/2m）是否记录上墙公示？9. 安全防护——临边洞口是否已设防护？脚手架是否与主体同步搭设且连墙件到位？操作层脚手板是否铺满铺稳？安全平网是否随层张设？',
        stage: 3,
        sourceRefs: [
          { layer: 'L1', sourceId: 'gb-50204', section: 'main-structure' },
          { layer: 'L1', sourceId: 'gb-50203', section: 'masonry' },
        ],
        provenance: 'official',
      },
      {
        id: 'cs-cl-004',
        title: '装修与机电就绪',
        content:
          '装饰装修与机电安装施工就绪检查清单（9项）。1. 主体验收——主体结构是否已通过验收？屋面防水是否已完成闭水试验合格？外门窗框是否已安装并防水密封？2. 湿作业完成——内外墙抹灰是否已完成并养护干燥（含水率达标）？地面找平层是否已完成并养护达到强度？卫生间/阳台防水层是否已完成闭水试验（≥48h）合格？3. 管线敷设——给排水管道/电气配管穿线/暖通管道是否已敷设完成并试压/绝缘测试合格？管道井/吊顶内管线是否已完成隐蔽验收？4. 设备就位——空调机组/水泵/风机/配电柜/控制柜等大型设备是否已就位安装并找平找正？5. 吊顶龙骨——吊顶内管线/设备/管道是否已完成？吊筋/龙骨是否安装牢固（间距/水平度符合要求）？重型灯具/风口检修口是否已预加固？6. 墙面基层——墙面基层是否平整（2m靠尺偏差≤3mm）？阴阳角是否方正？不同材料交接处是否已设防裂网？7. 地面基层——地面基层是否平整（2m靠尺偏差≤3mm）？含水率是否满足面层材料要求（木地板≤12%、地砖无明水）？8. 门窗安装——门框垂直度/水平度是否符合要求？门缝是否均匀（2-3mm）？五金件是否齐全灵活？9. 成品保护——已完成的装饰面（地面/墙砖/门窗/设备等）是否已采取保护措施（保护膜/纸板/木框等）？后续施工是否会破坏已完成的装饰面？',
        stage: 4,
        sourceRefs: [
          { layer: 'L1', sourceId: 'gb-50210', section: 'decoration-readiness' },
          { layer: 'L1', sourceId: 'gb-50243', section: 'mep-readiness' },
        ],
        provenance: 'official',
      },
      {
        id: 'cs-cl-005',
        title: '竣工验收就绪',
        content:
          '工程竣工验收就绪检查清单（10项，全部通过方可报验）。1. 合同内容完成——工程设计和合同约定的全部内容是否已完成？有无甩项（如有须有建设单位和设计单位的书面同意）？2. 单位工程质量——单位工程质量是否已通过施工单位自评合格和监理单位评估合格？各分部/分项验收记录是否完整？3. 专项验收——规划验收/消防验收/环保验收/人防验收/防雷验收/电梯验收/节能验收/档案验收等是否均已通过并取得合格文件？4. 竣工资料——工程资料是否按归档目录整理完毕（含开工报告/施工组织设计/图纸会审/设计变更/材料证明文件/检测报告/隐蔽验收记录/施工日志/质量验收记录/竣工图等）？5. 竣工图——竣工图是否已绘制完成并加盖竣工图章？是否反映了全部设计变更和施工中的修改？6. 设备调试——给排水/电气/暖通/消防/智能化/电梯等系统是否已完成单机试运转和联动调试并出具调试报告？7. 功能检测——室内环境质量检测（甲醛/TVOC/苯/氨/氡）、水质检测、照度检测、噪声检测等是否已出报告且合格？8. 质量问题整改——施工中和预验收发现的质量问题是否已全部整改完成并经复查合格？9. 现场清理——建筑垃圾是否已清运？临时设施是否已拆除？场地是否已清理整洁？10. 保修书——工程质量保修书是否已签署（地基基础和主体结构保修设计使用年限、防水工程5年、其他2年）？住宅工程分户验收是否已完成？',
        stage: 6,
        sourceRefs: [
          { layer: 'L1', sourceId: 'gb-50300', section: 'completion-readiness' },
          { layer: 'L1', sourceId: 'construction-law', section: 'completion' },
        ],
        provenance: 'official',
      },
      {
        id: 'cs-cl-006',
        title: '安全文明施工',
        content:
          '安全文明施工日常检查清单（10项，每日巡查）。1. 个人防护——安全帽是否全员正确佩戴（扣好下颚带）？高处作业人员是否正确佩戴安全带并高挂低用？特种作业人员是否持证上岗且人证合一？2. 临边洞口——楼梯口/电梯井口/预留洞口/坑井口/阳台边/屋面边/楼层边是否设有防护栏杆（高≥1.2m、挡脚板≥18cm）或牢固盖板？3. 脚手架——脚手架是否按方案搭设（立杆间距/横杆步距/连墙件/剪刀撑/扫地杆）？脚手板是否铺满铺稳无探头板？安全平网是否随层张设无破损？4. 施工用电——配电系统是否采用TN-S三相五线制三级配电两级保护？电箱是否上锁且有防雨措施？是否执行"一机一闸一漏一箱"？接地电阻是否≤4Ω？5. 起重吊装——起重机械（塔吊/施工升降机/吊车）是否经检测合格并挂验收牌？限位器/制动器/安全钩/防坠器等安全装置是否有效？吊装区域是否设警戒线和专人指挥？6. 模板支撑——模板支撑体系是否按方案搭设（立杆间距/水平杆步距/剪刀撑）？混凝土浇筑时是否有人在下方监模？7. 消防——消防通道是否畅通无堵塞？灭火器是否按规范配置（每100m²不少于2具）且在有效期内？动火作业是否办理动火审批并有监火人？8. 文明施工——材料堆放是否整齐分类？建筑垃圾是否及时清理？道路是否洒水防尘？噪声是否在规定时段内（6:00-22:00）？9. 安全标志——安全警示标志是否齐全（戴安全帽/系安全带/当心坠落/当心触电/禁止烟火等）？10. 安全记录——安全日志是否每日填写？安全教育/安全交底/安全检查/隐患整改记录是否完整？',
        stage: 2,
        sourceRefs: [
          { layer: 'L1', sourceId: 'jgj-59', section: 'daily-safety-inspection' },
          { layer: 'L1', sourceId: 'jgj-46', section: 'temporary-electricity' },
        ],
        provenance: 'official',
      },
      {
        id: 'cs-cl-007',
        title: '质量专项检查',
        content:
          '建筑工程质量专项检查清单（10项，按分部分项阶段检查）。1. 地基基础——桩位偏差/桩身完整性/承载力检测报告是否合格？基础混凝土强度/截面尺寸/标高偏差是否符合设计和规范？2. 钢筋工程——钢筋规格/数量/间距/锚固长度/保护层厚度/接头位置和百分率是否符合规范？钢筋代换是否经设计同意并办理变更？3. 混凝土工程——混凝土强度试块28天抗压强度是否满足设计（统计方法评定或非统计方法评定合格）？外观质量无严重缺陷（露筋/孔洞/夹渣/裂缝>0.3mm）？尺寸偏差在规范允许范围？4. 钢结构——钢材材质证明/焊接工艺评定/焊缝无损检测（超声波或射线）报告是否合格？高强度螺栓连接副扭矩系数/终拧扭矩是否符合要求？防腐/防火涂装厚度是否达标？5. 防水工程——屋面/卫生间/地下室防水层厚度/搭接宽度/附加层是否符合设计和规范？闭水试验是否合格（屋面24h/卫生间48h/地下室72h）？6. 砌体工程——砖/砌块强度是否符合设计？砌筑砂浆强度试块是否合格？拉结筋设置/灰缝饱满度是否符合规范？7. 装饰工程——抹灰层粘接强度（拉拔试验）/平整度/垂直度是否符合规范？面砖/石材铺贴空鼓率是否≤5%？涂饰表面是否均匀无流坠起皮？8. 门窗工程——门窗框安装牢固/垂直度/水平度/对角线差是否符合规范？密封胶条是否连续饱满？开启是否灵活？9. 机电安装——管道试压/通球/灌水试验是否合格？电气绝缘电阻/接地电阻是否符合规范？设备试运转是否正常（振动/噪声/温升/电流）？10. 节能工程——保温层厚度/密度是否符合设计？保温材料证明文件/检测报告是否齐全？节能构造是否与设计一致？',
        stage: 4,
        sourceRefs: [
          { layer: 'L1', sourceId: 'gb-50300', section: 'quality-inspection' },
          { layer: 'L1', sourceId: 'gb-50204', section: 'quality-checkpoints' },
        ],
        provenance: 'official',
      },
      {
        id: 'cs-cl-008',
        title: '材料与设备验收',
        content:
          '建筑材料与设备进场验收检查清单（10项）。1. 证明文件——出厂合格证/质量证明文件/检测报告/型式检验报告是否齐全且与合同约定的品牌/型号/规格一致？进口材料是否有海关报关单和商检报告？2. 外观检查——钢筋是否无严重锈蚀/油污/裂纹？水泥是否无结块/受潮（出厂超过3个月须复检）？砂石是否无泥块/杂物？砖/砌块是否无缺棱掉角/裂缝？防水材料是否在保质期内？3. 规格尺寸——钢筋直径/壁厚（钢管）/壁厚（管材）/厚度（板材/卷材）是否与合同和规范一致？游标卡尺或千分尺实测抽查≥5%且不少于5件？4. 见证取样——是否在监理工程师见证下按规定方法/数量/部位取样？样品是否封样（封条签字盖章）并送具有资质的检测机构？5. 检验报告——检测报告是否在有效期内（钢筋力学性能/水泥强度/砂石筛分/混凝土配合比/防水材料物理性能等）？结果是否合格？6. 设备验收——设备型号/规格/技术参数是否与合同/设计一致？外观是否无损伤/变形/锈蚀？随机文件（合格证/说明书/图纸/备件清单）是否齐全？7. 进场台账——材料/设备进场日期/批次/数量/规格/证明文件编号/检验状态/使用部位是否已记录台账？8. 不合格品——不合格材料是否已挂"不合格"标识并隔离存放？退场是否有记录（日期/数量/去向）？9. 特殊材料——涉及结构安全和重要使用功能的材料（钢筋/水泥/防水材料/保温材料/安全玻璃/消防产品等）是否实行了见证取样检验？10. 储存保管——水泥是否入库存放（下垫上盖防潮）？钢筋是否垫高（≥30cm）并覆盖防雨？防水材料是否避免日晒雨淋？设备是否在干燥通风环境中存放？',
        stage: 2,
        sourceRefs: [
          { layer: 'L1', sourceId: 'gb-50204', section: 'material-acceptance' },
          { layer: 'L1', sourceId: 'gb-50300', section: 'material-management' },
        ],
        provenance: 'official',
      },
    ],

    // ── rubric（评分维度）8 个维度 ──
    rubric: [
      {
        id: 'cs-rub-001',
        title: '安全合规度',
        content:
          '评估建筑工程项目的安全生产管理水平和合规程度。1分——安全管理失控：无安全管理制度或制度形同虚设、安全员配备不足（<法规要求的1人/万m²）、特种作业人员无证上岗普遍、安全防护设施缺失严重（临边无防护/脚手板不满铺/安全网破损不换）、三级安全教育不落实（签字走过场）、发生过一般及以上安全事故且未按"四不放过"处理。3分——安全管理基本合规：安全制度健全但执行有折扣（部分防护不到位/部分人员培训不足）、安全员按法规配备（1万m²以下1人、1-5万m²2人、>5万m²3人）、主要安全防护到位（临边/洞口/脚手架/用电基本规范）、安全检查和隐患整改有记录、未发生一般及以上安全事故。5分——安全管理卓越：安全文化深入人心（全员自觉遵守安全规范互相提醒监督）、安全投入充足（安全文明施工费足额使用不挪用）、安全防护设施标准化（工具式定型化防护栏杆/定型化安全通道/定型化电箱支架等）、安全技术创新（智慧工地安全监控系统/VR安全教育/无人机巡检）、连续安全生产无事故天数>500天、获得省级或以上安全文明工地称号。评分要点：安全制度健全性与执行率、安全防护设施到位率、安全培训与交底覆盖率、事故记录与处理合规性。',
        stage: 6,
        sourceRefs: [{ layer: 'L1', sourceId: 'jgj-59', section: 'safety-evaluation' }],
        provenance: 'official',
      },
      {
        id: 'cs-rub-002',
        title: '质量合格率',
        content:
          '评估建筑工程实体质量的综合合格水平。1分——质量失控：一次验收合格率<80%（大量检验批一次验收不通过需返修或返工）、发生过结构安全质量事故（基础不均匀沉降超标/主体结构裂缝超规范/主要材料不合格使用）、无质量管理制度或制度不执行、检测报告造假。3分——质量基本合格：一次验收合格率80%-95%（大部分检验批一次通过、少量需整改复验）、主要质量控制点到位（结构安全可靠/主要功能满足设计/观感质量可接受）、质量管理制度执行（三检制/材料进场检验/隐蔽验收/见证取样等基本落实）、检测报告真实完整。5分——质量卓越：一次验收合格率>95%（极少返工返修）、结构质量优良（垂直度/平整度/截面尺寸偏差远优于规范允许值）、无渗漏/空鼓/开裂等质量通病（通过工艺改进和精细化管理消除常见质量缺陷）、获得省级或以上优质工程奖（如鲁班奖/詹天佑奖/省优工程等）、质量管理体系通过ISO 9001认证且持续改进。评分要点：一次验收合格率、结构安全质量、使用功能满足度、质量通病控制水平、获奖与认证。',
        stage: 6,
        sourceRefs: [
          { layer: 'L1', sourceId: 'gb-50300', section: 'quality-evaluation' },
          { layer: 'L1', sourceId: 'gb-t-50375', section: 'quality-assessment' },
        ],
        provenance: 'official',
      },
      {
        id: 'cs-rub-003',
        title: '进度偏差率',
        content:
          '评估建筑工程实际进度与计划进度的偏差程度和管理水平。1分——进度严重失控：关键线路延误超过总工期的15%或30天以上（取大值）、进度计划形同虚设不更新不检查、无进度纠偏措施或措施无效、资源（劳动力/材料/机械）配置远低于计划需求、因进度问题被发包方多次发函警告或按合同约定处以误期违约金。3分——进度基本可控：关键线路延误在总工期的5%-15%之间（可接受的偏差范围）、有进度检查和更新（周进度例会+前锋线检查）、出现偏差时有赶工措施且有效（增加班次/增加施工段/优化方案等）、资源（劳动力/材料/机械）基本按计划到位（偶有短期缺口但未造成关键线路延误）。5分——进度卓越：实际进度按计划或超前完成（关键线路无延误或提前完工）、进度计划编制科学合理（资源均衡/工序搭接优化/缓冲预留恰当）、进度监控手段先进（BIM+4D模拟+无人机航拍+智慧工地平台实时跟踪）、多标段/多专业协同进度零冲突、因提前完工获得发包方奖励。评分要点：关键线路偏差率、进度计划更新频率与准确性、资源到位率与均衡度、纠偏措施及时性与有效性。',
        stage: 6,
        sourceRefs: [{ layer: 'L1', sourceId: 'gb-t-50326', section: 'schedule-performance' }],
        provenance: 'official',
      },
      {
        id: 'cs-rub-004',
        title: '造价偏差率',
        content:
          '评估建筑工程实际造价与预算造价的偏差程度和造价管理水平。1分——造价严重失控：竣工结算超预算>15%或超过合同价>20%、变更签证管理混乱（大量先干后签/签证内容不实/重复计量）、材料采购价远高于市场价、进度款支付与工程实际进度不匹配（超付或拖欠）、因造价问题发生合同纠纷或诉讼。3分——造价基本可控：竣工结算超预算5%-15%之间（合理的变更调整范围）、变更签证管理基本规范（有审批流程/资料基本齐全/少量后补但可追溯）、材料采购价与市场价偏差在合理范围（±5%）、进度款按合同约定支付无纠纷。5分——造价卓越：竣工结算控制在预算内或略有节余（超预算<5%）、变更签证管理严格规范（先审后干/量价分离审核/资料完整支撑充分）、通过优化设计/优化施工方案/材料集中采购等主动控制造价（节约>5%）、造价管理信息化（造价软件实时跟踪+合同执行预警+材料价格数据库）、无任何合同经济纠纷。评分要点：结算偏差率、变更签证规范度、材料采购价合理性、进度款支付准确度、合同经济纠纷记录。',
        stage: 6,
        sourceRefs: [{ layer: 'L1', sourceId: 'gb-50500', section: 'cost-performance' }],
        provenance: 'official',
      },
      {
        id: 'cs-rub-005',
        title: '变更控制有效性',
        content:
          '评估建筑工程设计变更和工程洽商的管理控制水平。1分——变更失控：变更数量异常多（>分部分项工程量的20%）、变更原因主要是设计错误和遗漏（设计质量差）、变更先施工后补单情况普遍、变更单内容模糊/工程量不准/签字不全、因变更导致造价大幅增加（>合同价15%）和工期严重延误（>总工期10%）、变更台账混乱无法追溯。3分——变更基本受控：变更数量在正常范围（分部分项工程量的5%-20%）、变更程序基本合规（多数先审后干、少数后补但有审批）、变更单内容基本完整（有原因/部位/工程量/造价影响/工期影响）、变更导致的造价增加在合同价5%-15%之间、变更台账清晰可追溯。5分——变更管理卓越：变更数量少（<分部分项工程量的5%，设计质量高减少变更）、变更程序严格合规（100%先审后干、所有变更经设计审批）、变更单标准化（编号连续/内容完整/附图清晰/计算准确）、主动变更（优化设计/优化方案节约造价或缩短工期——正变更而非被动变更）、变更信息管理系统化（电子审批流程+自动汇总分析+造价工期联动预警）。评分要点：变更数量与占比、变更程序合规率、变更单完整准确度、变更对造价和工期的影响控制。',
        stage: 6,
        sourceRefs: [{ layer: 'L1', sourceId: 'gb-t-50326', section: 'change-control' }],
        provenance: 'official',
      },
      {
        id: 'cs-rub-006',
        title: '资料完整度',
        content:
          '评估建筑工程施工技术资料的完整性、真实性和同步性。1分——资料严重缺失：竣工资料缺少关键文件（开工报告/图纸会审/设计变更/材料证明/检测报告/隐蔽验收记录/质量验收记录/竣工图等核心文件）、资料与工程实际不符（后补造假——日期逻辑矛盾/签字代签）、资料管理混乱（无台账/无分类/无目录/散乱丢失）、因资料问题导致竣工验收受阻或备案无法办理。3分——资料基本完整：关键文件齐全（有少量次要文件缺失但不影响竣工验收）、资料与工程基本同步（大部分资料及时形成——偶有月内后补但内容真实）、资料分类清晰有目录有台账、竣工验收和备案顺利办理。5分——资料管理卓越：资料完整齐全（所有目录内文件无缺失——一次性通过档案验收）、资料与工程完全同步（日清周结月归档——资料形成与施工进度完全同步）、资料真实规范（内容完整/签字盖章齐全/日期逻辑一致/追溯清晰）、资料管理信息化（项目管理信息系统+电子档案+纸质档案双轨管理）、通过省级或以上档案管理验收或评为档案管理示范项目。评分要点：资料完整性（目录覆盖度）、资料真实性（与工程实际一致性）、资料同步性（形成时间与施工时间匹配度）、资料规范性（签字盖章/日期逻辑/追溯性）。',
        stage: 6,
        sourceRefs: [
          { layer: 'L1', sourceId: 'construction-law', section: 'documentation-requirement' },
          { layer: 'L1', sourceId: 'gb-t-50328', section: 'archive-management' },
        ],
        provenance: 'official',
      },
      {
        id: 'cs-rub-007',
        title: '合同履约率',
        content:
          '评估建筑工程各方合同履约的完整性和合规程度。1分——合同履约差：发包方严重拖欠工程款（超合同约定支付期>60天）、承包方严重工期延误（超合同工期>15%或>60天）、双方存在重大合同纠纷（已进入仲裁或诉讼程序）、分包/供应商合同纠纷频繁（农民工工资拖欠/材料款拖欠等）、合同变更程序不合规（口头变更/个人承诺代替合同变更）。3分——合同履约基本正常：工程款支付基本按时（偶有短期拖欠但在合同约定宽限期内）、工期延误在可控范围（<合同工期10%）、合同变更程序基本合规（有书面记录双方签认）、无重大合同纠纷（有争议通过协商解决未进入仲裁诉讼）、分包/供应商合同管理基本有序。5分——合同履约卓越：工程款支付按时足额（从未拖欠——发包方信用优良）、工期按合同或提前完成、合同变更管理规范（全部书面形式/双方签认/程序合规）、零合同纠纷（所有争议通过协商友好解决）、合同管理信息化（合同执行台账/支付台账/变更台账/索赔台账联动管理）、合同条款完善（权责清晰/风险分配合理/无合同漏洞）。评分要点：工程款支付按时率、工期履约偏差、合同变更程序合规率、合同纠纷数量与严重程度、合同管理信息化程度。',
        stage: 6,
        sourceRefs: [
          { layer: 'L1', sourceId: 'fidic-2017', section: 'contract-performance' },
          { layer: 'L1', sourceId: 'construction-law', section: 'contract-compliance' },
        ],
        provenance: 'official',
      },
      {
        id: 'cs-rub-008',
        title: '绿色施工水平',
        content:
          '评估建筑工程绿色施工的实施水平和环保绩效。1分——绿色施工未开展：无绿色施工方案或方案形式化不实施、"四节一环保"无具体指标和措施、施工扬尘/噪声/污水/垃圾等环境污染严重被投诉或处罚、建筑垃圾未分类直接混合排放、绿色施工费未投入或被挪用、绿色施工无记录无数据。3分——绿色施工基本达标：有绿色施工方案并按方案实施、主要环保措施到位（围挡封闭/洒水降尘/车辆冲洗/噪声控制在规定时段/污水沉淀处理/垃圾分类回收）、"四节"有一定成效（节材/节水/节能/节地有措施有数据）、绿色施工记录和影像资料基本完整、通过政府绿色施工检查未受处罚。5分——绿色施工卓越：绿色施工方案科学详实且创新（雨水收集利用系统/太阳能利用/建筑垃圾零排放/装配式施工减少现场湿作业）、"四节一环保"指标量化且达标（节水>30%/节材>20%/节能>20%/节地>15%）、获得绿色施工示范工程或绿色建筑认证（国标一星/二星/三星或LEED认证）、绿色施工技术创新（BIM+绿色施工/智慧工地环境监测系统/碳排放跟踪）、绿色施工社会效益显著（周边居民满意度高/媒体正面报道/行业示范推广）。评分要点：绿色施工方案完整性与创新性、"四节一环保"指标达成度、环保合规记录（无投诉/无处罚）、绿色建筑认证获取情况。',
        stage: 6,
        sourceRefs: [
          { layer: 'L1', sourceId: 'gb-t-50905', section: 'green-evaluation' },
          { layer: 'L1', sourceId: 'gb-t-50640', section: 'green-assessment' },
        ],
        provenance: 'official',
      },
    ],
  },
}

// ── 「瀑布项目管理」Skill 完整内容定义 ──────────────────────────────────

const WATERFALL_PROJECT_MANAGEMENT_SEED: BuiltinSkillSeed = {
  skillKey: 'skill-pm-waterfall',
  name: '瀑布项目管理',
  version: '1.0.0',
  description:
    '覆盖瀑布项目管理方法论的完整知识包：从需求定义、设计、实现、验证到维护的线性阶段管理。适用于需求明确、变更少、交付件清晰的传统项目管理场景，提供规则、模式、反模式、示例、检查清单与评分标准。',
  category: {
    primary: 'methodology',
    secondary: 'waterfall',
  },
  tags: [
    '瀑布',
    'Waterfall',
    '传统项目',
    '项目管理',
    'WBS',
    '关键路径',
    '阶段门',
    '里程碑',
    '需求冻结',
    '变更控制',
  ],
  dependencies: [],
  activation: {
    projectTypes: ['瀑布', 'Waterfall', '传统项目', '传统', 'Waterfall Project'],
    domains: ['waterfall', 'project_management'],
    priority: 90,
  },
  basePriority: 90,
  knowledge: {
    rules: [
      {
        id: 'pm-wf-rule-001',
        title: '阶段门评审制度',
        content:
          '瀑布项目的每个阶段（需求→设计→实现→测试→部署→维护）之间必须设置正式阶段门（Stage Gate）评审。阶段门不是形式化的"签字通过"，而是由项目发起人、关键干系人与独立评审者共同参与的结构化质量门禁——评审内容包括：前一阶段交付件的完整性、与阶段入口标准的符合度、遗留风险的评估、下一阶段计划的可行性以及资源与预算的充足性。评审结论只有三种：Go（通过进入下一阶段）、No-Go（不通过需返工）、Go with Conditions（有条件通过——明确列出条件项和限期）。未通过阶段门评审的项目不得进入下一阶段——这是瀑布方法论不可妥协的底线。',
        stage: 1,
        sourceRefs: [{ layer: 'L1', sourceId: 'pmbok-7', section: 'stage-gate-governance' }],
        provenance: 'official',
      },
      {
        id: 'pm-wf-rule-002',
        title: '需求冻结与变更控制',
        content:
          '瀑布项目在需求阶段完成后，需求基线必须正式冻结（Baseline Freeze）。任何后续变更必须经正式的变更控制委员会（Change Control Board, CCB）审批——提交变更请求（Change Request, CR）需包含：变更描述、影响范围分析（对范围/进度/成本/质量/风险的量化影响）、替代方案与推荐方案、回滚计划。CCB 不得由项目经理单独组成——必须包含客户/业务方代表和技术负责人。批准后的 CR 必须同步更新所有受影响的交付件（需求规格、设计文档、测试用例、WBS、进度计划），确保文档与实现的一致性。变更控制是瀑布项目的生命线——失控的变更让瀑布退化为无控制的"边做边改"。',
        stage: 2,
        sourceRefs: [{ layer: 'L1', sourceId: 'cmmi-dev', section: 'requirements-management' }],
        provenance: 'official',
      },
      {
        id: 'pm-wf-rule-003',
        title: '文档驱动与交付件管理',
        content:
          '瀑布方法论的核心信条是"文档驱动"——每个阶段产出正式的、完整的、签字的交付件文档，作为下一阶段的输入与验收依据。关键交付件包括：需求规格说明书（SRS）、系统设计文档（SDD）、详细设计文档（DDD）、测试计划与测试用例、部署手册、运维手册与用户手册。交付件必须纳入配置管理（版本控制、基线管理、变更历史追溯），任何对交付件的修改必须留下"谁/什么时候/改了什么/为什么改"的审计轨迹。文档不是"为了文档而文档"——每份文档必须有明确的读者（谁会用它来做什么决策）和清晰的追溯关系。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'ieee-830', section: 'srs-structure' }],
        provenance: 'official',
      },
      {
        id: 'pm-wf-rule-004',
        title: 'WBS工作分解结构',
        content:
          'WBS（Work Breakdown Structure）是瀑布项目计划的基石——将项目范围自上而下逐层分解为可管理、可估算、可分配、可度量的工作包（Work Package）。分解原则：100%规则（子层工作包之和必须等于父层范围——不多不少）、工作包粒度控制在 8-80 小时（一个资源全职 1-10 个工作日可完成）、每个工作包必须有唯一负责人（不是团队共有——"共同负责"等于"无人负责"）、WBS 必须包含项目管理活动和质量管理活动（不是只有"干活"的工作包）。WBS 是进度计划、成本估算、资源分配、风险识别的唯一来源——WBS 的质量直接决定了项目计划的可靠性。',
        stage: 1,
        sourceRefs: [{ layer: 'L1', sourceId: 'pmbok-7', section: 'wbs-practice' }],
        provenance: 'official',
      },
      {
        id: 'pm-wf-rule-005',
        title: '关键路径法与依赖管理',
        content:
          '瀑布项目必须基于 WBS 建立活动网络图，使用关键路径法（CPM）识别决定项目最短工期的关键活动序列。关键路径上的任何延误都会直接导致项目整体延期——项目经理的每日关注重点首先是关键路径活动。依赖类型必须明确标注：完成-开始（FS）、开始-开始（SS）、完成-完成（FF）、开始-完成（SF）。外部依赖（如供应商交付、审批等待、设备到货）必须标注为高风险并设置缓冲时间（Buffer）。浮动时间管理：关键路径活动浮动时间为零；非关键路径活动的浮动时间是宝贵的弹性资源——消耗浮动时间必须经项目经理评估（如果浮动时间被吃光，非关键路径也会变成关键路径——多条关键路径使项目风险成倍增加）。',
        stage: 2,
        sourceRefs: [{ layer: 'L1', sourceId: 'pmbok-7', section: 'critical-path-method' }],
        provenance: 'official',
      },
      {
        id: 'pm-wf-rule-006',
        title: '里程碑验收与签字确认',
        content:
          '瀑布项目的每个里程碑必须设定可客观验证的验收标准——不是"设计完成"而是"设计文档通过正式评审且所有评审意见已关闭并签字确认"。验收标准必须满足 SMART 原则（具体、可度量、可达成、相关、有时限）。里程碑验收必须由客户/业务方代表正式签字确认——口头确认或邮件中的"looks good"不算验收。验收签字意味着"我对这一阶段的交付件质量与完整性承担责任"——这是瀑布方法论中不可替代的信任与责任机制。未通过验收的里程碑不得付款（如果合同采用里程碑付款模式）。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'prince2-2017', section: 'stage-boundaries' }],
        provenance: 'official',
      },
      {
        id: 'pm-wf-rule-007',
        title: '风险管理与储备分析',
        content:
          '瀑布项目必须在每个阶段进行正式的风险识别、定性/定量分析与应对规划。风险登记册（Risk Register）是活文档——在每个阶段门评审时更新，包含：风险描述、概率、影响、风险等级、应对策略、应急计划与触发条件。储备分析：已知风险设置应急储备（Contingency Reserve，属于项目预算/进度基准的一部分，项目经理有权使用）；未知风险设置管理储备（Management Reserve，不属于基准，需经管理层批准方可使用）。瀑布项目因阶段线性不可逆，风险窗口集中在前期——需求阶段的遗漏风险在测试阶段才发现时，修复成本是需求阶段的 50-100 倍。',
        stage: 2,
        sourceRefs: [{ layer: 'L1', sourceId: 'pmbok-7', section: 'risk-management' }],
        provenance: 'official',
      },
      {
        id: 'pm-wf-rule-008',
        title: '收尾与经验教训',
        content:
          '瀑布项目的收尾不是"最后一天写个总结"——收尾是一个正式的、结构化的阶段，包括：交付件正式移交（移交签字确认）、合同收尾（所有合同条款已完成或关闭、尾款支付确认）、行政收尾（团队解散、资源释放、项目文件归档）、经验教训总结（Lessons Learned）。经验教训必须在项目结束时召开专门的经验教训会议——不是在庆功宴上随口说两句——参会者包括项目团队、关键干系人和客户代表，讨论"哪些做得好应继续"、"哪些做得不好应改进"、"如果重新做会怎么做"三个核心问题。经验教训必须归档到组织过程资产（OPA）并在下一个类似项目的启动阶段被查阅。',
        stage: 6,
        sourceRefs: [{ layer: 'L1', sourceId: 'pmbok-7', section: 'close-project' }],
        provenance: 'official',
      },
    ],
    patterns: [
      {
        id: 'pm-wf-pat-001',
        title: '经典瀑布六阶段模型',
        content:
          '经典瀑布模型将项目生命周期划分为六个串行阶段：需求分析→系统设计→详细设计→编码与单元测试→集成与系统测试→部署与运维。每个阶段的输出是下一阶段的输入——信息沿瀑布逐级流动，不允许跳级或回溯。这种线性结构的核心优势是：阶段边界清晰、交付件标准明确、项目进度可控可度量、适合合同驱动与合规要求高的项目（政府项目、航空航天、医疗设备、大型基建）。核心缺陷是：对需求变更的适应性极弱——后期发现前期错误时修复成本极高。适用条件：需求在项目初期可以完全明确且高度稳定、技术方案成熟无不确定性、项目规模大且需要严格的合同管控。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'royce-1970', section: 'waterfall-model' }],
        provenance: 'official',
      },
      {
        id: 'pm-wf-pat-002',
        title: 'V模型验证与确认',
        content:
          'V模型是瀑布模型的增强版——在左侧"分解与定义"的每个阶段，在右侧对应一个"集成与测试"的阶段，形成对称的 V 字形。左侧：需求分析（对应右侧验收测试）→ 系统设计（对应系统测试）→ 详细设计（对应集成测试）→ 编码（对应单元测试）。核心思想：测试不是编码完成后才开始的——在需求分析阶段就开始编写验收测试用例、在设计阶段就开始编写集成测试用例。V模型强调"验证（Verification——我们正确地建造了产品吗？）"与"确认（Validation——我们建造了正确的产品吗？）"的双轨并行。V模型是 IEC 62304（医疗设备软件）和 ISO 26262（汽车功能安全）等安全关键领域的标准开发模型。',
        stage: 4,
        sourceRefs: [{ layer: 'L1', sourceId: 'ieee-1012', section: 'v-model-vv' }],
        provenance: 'official',
      },
      {
        id: 'pm-wf-pat-003',
        title: 'PRINCE2阶段门流程',
        content:
          'PRINCE2（Projects IN Controlled Environments）是英国政府采用的瀑布项目管理标准，以阶段门控制为核心特征。七大原则：持续的业务论证（项目必须始终有存在的商业理由——一旦不再合理立即终止）、从经验中学习、定义角色与职责、按阶段管理、例外管理（设定容忍度——只有在超出容忍度时才升级）、聚焦产品（先定义要交付什么再决定怎么做）、根据项目环境剪裁。七大主题：商业论证、组织、质量、计划、风险、变更、进展。PRINCE2 特别适合大型政府项目、公共部门项目和需要严格治理的企业项目——其"例外管理"机制使项目经理在容忍度内有自主权，超出容忍度自动升级到项目委员会，避免微观管理。',
        stage: 2,
        sourceRefs: [{ layer: 'L1', sourceId: 'prince2-2017', section: 'principles-themes' }],
        provenance: 'official',
      },
      {
        id: 'pm-wf-pat-004',
        title: '需求可追溯性矩阵RTM',
        content:
          '需求可追溯性矩阵（Requirements Traceability Matrix, RTM）是瀑布项目中保证"每一条需求都被设计、实现和测试"的核心治理工具。RTM 以表格形式将每一条需求（需求ID）与其对应的设计元素（设计ID）、实现模块（代码模块/功能ID）、测试用例（测试ID）建立双向追溯关系——正向追溯确保需求不被遗漏（向前看——需求→设计→实现→测试）、反向追溯确保实现不超出需求范围（向后看——测试→实现→设计→需求，防止范围蔓延）。RTM 在阶段门评审中是必查项——缺失追溯的需求视为未完成。RTM 也是变更影响分析的输入——当一条需求变更时，RTM 精确展示受波及的所有设计、实现和测试元素。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'cmmi-dev', section: 'traceability' }],
        provenance: 'official',
      },
      {
        id: 'pm-wf-pat-005',
        title: '挣值管理EVM',
        content:
          '挣值管理（Earned Value Management, EVM）是瀑布项目中将范围、进度和成本综合度量的量化管理技术。三个核心指标：计划价值（PV——计划到现在应该完成的工作的预算值）、挣值（EV——实际完成的工作的预算值）、实际成本（AC——实际花费）。派生指标：进度偏差 SV=EV-PV（负数为滞后）、成本偏差 CV=EV-AC（负数为超支）、进度绩效指数 SPI=EV/PV（<1 为滞后）、成本绩效指数 CPI=EV/AC（<1 为超支）。完工估算（EAC）基于当前绩效预测：如果当前趋势持续，EAC=BAC/CPI（BAC 为完工预算）。EVM 是瀑布项目"用数据说话"的核心工具——避免"感觉项目还行"的主观判断，用 SPI 和 CPI 两个数字精确表达项目健康状况。',
        stage: 5,
        sourceRefs: [{ layer: 'L1', sourceId: 'pmbok-7', section: 'earned-value-management' }],
        provenance: 'official',
      },
      {
        id: 'pm-wf-pat-006',
        title: '配置管理CM',
        content:
          '配置管理（Configuration Management, CM）是瀑布项目中维护交付件完整性和一致性的核心治理机制。包括四个要素：配置识别（定义哪些交付件纳入配置管理、建立配置项CI清单与唯一标识）、配置控制（对配置项的变更必须经正式的变更请求和审批流程——未经审批不得修改基线）、配置状态记录（记录每个配置项的当前版本、状态、变更历史、关联变更请求）、配置审计（定期验证配置项的实际状态与记录状态的一致性——发现不一致时启动根因分析）。在瀑布项目中，需求基线、设计基线、代码基线和测试基线是四个必须严格管理的配置基线——一旦基线建立，任何修改必须走正式的变更控制流程，且变更后的配置项必须重新标识为新版本。',
        stage: 4,
        sourceRefs: [{ layer: 'L1', sourceId: 'iso-10007', section: 'configuration-management' }],
        provenance: 'official',
      },
      {
        id: 'pm-wf-pat-007',
        title: '决策分析与决议DAR',
        content:
          '在瀑布项目中，重大技术选型、架构决策、工具选择和供应商评定等决策必须使用结构化的决策分析与决议（Decision Analysis and Resolution, DAR）流程。步骤：1. 明确决策问题（定义需要决策什么以及为什么这个决策重要）；2. 建立评价准则（定义决策的评判维度并赋予权重——如成本权重 30%、技术成熟度 20%、团队能力 25%、供应商稳定性 15%、长期可维护性 10%）；3. 识别候选方案（至少 3 个候选方案——少于 3 个说明探索不够）；4. 评价候选方案（按每个准则对每个方案打分 1-5，加权求和）；5. 敏感性分析（改变权重后排名是否变化——如果小幅调整权重就导致不同方案胜出，说明决策对权重敏感，需审慎）；6. 选择推荐方案并记录决策依据。DAR 文档是阶段门评审的必查件——避免"拍脑袋决策"和"事后无法解释为什么选这个方案"。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'cmmi-dev', section: 'dar' }],
        provenance: 'official',
      },
      {
        id: 'pm-wf-pat-008',
        title: '质量保证与审计QA',
        content:
          '瀑布项目中的质量保证（Quality Assurance, QA）不是测试——QA 是过程审计与合规检查，确保项目过程按照既定的流程、标准和规范执行。QA 活动包括：过程审计（检查团队是否按照规定的流程执行——如是否举行了阶段门评审、是否更新了风险登记册）、交付件审计（检查交付件是否符合模板和内容标准——如需求文档是否包含所有必要章节）、工具使用合规（检查配置管理工具、缺陷跟踪工具是否按规定使用）。QA 必须独立于项目团队——QA 人员向 PMO 或质量部门汇报，不对项目经理负责，以保持独立性和客观性。QA 发现的不合规项必须记录为不符合项（Non-Conformance, NC）并跟踪至关闭——NC 不是"找茬"，是防止小过程偏差积累成大质量事故的预警机制。',
        stage: 5,
        sourceRefs: [{ layer: 'L1', sourceId: 'iso-9001', section: 'quality-assurance' }],
        provenance: 'official',
      },
    ],
    antiPatterns: [
      {
        id: 'pm-wf-ap-001',
        title: '需求不清强行开工',
        content:
          '需求还在"大概""基本上""应该是"的状态下就强行进入设计或开发阶段——这是瀑布项目最常见也最致命的反模式。症状：需求文档充满模糊表述（"系统应该快速响应"——没有量化指标、"界面应该友好"——没有可用性标准）、需求评审被跳过或压缩为"邮件审阅"——没有正式的需求评审会、没有需求签字确认。后果：设计阶段和开发阶段频繁返回需求阶段确认细节——"返工瀑布"实际上变成了多次串行瀑布，每次返工都消耗大量进度和预算。根因：进度压力迫使压缩需求阶段（"需求花太多时间了——先开始设计，边做边确认"——这是最昂贵的节省——需求阶段省 1 天，后续返工花 10 天）。',
        stage: 1,
        provenance: 'official',
      },
      {
        id: 'pm-wf-ap-002',
        title: '阶段跳过或并行执行',
        content:
          '以"赶进度"为由跳过某个阶段或让多个阶段并行执行。典型表现：需求没有完全冻结就开始设计（"核心需求定了——边角料后面补"）、设计没有完成评审就开始编码（"架构定了——详细设计编码时再细化"）、单元测试没有完成就开始集成测试（"等集成测试时一起测"）。后果：阶段并行导致下游阶段基于不完整或错误的上游输出工作——下游产出在上游变更后全部作废、阶段门评审变成形式主义（因为已经进入下一阶段了——"总不能叫停已经开始的编码吧"）。根因：将"阶段"理解为"活动"而非"交付件基线"——瀑布的阶段切换不是活动切换（"设计做完了所以开始编码"），而是交付件基线建立（"设计基线已建立并签字确认，因此可以开始编码"）。',
        stage: 2,
        provenance: 'official',
      },
      {
        id: 'pm-wf-ap-003',
        title: '变更控制形同虚设',
        content:
          '变更控制委员会（CCB）存在但不运作，或运作但"永远不会说 No"——任何变更请求都被批准。症状：客户或业务方口头提出的需求修改直接进入开发——不走正式变更请求流程、变更影响分析流于形式（"这个改动很小——对进度影响大概一两天"——没有实际评估）、变更后不更新相关交付件（需求改了但设计文档没改——文档与代码不一致）。后果：范围持续膨胀（Scope Creep）——项目交付日期不变但范围不断增加、团队在无止境的变更中耗尽士气和生产力、最终交付物与最初需求规格的差异大到无法追溯。根因：项目经理害怕拒绝客户（"客户关系不能破坏"——但放任变更导致项目失败才是最大的客户关系破坏）、或缺乏变更影响的量化数据无法客观地说 No。',
        stage: 4,
        provenance: 'official',
      },
      {
        id: 'pm-wf-ap-004',
        title: '测试阶段被挤压',
        content:
          '当前置阶段延误时，测试阶段被压缩以"保住上线日期"——这是瀑布项目中最常见且最危险的反模式。症状：原计划 4 周的测试被压缩为 2 周甚至 1 周、测试用例被删减（"关键路径测一下就行"）、缺陷修复时间被挤压（"这个 bug 影响不大——先上线后面再修"——但后面永远没有时间修）。后果：上线后出现大量生产事故、用户对产品质量失去信心、后续的"运维阶段"实际上变成了"持续救火阶段"——运维成本远超压缩测试省下的时间成本。根因：将测试视为"弹性缓冲"而非"不可压缩的质量门禁"——测试时间是保证产品质量的最低必要时间，不是可以随意压缩的"余量"。',
        stage: 5,
        provenance: 'official',
      },
      {
        id: 'pm-wf-ap-005',
        title: '过度文档化',
        content:
          '将"文档驱动"误解为"文档越多越好"——每件事都要写文档、每份文档都要几十上百页、文档详细到"螺丝钉的规格"级别但无人阅读。症状：文档体积远超实际需要（"需求规格 500 页——谁读完谁是神"）、文档更新滞后（文档与实际工作脱节——写文档的人在写、做项目的人在做，两者不交集）、文档评审耗费大量时间但产出的反馈是"格式问题"而非内容问题。后果：文档变成"为文档而文档"的形式主义——团队在文档上投入大量时间但文档对项目质量没有实质贡献、文档维护成本持续吞噬团队生产力。根因：混淆"充分的文档"与"过度的文档"——文档的目的是"沟通与记录"，如果一份文档没人看、没人维护、不影响任何决策，它就是浪费。',
        stage: 3,
        provenance: 'official',
      },
      {
        id: 'pm-wf-ap-006',
        title: '里程碑形式化',
        content:
          '里程碑评审变成了"走过场"——评审会变成了进度汇报会而非质量门禁检查。症状：里程碑评审无独立评审者参与（只有项目团队自评自审）、验收标准模糊（"基本完成""大体符合"等无法客观判定的表述）、评审结论永远是"通过"（或"有条件通过——条件从未真正被满足"）。后果：问题被阶段性地隐藏——每个里程碑都"通过"了但最终交付时发现大量质量问题、里程碑失去了"及时发现问题并纠正"的核心价值、项目在"虚假的绿灯"下累积风险直到最后爆发。根因：将里程碑评审视为"项目进展的展示"而非"项目质量的检验"——里程碑评审的核心问题是"这个阶段的交付件质量是否足以支撑进入下一阶段"，而不是"我们做了什么"。',
        stage: 4,
        provenance: 'official',
      },
      {
        id: 'pm-wf-ap-007',
        title: '关键路径过度优化',
        content:
          '项目经理过度聚焦关键路径，忽视非关键路径的浮动时间消耗——当浮动时间被日常延误逐步侵蚀，非关键路径悄然变成关键路径，项目突然面临多条关键路径。症状：项目经理的注意力 95% 在关键路径上——非关键路径活动的浮动时间消耗无监控、多条非关键路径的浮动时间同时接近零时才发现、突然出现的多条关键路径让项目失控。后果：项目从单关键路径变成多关键路径——管理复杂度非线性增长（从管理一条链变成管理多链交织的网络）、任一关键路径的延误直接导致项目整体延期。根因：将关键路径法理解为"找到最长的链然后只管它"——关键路径法同时要求监控所有路径的浮动时间，及早预警"即将变成关键路径的次长链"。',
        stage: 5,
        provenance: 'official',
      },
      {
        id: 'pm-wf-ap-008',
        title: '无经验教训沉淀',
        content:
          '项目结束时不进行结构化的经验教训总结，或总结后归档到无人查阅的知识库深处——下一次项目重复同样的错误。症状：经验教训会议被压缩为"最后一天 30 分钟快速过一下"、经验教训被写成笼统的"要加强沟通""要提前规划"等无法执行的废话、经验教训归档到 SharePoint 但下一个项目的启动阶段没有人去查阅。后果：组织在项目层面的学习曲线是平的——做了 10 个项目但项目管理的成熟度没有提升（同样的错误重复发生）、团队成员流动后经验教训完全丢失、组织过程资产（OPA）成为"垃圾归档"而非"活的智慧"。根因：组织缺乏"将经验教训转化为可执行改进"的机制——经验教训不应是"项目总结文档的一个章节"，而应是一个结构化的"经验→分析→改进项→分配到人→跟踪闭环"的持续改进循环。',
        stage: 6,
        provenance: 'official',
      },
    ],
    examples: [
      {
        id: 'pm-wf-ex-001',
        title: '政府信息化项目WBS模板',
        content:
          '某省级政务服务平台建设项目的WBS分解示例。一级分解：1.项目启动与立项（可行性研究、立项审批、团队组建）→ 2.需求调研与分析（现状调研、业务需求访谈、需求规格编写与评审签字）→ 3.系统设计（总体架构设计、数据库设计、接口设计、安全设计——等保三级要求）→ 4.开发与单元测试（前端开发、后端服务开发、数据交换平台开发、单元测试与代码审查）→ 5.集成与系统测试（功能测试、性能测试、安全测试、兼容性测试、用户验收测试 UAT——需各委办局业务代表签字）→ 6.部署与数据迁移（生产环境部署、历史数据清洗与迁移、与上级平台对接联调）→ 7.培训与试运行（系统管理员培训、业务操作员培训、试运行期 3 个月——问题收集与优化）→ 8.正式上线与验收（正式上线切换、最终验收——需专家组评审、竣工文档移交）。每个一级节点下分解 3-5 个二级工作包，工作包粒度 40-80 小时。',
        stage: 1,
        sourceRefs: [{ layer: 'L1', sourceId: 'gov-it-project', section: 'wbs-template' }],
        provenance: 'official',
      },
      {
        id: 'pm-wf-ex-002',
        title: '建筑工程需求规格说明书结构',
        content:
          '某商业综合体项目的需求规格说明书推荐章节结构（根据 GB/T 50326 与 FIDIC 合同条件改编）。第1章：项目概述（项目背景、建设目标、建设地点与规模——总建筑面积 12 万平米、地下 3 层地上 28 层）→ 第2章：功能需求（商业零售区 4 万平米含主力店与专卖店、甲级写字楼 5 万平米、地下停车场 1200 车位、配套餐饮与休闲设施）→ 第3章：技术需求（结构设计使用年限 50 年、抗震设防烈度 8 度、绿色建筑二星级、BIM 模型交付 LOD 350）→ 第4章：交付件需求（施工图设计文件、工程量清单、主要材料设备品牌表、竣工模型与竣工图）→ 第5章：时间与里程碑（设计周期 6 个月、施工周期 24 个月、关键里程碑——基础出正负零/主体封顶/外立面完工/竣工验收）→ 第6章：质量与验收标准（GB 50300 建筑工程施工质量验收统一标准、JGJ 59 建筑施工安全检查标准）→ 第7章：约束与假设（施工期间商业区不停止营业——需分区施工与临时通道方案、市政管线接入时间需与市政部门协调）。',
        stage: 1,
        sourceRefs: [{ layer: 'L1', sourceId: 'gb-t-50326', section: 'project-planning' }],
        provenance: 'official',
      },
      {
        id: 'pm-wf-ex-003',
        title: '航空航天阶段门评审记录模板',
        content:
          '某航空电子设备研制项目的阶段门评审记录格式。评审基本信息：阶段门编号 PDR-003（Preliminary Design Review 初步设计评审）、评审日期与地点、评审委员会成员（主席：总工程师、委员：结构/电气/软件/可靠性/工艺各专业总师、独立评审员：质量部代表）、项目团队陈述人。评审内容清单（每项评定——符合/有条件符合/不符合）：1. 系统架构设计是否满足系统需求规格的所有功能与性能要求？2. 子系统间接口定义是否完整且无歧义？3. 关键器件选型是否已完成可用性/可靠性/供货周期评估？4. 初步可靠性分析（FMEA）是否已识别所有关键故障模式并制定缓解措施？5. 技术风险是否已识别并制定应对计划（TRL 技术就绪水平评估——关键技术是否达到 TRL 6 以上）？评审结论：有条件通过——条件项 3 项（①电源模块热分析需在详细设计评审前完成、②通信总线冗余方案需补充故障切换时间分析、③软件需求需与硬件设计做交叉追溯矩阵），条件项责任人及时限。',
        stage: 4,
        sourceRefs: [{ layer: 'L1', sourceId: 'do-178c', section: 'design-review' }],
        provenance: 'official',
      },
      {
        id: 'pm-wf-ex-004',
        title: '医疗设备软件验证流程',
        content:
          '某 III 类有源植入医疗器械（如心脏起搏器）嵌入式软件的验证流程示例——依据 IEC 62304 医疗设备软件生命周期过程。IEC 62304 将软件安全分为 A/B/C 三级（C 级为最高——软件失效可能导致患者死亡或严重伤害）。本案例为 C 级：需求分析阶段——编写软件需求规格 SRS（含所有功能需求、性能需求、安全需求、接口需求），每条需求标注安全等级→ 架构设计阶段——将软件架构分解为软件单元，识别需要"隔离"的安全关键单元→ 详细设计阶段——每个软件单元的详细设计文档（算法描述、数据结构、接口契约）→ 单元实现与验证——每个单元需通过代码审查+单元测试（分支覆盖率 100%——C 级要求）→ 软件集成与集成测试→ 软件系统测试（含异常测试/边界测试/压力测试/回归测试）→ 软件发布——所有测试记录/审查记录/不符合项关闭记录提交给认证机构（如 FDA/NMPA）。整个流程中每个阶段的输出必须可追溯到上一阶段的输入（完整追溯性——审计必查）。',
        stage: 5,
        sourceRefs: [{ layer: 'L1', sourceId: 'iec-62304', section: 'software-lifecycle' }],
        provenance: 'official',
      },
      {
        id: 'pm-wf-ex-005',
        title: '大型基建项目里程碑计划',
        content:
          '某城市轨道交通（地铁）线路建设项目的里程碑计划。M0：项目立项批复（可行性研究报告获批、环评通过、用地预审完成）→ M1：初步设计完成（线路走向与站点位置确定、初步设计评审通过、投资概算批复）→ M2：施工图设计完成（土建施工图/机电施工图/装修施工图全部通过审图——强审）→ M3：土建开工（首个车站或区间开工——主体围护结构施工）→ M4：洞通（所有隧道区间贯通——盾构机全部出洞）→ M5：轨通（全线轨道铺设完成——长轨焊接完成）→ M6：电通（接触网或第三轨供电系统送电成功）→ M7：车通（首列车全线冷滑/热滑完成——信号系统联调联试开始）→ M8：试运行（不少于 3 个月的不载客试运行——跑图指标——列车正点率/运行图兑现率/故障率满足国标要求）→ M9：竣工验收与初期运营（通过专家评审、取得初期运营许可、正式向公众开放）。每个里程碑有明确的"完成定义"（DoD）——不满足 DoD 不得宣告里程碑达成。',
        stage: 3,
        sourceRefs: [
          { layer: 'L1', sourceId: 'urban-rail-standards', section: 'milestone-management' },
        ],
        provenance: 'official',
      },
      {
        id: 'pm-wf-ex-006',
        title: '大型ERP实施计划与风险',
        content:
          '某制造业企业 SAP S/4HANA 实施项目的计划与风险管理示例。项目周期：18 个月，总预算：2800 万（含软件许可、实施服务、硬件、内部投入）。阶段分解：1. 项目准备（1 个月——项目章程、团队组建、基础设施部署）→ 2. 业务蓝图（3 个月——业务需求调研、"As-Is"现状流程梳理、"To-Be"未来流程设计、蓝图签字——这是最关键的阶段，蓝图一旦确认后续变更成本极高）→ 3. 系统实现（8 个月——系统配置、ABAP/Fiori 开发、单元测试、集成测试、数据迁移开发）→ 4. 上线准备（3 个月——最终集成测试、用户验收测试 UAT、最终用户培训、数据迁移预演与正式迁移、上线切换演练）→ 5. 上线与支持（3 个月——正式上线切换、上线后现场支持、问题处理与优化）。关键风险：①蓝图阶段需求蔓延（蓝图确认后持续提出新需求——需严格执行 CCB 变更控制）、②数据迁移质量（历史数据清洗工作量被严重低估——主数据/交易数据不一致率高达 20%——需提前 3 个月启动数据清洗）、③关键用户时间投入不足（关键用户被日常业务占据无法投入蓝图评审和 UAT——需业务部门负责人在项目启动时签署资源承诺书）。',
        stage: 2,
        sourceRefs: [{ layer: 'L1', sourceId: 'sap-asap', section: 'implementation-roadmap' }],
        provenance: 'official',
      },
      {
        id: 'pm-wf-ex-007',
        title: '国防项目配置管理计划',
        content:
          '某军用雷达系统研制项目的配置管理计划示例——依据 GJB 5235（军用软件配置管理）和 MIL-STD-973。配置项（CI）分类：A 类 CI（需军方审批——系统需求规格、系统设计文档、接口控制文档 ICD、验收测试规程）→ B 类 CI（需总工程师审批——子系统设计文档、软件需求规格、硬件详细设计）→ C 类 CI（需项目经理审批——软件模块设计、测试用例、用户手册）。基线建立节点：功能基线（系统需求规格通过评审后建立——对应 PDR 后）→ 分配基线（子系统需求规格通过评审后建立——对应 CDR 后）→ 产品基线（最终产品交付件通过验收后建立——对应物理配置审计 PCA 后）。变更控制：A 类 CI 变更需军方 CCB 审批——提交变更请求含变更理由/技术影响分析/进度成本影响/风险评估/替代方案；B 类 CI 变更需总工程师审批；C 类 CI 变更由项目经理审批。所有变更必须更新配置状态记录并通知所有受影响的干系方。',
        stage: 4,
        sourceRefs: [{ layer: 'L1', sourceId: 'gjb-5235', section: 'configuration-management' }],
        provenance: 'official',
      },
      {
        id: 'pm-wf-ex-008',
        title: '制造工艺变更控制流程',
        content:
          '某汽车零部件制造项目的工艺变更控制流程示例——依据 IATF 16949 汽车行业质量管理体系。变更来源：客户设计变更（OEM 修改图纸或规格——外部触发）、内部工艺优化（生产部门提出工艺改进——内部触发）、供应商变更（原材料/零部件供应商切换——供应链触发）。变更评估清单：①对产品功能和性能的影响（是否影响安全/法规/配合/功能？——如有影响需重新提交 PPAP 生产件批准程序）→ ②对制造过程的影响（是否需要新工装/设备/量具？——如需投资需编制 CAPEX 申请）→ ③对检验和测试的影响（现有检验方法是否仍适用？——需更新控制计划 Control Plan 和测量系统分析 MSA）→ ④对库存和在制品的影响（旧版本库存如何处置——报废/返工/让步接收？）→ ⑤对客户的影响（是否需通知客户并取得客户批准？——变更通知 CN 提交给客户 SQE 审批）→ ⑥对法规和认证的影响（是否需重新做 E-mark/EEC/CCC 等法规认证？）。变更批准后：更新 PFMEA、更新控制计划、更新作业指导书 SOP、培训操作员、首批验证 ISIR、变更跟踪至关闭。',
        stage: 5,
        sourceRefs: [{ layer: 'L1', sourceId: 'iatf-16949', section: 'change-management' }],
        provenance: 'official',
      },
    ],
    checklists: [
      {
        id: 'pm-wf-cl-001',
        title: '项目启动就绪检查清单',
        content:
          '项目正式启动前的就绪度检查（12项——任何一项未完成不得召开启动会）。1. 项目章程已获批（项目发起人签字确认——明确了项目目标、范围、预算、关键里程碑和项目经理任命）。2. 商业论证已通过评审（项目有明确的商业理由和预期收益——量化指标已定义）。3. 核心干系人已识别并分析了干系人影响/兴趣矩阵（谁对项目有影响力、谁受项目影响——沟通策略因人而异）。4. 项目经理已正式任命并有书面授权（授权范围与责任边界清晰）。5. 初始项目团队已到位（核心角色——技术负责人、业务分析师、质量负责人——至少 80% 时间已承诺给本项目）。6. 项目启动资金已批准并可用（至少覆盖启动阶段和第一阶段的所有费用）。7. 初步范围说明书已编写（项目范围边界清晰——明确"做什么"和"不做什么"）。8. 初步里程碑计划已制定（关键里程碑和期望日期——至少包含阶段门节点）。9. 项目章程与启动文件已分发给所有干系人并召开了干系人沟通会。10. 项目文档库和配置管理环境已搭建（项目文件的存储位置、命名规范和访问权限已定义）。11. 供应商/外包需求已初步评估（是否有需要外部采购的服务或产品——采购流程前置时间是否与项目计划匹配）。12. 法务与合规要求已初步审查（行业监管/数据保护/知识产权等特殊要求已识别）。',
        stage: 1,
        sourceRefs: [{ layer: 'L1', sourceId: 'pmbok-7', section: 'project-initiation' }],
        provenance: 'official',
      },
      {
        id: 'pm-wf-cl-002',
        title: '需求评审通过检查清单',
        content:
          '需求规格说明书（SRS）正式评审通过的标准（10项——全部通过方可签字建立需求基线）。1. 完整性——所有功能需求和非功能需求均已列出，无"待定TBD"或"后续明确"的模糊条目。2. 可验证性——每条需求都有可客观验证的验收标准（不是"系统应该好用"而是"用户完成核心任务的平均操作步骤≤5步"）。3. 一致性——需求之间无矛盾（如"系统应实时更新"与"数据同步周期为每小时一次"矛盾）。4. 可追溯性——每条需求有唯一ID和优先级（MoSCoW分类——Must have/Should have/Could have/Won\'t have）。5. 可行性——所有需求在现有技术、预算和时间约束下可实现。6. 非功能需求量化——性能（响应时间/吞吐量/并发用户数）、安全（认证方式/加密标准/审计要求）、可用性（正常运行时间/SLA/灾难恢复RTO-RPO）均已量化。7. 外部接口需求已明确（与哪些外部系统交互、接口协议/数据格式/频率/错误处理）。8. 法律与合规需求已识别（行业监管要求/数据隐私/出口管制等）。9. 约束条件已明确（技术约束/预算约束/时间约束/资源约束/政策约束）。10. 需求已由客户/业务方代表正式签字确认（签字=承担责任——不是"看过了"而是"认可了"）。',
        stage: 2,
        sourceRefs: [{ layer: 'L1', sourceId: 'ieee-830', section: 'srs-review-criteria' }],
        provenance: 'official',
      },
      {
        id: 'pm-wf-cl-003',
        title: '设计评审通过检查清单',
        content:
          '系统设计文档（SDD）正式评审通过的标准（10项）。1. 架构方案满足所有功能需求——用需求追溯矩阵逐条核对，每条功能需求都有对应的设计元素。2. 架构方案满足所有非功能需求——性能/安全/可用性/可扩展性/可维护性的架构决策有明确的设计方案和量化目标。3. 模块划分清晰——每个模块的职责单一、接口定义完整、模块间耦合度最小化（高内聚低耦合）。4. 技术选型有依据——关键技术选型（框架/数据库/中间件/第三方服务）的决策分析文档（DAR）已归档——不是"因为团队熟悉"的单因素决策。5. 数据模型已定义——核心实体关系图（ERD）、数据字典、数据流图已编写。6. 接口设计完整——所有内部接口（模块间）和外部接口（与外部系统）的契约（API/消息格式/错误处理）已定义。7. 安全设计已通过安全架构评审——认证/授权/数据保护/防攻击（OWASP Top 10 覆盖）方案已纳入设计。8. 部署与运维设计已考虑——部署拓扑、监控方案、备份策略、灾备方案已初稿。9. 设计约束已遵守——所有已知的技术约束、法规约束、平台约束在设计方案中得到尊重。10. 设计评审发现的问题已全部记录并关闭——每个问题的处理决定（采纳/拒绝/延后）有明确的理由和责任人。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'ieee-1016', section: 'sdd-review' }],
        provenance: 'official',
      },
      {
        id: 'pm-wf-cl-004',
        title: '开发就绪检查清单',
        content:
          '编码阶段正式启动前的就绪度检查（9项）。1. 详细设计文档已完成并通过评审（每个模块的类/函数/接口/算法已定义到可编码的程度）。2. 开发环境已搭建并验证——IDE/编译器/SDK/依赖库版本与生产环境一致（避免"在我机器上能跑"的问题）。3. 编码规范已发布——代码风格/命名约定/注释规范/禁止模式（如禁止使用 eval/禁止硬编码密码）已文档化并培训到团队。4. 配置管理环境已就绪——代码仓库已创建、分支策略已定义（主干开发还是 GitFlow）、代码提交门禁（pre-commit hook——lint/格式化/单元测试）已配置。5. 持续集成CI流水线已运行——每次提交自动触发构建+单元测试，构建失败自动通知团队。6. 测试策略已发布——单元测试覆盖率目标（通常≥70%后端≥90%）、测试框架和Mock框架已选定。7. 任务分配已完成——每个开发人员有明确的模块分配和交付日期，工作包粒度≤3天。8. 第三方依赖已评估——所有外部库/API/SDK的许可合规性、安全漏洞扫描和版本兼容性已验证。9. 数据访问权限已配置——开发/测试数据库已创建（隔离于生产环境）、开发人员有适当的数据库访问权限（只读/读写按需分配）。',
        stage: 4,
        provenance: 'official',
      },
      {
        id: 'pm-wf-cl-005',
        title: '测试就绪检查清单',
        content:
          '系统测试阶段正式启动前的就绪度检查（11项）。1. 测试计划已通过评审——测试范围、测试策略、测试环境需求、测试数据需求、测试进度与资源分配已明确。2. 测试用例已编写并评审——所有功能需求和非功能需求都有对应的测试用例，测试用例覆盖率 100%。3. 测试环境已搭建且与生产环境配置一致——操作系统/中间件/数据库版本一致（避免"测试环境通过生产环境失败"的环境差异问题）。4. 测试数据已准备——正常数据/边界数据/异常数据/大规模数据（性能测试用）均已就绪且经脱敏处理（不包含真实个人信息）。5. 缺陷管理流程已定义——缺陷提交模板、严重级别分类（P0阻塞/P1严重/P2一般/P3建议）、修复与验证流程、缺陷状态流转规则。6. 自动化测试框架已配置——回归测试套件可一键执行，测试报告自动生成。7. 性能测试工具与环境已就绪——压力测试/负载测试/稳定性测试的工具和监控仪表板已配置。8. 安全测试工具已就绪——SAST静态应用安全测试、DAST动态应用安全测试、第三方依赖漏洞扫描已集成。9. 测试入口标准已满足——所有单元测试通过、代码审查完成、代码已合并到测试分支。10. 测试退出标准已定义——所有P0/P1缺陷已关闭、测试覆盖率达标、性能测试指标满足SLA。11. 测试团队已培训——测试人员已熟悉业务需求和测试工具，盲测用例已分配。',
        stage: 5,
        provenance: 'official',
      },
      {
        id: 'pm-wf-cl-006',
        title: '部署上线就绪检查清单',
        content:
          '生产环境部署上线的就绪度检查——Go/No-Go决策依据（12项——任何一项不满足不得上线）。1. 所有测试阶段已完成——系统测试/UAT/性能测试/安全测试均通过且测试报告已签署。2. 所有P0和P1缺陷已关闭——无未解决的阻塞性或严重缺陷。3. 回归测试已执行——最后一次构建的回归测试全部通过。4. 部署手册已编写并验证——部署步骤（含回滚步骤）已在类生产环境中演练至少一次。5. 数据库变更脚本已准备并验证——DDL/DML脚本已在生产数据量级的测试环境中执行成功。6. 备份已完成——生产数据库和配置文件在上线前已做完整备份。7. 监控和告警已配置——关键指标（响应时间/错误率/CPU/内存/磁盘/数据库连接数）的监控仪表板和告警规则已配置并测试。8. 运维团队已培训——运维人员已熟悉新系统的运维手册和应急处置流程。9. 回滚方案已制定——如果上线后出现严重问题，回滚到上一版本的具体步骤、预计时间和责任人已明确。10. 上线时间窗口已确认——上线时间是否在业务低峰期、是否已通知所有相关方（业务部门/客服/运维/管理层）、是否有足够的支持人员在岗。11. 用户沟通已完成——上线通知/新功能介绍/已知问题/用户支持渠道已发布给最终用户。12. 上线批准已获得——Go/No-Go决策会上所有干系人（项目经理/技术负责人/业务方代表/运维负责人）同意上线并签字。',
        stage: 5,
        provenance: 'official',
      },
      {
        id: 'pm-wf-cl-007',
        title: '阶段门评审检查清单',
        content:
          '阶段门评审会议的标准化议程与检查项（10项——确保每次阶段门评审的质量一致性）。1. 前一阶段交付件完整性检查——所有计划交付件是否已完成并经过质量审查？是否有遗留的"待完成"项？2. 阶段入口标准符合度——下一阶段入口标准是否全部满足？如有未满足项，是否有补救计划？3. 进度绩效——当前阶段的计划进度vs实际进度（SPI），延期原因分析，延期部分的恢复计划。4. 成本绩效——计划成本vs实际成本（CPI），超支原因分析，超支部分的弥补方案。5. 质量绩效——缺陷密度/缺陷修复率/测试覆盖率等质量指标是否在可接受范围内？质量趋势是改善还是恶化？6. 风险评审——风险登记册更新：哪些风险已关闭/哪些风险状态变化/哪些新风险已识别/前10大风险及其缓解计划的有效性。7. 变更请求——本阶段内批准的变更请求数量与累计影响（范围/进度/成本），变更控制流程的运作情况（是否有绕过CCB的变更？）。8. 资源状况——团队资源是否充足？是否有资源冲突或人员流失风险？下阶段资源需求是否已确认？9. 干系人满意度——关键干系人的反馈和关注点，是否有未解决的不满或期望偏差？10. 下一阶段计划评审——下一阶段计划的可行性与资源匹配度，关键风险的应对策略。评审结论——Go/No-Go/Go with Conditions——必须有明确的后续行动项和责任人。',
        stage: 4,
        provenance: 'official',
      },
      {
        id: 'pm-wf-cl-008',
        title: '项目收尾检查清单',
        content:
          '项目正式收尾的完整性检查（13项——全部完成方可宣布项目关闭）。1. 所有交付件已正式移交给客户/运维团队——移交清单已双方签字确认。2. 客户/发起人已签署项目验收确认书——验收标准已逐条确认满足。3. 所有合同条款已完成或正式关闭——供应商尾款已支付、质保期安排已确认、合同收尾文件已归档。4. 最终项目报告已编写——包括项目目标达成度、最终进度与成本绩效（SPI/CPI）、主要成就与不足、经验教训。5. 经验教训总结会已召开并记录——经验教训已结构化归档到组织过程资产库（可被其他项目搜索和查阅）。6. 项目文件已全部归档——需求文档/设计文档/测试报告/会议纪要/变更请求/审计报告——归档文件清单完整且版本为最终版。7. 项目财务已关闭——所有费用已入账、项目成本中心已冻结、最终财务报告已提交。8. 团队资源已释放——团队成员已正式重新分配或离职交接完成、项目设备已归还。9. 项目环境已退役——开发/测试/构建环境已关闭或移交运维、许可证已回收。10. 运维交接已完成——运维手册/监控仪表板/告警规则/应急流程已移交运维团队且运维团队确认可独立运维。11. 知识产权与许可证——项目产生的知识产权（代码/文档/专利）已按合同约定处理、第三方许可证使用情况已记录。12. 项目绩效评估——项目团队成员的绩效评估已提交（如果组织有此流程）。13. 项目关闭审批已获得——项目发起人或PMO已正式批准项目关闭。',
        stage: 6,
        provenance: 'official',
      },
    ],
    rubric: [
      {
        id: 'pm-wf-rub-001',
        title: '需求稳定度评分标准',
        content:
          '评估瀑布项目需求基线的稳定程度——需求变更率越低分数越高。1分——需求高度不稳定：需求基线从未真正建立（持续有"新需求"被加入）、原始需求超过 30% 被修改或替换（不是细化而是推翻）、变更控制流程被绕过或不存在。3分——需求基本稳定：需求基线已建立且签字确认、变更率在 10%-20% 之间（合理范围内的细化和补充）、变更控制流程正常运行（所有变更经 CCB 审批）。5分——需求高度稳定：需求基线建立后变更率<5%（只涉及边界条件和异常场景的补充）、客户/业务方对需求的高度确定性和成熟度给予积极反馈、需求阶段的投入充分（充足的需求访谈/原型验证/干系人评审）——"前期投入换后期稳定"的策略成功。评分要点：需求变更数量与原始需求总数的比率、变更的性质（细化补充 vs 推翻修改）、变更控制流程的遵从度。',
        stage: 6,
        sourceRefs: [{ layer: 'L1', sourceId: 'pmbok-7', section: 'requirements-stability' }],
        provenance: 'official',
      },
      {
        id: 'pm-wf-rub-002',
        title: '文档完整度评分标准',
        content:
          '评估瀑布项目关键交付件文档的完整性、时效性和可追溯性。1分——文档严重缺失：关键交付件（SRS/SDD/测试计划）缺失或仅为形式化的空壳、文档与实际工作脱节（文档更新滞后超过 2 个阶段）、文档之间无追溯关系。3分——文档基本完整：所有关键交付件已存在且通过评审、文档更新基本同步（滞后不超过 1 个阶段）、文档之间有基本的追溯关系（需求→设计→测试）。5分——文档卓越：所有交付件完整且高质量（内容详实、格式规范、易于导航和搜索）、文档更新与实际工作完全同步（"文档即真相"——看文档就知道项目的真实状态）、文档之间的追溯关系完整且双向（正向和反向追溯矩阵已建立且维护）、文档版本管理规范（每次更新有版本号/变更记录/审批记录）。评分要点：关键交付件齐全性、文档更新时效性、文档追溯关系完整性、文档可读性与可用性。',
        stage: 6,
        sourceRefs: [{ layer: 'L1', sourceId: 'cmmi-dev', section: 'documentation-quality' }],
        provenance: 'official',
      },
      {
        id: 'pm-wf-rub-003',
        title: '里程碑达成率评分标准',
        content:
          '评估瀑布项目按计划达成里程碑的能力——包括准时性和验收质量两个维度。1分——里程碑频繁延误：超过 50% 的里程碑未按时达成（延误超过总工期的 5% 或 10 个工作日取较短者）、里程碑延误原因未分析或分析后无改进措施、里程碑验收走过场（无独立评审/无签字确认）。3分——里程碑基本达成：80% 以上里程碑按时达成、延误里程碑的延误幅度在可控范围内（<10%）、里程碑验收有正式评审和签字。5分——里程碑卓越：100% 里程碑按时或提前达成（无延误）、每个里程碑的验收标准清晰且客观可验证、里程碑评审质量高（独立评审者参与、评审意见有深度、后续行动项跟踪至关闭）、里程碑达成不仅准时而且交付件质量超出预期。评分要点：按时达成的里程碑比例、延误幅度、里程碑验收的正式性和质量。',
        stage: 6,
        provenance: 'official',
      },
      {
        id: 'pm-wf-rub-004',
        title: '变更控制有效性评分标准',
        content:
          '评估瀑布项目变更控制流程的实际运作效果——不仅是"有没有流程"而是"流程是否有效"。1分——变更控制无效：变更控制流程存在但不被遵循（大量变更绕过 CCB）、CCB 审批流于形式（从不拒绝变更请求——"橡皮图章"）、变更影响分析缺失或质量低下（"这个改动大概一两天"——无依据）。3分——变更控制基本有效：大部分变更走正式流程（偶有紧急变更绕过但事后补走流程）、CCB 有实质讨论（偶有拒绝或要求补充分析的请求）、变更影响分析有基本的范围/进度/成本估算。5分——变更控制卓越：100% 变更走正式流程（无例外——紧急情况有预定义的紧急变更流程）、CCB 决策质量高（基于量化影响分析做决策、拒绝无充分商业理由的变更）、变更后交付件同步更新无延迟（文档/代码/测试与变更保持一致性）、变更趋势数据用于改进前期需求质量（"为什么后期有这么多变更——是不是需求阶段投入不足？"）。评分要点：变更流程遵从率、CCB 决策质量、变更影响分析的准确性、变更后一致性维护。',
        stage: 6,
        provenance: 'official',
      },
      {
        id: 'pm-wf-rub-005',
        title: '风险储备充足率评分标准',
        content:
          '评估瀑布项目风险管理的有效性——风险识别的完整性和储备（应急+管理）的充足性与使用合理性。1分——风险管理薄弱：风险登记册为形式主义（内容笼统——"技术风险""进度风险"等无实质描述的条目）、无定量风险评估（无概率×影响的量化）、储备被随意使用（无触发条件——"储备就是用来花的"）、储备耗尽后项目失控。3分——风险管理基本合格：风险登记册有实质性内容（具体风险事件/概率/影响/应对策略）、储备有设定依据（基于风险定量分析）、储备使用有触发条件和审批。5分——风险管理卓越：风险识别覆盖所有风险类别（技术/管理/组织/外部）、定量风险分析（蒙特卡洛模拟——项目完工日期的概率分布）、储备设定科学（基于风险暴露值——Expected Monetary Value EMV）、储备使用有严格触发条件和跟踪（每笔储备消耗都有对应的风险事件触发）、储备充足（项目结束时储备未耗尽——剩余储备回归组织）。评分要点：风险识别的完整性和具体性、储备设定的科学性、储备使用的规范性和可追溯性。',
        stage: 6,
        sourceRefs: [{ layer: 'L1', sourceId: 'pmbok-7', section: 'risk-reserve-analysis' }],
        provenance: 'official',
      },
      {
        id: 'pm-wf-rub-006',
        title: '阶段门评审质量评分标准',
        content:
          '评估瀑布项目阶段门评审的实质性质量——不是"开了会"而是"产生了价值"。1分——阶段门形式化：评审会等同于进度汇报会（只报告做了什么——不检查质量是否达标）、评审参与者只有项目团队（无独立评审者/无客户代表）、评审结论永远是"通过"或"有条件通过——条件从未关闭"。3分——阶段门基本有效：评审有结构化议程和检查标准、有独立评审者或客户代表参与、评审时有实质性的质量讨论和问题发现、有条件通过的条件项被跟踪至关闭。5分——阶段门卓越：每次评审都有充分准备（评审材料提前至少 3 天分发给评审者——评审者有充足时间审阅）、评审讨论深入且建设性（不是"找茬"而是"如何更好"）、评审发现的缺陷在后续阶段显著减少（说明阶段门在阻止缺陷传递到下游方面真正有效）、评审效率高（评审时间合理——不会因为过度评审而成为瓶颈）。评分要点：评审准备的充分性、评审参与者的独立性、评审发现的问题数量和严重性趋势、条件项的关闭时效。',
        stage: 6,
        provenance: 'official',
      },
      {
        id: 'pm-wf-rub-007',
        title: '交付件质量评分标准',
        content:
          '评估瀑布项目最终交付件的质量——综合缺陷密度、客户满意度和运维稳定性的多维度评分。1分——交付件质量差：上线/交付后出现大量P0/P1生产缺陷（上线首月>10个严重缺陷）、客户/用户对质量不满意（正式投诉或拒绝验收）、运维团队反馈系统不稳定（频繁宕机或性能问题）。3分——交付件质量合格：上线/交付后生产缺陷在可接受范围内（首月P0/P1<5个）、客户/用户对质量基本满意（通过验收但有一些改进建议）、系统运行基本稳定（偶有非关键问题但及时解决）。5分——交付件质量卓越：上线/交付后无P0缺陷（P1<3个且48小时内修复）、客户/用户对质量高度满意（超出预期——主动推荐或追加合同）、系统运行高度稳定（上线首月无计划外停机——SLA 100%达成）、运维团队反馈"这是今年接手的最稳定的系统"。评分要点：生产缺陷密度（按严重级别）、客户满意度（正式反馈/NPS）、系统稳定性指标（可用性/故障恢复时间）。',
        stage: 6,
        provenance: 'official',
      },
      {
        id: 'pm-wf-rub-008',
        title: '收尾完整度评分标准',
        content:
          '评估瀑布项目收尾的完整性和质量——不仅是"项目做完了"而且是"干净利落地结束了"。1分——收尾潦草：项目结束无正式收尾流程（"最后一个人关了灯就走了"）、经验教训未总结或总结流于形式（笼统的"要加强沟通"——无具体可执行改进）、项目文件散落在个人电脑和邮件中未归档、合同有遗留问题未解决（供应商尾款纠纷/质保责任不清）。3分——收尾基本完整：有正式收尾流程和收尾报告、经验教训已总结并归档（有具体案例和建议）、项目文件已集中归档（可在需要时找到）、合同已正式关闭（所有付款完成/质保条款确认）。5分——收尾卓越：收尾流程标准化且高效（从启动收尾到正式关闭<2周）、经验教训结构化（分类/标签/可搜索——被后续类似项目主动引用）、项目文件归档质量高（完整/版本正确/易于导航——"3年后新接手者能快速理解项目全貌"）、合同收尾干净（无遗留纠纷/供应商评估已完成/长期合作伙伴关系已建立）、客户/发起人对收尾满意度高（"期待与你们再次合作"）。评分要点：收尾流程的正式性和效率、经验教训的质量和可复用性、文档归档的完整性和可用性、合同收尾的干净程度。',
        stage: 6,
        provenance: 'official',
      },
    ],
  },
}

// ── 「产品研发」Skill 完整内容定义 ────────────────────────────────────

const PRODUCT_RD_SEED: BuiltinSkillSeed = {
  skillKey: 'skill-product-rd',
  name: '产品研发',
  version: '1.0.0',
  description:
    '覆盖硬件与软件产品研发全生命周期的领域知识包：从产品定义、概念设计、工程验证、设计验证、量产验证到量产移交。适用于智能硬件、消费电子、医疗设备、汽车零部件、工业设备等产品的研发项目管理。',
  category: { primary: 'domain', secondary: 'product_rd' },
  tags: [
    '产品研发',
    '硬件研发',
    '智能硬件',
    '研发管理',
    'IPD',
    'NPI',
    'DFM',
    'FMEA',
    '合规认证',
    'PLM',
    '供应链',
    '品质管理',
  ],
  dependencies: [],
  activation: {
    projectTypes: [
      '产品研发',
      '硬件研发',
      '智能硬件',
      '混合产品研发',
      '产品开发',
      'Product R&D',
      'Product Development',
    ],
    domains: ['product_rd', 'hardware', 'embedded', 'industrial_design', 'mechanical_engineering'],
    priority: 80,
  },
  basePriority: 80,
  knowledge: {
    rules: [
      {
        id: 'prd-rule-001',
        title: 'IPD集成产品开发流程',
        content:
          '集成产品开发（IPD, Integrated Product Development）将产品研发从"串行接力"转变为"跨职能并行协同"——市场、研发、制造、采购、服务、财务六大职能在产品定义阶段就共同参与，形成 PDT（Product Development Team）跨部门重量级团队。IPD 的核心信条：产品开发是投资行为（用投资回报率视角管理产品组合）、基于市场需求和技术趋势的异步开发、结构化流程与阶段决策评审点（DCP：概念决策/计划决策/可获得性决策/生命周期终止决策）。未通过 DCP 的项目不得进入下一阶段——这是 IPD 不可妥协的治理底线。',
        stage: 1,
        sourceRefs: [{ layer: 'L1', sourceId: 'ipd-framework', section: 'core-principles' }],
        provenance: 'official',
      },
      {
        id: 'prd-rule-002',
        title: 'DFX可制造性可测试性可维修性',
        content:
          'DFX（Design for X）即在设计阶段前置考虑制造、测试、装配、维修等下游环节的约束与需求。DFM（可制造性）：设计是否能用现有工艺和设备高效制造？DFT（可测试性）：产品是否设计了足够的测试点覆盖关键功能？DFR（可靠性）：设计是否满足目标 MTBF/寿命/B10？DFX 的设计评审必须有制造工程师、测试工程师和维修工程师参与——"设计者坐在办公室画图，工厂在车间骂设计"是不可接受的反模式。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'dfx-methodology', section: 'dfm-dft-dfr' }],
        provenance: 'official',
      },
      {
        id: 'prd-rule-003',
        title: 'FMEA失效模式与影响分析',
        content:
          'FMEA 是产品研发中预防性质量工程的基石——在每个设计阶段系统性地识别所有可能的失效模式：它如何发生（Failure Mode）、影响有多严重（Severity 1-10）、发生概率多大（Occurrence 1-10）、当前检测能力（Detection 1-10）。RPN = S×O×D——RPN > 100 的失效模式必须制定纠正措施并在 RPN < 50 后才能关闭。FMEA 不是一次性文档——每次设计变更后必须更新，并在阶段评审时由跨职能团队联合复核。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'aiag-fmea-5', section: 'rpn-methodology' }],
        provenance: 'official',
      },
      {
        id: 'prd-rule-004',
        title: '合规认证前置',
        content:
          '产品的目标市场合规认证（安全/EMC/环保/行业准入）不是"研发完成后去拿证"——认证要求必须在产品定义阶段明确并融入设计。常见认证：安全（CCC/UL/CE-LVD）、电磁兼容（FCC/CE-EMC）、环保（RoHS/REACH/WEEE）、行业准入（NMPA/FDA/MDR/ATEX/IECEx）、功能安全（ISO 26262/IEC 62304）。认证"后补"的风险：设计不满足认证要求时，修改可能触及已冻结的模具/PCB/软件——一个认证失败可致数月延期和百万级模具报废。',
        stage: 1,
        sourceRefs: [
          { layer: 'L1', sourceId: 'regulatory-compliance', section: 'pre-certification' },
        ],
        provenance: 'official',
      },
      {
        id: 'prd-rule-005',
        title: '需求双向追溯',
        content:
          '每一条产品需求（PRD中的需求）必须双向追溯到设计规格和测试用例——正向追溯（需求→设计→测试）确保每条需求都得到了实现和验证，反向追溯（测试→设计→需求）防止范围蔓延。在医疗设备（IEC 62304）和汽车功能安全（ISO 26262）领域，完整的需求追溯性是认证审计的强制要求——缺失追溯关系即为不合格项。需求变更时，追溯矩阵自动展示受波及的所有设计模块和测试用例——这是变更影响分析的精确输入。',
        stage: 2,
        sourceRefs: [{ layer: 'L1', sourceId: 'iec-62304', section: 'traceability' }],
        provenance: 'official',
      },
      {
        id: 'prd-rule-006',
        title: 'BOM管理与版本控制',
        content:
          'BOM（物料清单）是产品研发的信息中枢——设计 BOM（EBOM）描述工程设计构成，制造 BOM（MBOM）描述生产组装构成。BOM 版本必须与产品设计版本严格同步——任何设计变更导致 BOM 变化时，必须创建新 BOM 版本（不覆盖旧版本）、标注变更原因和生效时间（ECN/ECO）、同步更新 ERP/PLM 系统。BOM 错误是量产中最常见的灾难性事故——一个错误的物料号可能导致批量生产用错了零部件——"BOM 的魔鬼在细节里"。',
        stage: 4,
        sourceRefs: [{ layer: 'L1', sourceId: 'plm-best-practices', section: 'bom-management' }],
        provenance: 'official',
      },
      {
        id: 'prd-rule-007',
        title: '试产与NPI新产品导入',
        content:
          'NPI（New Product Introduction）是从"工程样机"到"可量产产品"的关键桥梁——不是"把图纸丢给工厂就能生产"。核心任务：验证制造工艺可行性（工序能力 CPK ≥ 1.33）、建立 SOP 并培训产线工人、确认工装夹具与测试治具就绪、验证供应链（供应商产能/质量/交期）、完成首件检验 FAI。NPI 必须在工厂的真实产线上进行——"实验室能做"和"产线能做"之间的鸿沟要靠 NPI 来弥合。',
        stage: 4,
        sourceRefs: [
          { layer: 'L1', sourceId: 'npi-methodology', section: 'new-product-introduction' },
        ],
        provenance: 'official',
      },
      {
        id: 'prd-rule-008',
        title: '设计评审门禁',
        content:
          '产品研发的每个阶段之间必须通过正式的设计评审（Design Review），由独立于项目团队的技术专家和跨职能代表参与。评审检查项：技术方案是否满足所有需求和约束？FMEA 是否已识别关键失效模式且 RPN 可接受？DFM/DFT/DFR 检查是否通过？合规认证要求是否已在设计中体现？评审结论：通过/有条件通过（列条件项和责任人期限）/不通过（列返工要求）。跳过设计评审是产品研发中代价最高的技术债。',
        stage: 3,
        provenance: 'official',
      },
    ],
    patterns: [
      {
        id: 'prd-pat-001',
        title: 'Stage-Gate阶段门模型',
        content:
          'Stage-Gate（Cooper, 1980s）将产品研发划分为多个阶段（Stage）和关卡（Gate）——每个 Stage 是跨职能团队并行执行的研发活动集合，每个 Gate 是 Go/Kill/Hold/Recycle 的投资决策点。典型阶段：发现→范围确定→商业论证→开发→测试验证→上市。Gate 由高级管理层和跨职能负责人组成的评审委员会做出"继续投入还是终止"的明确决策——每个 Gate 都是一次"我们还要继续在这个产品上花钱吗"的重估。',
        stage: 2,
        sourceRefs: [{ layer: 'L1', sourceId: 'stage-gate-cooper', section: 'model-overview' }],
        provenance: 'official',
      },
      {
        id: 'prd-pat-002',
        title: '系统工程V模型',
        content:
          'V 模型是复杂产品研发中协调多学科的标准框架。左侧"分解"：系统需求→系统架构→子系统需求→组件设计；右侧"集成验证"：组件测试→子系统集成测试→系统集成测试→系统验证确认。V 模型核心优势：左侧每个"定义"层级在右侧有对应"验证"层级——系统需求定义了什么该在系统验收测试中验证。这种"先定义验收标准再开始设计"的理念确保了需求-设计-测试闭环。',
        stage: 4,
        sourceRefs: [{ layer: 'L1', sourceId: 'incose-systems-engineering', section: 'v-model' }],
        provenance: 'official',
      },
      {
        id: 'prd-pat-003',
        title: '敏捷硬件开发',
        content:
          '敏捷硬件开发将迭代增量理念与硬件研发的物理约束结合——硬件不能像软件一样"每周发布"，但可在原型阶段快速迭代（3D打印快速原型、面包板电子原型、仿真验证）。关键模式：分解为多个 Sprint（2-4周），每个 Sprint 产出可测试的增量（可测试的 PCB 模块/机械子装配/固件功能）；每个 Sprint 结束时用实物展示进展——物理产品需实物验收。设计评审嵌入 Sprint 节奏。',
        stage: 4,
        sourceRefs: [{ layer: 'L1', sourceId: 'agile-hardware', section: 'iterative-prototyping' }],
        provenance: 'official',
      },
      {
        id: 'prd-pat-004',
        title: '模块化平台化',
        content:
          '模块化平台化是降低复杂度、加速迭代和实现规模经济的核心架构策略。平台化：定义一个可复用的核心平台（共享的机械底盘/电子架构/软件平台），不同产品型号基于同一平台衍生——如大众 MQB 平台支持数十款车型。模块化：将产品分解为功能独立、接口标准化的模块——一个模块的设计变更不影响其他模块（只要接口不变）。组合实现了"一次平台投入、多款产品复用"和"模块独立演进、整体产品不断升级"。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'product-platform-strategy', section: 'modularity' }],
        provenance: 'official',
      },
      {
        id: 'prd-pat-005',
        title: 'TRIZ创新方法',
        content:
          'TRIZ（发明问题解决理论）是 Altshuller 在分析数十万件专利后提炼的系统性创新方法论。核心工具：40个发明原理、技术矛盾矩阵（39个工程参数——当改善参数A但恶化参数B时，矩阵推荐最可能的发明原理）、物-场分析与标准解、技术系统进化定律。TRIZ 的优势在于将创新从"灵光一闪"变成"系统性地搜索已知的解决方案模式"——不必重新发明轮子。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'triz', section: 'contradiction-matrix' }],
        provenance: 'official',
      },
      {
        id: 'prd-pat-006',
        title: '并行工程',
        content:
          '并行工程（Concurrent Engineering）将产品研发从传统"串行流水线"转变为"跨职能并行开发"——当研发在进行概念设计时，制造工程师已在评估制造可行性、采购已在寻找供应商、质量工程师已在制定检验计划。关键使能器是"信息透明"与"提前介入"——要求所有下游职能代表从项目第一天全职参与、共享同一个 PLM 系统、下游职能有权力早期 veto 不可行方案。并行工程是 IPD 的核心理念之一。',
        stage: 2,
        sourceRefs: [
          { layer: 'L1', sourceId: 'concurrent-engineering', section: 'cross-functional-parallel' },
        ],
        provenance: 'official',
      },
      {
        id: 'prd-pat-007',
        title: '供应商协同设计',
        content:
          '关键零部件供应商不仅是"按图加工"的角色——他们可能是核心技术的世界领先者。供应商协同设计（Supplier Co-Design）在概念设计阶段就邀请关键供应商参与——供应商将其技术能力、工艺约束和成本优化建议带入设计。"早期供应商介入"（ESI）可以显著降低 BOM 成本、缩短设计周期、提升产品质量。但协同设计必须建立明确的 IP 保护和 NDA——协同越深，IP 归属和独家授权条款越需提前明确。',
        stage: 3,
        sourceRefs: [
          { layer: 'L1', sourceId: 'supplier-codevelopment', section: 'esi-early-involvement' },
        ],
        provenance: 'official',
      },
      {
        id: 'prd-pat-008',
        title: '可靠性工程',
        content:
          '可靠性工程通过系统方法确保产品在指定条件下、指定时间内、以可接受概率完成其预定功能。核心工具：可靠性框图（RBD）、故障树分析（FTA）、加速寿命试验（ALT）、可靠性增长测试（RGT——"测试-修复-再测试"循环）、Weibull 分析。对于安全关键产品（医疗器械/汽车安全系统/航空航天），可靠性工程不是"加分项"而是法定认证要求。',
        stage: 4,
        sourceRefs: [{ layer: 'L1', sourceId: 'reliability-engineering', section: 'core-methods' }],
        provenance: 'official',
      },
    ],
    antiPatterns: [
      {
        id: 'prd-ap-001',
        title: '设计冻结后频繁变更',
        content:
          '设计冻结后仍接受大量设计变更——产品研发中最常见也最致命的反模式。症状：设计冻结"只是说说而已"（每次评审后仍有大量改动）、模具已启动的情况下设计还在变——模具修改变更费用动辄数十万且可能报废、PCB Layout 在投板前还在调"紧急绕一条线"——可能引入信号完整性问题。后果：NPI 试产中发现的问题无法区分是"设计缺陷"还是"变更未充分验证"、量产日期反复推迟、团队在"设计→变更→试产→发现问题→再改设计→再试产"的死循环中耗尽士气和预算。',
        stage: 4,
        provenance: 'official',
      },
      {
        id: 'prd-ap-002',
        title: '忽视制造端约束',
        content:
          '研发团队在设计时完全不考虑制造工艺的可行性和成本——"我们只管设计得好，制造能不能做出来是工厂的事"。症状：关键尺寸无公差标注、使用非标准件和定制件（物料种类膨胀/采购周期不可控）、结构设计不考虑装配顺序——"某螺丝位置在整机装配后无法被工具触及"。后果：NPI 阶段发现大量"无法制造的原型设计"、制造工程师被迫做大量昂贵的临时补救措施、BOM 成本远超预算。',
        stage: 3,
        provenance: 'official',
      },
      {
        id: 'prd-ap-003',
        title: '认证合规后补',
        content:
          '"先做完产品再去过认证"——把认证当作独立手续而非融入设计的约束条件。症状：产品设计完成后才开始咨询认证实验室——"你们看一下这个需要过哪些认证"——"你设计前就应该来问"、PCB Layout 和结构冻结后才发现不满足 EMC 要求——修改代价巨大（重新设计PCB/增加屏蔽罩/更改结构——模具已开的代价是几十到几百万）、关键器件没有对应市场的法规认证（如某器件只有 UL 认证无 CE 认证——产品要卖欧盟但器件只认证了北美）。后果：上市日期因认证失败推迟 3-12 个月。',
        stage: 1,
        provenance: 'official',
      },
      {
        id: 'prd-ap-004',
        title: '关键器件单一供应商',
        content:
          'BOM 中的核心器件（MCU/SoC/传感器/定制开模件——"一旦断供产品无法生产"级别）只有单一供应商——无第二货源或替代方案。症状：供应商产能紧张时分配不到足够配额、收到供应商 EOL 停产通知——"这款芯片 12 个月后停产—请提前备货或替换"—替代方案需要重新设计 PCB 和重做认证。对于汽车和医疗设备等产品生命周期 10-20 年的行业，单一供应商风险尤其致命。',
        stage: 4,
        provenance: 'official',
      },
      {
        id: 'prd-ap-005',
        title: '软硬件联调推迟',
        content:
          '硬件团队和软件团队各自独立开发直到"硬件做完了"才联调——"先各自开发，硬件做完再说"。症状：硬件团队在未运行真实软件的情况下"验证"了硬件——"上电灯亮了——硬件没问题"——但软件运行时的时序/中断/电源噪声不可见；软件团队在开发板上开发——"代码在开发板上跑得好好的"——但实际硬件的 GPIO/时序/电源域与开发板不同。后果：首次联调时发现大量接口不匹配/时序冲突/电源问题——"不是说硬件没问题吗"——"软件驱动写得不对"——责任推诿、修复周期漫长。',
        stage: 5,
        provenance: 'official',
      },
      {
        id: 'prd-ap-006',
        title: '跳过EVT-DVT-PVT验证阶段',
        content:
          '将原型等同于量产——跳过或压缩 EVT/DVT/PVT 验证阶段。症状："原型已经跑得很好了——直接准备量产吧"（忽略原型是手工制作的"黄金样品"——产线工人不会/不能那样微调）、EVT 未完成就进入 DVT（"设计还不够稳但模具已经开了——只能边验证边修模"）、可靠性测试"高温高湿 1000h 测 100h 没出事就算了"——实际上大部分故障模式在 200h-500h 才会暴露。后果：量产早期大规模质量事故——召回/赔偿/品牌声誉受损的成本远超跳过验证阶段省下的时间。',
        stage: 5,
        provenance: 'official',
      },
      {
        id: 'prd-ap-007',
        title: '原型当作量产',
        content:
          '混淆"工程原型"与"量产设计"——把实验室里手工做出的功能原型当作量产设计验证通过。症状：原型使用 3D 打印件（强度/公差/表面质量与注塑件完全不同——"外形验证过了—结构没问题"）、电子使用开发板模块（Arduino/Raspberry Pi——量产需要设计专用 PCB——成本/尺寸/EMC/散热完全不同）。后果：原型上完美的产品在产线上"组装不起来"（原型可以敲进去的干涉配合在产线上完全不被接受）、因重设计导致模具报废费用超过预算 50% 以上。',
        stage: 4,
        provenance: 'official',
      },
      {
        id: 'prd-ap-008',
        title: '技术债务无清理',
        content:
          '在不断紧张的研发节奏下，团队持续积累技术债务——"这个代码脏但能跑先这样，下个版本再重构"、"这个零件用胶水临时粘的量产必须换结构"、"设计文档不全但需要时问工程师就行"——但"下个版本"和"量产前"永远不来。症状：技术债务没有记录（不在 issue/backlog 中——只在工程师脑中）、没有人负责偿还（"这不是 feature——没有 KPI"）。后果：原始团队离职后新接手者面对的是无文档/无注释/不明原因的"黑魔法设计"——"这根线为什么接这里——改了会有什么后果——没有人知道"。',
        stage: 6,
        provenance: 'official',
      },
    ],
    examples: [
      {
        id: 'prd-ex-001',
        title: '智能硬件NPI WBS',
        content:
          '某智能手表 NPI 阶段 WBS 示例。EVT（8周）：首版 PCB 和结构件（CNC/3D打印验证）、组装 10-20 台、基本功能/射频/功耗/结构适配性测试→DVT（12周）：DVT 版 PCB 和结构件（软模注塑——首次接近量产状态塑料件）、组装 50-100 台、完整功能/可靠性（高温高湿/跌落/振动/盐雾/防水IP）/EMC预测试→PVT（8周）：量产模具试模（硬模 T0/T1）、产线组装 200-500 台验证节拍/良率/CPK、出厂检验标准/包装运输/认证正式测试→MP 移交：所有 PVT 问题关闭、量产 SOP 签署、Pilot Run 首批量产 1000-5000 台。',
        stage: 4,
        sourceRefs: [{ layer: 'L1', sourceId: 'npi-methodology', section: 'npi-wbs-template' }],
        provenance: 'official',
      },
      {
        id: 'prd-ex-002',
        title: '消费电子研发阶段',
        content:
          '某旗舰手机研发案例（12-15个月）。概念（2月）：产品定义/竞品 Benchmark/核心卖点/关键器件选型（SoC/摄像头/显示屏——长交期器件最早锁定）→预研（2月）：技术可行性 Breadboard 原型/ID 工业设计多方案（CMF 迭代）→EVT（3月）：首次可开机完整工程样机 20-50台/核心功能启动→DVT（3月）：接近量产状态样机 200-500台/完整功能验证/可靠性测试/全球运营商认证→PVT（2月）：产线试产 2000-5000台/节拍良率验证/GM 软件版本冻结/首批量产。',
        stage: 1,
        sourceRefs: [
          { layer: 'L1', sourceId: 'consumer-electronics', section: 'development-phases' },
        ],
        provenance: 'official',
      },
      {
        id: 'prd-ex-003',
        title: '医疗设备研发流程',
        content:
          '某 III 类医疗器械（植入式心脏起搏器）研发流程——依据 ISO 13485 和 FDA 21 CFR Part 820 设计控制。阶段1设计输入：用户需求→设计输入需求（功能/性能/安全/法规/可用性——验收标准已定义）→阶段2设计输出：产品规格（机械/电子/软件/引线/外壳）→阶段3设计评审：独立评审员+跨职能团队+临床代表+法规代表→阶段4设计验证：台架测试/动物试验/EMC/加速寿命试验→阶段5设计确认：临床评价/模拟使用/可用性工程→阶段6设计转移：DMR 器械主记录（BOM/图纸/工艺规程/检验标准）→阶段7设计变更：任何变更重新走设计控制流程。',
        stage: 1,
        sourceRefs: [{ layer: 'L1', sourceId: 'fda-design-controls', section: '21-cfr-820-30' }],
        provenance: 'official',
      },
      {
        id: 'prd-ex-004',
        title: '汽车零部件APQP',
        content:
          'APQP（先期产品质量策划）是汽车行业（IATF 16949）的标准研发流程，五阶段：1.计划与定义——客户需求/法规/竞品基准/可靠性目标→2.产品设计与开发——DFMEA/设计评审/原型/DVP&R→3.过程设计与开发——PFMEA/控制计划/流程图/MSA→4.产品与过程确认——试生产（≥300件连续）/初始过程能力（PPK≥1.67）/PPAP→5.反馈评估——量产后的持续监控与改进。关键交付件——PPAP 18项要素包括设计记录/工程变更/DFMEA/PFMEA/控制计划/MSA/尺寸结果/材料验证/初始过程能力/PSW等。',
        stage: 1,
        sourceRefs: [{ layer: 'L1', sourceId: 'apqp-iatf16949', section: 'five-phases' }],
        provenance: 'official',
      },
      {
        id: 'prd-ex-005',
        title: '工业设备DFMEA示例',
        content:
          '某数控机床主轴系统 DFMEA 摘录。功能：主轴电机 0-15000 RPM 提供扭矩≥50Nm。失效模式1：主轴轴承过热（润滑不足→Severity 9/Occurrence 2/Detection 4→RPN 72）。纠正：增加冗余油雾发生器、温度报警阈值降到 75°C→重评 RPN 27。失效模式2：拉刀力不足（碟形弹簧疲劳→刀具飞出/工件报废/操作员受伤→Severity 10/Occurrence 3/Detection 3→RPN 90）。纠正：碟形弹簧预测性维护周期从 200万次缩到 100万次、双重冗余拉刀力检测——低于阈值报警+确认后锁定主轴。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'aiag-fmea-5', section: 'dfmea-example' }],
        provenance: 'official',
      },
      {
        id: 'prd-ex-006',
        title: '机器人软硬件联调',
        content:
          '某协作机器人关节模组联调计划示例。每两周一次集成测试（Sprint 节奏）。第1次联调（Sprint4）：单关节上电与基本驱动（CAN通信/电流环/温度/编码器验证）→第2次联调（Sprint6）：位置控制和速度控制环（PID粗调/扭矩传感器校准/温升≤25°C）→第3次联调（Sprint8）：双关节联动（力矩前馈/重力补偿/碰撞检测阈值）→第4次联调（Sprint10）：六轴整机联调（全自由度路径规划/1kHz控制频率 CPU<50%/STO安全功能测试）。P0问题必须在下次联调前关闭——不允许带着上次联调的 P0 问题进入下次联调。',
        stage: 5,
        sourceRefs: [{ layer: 'L1', sourceId: 'embedded-integration', section: 'hw-sw-cotest' }],
        provenance: 'official',
      },
      {
        id: 'prd-ex-007',
        title: '物联网产品试产',
        content:
          '某智能家居网关产品试产流程示例。试产准备（提前4周）：BOM 物料齐套确认、SMT 贴片程序验证、测试治具制作调试（Gate Test——用已知良品和不良品调通）、SOP 初稿→试产执行：首批 200台——SMT（SPI+AOI）→DIP插件波峰焊→整机装配功能测试（射频校准/互操作测试）→老化 24h（暴露早期故障）→包装 OQC（AQL 抽样）→试产总结：良率统计（首件/最终目标≥95%）、问题分类（设计/工艺/来料）、量产准入——良率达标+所有 P0/P1 关闭+节拍达标=量产 Go。',
        stage: 5,
        sourceRefs: [{ layer: 'L1', sourceId: 'electronics-manufacturing', section: 'pilot-run' }],
        provenance: 'official',
      },
      {
        id: 'prd-ex-008',
        title: '嵌入式固件版本管理',
        content:
          '某产品嵌入式固件版本管理策略。版本号语义：Major.Minor.Patch-Build（如 2.3.1-045），Major=硬件不兼容升级、Minor=后向兼容功能新增、Patch=后向兼容 Bug 修复、Build=CI 构建号。版本存储在 Flash 固定地址（0x0800FF00——Bootloader 和 App 均读此处），设备启动时上报版本号到云端设备影子，APP 根据云端版本号提示 OTA 升级。OTA 双区模式：下载→校验签名→写入 Flash→标记"待启动"→重启→自检通过→标记"已确认"（自检失败→自动回滚到上一版本）。',
        stage: 4,
        sourceRefs: [{ layer: 'L1', sourceId: 'firmware-ota', section: 'version-management' }],
        provenance: 'official',
      },
    ],
    checklists: [
      {
        id: 'prd-cl-001',
        title: '产品定义就绪检查清单',
        content:
          '产品进入研发前的定义就绪度检查（10项）。1.PRD 已由产品负责人签字（目标用户/痛点/竞品差异化价值已明确）。2.核心功能和性能指标已定义且按优先级分类（P0 Must/P1 Should/P2 Nice）。3.目标 BOM 成本和售价区间已估算且在商业可行性范围内。4.目标市场法规和认证要求已初步识别（安全/EMC/环保/行业准入）。5.关键技术风险已识别并制定验证计划——"纸面可行"不等于"技术可行"。6.长交期关键器件已初步选型并预警。7.工业设计概念方向已初步确定（多个方案已评审——不是只有一个方向）。8.商业模式与上市时间窗口已明确。9.核心团队已到位——产品负责人/项目经理/技术架构师/工业设计师/质量负责人。10.产品定义已由高级管理层批准——批准意味着资源承诺。',
        stage: 1,
        sourceRefs: [
          { layer: 'L1', sourceId: 'product-management', section: 'definition-checklist' },
        ],
        provenance: 'official',
      },
      {
        id: 'prd-cl-002',
        title: '概念设计评审检查清单',
        content:
          '概念设计通过评审的标准（10项）。1.至少 3 个不同的概念方向已被探索和比较。2.每个方案的可行性（技术/制造/成本/时间）已初步评估。3.关键器件选型（第一选型+备选）已完成初步技术验证。4.工业设计多个方向已制作快速原型或渲染图并完成评审。5.核心技术 Breadboard 原型已运行并证明可行性。6.初始 DFMEA 已识别关键失效模式且 RPN 可接受。7.认证合规要求已以清单形式明确（认证类型/实验室/标准/时间节点）。8.初始 BOM 成本估算已完成（误差±30%——概念阶段允许精度）。9.研发时间线和里程碑已制定（EVT/DVT/PVT/MP 目标日期和关键依赖）。10.方案已由跨职能团队和高级管理层评审并选定。',
        stage: 2,
        provenance: 'official',
      },
      {
        id: 'prd-cl-003',
        title: '详细设计评审检查清单',
        content:
          '详细设计通过评审的标准（12项）。1.3D 模型所有零件完成且干涉检查通过。2.工程图纸标注所有关键尺寸和公差（GD&T 而非随意"±0.1"）。3.材料牌号和供应商已明确——无"TBD"材料。4.FMEA 已更新至详细设计层面且 RPN>100 项目有纠正措施。5.BOM 已完成（物料编号/规格/数量/替代料）且采购部门确认可获得性。6.PCB Layout 完成且 DFM/DFT/DFA 检查通过。7.固件/软件架构设计文档完成——模块划分/接口定义/关键算法设计。8.仿真分析满足设计目标（热/结构强度/信号完整性/EMC预仿真）。9.所有外部接口已定义并与对接方确认。10.DFM/DFT/DFA 报告完成且制造/测试/装配代表已签字。11.合规预测试结果满足要求或已知不合规项有明确解决计划。12.详细设计已由跨职能团队正式评审通过。',
        stage: 3,
        provenance: 'official',
      },
      {
        id: 'prd-cl-004',
        title: '工程样机评审检查清单',
        content:
          'EVT 工程样机评审通过的标准（10项）。1.样机按设计组装完成数量≥10台。2.所有核心功能已通过验证——不是"基本能跑"。3.关键性能指标已测试且满足目标（续航/成像/电机效率等）。4.EVT 测试发现的问题已记录且 P0/P1 有关闭计划。5.结构适配性已验证——所有零件能顺利组装不需"辅助"。6.SOP 作业指导书初稿已编写并识别了高难度步骤。7.初始可靠性测试（≥48h连续运行/温度循环/跌落）暴露的故障模式已分析。8.各专业设计评审完成且问题关闭。9.DVT 设计修改清单已汇总和排序。10.DVT 样机的物料齐套计划已确认——所有物料交期确认无延期风险。',
        stage: 4,
        provenance: 'official',
      },
      {
        id: 'prd-cl-005',
        title: 'DVT验证就绪检查清单',
        content:
          'DVT 设计验证就绪度检查（11项）。1.样机组装≥50台且全部通过出厂全检。2.所有 EVT→DVT 设计更改已关闭——无 EVT 版残留混入。3.DVT 测试计划已评审通过（测试项目/方法/标准/设备/合格判定）。4.可靠性测试清单敲定——环境/机械/寿命（ALT ≥1.5倍目标寿命）。5.EMC 预测试实验室已预约或自有设备就绪。6.安全测试按目标市场标准准备。7.软件合规测试环境和用例已就绪。8.认证正式测试实验室已选定且预约（排队通常 2-8 周）。9.非标测试治具已制作调试完成。10.测试数据记录分析模板已定义。11.所有测试在设计的温度/湿度/海拔条件下执行。',
        stage: 5,
        provenance: 'official',
      },
      {
        id: 'prd-cl-006',
        title: 'PVT量产验证就绪检查清单',
        content:
          'PVT 制造验证就绪度检查（12项）。1.量产模具 Tf 完成且全尺寸检测和装配验证通过。2.供应商量产件已批准（PPAP——首批全尺寸全性能检验合格）且 CPK≥1.33。3.BOM 100%物料生产供应商已确定——无代用件残留。4.产线布局和工艺流程确定且所有工作站/测试站已部署调试。5.SOP 以产线操作员视角编写——不是工程师的"你懂的"表述。6.生产测试程序（ICT/FCT/Burn-in/终检）已通过 GR&R 验证。7.产线工人已培训且操作一致性验证通过。8.所有测试设备校准证书在有效期内。9.PVT 试产产量已下单（200-500台——足够样本暴露低频问题）。10.包装设计完成且包装运输测试已通过。11.客户/用户手册已完成（用户视角——不是技术说明书）。12.售后维修方案已制定——备品备件/诊断工具/维修手册已就绪。',
        stage: 5,
        provenance: 'official',
      },
      {
        id: 'prd-cl-007',
        title: '认证合规审查检查清单',
        content:
          '产品认证合规审查的就绪度检查（11项——送认证实验室前必查）。1.所有目标市场和适用法规的认证清单已确定且无遗漏。2.认证实验室已选定且有 ISO 17025 认可资质。3.送测样品按实验室要求准备——数量/版本/用途标签明确。4.测试标准和适用版本已确认（标准每年更新——确保适用目标市场承认的版本）。5.关键件清单和对应认证证书已备齐——所有安全关键件需有效认证。6.说明书和标签草案已完成（目标市场语言——安全警告/回收/合规标识）。7.软件/固件版本已锁定——送测版本须与量产版本一致。8.功能描述文档已编写——帮助认证工程师理解产品。9.安全关键设计文档已归档（隔离图/安全回路/冗余设计——认证机构必查）。10.EMC 预测试——正式送测前已完成预测试且结果良好（不应在认证实验室做第一次测试——时间和金钱浪费）。11.认证时间窗口——预留整改和复测时间（大多数产品首次 EMC 有少数项目不通过——预留时间）。',
        stage: 5,
        provenance: 'official',
      },
      {
        id: 'prd-cl-008',
        title: '量产移交评审检查清单',
        content:
          '产品研发正式移交生产的评审检查（12项——全部通过方可宣布研发完成）。1.所有 PVT 问题已关闭——无 P0/P1 遗留。2.产线良率在多日生产中稳定达标（≥95%或合同值）。3.产线节拍满足市场交付需求（产能≥订单+20%安全余量）。4.关键工序过程能力 CPK≥1.33。5.供应商量产件已通过批准（首批全尺寸全性能检验合格）。6.所有测试设备和量具的 MSA 通过（GR&R 10-30%——可接受）。7.质量控制计划（Control Plan）已签发生效——所有关键工序的检验方法/频率/抽样/反应计划。8.售后维修部门已完成产品培训（诊断/拆解/备件清单）。9.品质部门已完成生产件批准（PSW）。10.BOM/MBOM/工艺规程/检验标准/SOP 最终版签署且 ERP/PLM 版本一致。11.知识产权（专利/商标/外观设计）已提交申请。12.量产移交评审会——研发负责人正式签字移交——研发角色结束——研发组转入量产支持模式（协助处理前3个月异常和客户反馈）。',
        stage: 6,
        provenance: 'official',
      },
    ],
    rubric: [
      {
        id: 'prd-rub-001',
        title: '需求满足度评分标准',
        content:
          '评估产品最终交付相对初始 PRD 的需求满足程度。1分——大量 P0 需求未满足（关键功能缺失或性能远低于目标：如电池 24h→实际 8h、传感器精度未达标）、产品负责人不满意。3分——所有 P0 满足、大部分 P1 满足（偶有 P1 因技术/成本退而求其次但替代方案经产品负责人 accept）。5分——所有 P0/P1 满足且部分超出预期（续航目标 24h→实际 30h、重量目标 500g→实际 420g）、关键功能使用满意度高于竞品。评分要点：P0 覆盖率、性能指标达成率、满意度。',
        stage: 6,
        provenance: 'official',
      },
      {
        id: 'prd-rub-002',
        title: '设计成熟度评分标准',
        content:
          '评估产品设计的制造生产成熟程度。1分——设计不成熟：图纸缺失关键尺寸公差、BOM 物料不可获得、PVT 仍在频繁修改、制造反馈不适于制造问题>20项。3分——设计基本成熟：图纸完整且关键尺寸公差标注、>95%物料可获、设计修改限于细节优化。5分——高度成熟：图纸/BOM/OQC标准/测试规范完整且符合行业标准格式（GD&T 正确应用）、100%物料可获且有替代料方案、PVT 后变更<5处均为非功能性优化、各职能"准备就绪"。评分要点：图纸/ BOM 完整性、设计变更频率和严重性。',
        stage: 6,
        provenance: 'official',
      },
      {
        id: 'prd-rub-003',
        title: 'DFM制造可行性评分标准',
        content:
          '评估设计融入的制造可行性考虑。1分——DFM 不足：关键工序依赖手工调整（每个产品需手工校准/选配/打磨——无法标准化量产）、良率<90%、CPK<1.0、制造工时远超同品类基准。3分——DFM 基本可行：关键工序标准化（操作员培训后可重复执行产出一致）、良率≥95%、CPK≥1.0。5分——DFM 卓越：防呆设计（Poka-Yoke——错误无法发生——不对称设计/颜色编码——不是靠操作员认真而是靠设计不给犯错机会）、良率≥98%、CPK≥1.67、装配自动化率行业前列。评分要点：良率/CPK/防呆覆盖度/制造工时效率。',
        stage: 6,
        provenance: 'official',
      },
      {
        id: 'prd-rub-004',
        title: '可靠性指标评分标准',
        content:
          '评估产品可靠性与耐久性测试结果相对设计目标的达成度。1分——不达标：关键可靠性指标低于目标（MTBF/L10/可用性不达标）、ALT 提前出现严重故障、退货率超行业基准。3分——达标：关键指标满足目标、ALT 完成且故障模式已知已改进、退货率正常水平。5分——卓越：关键指标显著超出目标（实际寿命≥目标1.5倍）、Warranty期内故障率远低于行业基准（如消费电子1年退货率通常2-5%→<1%）。评分要点：核心可靠性指标达标率、ALT 结果、保修期退货率。',
        stage: 6,
        provenance: 'official',
      },
      {
        id: 'prd-rub-005',
        title: '合规通过率评分标准',
        content:
          '评估目标市场法规和认证合规达成度。1分——未满足：关键市场认证未通过或未完成、需整改代价巨大（可能重新设计关键系统）。3分——核心市场认证已通过：已获所有强制性认证证书（CCC/CE/FCC/UL/NMPA）、认证过程中 minor non-conformance 可通过小幅修改补救。5分——卓越：所有目标市场认证一次通过（首次送测即全部通过）、同时获自愿性高质量认证（ISO 26262/IEC 62304/ISO 27001）、认证时间较行业平均缩短 30%+。评分要点：目标市场覆盖率、首次通过率、认证时间与成本 vs 计划。',
        stage: 6,
        provenance: 'official',
      },
      {
        id: 'prd-rub-006',
        title: '成本达成率评分标准',
        content:
          '评估 BOM 成本和总研发成本相对预算目标的达成情况。1分——成本失控：BOM 超目标 20%+（毛利为负/无法竞争）、研发成本超预算 30%+（可避免的成本驱动因素——设计返工/认证失败/供应商变更）。3分——可控：BOM 超目标 10%内（可通过谈判/批量采购/下版本优化追回）、研发在预算 100-120% 内（超出有明确原因审批）。5分——卓越：BOM 达成或低于目标（设计优化+供应商谈判——不是低质压价）、研发在预算内甚至结余、研发全程成本意识融入设计决策（"Design to Cost"——不是做完再算成本）。评分要点：BOM 偏差率、研发成本偏差率、成本管控制度化程度。',
        stage: 6,
        provenance: 'official',
      },
      {
        id: 'prd-rub-007',
        title: 'BOM准确度评分标准',
        content:
          '评估 BOM 完整性和准确性——BOM 错误是量产灾难第一大来源。1分——错误频发：BOM 与实物不符（物料号/数量/替代料与实际不一致）、物料描述模糊致采购买错料、>5%物料不在 BOM 中。3分——基本准确：>98%物料与实际一致、重要物料的品牌/规格/替代料完整、采购状态可追踪（ERP/PLM 而非 Excel 管 BOM）。5分——卓越：100%准确（两次独立审核通过）、ECN/ECO 流程规范（变更记录完整/通知到位/ERP/MES/PLM 同步）、BOM 版本与产品版本 100% 同步、组织内一键查询——"不需要问工程师，系统里就是对的"。评分要点：BOM 准确率、变更控制规范度、ERP/PLM 与实物一致性。',
        stage: 6,
        provenance: 'official',
      },
      {
        id: 'prd-rub-008',
        title: 'NPI导入效率评分标准',
        content:
          '评估新产品从研发到量产的导入效率——时间/成本/质量。1分——困难：NPI 周期超出计划 50%+（原计划4个月→实际6个月+、每次试产因重大问题中断返工）、NPI 成本超出预算（延期/重复试产/加急物料/模具修改）。3分——基本顺畅：周期在计划 120%内（偶有问题但指数下降趋势——EVT 30项→DVT 12项→PVT 3项→MP 0项）、成本在预算内。5分——卓越高效：NPI 一次性成功（One-Pass——首次量产即达标良率产量——无 P0 问题需回头优化设计——NPI 最高境界）、周期快于行业平均（如消费电子典型 12-16周→本产品 8-10周——设计成熟/风险前期化解/供应商就绪）、NPI 知识组织内标准化可复用。评分要点：周期偏差、试产次数、首次量产良率、问题曲线收敛趋势。',
        stage: 6,
        provenance: 'official',
      },
    ],
  },
}

// ── 「DevOps」Skill 完整内容定义 ────────────────────────────────────

const DEVOPS_SEED: BuiltinSkillSeed = {
  skillKey: 'skill-devops',
  name: 'DevOps',
  version: '1.0.0',
  description:
    '覆盖研发运维全生命周期的领域知识包：从持续集成与持续交付、基础设施即代码、容器编排、可观测性到站点可靠性工程与平台工程。适用于 DevOps 转型、SRE 实践、云原生基础设施建设与运维自动化项目。',
  category: {
    primary: 'domain',
    secondary: 'devops',
  },
  tags: [
    'DevOps',
    'CI/CD',
    'IaC',
    'Kubernetes',
    'SRE',
    'DORA',
    'Terraform',
    '可观测性',
    'Docker',
    'GitOps',
    'DevSecOps',
    '平台工程',
  ],
  dependencies: [],
  activation: {
    projectTypes: [
      'DevOps',
      '研发运维',
      '开发运维',
      'DevSecOps',
      '平台工程',
      '基础设施运维',
      'SRE',
      'Site Reliability Engineering',
    ],
    domains: ['devops', 'cicd', 'infrastructure', 'sre', 'platform_engineering'],
    priority: 80,
  },
  basePriority: 80,
  knowledge: {
    // ── rules（规则）8 条 ──
    rules: [
      {
        id: 'do-rule-001',
        title: '基础设施即代码不可变',
        content:
          '所有基础设施（服务器、网络、存储、负载均衡等）必须通过声明式代码定义和版本管理，严禁手动 SSH 登录服务器修改配置。基础设施代码与应用程序代码存放在同一版本仓库或关联仓库中，变更流程与代码变更完全一致：Pull Request → 代码评审 → 自动化测试（terraform plan / cdk diff）→ 合并后自动应用。不可变基础设施原则：服务器一旦创建就不再修改，任何配置变更、补丁更新、依赖升级都通过构建新镜像并替换旧实例完成，而非在运行中的实例上操作。这消除了"配置漂移"（Configuration Drift）——手动修改与代码定义之间的差异，确保所有环境的完全一致性。Terraform 的 state 文件必须使用远程后端（S3 + DynamoDB 锁 / Terraform Cloud / Azure Storage），避免多人协作时的状态冲突和本地 state 丢失。所有敏感变量（密钥、token、密码）必须使用 secrets 管理工具（Vault / AWS Secrets Manager / SOPS）注入，严禁明文出现在 .tf 文件或环境变量中。',
        stage: 2,
        sourceRefs: [
          {
            layer: 'L1',
            sourceId: 'terraform-best-practices',
            section: 'immutable-infrastructure',
          },
        ],
        provenance: 'official',
      },
      {
        id: 'do-rule-002',
        title: 'CI/CD 流水线为唯一部署路径',
        content:
          '生产环境的任何变更必须通过 CI/CD 流水线执行，严禁本地手动构建、手动上传制品、手动执行部署脚本。流水线是唯一可信部署路径（Single Source of Truth for Deployments），这确保了每一次部署的可追溯、可复现、可审计。流水线必须包含以下不可跳过的阶段：代码检查（lint/format/SAST）→ 单元测试 → 构建制品 → 部署到非生产环境（dev/staging）→ 集成/冒烟测试 → 部署到生产环境（经人工审批门或自动化渐进发布）。制品必须只构建一次并在所有环境间晋级（Build Once, Deploy Many）——同一 Docker 镜像 tag 从 dev 晋升到 staging 再到 production，不能在每个环境重新构建。这消除了"在测试环境测试的是版本 A，部署到生产的是版本 B"的风险。流水线定义文件（Jenkinsfile / .gitlab-ci.yml / .github/workflows/*.yml / Tekton Pipeline）必须与应用代码在同一仓库中进行版本管理。任何流水线修改必须走代码评审流程——流水线是生产系统的一部分，不是"配置而已"。',
        stage: 2,
        sourceRefs: [{ layer: 'L1', sourceId: 'cd-foundations', section: 'deployment-pipeline' }],
        provenance: 'official',
      },
      {
        id: 'do-rule-003',
        title: '可观测性三支柱',
        content:
          '任何部署到生产的服务必须覆盖可观测性三支柱——指标（Metrics）、日志（Logging）和链路追踪（Tracing）——且三者必须在统一平台上关联查询。指标维度：RED 模式（Rate-请求速率、Errors-错误率、Duration-延迟）用于服务端点监控；USE 模式（Utilization-利用率、Saturation-饱和度、Errors-错误）用于基础设施资源监控。日志维度：结构化日志（JSON 格式）是硬性要求——每条日志包含 traceId、spanId、timestamp、level、service、message 等固定字段，便于索引和聚合。链路追踪维度：所有服务间调用必须传递 trace context（W3C Trace Context 或 B3 Propagation），OpenTelemetry SDK 为推荐标准。告警规则必须基于 SLI（服务等级指标）设置，告警阈值必须与 SLO（服务等级目标）关联——如"错误率 > SLO 的 60% 消耗速率"触发警告、"错误率 > SLO 的 90% 消耗速率"触发紧急告警。告警必须可操作（Actionable）——收到告警的人知道该做什么，避免"狼来了"式的噪音告警。告警通知必须包含 Runbook 链接、影响范围、最近变更和可视化仪表板直链。',
        stage: 3,
        sourceRefs: [
          { layer: 'L1', sourceId: 'google-sre-book', section: 'monitoring-distributed-systems' },
        ],
        provenance: 'official',
      },
      {
        id: 'do-rule-004',
        title: '十二要素应用',
        content:
          '云原生应用必须遵循十二要素（12-Factor App）方法论，确保应用具备可移植性、可伸缩性和持续部署能力。核心要素：I. 代码库——一份代码库对应一个应用，多份部署（staging/production）使用同一代码库的不同版本；II. 依赖——显式声明所有依赖（package.json / go.mod / requirements.txt），不依赖系统级包的隐式存在；III. 配置——配置与代码严格分离，配置存储在环境变量中（不随代码入库）；IV. 后端服务——将数据库、消息队列、缓存等视为附加资源，通过 URL 或连接字符串绑定；V. 构建-发布-运行——严格分离构建（代码编译为制品）、发布（制品+配置）和运行（启动进程）三个阶段；VI. 进程——应用进程无状态且不共享任何数据，任何需要持久化的数据存储在外部后端服务中；VII. 端口绑定——应用通过端口绑定对外暴露服务（完全自包含，不依赖外部 Web 服务器注入）；VIII. 并发——通过进程模型横向扩展，不依赖线程或守护进程；IX. 可处置性——快速启动和优雅关闭（SIGTERM 后完成当前请求、释放资源、退出）；X. 环境等价——开发、预发、生产环境尽可能相似（差距是持续交付的最大阻力）；XI. 日志——应用将日志作为事件流输出到 stdout/stderr，不关心日志的存储和路由；XII. 管理进程——一次性管理任务（数据库迁移/脚本）作为独立进程运行，与主应用进程代码一起发布。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'twelve-factor-app', section: 'methodology' }],
        provenance: 'official',
      },
      {
        id: 'do-rule-005',
        title: '安全左移',
        content:
          '安全实践必须从软件开发的最早阶段嵌入——需求分析、架构设计、编码阶段而非在发布前或生产事故后才介入。安全左移的四个关键落地：1. 威胁建模——在架构设计阶段使用 STRIDE 模型（Spoofing 欺骗、Tampering 篡改、Repudiation 否认、Information Disclosure 信息泄露、Denial of Service 拒绝服务、Elevation of Privilege 权限提升）系统性地识别每项功能的安全威胁和缓解措施。2. SAST（静态应用安全测试）——代码提交时自动触发安全扫描，高危漏洞阻断合并（不允许包含 SQL 注入、XSS、硬编码凭据的代码进入主分支）。3. 依赖项扫描——每次构建自动扫描第三方依赖的已知漏洞（CVE），存在 Critical/High 漏洞的依赖项必须立即升级或替换。4. 容器镜像扫描——基础镜像和最终镜像均需通过漏洞扫描，Critical 漏洞镜像不得部署到任何环境。5. 密钥管理——凭据、API Key、证书等敏感信息必须使用 Secrets Manager（Vault / AWS Secrets Manager / SOPS）管理，严禁硬编码、严禁通过环境变量明文传递、严禁提交到代码仓库。CI/CD 流水线中集成 DAST（动态应用安全测试）和合规检查（如 CIS Benchmark）作为部署门禁——安全扫描未通过的门禁不得进入生产环境。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'owasp-devsecops', section: 'shift-left' }],
        provenance: 'official',
      },
      {
        id: 'do-rule-006',
        title: '不可变基础设施',
        content:
          '服务器实例一旦创建就永不修改——任何配置变更、操作系统补丁、依赖升级都通过构建新的不可变镜像（AMI/Docker Image）并替换旧实例完成，而非在运行实例上操作。不可变基础设施消除了配置漂移和雪花服务器（Snowflake Server）问题，确保所有实例的一致性。操作实践：基础设施代码化——所有服务器配置通过 Terraform/Pulumi 声明式定义；镜像构建流水线化——基础镜像定期重建（如每周自动构建最新的安全补丁版本）；蓝绿部署或金丝雀发布——新版本实例组启动并通过健康检查后，流量逐步切换，旧实例组在确认稳定后销毁；实例禁止 SSH 登录——所有操作通过配置管理、CI/CD 流水线或编排系统执行，紧急情况使用堡垒机并经审批审计；状态外置——会话、缓存、文件存储等有状态数据存储在外部服务（数据库、对象存储、Redis），实例本身完全无状态，可随时被替换而不丢失数据。',
        stage: 4,
        sourceRefs: [
          { layer: 'L1', sourceId: 'hashicorp-tao', section: 'immutable-infrastructure' },
        ],
        provenance: 'official',
      },
      {
        id: 'do-rule-007',
        title: '蓝绿与金丝雀部署',
        content:
          '生产环境部署必须使用蓝绿部署或金丝雀发布策略，杜绝"停机部署"或"一次性全量切换"。蓝绿部署：维护两套完全相同的生产环境——蓝色（当前活跃版本）和绿色（新版本）。新版本部署到绿色环境并通过所有验证（冒烟测试、健康检查、性能基准）后，通过负载均衡器一次性地将所有流量从蓝色切换到绿色。回滚只需将流量切回蓝色，恢复时间以秒计。适用场景：重大版本变更、数据库迁移、基础设施变更——需要快速回滚能力。金丝雀发布：新版本先部署到一小部分实例（如 5%），监控关键指标（错误率、延迟、业务指标），确认无异常后逐步扩大比例（5%→25%→50%→100%），每次扩大前都需要验证窗口期。如果在任何阶段发现指标劣化，自动或手动回滚金丝雀实例。适用场景：希望最小化变更风险、需要真实流量验证。无论哪种策略，部署必须支持一键回滚或自动回滚，回滚操作不依赖重新构建（构建可能失败）——必须保留上一个版本的可部署制品。',
        stage: 5,
        sourceRefs: [
          { layer: 'L1', sourceId: 'devops-handbook', section: 'zero-downtime-deployment' },
        ],
        provenance: 'official',
      },
      {
        id: 'do-rule-008',
        title: '故障复盘无责文化',
        content:
          '生产事故发生后必须进行无指责复盘（Blameless Postmortem），聚焦于"系统为什么允许这个故障发生"而非"谁犯了错"。复盘的核心原则：不寻找个人责任——事故是系统性的，是流程、工具、知识、培训、设计的不足共同导致，而非个人失误；不惩罚犯错者——惩罚会导致隐瞒事故和推卸责任，使组织失去从故障中学习的机会；详细记录时间线和影响——精确到分钟的时间线（谁做了什么、观察到什么、何时升级、何时缓解），用于分析信息传递和决策延迟；识别根本原因和促成因素——使用"5 Why"或因果图（Ishikawa Diagram）追溯到底层系统性问题；产出可执行行动项——每个行动项有明确负责人和截止日期，优先级分为 P0（立即执行）和 P1（本迭代完成）；行动项跟踪至完成——复盘不是"开了会就结束"，需在后续 Sprint 中跟踪至所有 P0 项关闭。谷歌 SRE 的实践证明，无指责文化是组织学习能力的基础——"故障是不可避免的，但从故障中不学习是不可接受的"。',
        stage: 6,
        sourceRefs: [{ layer: 'L1', sourceId: 'google-sre-book', section: 'postmortem-culture' }],
        provenance: 'official',
      },
    ],

    // ── patterns（模式）8 条 ──
    patterns: [
      {
        id: 'do-pat-001',
        title: 'GitOps 工作流',
        content:
          'GitOps 是以 Git 仓库作为声明式基础设施和应用程序配置的唯一事实来源，通过自动化流程确保集群的实际状态与 Git 中的期望状态持续同步。核心工作流：1. 所有配置（Kubernetes 清单、Helm Charts、Terraform 模块、策略文件）存储在 Git 仓库中，分支策略对应环境（main→production、staging→staging）；2. 开发者通过 Pull Request 提交变更，代码评审和自动化校验（kubeval / conftest / OPA）通过后合并；3. GitOps 控制器（ArgoCD / Flux）持续监控 Git 仓库与集群状态的差异，自动将 Git 中的期望状态应用到集群；4. 集群实际状态偏离 Git 时（如有人手动 kubectl apply），控制器自动纠正或告警（取决于 sync policy）；5. 回滚操作只需 Git revert 并合并，控制器自动执行回滚。GitOps 的核心优势：单一事实来源（Git 即真相）、完整的审计追踪（每个变更对应一次 Git commit）、开发者友好的工作流（用 Git 操作管理一切）、增强的安全性（不需要直接访问集群的 CI/CD 凭证）。Weaveworks 是 GitOps 术语的提出者和最佳实践推动者。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'weaveworks-gitops', section: 'principles' }],
        provenance: 'official',
      },
      {
        id: 'do-pat-002',
        title: '容器化与 Kubernetes 编排',
        content:
          '应用容器化是现代 DevOps 的基础实践——将应用及其所有依赖打包为轻量级、可移植的容器镜像，确保开发、测试、生产环境的一致性。Docker 是事实标准容器运行时，Dockerfile 定义镜像构建步骤：基础镜像选择（优先官方镜像或经过安全扫描的瘦身镜像，如 distroless 或 alpine）、多阶段构建（分离构建依赖和运行时依赖以减小镜像体积）、层级优化（将变化频率低的层放在前面以利用缓存）、非 root 用户运行（安全最佳实践）。Kubernetes 作为容器编排平台提供：自动调度（将容器按资源需求调度到最优节点）、自愈（容器崩溃自动重启、节点故障自动迁移 Pod）、水平伸缩（HPA 基于 CPU/内存或自定义指标自动扩缩 Pod 数量）、服务发现与负载均衡（Service + Ingress 管理集群内外流量）、滚动更新与回滚（Deployment 控制器支持零停机更新和快速回滚）、配置与密钥管理（ConfigMap 和 Secret 分离配置与代码）。Kubernetes 的声明式 API 与控制器模式使其成为云原生生态的操作系统——开发者声明期望状态，控制器持续协调实际状态趋近期望状态。',
        stage: 4,
        sourceRefs: [{ layer: 'L1', sourceId: 'kubernetes-docs', section: 'concepts' }],
        provenance: 'official',
      },
      {
        id: 'do-pat-003',
        title: '服务网格',
        content:
          '服务网格（Service Mesh）是将服务间通信的可靠性、安全性和可观测性能力从应用代码中下沉到基础设施层的架构模式。Istio 是 CNCF 中最成熟的服务网格实现，其架构分为数据平面（Data Plane——以 Sidecar 模式注入到每个 Pod 的 Envoy 代理，拦截所有入站和出站流量）和控制平面（Control Plane——Istiod 负责配置管理、服务发现、证书颁发和策略分发）。核心能力：流量管理——细粒度的流量路由（按 Header/Cookie/权重分流）、金丝雀发布（基于权重的渐进流量切换）、熔断与故障注入（测试系统韧性）；安全——自动 mTLS（双向 TLS）加密服务间通信、细粒度访问控制（AuthorizationPolicy——基于 JWT Claim / 命名空间 / 服务账户）；可观测性——自动生成服务拓扑图、收集 L7 指标（请求速率/错误率/延迟，按 source/destination 维度）、分布式追踪集成（Envoy 自动传播 trace headers）。Linkerd 是另一个流行的轻量级替代方案，专注于简洁性和低资源开销。服务网格适合服务数量多（> 20 个）、需要统一安全策略和细粒度流量控制的大中型微服务架构。',
        stage: 5,
        sourceRefs: [{ layer: 'L1', sourceId: 'istio-docs', section: 'architecture' }],
        provenance: 'official',
      },
      {
        id: 'do-pat-004',
        title: '声明式基础设施',
        content:
          '声明式基础设施是 Infrastructure as Code 的核心理念——定义"基础设施应该是什么状态"而非"如何达到这个状态"，由 IaC 工具（Terraform / Pulumi / Crossplane）负责计算和执行达到期望状态所需的具体操作。Terraform 使用 HCL 语言描述资源：resource 定义具体资源（如 aws_instance、kubernetes_deployment）、data source 查询现有资源、variable 参数化配置、output 暴露资源属性给外部消费。执行流程：terraform init（初始化 provider 插件和 backend）→ terraform plan（对比当前状态与期望状态的差异，生成执行计划——新增/修改/删除）→ terraform apply（执行计划，更新真实基础设施）。Terraform state 文件是关键——记录了真实基础设施与代码定义之间的映射，必须安全存储（远程 backend + 加密 + 版本管理）。Pulumi 提供使用通用编程语言（TypeScript / Python / Go / C#）定义基础设施的替代方案，适合偏好编程语言胜于 DSL 的团队。声明式基础设施与 GitOps 结合形成完整的 Git 驱动运维——基础设施代码入库、PR 触发自动 plan 并在评论中展示 diff、合并后自动 apply。',
        stage: 3,
        sourceRefs: [
          { layer: 'L1', sourceId: 'terraform-docs', section: 'configuration-language' },
        ],
        provenance: 'official',
      },
      {
        id: 'do-pat-005',
        title: '混沌工程',
        content:
          '混沌工程是在分布式系统上进行受控实验以建立对系统应对混乱条件的能力信心的实践。Netflix 的 Chaos Monkey 是混沌工程的开创者——在生产环境中随机终止实例以验证系统的自动恢复能力。混沌工程的原则：1. 定义稳态假设——先定义系统在正常情况下的可测量输出（如"API P99 延迟 < 500ms 且错误率 < 0.1%"）；2. 设计最小爆炸半径的实验——从小范围（单个实例/单个 AZ/单个服务）开始，逐步扩大范围；3. 在受控条件下引入变量——模拟真实世界故障：网络延迟、DNS 故障、磁盘满、CPU 飙升、依赖服务超时、整个 AZ 不可用；4. 在实验中持续监控稳态指标——一旦稳态被打破（实际影响超出预期），立即中止实验；5. 自动化混沌实验——将实验集成到 CI/CD 流水线中定期执行（如每次部署后自动运行核心韧性测试）。工具生态：Chaos Mesh（Kubernetes 原生——支持 Pod 故障、网络故障、IO 故障）、LitmusChaos（CNCF 项目——声明式混沌实验定义）、Gremlin（商业平台——提供更丰富的故障注入类型和实验管理）。混沌工程的最终目标不是"破坏东西"，而是"证明系统在破坏中仍然可靠"。',
        stage: 6,
        sourceRefs: [{ layer: 'L1', sourceId: 'netflix-chaos-engineering', section: 'principles' }],
        provenance: 'official',
      },
      {
        id: 'do-pat-006',
        title: '渐进交付',
        content:
          '渐进交付（Progressive Delivery）是持续交付的进化——将新功能逐步、可控地发布给用户子集，而非一次性全量上线。核心策略：1. 金丝雀发布——新版本先部署到 5% 流量，验证关键指标（错误率/延迟/业务转化率）无劣化后逐步扩大比例；2. 功能标志（Feature Flag）——将功能发布与代码部署解耦：代码随时部署到生产，但功能通过开关控制对特定用户群开放（内部员工→Beta 用户→5%→50%→100%），出现问题时只需关闭标志，无需回滚部署；3. A/B 测试——同时运行两个版本以比较用户行为差异，数据驱动地决定哪个版本全量上线；4. 蓝绿部署——维护两套完整环境，验证后一次性切换流量。渐进交付的关键工具：LaunchDarkly / Split.io 提供功能标志管理平台，Argo Rollouts（Kubernetes 原生）提供声明式渐进交付 CRD（支持金丝雀和蓝绿策略，自动分析 Prometheus 指标决定推进或回滚），Flagger（集成 Istio/Linkerd/NGINX 的服务网格渐进交付 Operator）。渐进交付将部署风险从"可能影响 100% 用户"降低到"只影响 x% 用户"，使团队敢于更频繁地部署。',
        stage: 5,
        sourceRefs: [{ layer: 'L1', sourceId: 'argo-rollouts', section: 'progressive-delivery' }],
        provenance: 'official',
      },
      {
        id: 'do-pat-007',
        title: '平台工程内部产品',
        content:
          '平台工程是将 DevOps 实践产品化——构建内部开发者平台（Internal Developer Platform, IDP）作为产品来服务应用开发团队，目标是降低认知负荷和提高开发者自服务能力。平台工程的核心原则：将平台视为产品——定义平台的目标用户（应用开发团队）、用户旅程（从创建新服务到部署上线的完整体验）、SLO（平台可用性目标）、反馈循环（NPS 调研）；构建"黄金路径"（Golden Path）——预配置的最佳实践模板（脚手架、CI/CD 流水线、监控仪表板、基础设施模块），让开发者一键创建符合组织标准的服务，同时不阻止开发者自定义；自服务能力——开发者通过 Portal/CLI/API 自助完成资源申请、环境创建、部署和监控，不依赖运维团队的人工 ticket；认知负荷管理——平台抽象底层基础设施的复杂性，提供开发者友好的接口（如 Backstage 的 Software Catalog + TechDocs + Scaffolder）。CNCF 的平台工程白皮书（Platform Engineering Maturity Model）将平台成熟度分为四个级别：Level 0-无平台（手动 ticket 驱动）、Level 1-基础平台（标准化 CI/CD 和基础设施模块）、Level 2-自服务平台（Portal + Golden Path + 自助资源管理）、Level 3-产品化平台（SLO 驱动 + 开发者体验度量 + 持续改进）。',
        stage: 5,
        sourceRefs: [
          { layer: 'L1', sourceId: 'cncf-platform-engineering', section: 'maturity-model' },
        ],
        provenance: 'official',
      },
      {
        id: 'do-pat-008',
        title: '站点可靠性工程 SRE',
        content:
          '站点可靠性工程（Site Reliability Engineering）是谷歌首创的运维方法论——用软件工程的方法解决运维问题，核心是"以错误预算（Error Budget）为决策框架，平衡可靠性与功能迭代速度"。SRE 的核心实践：1. SLO 与错误预算——为每个服务定义 SLI（如可用性 99.9%），转化为错误预算（允许的不可用时间——每月 43 分钟），错误预算未耗尽时可发布新功能，预算耗尽则冻结发布并投入可靠性改进；2. 减少苦工（Toil）——通过自动化消除重复性手动操作，SRE 团队至少 50% 时间投入工程工作而非运维操作；3. 监控与告警——基于"四大黄金信号"（延迟、流量、错误、饱和度）建立告警，告警必须紧急、可操作且需要人工介入；4. 变更管理——渐进发布、快速检测问题、快速回滚——目标是 MTTR（平均恢复时间）而非 MTBF（平均故障间隔）；5. 容量规划——基于负载测试和需求预测，确保系统在预期增长下有充足容量；6. 事故管理——On-Call 轮值、事故指挥官角色、无指责复盘。SRE 与传统运维的根本区别：SRE 是工程团队而非操作团队——写代码自动化运维而非手动执行运维任务。',
        stage: 6,
        sourceRefs: [{ layer: 'L1', sourceId: 'google-sre-book', section: 'introduction' }],
        provenance: 'official',
      },
    ],

    // ── antiPatterns（反模式）8 条 ──
    antiPatterns: [
      {
        id: 'do-ap-001',
        title: '手动配置雪花服务器',
        content:
          '运维人员通过 SSH 登录每台服务器手动安装软件、修改配置、调整参数——导致每台服务器配置独一无二（"雪花服务器" Snowflake Server），环境之间（dev/staging/production）的配置差异无法追踪和复现。典型症状：只有某人知道某台服务器的特殊配置，此人休假或离职时服务器成为"碰不得"的遗留系统；生产环境出问题时，无法在测试环境复现——因为测试环境配置与生产不同；服务器扩容时，新实例需要手动重复配置过程，交付周期以天为单位。根治方案：全面采用 Infrastructure as Code（Terraform / Ansible / Pulumi），所有服务器配置声明式定义在代码中并版本管理；采用不可变基础设施模式——服务器通过构建标准化镜像（Packer / Docker）创建，禁止登录修改；使用配置管理工具（Ansible / Chef / Puppet）确保所有实例的一致性；建立合规检测——定期扫描运行中实例的配置漂移并自动修复或告警。',
        stage: 2,
        sourceRefs: [{ layer: 'L1', sourceId: 'phoenix-project', section: 'snowflake-servers' }],
        provenance: 'official',
      },
      {
        id: 'do-ap-002',
        title: '无 CI/CD 手工部署',
        content:
          '开发完成后由专人手动执行部署——本地构建、手动上传制品（scp/FTP/Web 管理后台）、手动执行数据库迁移脚本、手动重启服务。典型症状：部署步骤存在于某人的脑子里或过时的 Wiki 文档中；"在我的机器上能跑"成为部署失败的标准回应；每次部署时间超过 30 分钟且结果不可预测；部署操作没有审计追踪——不知道谁在什么时候做了什么变更；回滚困难——需要找到上一个版本的制品并手动恢复数据库。根治方案：建立 CI/CD 流水线——代码推送触发自动构建和测试，制品自动推送到制品仓库（Docker Registry / Artifactory / ECR）；部署通过流水线执行——一键部署或合并后自动部署，所有部署操作可追溯（谁在什么时间部署了哪个版本）；实现零停机部署——蓝绿/金丝雀/滚动更新，用户无感知；制品只构建一次——同一制品在所有环境间晋级。DORA 研究表明，实施 CI/CD 的高绩效团队部署频率是低绩效团队的 208 倍，变更前置时间快 106 倍。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'dora-accelerate', section: 'continuous-delivery' }],
        provenance: 'official',
      },
      {
        id: 'do-ap-003',
        title: '监控告警缺失或过噪',
        content:
          '要么完全没有监控——服务是否正常、用户是否能访问完全未知，直到用户投诉才知道出问题；要么告警过多过滥——CPU > 70% 告警、磁盘 > 60% 告警、内存 > 50% 告警，每天收到数百条告警但 95% 是噪音，导致团队对告警麻木，真正紧急的告警被淹没。典型症状：告警风暴——一个服务故障导致数百条关联告警涌入，On-Call 工程师无法快速定位根因；告警无 Runbook——收到告警的人不知道该如何响应；告警阈值无依据——凭经验设定阈值，经常误报或漏报。根治方案：以 SLO 为基准设定告警——只有影响 SLO 的指标才触发告警（如"错误率消耗了错误预算的 60%"）；告警分级——Critical（立即响应，5 分钟内）、Warning（工作时间处理）、Info（仅记录不通知）；告警必须附带 Runbook 链接和诊断仪表板；建立告警优化循环——定期审查告警（Alert Review），移除从未触发或频繁误报的规则，调整阈值以匹配真实流量模式；实现告警聚合和降噪——将同一根因的多条告警聚合为一条 Incident 通知。',
        stage: 4,
        sourceRefs: [{ layer: 'L1', sourceId: 'google-sre-book', section: 'alerting-on-slos' }],
        provenance: 'official',
      },
      {
        id: 'do-ap-004',
        title: '无灾备与恢复演练',
        content:
          '备份策略存在但从未验证——备份是否能恢复、恢复需要多长时间、恢复后的数据是否完整，全部未知。典型症状：定期备份任务表面上成功但实际备份文件损坏（没人检查过）；恢复流程仅存在于文档中，从未实际操作过；灾难发生后发现备份不可用或恢复时间远超 SLA；数据库主从切换从未演练，真正需要切换时发现从库数据严重滞后或复制已中断多日。根治方案：定期自动恢复演练（如每月/每季度从最新备份完整恢复到一个隔离环境，验证数据完整性和恢复时长）；备份的 3-2-1 原则——3 份拷贝、2 种介质、1 份异地；恢复时间目标（RTO）和恢复点目标（RPO）明确定义并与业务方确认——不是所有系统都需要秒级 RTO；灾备切换自动化——通过 Chaos Engineering 演练主动切换（如 Chaos Mesh 定期模拟主数据库故障，验证自动故障转移和高可用机制）；灾备文档（Disaster Recovery Runbook）保持更新并在每次演练后修正。',
        stage: 5,
        sourceRefs: [
          { layer: 'L1', sourceId: 'aws-well-architected', section: 'reliability-pillar' },
        ],
        provenance: 'official',
      },
      {
        id: 'do-ap-005',
        title: '凭据硬编码',
        content:
          'API Key、数据库密码、TLS 证书私钥、第三方服务 Token 等敏感凭据硬编码在源代码、配置文件或环境变量中明文传递。典型症状：代码仓库中能搜索到密码（git log -p 查历史能发现更多）；凭据泄露后更换困难——需要修改代码、重新构建、重新部署所有使用该凭据的服务；凭据在所有环境共用——开发环境的数据库密码与生产环境相同；凭据未定期轮换——同一密码使用数年未改。根治方案：使用 Secrets Manager（HashiCorp Vault / AWS Secrets Manager / Azure Key Vault / GCP Secret Manager）集中管理凭据；应用启动时从 Secrets Manager 动态获取凭据，支持自动轮换——Secrets Manager 定期更新凭据，应用自动加载新凭据无需重启；CI/CD 流水线中的凭据通过平台自身的 Secrets 管理（GitHub Secrets / GitLab CI Variables / Jenkins Credentials）注入，绝不写入代码；强制推行 pre-commit hook 扫描（如 git-secrets / detect-secrets / truffleHog）阻止凭据提交；建立凭据泄露应急响应流程——发现泄露后立即轮换所有受影响凭据、审计访问日志、评估潜在影响。',
        stage: 3,
        sourceRefs: [
          { layer: 'L1', sourceId: 'owasp-secrets-management', section: 'best-practices' },
        ],
        provenance: 'official',
      },
      {
        id: 'do-ap-006',
        title: '日志无结构化',
        content:
          '应用日志是非结构化或半结构化的自由文本——每条日志格式不同（不同开发者有不同的日志风格），没有统一的字段标准（有的用 timestamp 有的用 time，有的记录 userId 有的不记录），日志级别使用混乱（Debug 级别记录用户支付信息、Error 级别记录"用户未登录"的预期行为）。典型症状：跨服务排查问题时需要在不同格式的日志间跳转，手工关联同一个请求在不同服务中的日志——平均定位时间从分钟级延长到小时级；无法高效聚合和分析日志——"过去 1 小时有多少用户遇到支付失败"需要在日志搜索引擎中写复杂的正则表达式；关键信息缺失——日志中没有 traceId，无法追踪请求的完整链路。根治方案：统一日志格式——所有服务输出结构化 JSON 日志，必须字段包括 timestamp（ISO 8601）、level（DEBUG/INFO/WARN/ERROR）、service（服务名）、traceId（W3C Trace Context）、message（人类可读描述）；日志级别规范——DEBUG（开发调试信息，生产默认关闭）、INFO（关键业务流程节点）、WARN（可恢复的异常）、ERROR（需要人工介入的故障）；敏感信息脱敏——日志中不记录密码、Token、完整信用卡号、身份证号等；集成 OpenTelemetry 自动注入 trace context，实现日志与链路追踪的自动关联。',
        stage: 3,
        sourceRefs: [{ layer: 'L1', sourceId: 'opentelemetry', section: 'logging-data-model' }],
        provenance: 'official',
      },
      {
        id: 'do-ap-007',
        title: '部署与运维分离',
        content:
          '开发团队负责写代码，"扔过墙"给运维团队负责部署和线上运维——开发与运维之间是交接关系而非协作关系。典型症状：开发对生产环境无感知——不知道服务的实际运行状态、资源消耗、用户行为；运维对应用行为不了解——遇到生产问题时只能重启服务（"试试重启，不行再找开发"），故障恢复时间长；部署成为瓶颈——运维团队是唯一的部署执行者，部署请求排期等待（从开发完成到上线可能需要数天甚至数周）；事故响应效率低——开发在排查问题时无法直接访问生产日志和监控，需要运维代为查询。根治方案：实践 DevOps 文化——"你构建它，你运维它"（You Build It, You Run It），开发团队对自己服务的全生命周期负责；开发拥有生产环境只读权限（日志/监控/追踪），能够快速定位和解决问题；CI/CD 流水线赋能开发团队自助部署——合并到主分支后自动部署，不需要运维手动执行；运维转型为平台工程团队——构建自服务平台和 Golden Path，赋能而非阻塞开发团队；建立 On-Call 轮值——开发与运维共同参与，事故响应时 Incident Commander 可来自任一团队。',
        stage: 4,
        sourceRefs: [
          { layer: 'L1', sourceId: 'devops-handbook', section: 'you-build-it-you-run-it' },
        ],
        provenance: 'official',
      },
      {
        id: 'do-ap-008',
        title: '无容量规划盲目扩容',
        content:
          '不基于数据和趋势做容量规划，系统扩容全凭直觉或"等出问题再说"——系统性能下降时匆忙扩容，经常遇到资源不足（云区域实例售罄、IP 地址耗尽、配额不足）或过度扩容导致成本浪费。典型症状：流量高峰期（大促/营销活动）前未做容量评估和提前扩容——活动开始时系统崩溃；遇到性能问题时第一反应是"加机器"，而不分析瓶颈在哪里（是数据库连接池耗尽、缓存命中率低、还是代码效率问题）；云资源账单失控——存在大量未使用或使用率极低的实例（"为了安全多开了几台"）；未建立自动伸缩策略——流量低谷时资源闲置浪费，流量高峰时手动扩容来不及。根治方案：建立容量规划流程——基于历史数据和业务预测（QPS 增长率、用户增长趋势）提前规划资源需求；实现自动弹性伸缩——基于 CPU/内存/自定义业务指标（请求队列长度/并发连接数）自动扩缩；定期容量评审——每月/每季度审查资源使用率和成本，识别浪费和瓶颈；负载测试——定期执行负载测试验证系统的实际容量上限，与理论规划对比；资源预留——对于需要预热（缓存填充/JIT 编译）的服务，预留缓冲容量以应对突发流量。',
        stage: 5,
        sourceRefs: [
          { layer: 'L1', sourceId: 'aws-well-architected', section: 'performance-efficiency' },
        ],
        provenance: 'official',
      },
    ],

    // ── examples（示例）8 条 ──
    examples: [
      {
        id: 'do-ex-001',
        title: 'CI/CD 流水线定义',
        content:
          '使用 GitHub Actions 定义一个完整的 CI/CD 流水线示例——从代码推送到生产部署的自动化流程。流水线结构：1. 触发条件——push 到 main 分支或 Pull Request 到 main 触发；2. Lint 与格式检查阶段——并行执行 ESLint、Prettier 格式检查、Markdown 链接检查，耗时约 30 秒；3. 单元测试与 SAST 阶段——运行 Vitest 单元测试并收集覆盖率报告、执行 CodeQL 安全扫描、OSV-Scanner 依赖项漏洞扫描，覆盖率低于 80% 或发现 Critical 漏洞时失败；4. 构建阶段——Docker 镜像构建（多阶段构建：npm ci→npm run build→仅复制构建产物到 nginx 基础镜像），推送到容器镜像仓库（ghcr.io），镜像标签使用 git SHA 和 latest；5. 部署 Staging 阶段——通过 ArgoCD Image Updater 自动更新 Staging 集群的 Deployment 镜像版本，等待 Pod 就绪并执行冒烟测试（curl 关键端点验证 HTTP 200）；6. 部署 Production 阶段（需要人工审批 environment: production）——ArgoCD 同步到 Production 集群，执行金丝雀发布（5%→25%→100%，每步监控 10 分钟），Prometheus 错误率 SLO 监控——如错误率超过阈值自动回滚。',
        stage: 4,
        sourceRefs: [{ layer: 'L1', sourceId: 'github-actions', section: 'workflow-syntax' }],
        provenance: 'official',
      },
      {
        id: 'do-ex-002',
        title: 'Terraform 基础设施代码',
        content:
          '使用 Terraform 定义 AWS 上三层 Web 应用基础设施的完整示例。网络层：VPC（CIDR 10.0.0.0/16）→ 公有子网（ALB + NAT Gateway）+ 私有子网（ECS + RDS + ElastiCache）跨 3 个 AZ 部署，使用 terraform-aws-modules/vpc 模块简化配置。计算层：ECS Fargate 运行容器化 Web 应用，通过 Auto Scaling 根据 CPU 利用率（target 70%）自动扩缩容器实例数（min=2, max=10），Service 关联 ALB Target Group 实现负载均衡和健康检查。数据层：RDS Aurora PostgreSQL 多 AZ 部署（1 主 + 1 只读副本），自动备份保留 30 天，加密静态数据（KMS）；ElastiCache Redis Cluster 用于会话存储和缓存。安全层：Security Group 最小权限原则——ALB 仅允许 80/443 入站、ECS 仅接受来自 ALB 的流量、RDS 仅接受来自 ECS SG 的 5432 端口；所有敏感资源（RDS 密码、Redis AUTH Token）通过 AWS Secrets Manager 管理。Terraform Remote State 存储在 S3 + DynamoDB 锁，State 文件加密（SSE-S3）。模块化设计——VPC 模块、ECS 模块、RDS 模块独立定义，可复用和独立测试。',
        stage: 4,
        sourceRefs: [
          { layer: 'L1', sourceId: 'terraform-aws', section: 'three-tier-architecture' },
        ],
        provenance: 'official',
      },
      {
        id: 'do-ex-003',
        title: 'Kubernetes 部署清单',
        content:
          "一套完整的微服务应用 Kubernetes 部署清单示例，包含 Deployment、Service、Ingress、HPA 和 ConfigMap 的声明式定义。Deployment 定义——replicas: 3（最小高可用）、strategy: RollingUpdate（maxSurge: 1, maxUnavailable: 0 确保零停机）、Pod 规格（resources.requests 和 limits 对称设置以获取 Guaranteed QoS）、readinessProbe（HTTP GET /healthz，initialDelaySeconds: 10, periodSeconds: 5）、livenessProbe（HTTP GET /healthz，initialDelaySeconds: 30——给应用充足的启动时间）、preStop hook（sleep 10 等待 Endpoint 更新和连接排空）。Service 定义——ClusterIP 类型（内部服务间通信），通过 label selector 匹配 Deployment Pod，暴露 8080 端口。Ingress 定义——nginx-ingress 控制器，TLS 终止（cert-manager 自动管理 Let's Encrypt 证书），路由规则按 path 分发到不同 Service（/api/*→api-service, /*→web-service）。HPA 定义——minReplicas: 3, maxReplicas: 20，基于 CPU 利用率 70% 和内存利用率 80% 自动扩缩。ConfigMap 定义——非敏感配置（日志级别、API 超时、特性开关）通过 ConfigMap 挂载为环境变量或文件，与代码分离。所有资源定义在 Git 仓库中通过 ArgoCD 同步到集群。",
        stage: 4,
        sourceRefs: [{ layer: 'L1', sourceId: 'kubernetes-docs', section: 'workloads' }],
        provenance: 'official',
      },
      {
        id: 'do-ex-004',
        title: 'Prometheus 告警规则',
        content:
          '基于 Google SRE 四大黄金信号和错误预算的 Prometheus 告警规则定义示例。高优先级告警（Critical——立即通知 On-Call）：1. 错误率 SLO 消耗过快——sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) > 0.001（假设 SLO 为 99.9%，错误预算月度消耗超过 60% 即 0.06% 时告警）；2. 延迟 SLO——histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m])) > 0.5（P99 延迟超过 500ms）；3. 实例宕机——up == 0 for 5m。中等优先级告警（Warning——工作时间处理）：1. CPU 饱和度——node_cpu_seconds_total{mode="idle"} 的 5 分钟变化率 < 0.1（CPU 空闲率低于 10%，持续 15 分钟）；2. 磁盘空间——node_filesystem_avail_bytes / node_filesystem_size_bytes < 0.1（磁盘可用空间低于 10%）；3. 证书过期——probe_ssl_earliest_cert_expiry - time() < 86400 * 7（证书将在 7 天内过期）。低优先级告警（Info——仅记录）：1. 部署事件——kube_deployment_status_observed_generation != kube_deployment_metadata_generation（Deployment 变更后未就绪）；2. HPA 达到上限——kube_hpa_status_current_replicas == kube_hpa_spec_max_replicas。所有告警规则附带 runbook_url 标签指向对应的应急操作手册。',
        stage: 5,
        sourceRefs: [{ layer: 'L1', sourceId: 'prometheus-docs', section: 'alerting-rules' }],
        provenance: 'official',
      },
      {
        id: 'do-ex-005',
        title: '灰度发布流程',
        content:
          '使用 Argo Rollouts 和 Istio 实现自动化的金丝雀发布流程完整示例。步骤 1——开发完成并通过 CI 流水线后，构建新版本 Docker 镜像（tag: v1.2.3）推送到容器镜像仓库。步骤 2——更新 Argo Rollout 资源的镜像版本，Rollout Controller 自动创建新版本 ReplicaSet（1 个 Pod，占总数 10%）。步骤 3——Istio VirtualService 根据 weight 将 10% 流量路由到新版本 Pod（canary），90% 流量保持在旧版本 Pod（stable）。步骤 4——Argo Rollouts 自动执行分析——Prometheus AnalysisTemplate 监控金丝雀 Pod 的错误率和延迟指标，与稳定版本对比（如 canary 错误率 > stable 错误率 * 2 则判定失败）；分析持续 10 分钟（metrics 每 30 秒采集一次，需要至少 6 个数据点）。步骤 5——分析通过后，Argo Rollouts 自动推进到 25% → 50% → 100%，每一步之间有 5 分钟的分析窗口。步骤 6——100% 流量切换完成后，旧 ReplicaSet 保留 10 分钟（scaleDownDelaySeconds）后缩容到 0。步骤 7——如果任何步骤的分析失败（错误率或延迟显著劣化），Argo Rollouts 自动回滚——立即将流量权重切回 100% stable。整个过程无需人工介入（除初始部署触发），Prometheus 指标驱动的自动化渐进发布。',
        stage: 5,
        sourceRefs: [{ layer: 'L1', sourceId: 'argo-rollouts', section: 'canary-deployment' }],
        provenance: 'official',
      },
      {
        id: 'do-ex-006',
        title: '灾备与恢复 Runbook',
        content:
          '生产环境数据库（RDS PostgreSQL）主实例故障的应急恢复 Runbook 示例。触发条件——RDS 监控告警：Database Connections 降为 0、Replication Lag > 300 秒且持续 5 分钟、或 AWS Health Dashboard 报告 RDS 实例故障。步骤 1（0-2 分钟）——Incident Commander 在 Slack #incidents 频道宣布 SEV-1 事故，启动 War Room（Zoom/Meet 紧急会议室）。步骤 2（2-5 分钟）——检查 RDS 控制台确认故障状态：是单 AZ 故障还是整个区域故障？只读副本是否可用？最新可恢复时间点（Latest Restorable Time）是否在 RPO（5 分钟）以内？步骤 3（5-10 分钟）——决策分支：如果只读副本可用且复制延迟 < 5 分钟 → 提升只读副本为新的主实例（aws rds promote-read-replica），更新应用数据库连接端点（通过 Route 53 CNAME 切换或更新 ConfigMap→重启应用 Pod）；如果无可用只读副本 → 从最新备份执行 Point-in-Time Recovery（PITR）恢复到新 RDS 实例，恢复时长取决于数据量（通常 15-30 分钟）。步骤 4（10-20 分钟）——验证恢复：连接新主实例执行健康检查（SELECT 1）、检查数据完整性（对比关键表的记录数）、检查应用日志确认数据库连接恢复正常、检查业务指标（API 错误率、用户登录成功率）。步骤 5（20-30 分钟）——事后操作：重建只读副本（从新主实例创建）、更新数据库连接配置（应用指向新主实例端点）、更新 Terraform state（导入新 RDS 实例资源）。步骤 6——事故恢复后，召开无指责复盘会议，更新 Runbook（修正恢复时间预期、新增检查项）。',
        stage: 5,
        sourceRefs: [{ layer: 'L1', sourceId: 'aws-rds-docs', section: 'disaster-recovery' }],
        provenance: 'official',
      },
      {
        id: 'do-ex-007',
        title: '安全扫描 Pipeline',
        content:
          '集成多层安全扫描的 DevSecOps CI/CD Pipeline 示例，在代码推送→生产部署的全链路嵌入安全检查点。阶段 1（Pre-commit）——本地开发环境集成 pre-commit hooks：git-secrets 扫描阻止凭据提交、ESLint security plugin 检查常见安全漏洞模式（eval、innerHTML、dangerouslySetInnerHTML）。阶段 2（PR 提交后）——CI 自动触发：CodeQL 静态分析扫描代码中的安全漏洞（SQL 注入、XSS、路径遍历、硬编码密钥），高危漏洞标记为 PR 必须修复（block merge）；依赖项安全扫描——OSV-Scanner / Snyk / Dependabot 检查 package.json / go.mod / requirements.txt 中的第三方依赖，发现 CVE Critical/High 漏洞时 PR 被阻断；IaC 安全扫描——Checkov / tfsec 扫描 Terraform 代码中的安全配置错误（S3 Bucket 公开访问、Security Group 0.0.0.0/0、RDS 未加密）。阶段 3（镜像构建后）——容器镜像安全扫描：Trivy / Grype 扫描 Docker 镜像中的操作系统包和应用依赖漏洞，Critical 漏洞阻断部署；Dockerfile 检查——Hadolint 检查 Dockerfile 最佳实践（非 root 用户、最小基础镜像、HEALTHCHECK 指令）。阶段 4（部署 Staging 后）——DAST 动态扫描：OWASP ZAP / Burp Suite 对 Staging 环境执行自动化安全扫描（爬虫 + 主动扫描），发现 High 漏洞阻断 Production 部署。阶段 5（部署 Production 后）——合规检查：CIS Kubernetes Benchmark（kube-bench）、CIS Docker Benchmark、Pod Security Standards（restricted 模式）。',
        stage: 4,
        sourceRefs: [{ layer: 'L1', sourceId: 'owasp-devsecops', section: 'pipeline-integration' }],
        provenance: 'official',
      },
      {
        id: 'do-ex-008',
        title: 'SLO-SLI 仪表板',
        content:
          '使用 Grafana 构建基于 Google SRE 方法论的 SLO/SLI 实时监控仪表板示例。仪表板布局分为四个区域。区域一（顶部横幅）——服务整体状态：SLO 合规状态（绿色-达标、黄色-预算消耗 > 50%、红色-预算耗尽）、本月错误预算剩余（如"43 分钟中的 38 分钟剩余"）、预算消耗速率（预计多少天后耗尽）。区域二（SLI 趋势图）——四大黄金信号的时间序列面板：可用性 SLI——(200+301 响应数 / 总请求数) * 100%，以 30 天滚动窗口计算；延迟 SLI——P50/P90/P99 延迟趋势图，P99 < 500ms 达标线标注；错误率 SLI——5xx 错误占总请求的百分比，SLO 阈值线（0.1%）清晰标注；吞吐量 SLI——RPS 趋势图，标注容量规划上限。区域三（错误预算燃尽图）——横轴为月度时间、纵轴为剩余错误预算（分钟），一条理想消耗线（匀速消耗）、一条实际消耗线——实际线在理想线下方表示预算消耗过快。区域四（SLO 详细表）——按服务/端点粒度的 SLO 明细表：服务名、SLI 类型（可用性/延迟）、SLO 目标（99.9%/P99<500ms）、当前 SLI 实际值、错误预算剩余、合规状态图标。仪表板顶部配置时间范围选择器和自动刷新（30 秒），关键面板配置 Alert 链接——点击直达对应告警规则。',
        stage: 6,
        sourceRefs: [{ layer: 'L1', sourceId: 'grafana-docs', section: 'slo-dashboard' }],
        provenance: 'official',
      },
    ],

    // ── checklists（检查清单）8 条 ──
    checklists: [
      {
        id: 'do-cl-001',
        title: 'CI/CD 流水线就绪检查清单',
        content:
          'CI/CD 流水线投产前的就绪度检查（12项——全部满足方可称为"流水线就绪"）。1. 代码仓库已配置 Webhook——Push 事件和 Pull Request 事件自动触发流水线。2. Lint/格式检查阶段已配置——ESLint、Prettier、Markdown Lint 等检查在 PR 阶段自动执行。3. 单元测试阶段已配置——所有测试套件在流水线中运行，覆盖率报告自动生成且低于阈值（如 80%）时流水线失败。4. SAST 安全扫描已集成——CodeQL / SonarQube 在每次 PR 时自动运行。5. 依赖项扫描已集成——OSV-Scanner / Snyk 检查第三方依赖漏洞。6. 构建阶段已配置——Docker 镜像构建成功且推送到容器镜像仓库，镜像标签策略清晰（git SHA + 环境标签）。7. 制品只构建一次——同一镜像 tag 从 Dev 环境晋级到 Staging 再到 Production，不在每个环境重新构建。8. 非生产环境自动部署——合并到主分支后自动部署到 Staging，冒烟测试自动执行。9. 生产环境部署有人工审批门——需要指定人员 approval 后才触发生产部署。10. 回滚能力已验证——一键回滚到上一个版本的操作已测试且确认可用。11. 流水线定义文件（.github/workflows / Jenkinsfile / .gitlab-ci.yml）在代码仓库中版本管理。12. 流水线通知已配置——成功/失败状态通知到 Slack/Teams/企业微信。',
        stage: 4,
        sourceRefs: [{ layer: 'L1', sourceId: 'dora-accelerate', section: 'ci-cd-capabilities' }],
        provenance: 'official',
      },
      {
        id: 'do-cl-002',
        title: '基础设施部署就绪检查清单',
        content:
          '通过 IaC 工具部署生产环境基础设施前的就绪度检查（10项）。1. Terraform/Pulumi 代码已通过 terraform validate / pulumi preview 语法校验。2. terraform plan 输出已人工审查——确认所有变更（新增/修改/删除资源）符合预期，无意外资源删除（特别是 state 中存在但代码中已移除的资源——可能被 destroy）。3. 敏感变量已通过 Secrets Manager 注入——无明文密码/Token/Access Key 在代码或 plan 输出中。4. Remote State 已配置且可访问——Terraform Backend（S3 + DynamoDB / Terraform Cloud）已初始化，State Lock 机制已验证（多人同时 apply 不会冲突）。5. 模块版本已固定——terraform { source = "..." version = "x.y.z" } 未使用 floating version。6. Provider 版本已固定——required_providers 中指定了版本约束（如 aws = "~> 5.0"）。7. 资源命名规范一致——遵循团队约定的命名模式（环境-服务-资源类型，如 prod-web-alb）。8. Tag 策略已应用——所有资源打上必要的标签（Environment、Service、ManagedBy、CostCenter）。9. 安全组/防火墙规则已审查——无 0.0.0.0/0 入站规则（除 ALB/CloudFront 的 80/443），数据库端口不对公网开放。10. 加密已配置——RDS/EBS/S3 静态数据加密（KMS）、ELB HTTPS Listener（TLS 1.2+）、RDS 强制 SSL 连接。',
        stage: 4,
        sourceRefs: [
          { layer: 'L1', sourceId: 'terraform-best-practices', section: 'deployment-checklist' },
        ],
        provenance: 'official',
      },
      {
        id: 'do-cl-003',
        title: '安全合规扫描就绪检查清单',
        content:
          "应用和基础设施上线前的安全合规就绪度检查（11项——任何一项不满足不得上线）。1. SAST 扫描已完成——代码静态分析无 Critical/High 漏洞未关闭。2. 依赖项漏洞扫描已完成——所有第三方依赖无已知 Critical CVE（或已有临时缓解措施且经安全团队审批）。3. 容器镜像漏洞扫描已完成——基础镜像和最终镜像无 Critical 漏洞。4. 密钥扫描已完成——代码仓库和配置文件中无硬编码凭据（git-secrets / truffleHog 通过）。5. Dockerfile 安全检查已通过——非 root 用户运行、最小基础镜像、HEALTHCHECK 已定义。6. IaC 安全扫描已通过——Checkov / tfsec 无 High 风险配置（公开 S3 Bucket、0.0.0.0/0 SG、未加密 RDS）。7. Kubernetes 安全策略已应用——Pod Security Standards（restricted 模式）、NetworkPolicy 默认拒绝入站、RBAC 最小权限。8. TLS 证书已配置——Ingress TLS（Let's Encrypt 自动管理）、服务间 mTLS（Istio/Consul Connect）、数据库强制 SSL。9. Secrets 管理已就绪——所有敏感配置通过 External Secrets Operator / Vault Sidecar Injector 注入，Pod 环境变量中无明文密码。10. 审计日志已开启——Kubernetes API Server Audit Log、云平台 CloudTrail、应用审计日志均已启用。11. 合规框架对照已完成——CIS Benchmark（Kubernetes/Docker/云平台）、SOC 2 / ISO 27001 相关控制项已检查。",
        stage: 5,
        sourceRefs: [{ layer: 'L1', sourceId: 'cis-benchmarks', section: 'kubernetes' }],
        provenance: 'official',
      },
      {
        id: 'do-cl-004',
        title: '监控与告警就绪检查清单',
        content:
          '生产环境上线前监控和告警体系的就绪度检查（10项）。1. 基础设施监控已配置——Node Exporter / cAdvisor 收集节点和容器指标，Kube-State-Metrics 收集 Kubernetes 对象状态。2. 应用监控已配置——RED 指标（Rate/Errors/Duration）通过 Prometheus Instrumentation 或 OpenTelemetry SDK 暴露。3. 日志聚合已配置——Loki / Elasticsearch / CloudWatch Logs 接收结构化日志，日志保留期满足合规要求（至少 30 天）。4. 分布式追踪已配置——OpenTelemetry Collector / Jaeger / Tempo 接收 trace，采样率配置合理（生产环境 1-10% 采样，错误 100% 采样）。5. SLO 已定义——每个关键用户旅程（User Journey）的 SLI 和 SLO 已与业务方确认并记录。6. 告警规则已配置——基于 SLO 的告警（错误预算消耗速率），而非固定阈值（CPU > 80%）。7. 告警通知渠道已配置——PagerDuty / Opsgenie / 企业微信 / Slack #alerts 频道。8. On-Call 轮值表已建立——至少 2 人参与轮值（避免单点故障），升级策略已定义（5 分钟未 Ack 升级到二级联系人）。9. 告警 Runbook 已编写——每个 Critical 告警有对应的应急操作手册（Playbook），包含诊断步骤、缓解措施、升级路径。10. 仪表板已创建——服务总览仪表板（四大黄金信号）、SLO 燃尽图、基础设施资源仪表板、业务指标仪表板。',
        stage: 5,
        sourceRefs: [{ layer: 'L1', sourceId: 'google-sre-book', section: 'monitoring' }],
        provenance: 'official',
      },
      {
        id: 'do-cl-005',
        title: '灾备与恢复就绪检查清单',
        content:
          '灾难恢复计划的就绪度验证检查（10项——每项必须通过实际演练验证而非文档审查）。1. 备份策略已定义并验证——RPO（恢复点目标）和 RTO（恢复时间目标）已与业务方确认，备份调度已配置且最近一次备份成功。2. 备份恢复演练已执行——最近 30 天内从备份完整恢复到隔离环境，数据完整性验证通过（关键表行数、校验和对比）。3. 数据库高可用已配置——主从复制（流复制 / Group Replication）已启用，自动故障转移已测试（手动停止主实例验证从库提升）。4. 跨区域/AZ 容灾已配置——关键服务跨至少 2 个 AZ 部署，无状态服务跨 AZ 负载均衡，有状态服务（数据库）跨 AZ 主从或多主。5. 基础设施代码可重建——Terraform 代码可从零重建完整环境（在隔离账户/区域执行 terraform apply 验证）。6. DNS 故障转移已配置——Route 53 / Cloudflare Failover 策略，健康检查已配置，TTL 合理（60-120 秒，平衡切换速度与 DNS 查询负载）。7. 事故响应流程已文档化——Incident Commander 角色、升级路径、War Room 流程、沟通模板（用户通知/内部通知/事后报告）。8. 关键依赖的外部服务降级方案已定义——第三方 API（支付/短信/邮件）不可用时的降级策略（队列缓冲/优雅降级/手动补偿）。9. 灾备文档已维护——DR Runbook 保持更新，包含最新的系统架构图、依赖关系、恢复步骤。10. 定期灾备演练已排期——每季度至少一次完整灾备切换演练（从备份恢复→验证→流量切换→回切），演练结果和行动项跟踪至关闭。',
        stage: 6,
        sourceRefs: [{ layer: 'L1', sourceId: 'aws-disaster-recovery', section: 'dr-planning' }],
        provenance: 'official',
      },
      {
        id: 'do-cl-006',
        title: '发布上线就绪检查清单',
        content:
          '生产环境发布上线的 Go/No-Go 决策检查清单（12项——任何一项不满足不得上线）。1. 所有测试已完成并通过——单元测试、集成测试、E2E 测试、性能测试（如有要求）。2. 代码评审已完成——所有 PR 已通过至少一位 Reviewer 的审批。3. 安全扫描已通过——SAST/DAST/依赖项/镜像漏洞扫描无 Critical/High 未关闭项。4. 变更的架构评审已完成（如果变更涉及架构变更）。5. 数据库迁移已审查——DDL 脚本已在生产数据量级的环境中测试，回滚脚本已验证。6. 部署计划已编写——发布步骤、预计时间、回滚方案已明确。7. 监控仪表板已确认——新增/修改的指标和告警已就绪。8. 发布窗口已确认——发布时间在业务低峰期、相关团队已通知（客服/运维/业务方）、On-Call 人员已确认在岗。9. 制品已就绪——Docker 镜像已构建并通过 Staging 环境验证（同一镜像 tag）。10. 配置变更已就绪——ConfigMap/Secrets/环境变量变更已在 Staging 验证，生产环境配置值已确认（端点/密钥/证书）。11. 用户通知已准备——Release Notes / Changelog 已编写，已知问题和限制已文档化。12. 回滚方案已演练——回滚到上一个版本的操作已测试并确认可用，回滚耗时在可接受范围内。',
        stage: 6,
        sourceRefs: [{ layer: 'L1', sourceId: 'devops-handbook', section: 'release-readiness' }],
        provenance: 'official',
      },
      {
        id: 'do-cl-007',
        title: '性能测试就绪检查清单',
        content:
          '系统在生产环境上线前或重大变更前的性能测试就绪度检查（9项）。1. 性能测试目标已定义——基于业务指标推导的目标 QPS（如"支持 1000 并发用户，P99 延迟 < 500ms"）。2. 性能测试环境已搭建——与生产环境配置一致（实例规格/数据库容量/网络拓扑），测试数据量接近生产（或等比例缩小）。3. 负载测试工具已配置——k6 / Locust / JMeter 脚本已编写，模拟真实用户行为（登录→浏览→搜索→下单，带 Think Time）。4. 监控仪表板已配置——测试期间实时监控系统指标（CPU/内存/数据库连接/应用 RPS/延迟/错误率）和业务指标。5. 基线性能已建立——当前版本的性能基线数据（RPS/延迟分布/资源利用率），用于对比新版本。6. 压力测试——逐步增加负载直到系统瓶颈出现（延迟急剧上升/错误率飙升），记录系统极限容量。7. 浸泡测试——在 70-80% 极限容量下持续运行 4-24 小时，检查内存泄漏、连接泄漏、日志膨胀、GC 暂停等长期稳定性问题。8. 峰值测试——模拟流量突发（秒级 RPS 从 100 跳到 1000），验证自动伸缩响应速度（HPA 扩容延迟）和系统在突发负载下的表现。9. 性能测试报告已编写——包含测试方法/测试结果/瓶颈分析/优化建议/容量规划建议，与基线对比。',
        stage: 6,
        sourceRefs: [{ layer: 'L1', sourceId: 'k6-docs', section: 'test-types' }],
        provenance: 'official',
      },
      {
        id: 'do-cl-008',
        title: '运维交接就绪检查清单',
        content:
          '新服务或重大版本从开发团队移交给运维/SRE 团队的交接就绪度检查（10项——全部满足方可完成交接）。1. 系统架构文档已编写——架构图（C4 Model）、服务依赖关系、数据流图已更新。2. 运维手册（Runbook）已编写——常见故障的诊断和恢复步骤（Top 5 故障场景）、启停流程、备份恢复流程。3. 监控仪表板已创建并验证——服务总览仪表板、SLO 仪表板、资源仪表板，告警已配置并测试。4. On-Call 培训已完成——On-Call 人员已接受系统培训（架构/故障诊断/恢复操作），至少完成一次模拟故障演练。5. 部署文档已编写——部署架构（环境/实例/网络拓扑）、部署步骤、回滚步骤、配置管理说明。6. 依赖项清单已整理——外部服务（第三方 API/云服务）、内部服务依赖、数据库/缓存/消息队列依赖——含版本和 SLA。7. 容量规划数据已提供——当前资源使用基线（CPU/内存/存储/网络）、预期增长趋势、扩容方案。8. 安全与合规文档已移交——安全架构（网络隔离/加密/认证授权）、合规检查清单、渗透测试报告（如有）。9. 已知问题清单已整理——已知 Bug/限制/技术债务，含影响范围、优先级和计划修复时间。10. 交接签署已完成——开发团队和运维/SRE 团队双方确认交接清单所有项已完成，运维/SRE 团队正式承担 On-Call 责任。',
        stage: 6,
        sourceRefs: [{ layer: 'L1', sourceId: 'sre-workbook', section: 'operational-handoff' }],
        provenance: 'official',
      },
    ],

    // ── rubric（评分标准）8 条 ──
    rubric: [
      {
        id: 'do-rub-001',
        title: '部署频率评分标准',
        content:
          '评估团队的软件交付吞吐量——从代码提交到生产环境部署的频率。1 分——按需部署，频率低于每月一次：发布是"大事件"——需要数周准备、全团队加班、管理层审批，每次发布伴随高压力和风险。3 分——每周部署：有基本的 CI/CD 流水线但仍有手动步骤（如生产部署需要人工触发），部署过程需要数小时且偶有失败。5 分——每天多次部署：代码合并后自动通过流水线部署到生产，从提交到上线 < 1 小时；部署是小而频繁的例行操作，团队对部署无恐惧感；通过功能标志实现部署与发布解耦——代码随时部署，功能按需发布。DORA 研究显示，精英绩效团队每天多次部署，变更失败率仅为 0-15%；低绩效团队每月到每半年部署一次，变更失败率高达 46-60%。部署频率是 DevOps 成熟度的首要指标——高频部署意味着高度的自动化、充分的测试信心和健康的工程文化。',
        stage: 6,
        sourceRefs: [{ layer: 'L1', sourceId: 'dora-accelerate', section: 'deployment-frequency' }],
        provenance: 'official',
      },
      {
        id: 'do-rub-002',
        title: '变更前置时间评分标准',
        content:
          '评估从代码提交到成功运行在生产环境的时间——度量交付效率的核心指标。1 分——前置时间超过一个月：代码提交后等待漫长的评审、测试、集成、审批流程，发布是"火车发车"模式（固定日期批量发布）。3 分——前置时间一周到一天之间：CI 自动运行测试和构建，但仍有手动测试阶段或人工审批延迟，代码提交到部署需要跨 Sprint 等待。5 分——前置时间小于 1 小时：代码提交后自动化流水线完成测试、构建、安全扫描和部署，全程无需人工干预；小批量频繁提交（每天多次）而非大批量每周一次；主干开发（Trunk-Based Development）——开发者直接提交到主分支或短生命周期的功能分支（< 1 天）。DORA 研究显示，精英绩效团队的变更前置时间 < 1 小时，低绩效团队 > 6 个月。缩短前置时间的关键实践：小批量工作、自动化测试覆盖、特性标志解耦部署与发布、消除人工审批瓶颈。',
        stage: 6,
        sourceRefs: [
          { layer: 'L1', sourceId: 'dora-accelerate', section: 'lead-time-for-changes' },
        ],
        provenance: 'official',
      },
      {
        id: 'do-rub-003',
        title: '变更失败率评分标准',
        content:
          '评估部署导致生产环境服务降级（如服务中断、严重功能缺陷、需要紧急修复或回滚）的比例——度量交付质量的核心指标。1 分——变更失败率 > 45%：几乎每两次部署就有一次出问题，部署伴随着高恐惧（"千万别在周五部署"），回滚是常态而非例外。3 分——变更失败率 16-30%：偶有部署故障但通过快速回滚控制影响范围，部署仍有压力但团队有信心在数小时内恢复。5 分——变更失败率 0-15%：绝大多数部署按预期运行，部署是低风险例行操作；故障发生时能快速检测和恢复（MTTR < 1 小时）；通过金丝雀发布、功能标志、自动化测试和充分的生产前验证实现高成功率。DORA 研究显示，精英绩效团队变更失败率 0-15% 且恢复时间 < 1 小时。降低变更失败率的关键实践：全面的自动化测试、渐进交付策略、充分的预生产环境验证、代码评审文化。',
        stage: 6,
        sourceRefs: [{ layer: 'L1', sourceId: 'dora-accelerate', section: 'change-failure-rate' }],
        provenance: 'official',
      },
      {
        id: 'do-rub-004',
        title: '故障恢复时间评分标准',
        content:
          '评估从生产故障发生到服务完全恢复的平均时间（MTTR——Mean Time to Recovery）——度量运维响应能力和系统韧性。1 分——MTTR > 1 周：故障定位依赖人工排查，恢复操作是手动的且容易出错（"试试重启"），缺少有效的监控和告警导致故障发现延迟数小时，事故响应流程混乱——无 Incident Commander、沟通不畅、缺乏预定义 Runbook。3 分——MTTR 在 1 小时到 1 天之间：有基本的监控和告警但覆盖不全（某些故障场景未被监控），有 On-Call 轮值但响应速度不稳定（取决于谁值班），有 Runbook 但可能过时或不完整。5 分——MTTR < 1 小时：完善的监控和告警体系——故障发生 1 分钟内检测到并通知 On-Call，有清晰的 Runbook 和自动化恢复工具（一键回滚/自动故障转移），定期演练事故响应流程，团队对故障响应有信心（"出问题不可怕，我们知道怎么快速恢复"）。DORA 研究显示，精英绩效团队 MTTR < 1 小时，低绩效团队需要 1 周到 1 个月。',
        stage: 6,
        sourceRefs: [{ layer: 'L1', sourceId: 'dora-accelerate', section: 'time-to-restore' }],
        provenance: 'official',
      },
      {
        id: 'do-rub-005',
        title: '基础设施代码覆盖率评分标准',
        content:
          '评估通过 IaC 工具声明式管理的基础设施资源占全部基础设施资源的比例——度量基础设施自动化成熟度。1 分——IaC 覆盖率 < 20%：大部分基础设施通过云平台 Console 手动创建（ClickOps），配置信息存在于某人脑中或截图文档中，重建环境需要数天甚至数周（如果可能的话），"关键服务器碰不得"——无人敢修改怕出问题。3 分——IaC 覆盖率 50-80%：核心基础设施（VPC/计算/数据库）已代码化，但仍有部分资源（DNS 记录/CDN 配置/第三方 SaaS 集成）手动管理，基础设施代码的模块化和复用性有限（多环境间有代码重复）。5 分——IaC 覆盖率 > 95%：几乎所有基础设施资源通过 IaC 代码定义和版本管理，环境可从零重建（terraform apply 即可重建完整环境），所有变更通过 Git PR→Plan→Apply 流程，无手动 ClickOps 操作（紧急情况除外且事后补代码）。高 IaC 覆盖率是基础设施敏捷性的基础——环境创建从数天缩短到数分钟，配置漂移被消除，灾难恢复能力显著增强。',
        stage: 6,
        sourceRefs: [
          { layer: 'L1', sourceId: 'hashicorp-state-of-cloud', section: 'iac-maturity' },
        ],
        provenance: 'official',
      },
      {
        id: 'do-rub-006',
        title: '安全合规评分标准',
        content:
          '评估 DevOps 实践链中安全与合规的集成成熟度——安全是否内建于流程而非事后检查。1 分——安全是"上线前的最后一关"：安全团队在开发完成后才介入，发现问题时返工成本高（"已经开发了 3 个月，这个安全漏洞能接受风险吗？"），凭据管理混乱（密码在代码和配置文件间复制粘贴），无自动化安全扫描——依赖人工渗透测试和安全审计（每年 1-2 次）。3 分——安全左移到开发阶段：SAST 和依赖项扫描集成到 CI 流水线中，Secrets Manager 管理敏感凭据但未强制所有团队使用，容器镜像在构建时扫描但 Critical 漏洞不阻断部署（人工审批例外）。5 分——安全完全内建于 DevOps 全流程（DevSecOps）：Pre-commit→CI→镜像构建→部署→生产运行的全链路安全自动化扫描，安全门禁与功能门禁同等对待——安全漏洞阻断部署；凭据管理完全自动化（Secrets Manager + 自动轮换 + 动态凭据）；合规检查自动化（CIS Benchmark 定期扫描 + 自动修复）；安全事件响应流程成熟——发现漏洞到修复部署的时间以小时计。',
        stage: 6,
        sourceRefs: [{ layer: 'L1', sourceId: 'owasp-samm', section: 'maturity-model' }],
        provenance: 'official',
      },
      {
        id: 'do-rub-007',
        title: '可观测性成熟度评分标准',
        content:
          '评估团队对系统内部状态的观测和理解能力——从"用户投诉才知道出问题"到"主动发现和预防"。1 分——被动监控：仅有基础资源监控（CPU/内存/磁盘），无应用级指标，日志是非结构化的自由文本且分散在各服务器本地文件，没有分布式追踪——跨服务问题定位依赖开发者脑内推理，故障发现依赖用户投诉（"网站打不开了？"）。3 分——主动监控：结构化日志集中收集和检索，RED 指标已标准化（所有服务暴露 Rate/Errors/Duration），基础分布式追踪但采样率低或无尾采样（高流量时丢失关键 Trace），有 SLO 定义但告警仍以固定阈值为主（CPU > 80%）。5 分——可观测性驱动开发：可观测性是系统的一等公民——所有新服务默认集成 OpenTelemetry 自动插桩，SLO 是告警的唯一依据（"消耗错误预算"而非"指标超过固定阈值"），日志/指标/追踪完全关联（Exemplar——指标中的高延迟/高错误示例直接链接到对应 Trace），团队在开发阶段使用可观测性数据做性能优化和容量规划决策，故障平均检测时间（MTTD）< 1 分钟。',
        stage: 6,
        sourceRefs: [{ layer: 'L1', sourceId: 'opentelemetry', section: 'observability-maturity' }],
        provenance: 'official',
      },
      {
        id: 'do-rub-008',
        title: '自动化率评分标准',
        content:
          '评估运维操作的自动化程度——从全手动操作到全自动自愈的成熟度演进。1 分——全手动：所有运维操作（部署/扩容/故障恢复/配置变更/证书更新）都是人工执行，通过 ticket 驱动（"帮我重启一下 X 服务"、"帮我加一台 Y 服务器"），运维团队大部分时间在做重复性手动操作（Toil），自动化仅限于几个简单的 cron 脚本（如每天凌晨清理日志）。3 分——半自动化：核心流程已自动化（CI/CD 流水线自动部署、HPA 自动扩容、Prometheus Alertmanager 自动告警），但仍有相当比例的手动操作（数据库迁移需人工审批执行、证书更新手动续期、容量规划手动计算），On-Call 工程师仍需执行手动诊断和恢复步骤。5 分——高度自动化：基础设施创建/销毁全自动（Terraform CI/CD）、应用部署全自动（GitOps 持续同步）、扩缩容全自动（HPA + Cluster Autoscaler + 预测性扩容）、故障恢复全自动（自愈——Pod 重启/节点替换/多 AZ 故障转移）、安全修补全自动（自动滚动更新镜像）、SRE 团队 50% 以上时间投入工程工作（构建自动化而非执行操作）。自动化率的提升将运维从成本中心转变为效能倍增器。',
        stage: 6,
        sourceRefs: [{ layer: 'L1', sourceId: 'google-sre-book', section: 'eliminating-toil' }],
        provenance: 'official',
      },
    ],
  },
}

// ── 「数据项目」Skill 完整内容定义 ────────────────────────────────────

const DATA_PROJECT_SEED: BuiltinSkillSeed = {
  skillKey: 'skill-data-project',
  name: '数据项目',
  version: '1.0.0',
  description:
    '覆盖数据工程与 AI 项目全生命周期的领域知识包：从业务问题定义、数据可用性评估、数据架构设计、管道开发、模型训练实验到上线监控与模型退役。适用于数据工程、数据科学、机器学习与 AI 项目，提供规则、模式、反模式、示例、检查清单与评分标准。',
  category: {
    primary: 'domain',
    secondary: 'data_engineering',
  },
  tags: [
    '数据工程',
    '数据科学',
    '机器学习',
    'AI',
    'MLOps',
    'ETL',
    '数据仓库',
    '数据湖',
    '数据治理',
    '数据质量',
    'CRISP-DM',
    '特征工程',
  ],
  dependencies: [],
  activation: {
    projectTypes: [
      '数据项目',
      '数据工程',
      '数据开发',
      '数据分析',
      '数据科学',
      'AI项目',
      '人工智能',
      '机器学习',
      '数据',
      'Data',
      'Data Science',
      'Data Engineering',
    ],
    domains: ['data_engineering', 'data_science', 'machine_learning', 'ai', 'analytics', 'data'],
    priority: 80,
  },
  basePriority: 80,
  knowledge: {
    // ── rules（规则）8 条 ──
    rules: [
      {
        id: 'dp-rule-001',
        title: '数据质量门禁与校验',
        content:
          '数据进入管道的每一步都必须经过质量校验门禁。定义明确的数据质量规则（完整性——非空字段占比、唯一性——主键不重复、一致性——跨源字段值一致、准确性——值在合理范围内、及时性——数据延迟 SLA），每条管道作业执行前自动运行这些规则，不通过的记录写入死信队列或隔离表并触发告警。数据质量是管道的第一公民——"脏数据入，脏决策出"（Garbage In, Garbage Out）是数据项目失败的根因。校验规则与业务含义解耦——规则引擎应独立于管道代码，支持规则的增删改而不需修改作业逻辑。推荐 dbt tests、Great Expectations 或 AWS Deequ 作为数据质量校验框架，质量报告自动纳入数据目录供下游消费方查阅。生产环境的数据质量门禁必须与 CI/CD 集成，数据质量校验不通过则阻断部署。',
        stage: 4,
        provenance: 'official',
      },
      {
        id: 'dp-rule-002',
        title: '数据血缘可追溯',
        content:
          '从原始数据源到最终报表或模型训练集的每条数据都必须可追溯其完整血缘链路——包括源表、中间转换、连接、聚合、过滤的每一步。血缘追踪不只是"这条数据从哪来"，还包括"如何被变换"——每次转换的操作类型（SQL/Spark/Python）、执行时间戳、处理的数据量。血缘信息必须存储为结构化元数据（表级血缘 + 列级血缘），支持"向前追溯"（从源到目标——这个报表字段来自哪些原始字段？）和"向后追溯"（从目标到源——修改这个源字段会影响哪些下游？）。数据血缘是数据治理的根基——合规审计要求证明报告数据的来源、影响分析评估上游变更风险、数据发现帮助团队找到可信数据源。推荐使用 OpenLineage、Marquez 或 DataHub 作为血缘追踪基础设施，自动从管道作业中提取血缘而非依赖人工文档。',
        stage: 3,
        provenance: 'official',
      },
      {
        id: 'dp-rule-003',
        title: '模型版本与实验可复现',
        content:
          '每次模型训练实验必须可完整复现——包括代码版本（git commit hash）、训练数据版本（数据集切分的哈希指纹）、超参数配置、随机种子、依赖环境（Python 包版本/Docker 镜像 ID）、评估结果。实验记录必须在实验跟踪系统中自动捕获（不依赖人工"记得记录下来"），确保任意实验在任意时间都可精确复现。复现性不是"最好有"——可复现是模型可信度的基石。生产模型的部署必须锁定所有依赖版本（requirements.txt + Dockerfile + 模型权重 checksum），确保训练环境和推理环境的一致性。模型版本号必须与训练数据版本、代码版本、超参配置绑定——同一个模型版本号必须指向唯一可复现的训练运行。',
        stage: 5,
        provenance: 'official',
      },
      {
        id: 'dp-rule-004',
        title: '特征存储一致性与单一可信源',
        content:
          '所有用于模型训练和在线推理的特征必须来自统一的特征存储（Feature Store），严禁训练管道和推理管道各自独立计算特征。特征存储提供特征的单一可信源——离线训练和在线服务使用完全相同的特征定义和计算逻辑，消除训练-服务偏差（Training-Serving Skew）。特征必须在特征存储中注册为有类型的实体（特征组、特征视图），每条特征标注数据源、计算逻辑、所有者团队、更新时间、统计信息（分布、缺失率）。特征存储支持时点查询——给定实体 ID 和时间戳返回该时刻的特征值，保证训练集构造和在线推理的时间一致性。特征复用是特征存储的核心价值——新项目优先查询特征目录中已存在的特征，减少重复计算和特征不一致。',
        stage: 4,
        provenance: 'official',
      },
      {
        id: 'dp-rule-005',
        title: '数据隐私与合规脱敏',
        content:
          '任何包含个人身份信息（PII——姓名、身份证号、电话、邮箱、IP 地址、地理位置）或敏感业务数据的字段必须在进入数据管道的第一时间进行脱敏处理——标记化（Tokenization）、掩码（Masking）或匿名化（Anonymization）。脱敏策略必须在管道设计阶段定义——"这个字段包含什么敏感信息？采用什么脱敏方式？谁有权访问脱敏前的原始数据？"——而不是上线后补救。数据访问控制必须遵循最小权限原则——数据工程师默认不应看到生产环境的原始 PII 数据。脱敏后的数据必须不可逆推回原始值——使用加盐哈希或强加密而非简单替换。合规不仅是法律要求（GDPR/个人信息保护法/CCPA），也是用户信任的基石——数据泄露的平均成本远超预防成本。',
        stage: 4,
        provenance: 'official',
      },
      {
        id: 'dp-rule-006',
        title: '训练-验证-测试集严格隔离',
        content:
          '模型评估必须严格使用三数据集划分：训练集（模型参数学习）、验证集（超参调优和模型选择）、测试集（最终性能评估——仅使用一次）。严禁验证集和测试集之间的信息泄露——测试集在整个模型开发周期中只能被"查看"一次，在最终评估报告生成前不得以任何方式影响模型选择或超参决策。时序数据必须按时间切分（而非随机切分）——用过去的数据训练，用未来的数据验证和测试，防止"用未来信息预测过去"的泄露。数据泄露是模型失败的首要原因——模型在离线评估中表现完美，上线后效果大幅下降（因为泄露的特征在生产中不可用）。数据划分策略必须在实验开始前确定并记录，防止事后"调整"划分以美化结果。',
        stage: 5,
        provenance: 'official',
      },
      {
        id: 'dp-rule-007',
        title: '数据契约 Schema 演进治理',
        content:
          '数据管道的上下游之间必须定义显式的数据契约（Data Contract）——声明每个数据集的 Schema（字段名、类型、是否可空、业务含义）、SLA（产出时间、新鲜度、完整度）、所有者团队、变更管理流程。Schema 变更必须走正式的兼容性审查——新增字段为向后兼容变更、删除或重命名字段为不兼容变更（需协调下游消费者）。数据契约存储在契约注册表中（推荐 DataHub 或自定义 YAML/JSON 注册表），与代码仓库同步版本管理。生产数据的 Schema 变更必须在 CI/CD 流水线中自动检测——上游 PR 修改了 Schema？自动触发下游兼容性检查。数据契约是数据工程团队与数据消费团队（分析师、数据科学家、ML 工程师）之间的合同——明确承诺与期望，减少"数据突然变了导致下游全挂"的事故。',
        stage: 4,
        provenance: 'official',
      },
      {
        id: 'dp-rule-008',
        title: '模型监控与漂移检测',
        content:
          '生产环境中的每个模型都必须配备自动化的监控和漂移检测——输入数据漂移（特征分布变化）、输出数据漂移（预测分布变化）、模型性能漂移（准确率/精确率/召回率下降）。监控指标必须设置明确的告警阈值——当漂移程度超过阈值时自动触发告警，通知模型负责人。模型监控不是"上线后就完事"——模型在真实世界中会随时间衰减（数据分布变化、用户行为变化、业务策略调整），没有监控的模型就像没有仪表盘的飞机。漂移检测必须对比基线（训练时的特征和预测分布）与当前生产窗口的分布，使用统计检验（KS 检验/卡方检验/Wasserstein 距离）量化漂移程度。模型性能指标必须与业务指标挂钩——模型的技术指标（AUC/准确率）最终影响的是业务指标（收入/用户留存/效率），业务指标是模型价值的最终裁决。',
        stage: 6,
        provenance: 'official',
      },
    ],

    // ── patterns（模式）8 条 ──
    patterns: [
      {
        id: 'dp-pat-001',
        title: 'CRISP-DM 数据挖掘流程',
        content:
          'CRISP-DM（Cross-Industry Standard Process for Data Mining）是数据挖掘与数据科学项目的事实标准流程框架，六阶段迭代循环：1. 业务理解——定义业务目标、评估现状、将业务问题转化为数据挖掘问题、制定项目计划；2. 数据理解——收集初始数据、描述数据、探索数据、验证数据质量；3. 数据准备——选择数据、清洗数据、构建新特征、整合数据、格式化；4. 建模——选择建模技术、设计测试方案、构建模型、评估模型；5. 评估——评估结果是否达到业务目标、评审流程、决定下一步（部署/迭代/放弃）；6. 部署——规划部署、监控维护、生成最终报告、项目评审。CRISP-DM 的核心理念是迭代而非瀑布——各阶段之间有反馈循环，业务理解的深入可能触发新一轮数据准备和建模。数据科学项目最大的风险不是技术选错，而是解决了错误的问题——CRISP-DM 强制在建模之前反复确认"这个问题值得用数据科学解决吗？"。',
        stage: 1,
        provenance: 'official',
      },
      {
        id: 'dp-pat-002',
        title: 'MLOps 模型生命周期',
        content:
          'MLOps 是 DevOps 方法论在机器学习领域的延伸，覆盖模型从实验到生产的全生命周期管理：1. 数据管理——数据版本控制、数据验证、特征存储；2. 实验跟踪——超参和指标自动记录、实验对比和可视化；3. 模型训练——训练管道编排、分布式训练、资源调度；4. 模型注册——模型版本管理、元数据存储、阶段标记（Staging/Production/Archived）；5. 模型部署——在线推理服务、批量推理、A-B 测试框架；6. 模型监控——数据漂移检测、模型性能监控、告警；7. 模型治理——审计跟踪、合规、访问控制。MLOps 的核心原则：自动化（减少人工步骤）、可复现（每个模型可追溯至完整训练运行）、持续（模型持续训练和部署而非一次性交付）、监控（生产模型必须被持续观察）。ML 系统的技术债务比传统软件更复杂——除了代码债务还有数据债务和模型债务，MLOps 通过工程化实践管理这些独特风险。',
        stage: 3,
        provenance: 'official',
      },
      {
        id: 'dp-pat-003',
        title: 'Lambda 与 Kappa 数据架构',
        content:
          'Lambda 架构通过批处理层和流处理层的组合实现低延迟与高准确性的平衡：批处理层——对主数据集进行定期全量计算，生成准确的批处理视图（如 Hadoop/Spark 批作业每小时或每天运行），特点是数据完整且准确但延迟高；流处理层——实时处理增量数据，提供低延迟的近似结果（如 Kafka Streams/Flink 秒级延迟），用批处理层的结果定期修正流处理层的结果。Lambda 架构解决了"既要实时又要准确"的矛盾——批处理保证最终一致性，流处理提供低延迟。Kappa 架构是 Lambda 的简化版——摒弃独立的批处理层，一切皆为流（Event Sourcing），所有数据以不可变事件日志的形式持久化，批处理只是流处理的回放（从最早 offset 重新消费）。Kappa 的哲学：如果你的流处理系统足够强大且事件日志保留足够长，就不需要独立的批处理层。选择 Lambda 还是 Kappa 取决于场景——如果业务需求同时要求亚秒级延迟和 100% 准确（如金融交易），Lambda 更合适；如果可以接受流处理的近似结果且最终一致性足够（如推荐系统），Kappa 更简单。',
        stage: 3,
        provenance: 'official',
      },
      {
        id: 'dp-pat-004',
        title: 'Kimball 维度建模',
        content:
          'Kimball 维度建模是数据仓库设计的行业标准方法论，核心四步骤：1. 选择业务过程——识别组织需要分析的核心业务流程（销售、库存、物流等），一个业务过程对应一个事实表；2. 声明粒度——定义每个事实表行的原子粒度（"一行代表一次销售交易的单个商品"而非"一行代表一天的总销售"），粒度越细分析灵活性越高；3. 选择维度——确定描述事实的上下文属性（时间、产品、客户、门店等），维度表围绕事实表构建星型模式；4. 确定事实——识别可加性数字度量（销售金额为完全可加——可跨所有维度求和、库存水平为半可加——不可跨时间求和、单价为非可加——任何时候求和都无意义）。维度建模的核心设计原则：以业务用户的理解为中心——表结构应反映业务人员的思考方式（"我们想按产品、时间、地区分析销售"），而非数据源系统的结构。星型模式（一个事实表连接多个维度表）查询性能最优，雪花模式（维度表再规范化）节省存储但增加查询复杂度。',
        stage: 3,
        provenance: 'official',
      },
      {
        id: 'dp-pat-005',
        title: 'Data Vault 建模',
        content:
          'Data Vault 2.0 是面向企业级数据仓库的建模方法论，专为大规模集成和历史追踪而设计，三核心实体：Hub——业务实体的唯一标识（如客户 Hub、产品 Hub），每个 Hub 只存储业务主键、加载时间和数据来源，不存储任何描述性属性；Link——记录实体之间的业务关系（如"客户-购买-产品"），Link 是多对多关系的物理实现，每个关系都带时间戳和来源；Satellite——存储实体的描述性属性和历史变化，按变化频率和来源系统分离（一个 Hub 可以有多个 Satellite——一个存客户基本信息变化慢、一个存客户偏好变化快）。Data Vault 的核心理念：原始数据不可变——所有从源系统加载的数据都以原始形式保留（Raw Vault），不因业务规则变化而需要重新加载历史数据；业务规则在信息交付层（Information Mart）应用而非在数据加载时应用。Data Vault 适合企业级数据仓库的长期演进——源系统变更只需添加新的 Satellite 而不需修改已有结构，历史追踪完整且审计友好。',
        stage: 3,
        provenance: 'official',
      },
      {
        id: 'dp-pat-006',
        title: '批流一体',
        content:
          '批流一体（Streaming-First Architecture）是现代数据平台的核心架构范式——用统一的流处理引擎同时处理实时和批处理数据，消除 Lambda 架构的双系统维护成本。Apache Kafka 作为统一的数据总线——所有数据（实时事件和批处理数据）都以流的形式进入 Kafka，Flink/Spark Structured Streaming 作为统一计算引擎——同一套代码处理实时流和批处理（批处理只是"有界流"）。批流一体的核心优势：一套代码（实时和离线使用同一套处理逻辑——"实时报表"和"每日离线报表"只差窗口大小，不差代码）、一份数据（不再有"实时数仓"和"离线数仓"的数据差异——Kafka 的日志留存策略如保留 30 天让回放成为批处理）、一种运维（只维护一套流处理引擎而非 Lambda 的两套）。批流一体的实践路径：先从批处理迁移到 Lambda（批+流共存），再从 Lambda 演进到批流一体（流处理引擎成熟到能完全替代批处理）。关键前提是流处理引擎的状态后端和 exactly-once 语义足够成熟——Flink 的检查点和 Savepoint 机制让长时间运行的流处理作业具备批处理的可靠性。',
        stage: 4,
        provenance: 'official',
      },
      {
        id: 'dp-pat-007',
        title: '特征存储 Feature Store',
        content:
          '特征存储是 ML 基础设施的核心组件——统一管理特征的定义、计算、存储和服务：1. 特征注册——特征定义的目录（名称、类型、数据源、计算逻辑、所有者、统计信息），新项目从这里发现已有特征；2. 特征计算——定义特征的计算管道（批特征——Spark/SQL 作业、流特征——Flink/Kafka Streams 实时计算），特征存储编排这些计算管道的执行并缓存结果；3. 特征服务——低延迟 API 提供在线推理所需的特征值（<10ms），支持点查（给定 entity_id+feature_name 返回当前值）和批量获取（给定 entity_id 列表返回多个特征值）；4. 特征质量——自动监控特征值的分布、缺失率、新鲜度，检测训练-服务偏差。特征存储解决 ML 系统的三大痛点：训练-服务偏差（离线训练和在线推理使用不同特征）、特征重复计算（多个团队各自计算相同的特征）、特征元数据缺失（不知道某个特征是什么含义、怎么来的）。Feast、Tecton 或自建 Feature Store 都是推荐方案。',
        stage: 4,
        provenance: 'official',
      },
      {
        id: 'dp-pat-008',
        title: '数据网格 Data Mesh',
        content:
          "数据网格是面向大规模组织的数据平台去中心化架构范式，核心理念：数据所有权从中央数据团队转移到产生和使用数据的领域团队。四大原则：1. 领域所有权——每个业务领域拥有并管理自己的数据产品（数据作为产品而非副产品），领域团队负责数据的质量、SLA 和文档；2. 数据作为产品——数据以可发现、可理解、可信任、可互操作、安全的产品形式对外暴露，每个数据产品有明确的 API（如 SQL/Parquet/Avro）、SLA、Schema 和所有者；3. 自服务数据平台——提供统一的基础设施平台让领域团队能自助地构建和运维自己的数据产品（而非所有数据工作都依赖中央数据平台团队）；4. 联邦治理——全局治理标准（数据产品互操作性、访问控制、合规）在联邦层面定义，各领域在执行层面有自治权。数据网格解决中央数据平台的瓶颈问题——数据平台团队成为所有数据需求的阻塞点、数据生产者与消费者脱节、数据仓库成为单体。数据网格不是技术架构——是组织结构变革（Conway's Law：系统设计反映组织沟通结构）。适合有多个独立业务单元、数据规模大到中央团队无法集中管理的大型组织。",
        stage: 3,
        provenance: 'official',
      },
    ],

    // ── antiPatterns（反模式）8 条 ──
    antiPatterns: [
      {
        id: 'dp-ap-001',
        title: '数据沼泽无治理',
        content:
          '数据湖退化为数据沼泽（Data Swamp）是最常见的数据项目失败模式——组织将大量原始数据倾倒进数据湖但没有建立任何治理机制。症状：没有 Schema 管理——所有数据以原始格式（CSV/JSON）存入而没有结构化元数据（不知道每张表有什么字段、什么含义、谁负责）；没有数据目录——找数据靠"问别人"而非系统化搜索（"你知道哪里有用户行为数据吗？"）；没有访问控制——所有人对所有数据有完全访问权限（安全和合规灾难）；没有质量监控——数据是否完整、是否及时、是否准确全凭运气；没有生命周期管理——旧数据永不删除存储成本无限增长。数据沼泽的根因是"先建数据湖再想治理"——组织建了数据湖（S3/ADLS/HDFS）但没有投入在元数据、目录、质量、安全上。逆转数据沼泽的策略：建立数据目录（DataHub/Apache Atlas）、定义数据所有权、实施访问控制、设置数据质量 SLI、建立数据保留策略。记住——数据湖的价值不在存储数据，在于能用数据做决策。',
        stage: 2,
        provenance: 'official',
      },
      {
        id: 'dp-ap-002',
        title: '训练测试数据泄漏',
        content:
          '训练数据与测试数据之间的信息泄露是 ML 项目最隐蔽且代价最高的错误——模型在离线评估中表现完美，上线后效果大幅下降。泄漏的常见形式：时序泄漏——用未来的信息预测过去（如用明天的股价预测今天的股价）；特征泄漏——特征计算使用了本应在预测时不可用的信息（如用"用户是否购买"来计算"用户活跃度"特征）；行级泄漏——训练集和测试集包含同一实体的不同行（随机切分忽略了实体分组）；预处理泄漏——在划分训练/测试集之前做了全局归一化/填充缺失值（用测试集的信息影响了训练数据）。泄漏的后果是模型离线指标虚高，上线后效果远低于预期——因为生产环境中没有这些"泄漏特征"。防止泄漏的最佳实践：严格按时间切分、特征计算逻辑在训练和推理时完全一致、预处理参数（均值/标准差）从训练集计算并应用到测试集（而非全局计算）。',
        stage: 5,
        provenance: 'official',
      },
      {
        id: 'dp-ap-003',
        title: '模型黑盒无监控',
        content:
          '将模型部署到生产环境但没有建立任何监控和告警机制——"模型上线了就完事"是 ML 项目的常见反模式。没有监控的模型就像没有仪表盘的飞机——你完全不知道它在生产中的表现如何。症状：不知道模型的预测分布是否已偏离训练时的分布（数据漂移）；不知道模型的准确率是否在下降（模型衰减）；不知道模型的延迟和吞吐是否满足 SLI（服务等级指标）；不知道模型的预测是否对某些子群体产生了偏见（公平性监控）。模型在真实世界中的衰减是必然的——用户行为变化、业务策略调整、数据分布变化都会导致模型性能随时间下降。没有监控，这些问题会在用户投诉或业务指标显著下降后才被发现。监控的最小集合：输入数据分布漂移检测、模型预测分布漂移检测、模型性能指标（如果 label 可获取）、模型延迟和吞吐、业务影响指标。',
        stage: 6,
        provenance: 'official',
      },
      {
        id: 'dp-ap-004',
        title: '管道单体不可复用',
        content:
          '将整个数据处理逻辑写成一个巨大的单体脚本（一个 SQL 文件几千行 / 一个 Spark 作业做所有事）是数据项目的常见反模式。症状：管道没有模块化——数据提取、清洗、转换、聚合全部在一个作业中；作业失败时需要从头重跑整个管道而非只重跑失败的部分；代码复用靠复制粘贴——"这个清洗逻辑跟另一个管道差不多，复制一份改一改"；测试困难——无法单独测试管道的某个步骤，只能端到端测试整个管道；变更风险高——修改管道中的一个步骤可能影响所有下游，因为边界不清晰。管道模块化的实践：每个管道步骤做一件事（Single Responsibility）、步骤之间通过明确定义的接口（数据契约 Schema）连接、管道编排工具（Airflow/Prefect/Dagster）管理步骤间的依赖和重试、每个步骤可独立测试和部署。模块化的管道更容易维护、测试、复用和扩展——管道的灵活性是数据团队速度的关键。',
        stage: 5,
        provenance: 'official',
      },
      {
        id: 'dp-ap-005',
        title: '特征重复计算不一致',
        content:
          '多个团队独立计算相同的特征但没有统一的特征存储导致特征不一致——训练管道、推理管道、实时管道各自实现了"相同"的特征但有微妙差异。症状：训练时用的特征 A 是"近 30 天用户购买次数"，推理时用的特征 A 是"近 28 天用户购买次数"（因为实现差异）；两个团队各算各的"用户活跃度"特征但定义和口径不同；特征值的统计分布在不同管道中不一致——训练数据中的特征值和推理时传入的特征值有系统性偏差。根因是缺乏特征存储——没有统一的特征定义、计算和服务的平台，每个团队自己实现自己版本的特征。特征不一致导致训练-服务偏差——模型在离线训练时学到的模式与在线推理时看到的模式不同，预测质量下降。解决方案：建立特征存储作为特征的唯一可信源——所有特征在特征存储中定义和注册一次，训练和推理从同一来源获取。',
        stage: 4,
        provenance: 'official',
      },
      {
        id: 'dp-ap-006',
        title: '忽视数据漂移',
        content:
          '生产环境的数据分布随时间变化（数据漂移）但团队没有建立漂移检测机制，导致模型预测质量持续下降而无人知晓。漂移的类型：协变量漂移——输入特征分布变化（如用户年龄分布从以 20-30 为主变为以 30-40 为主）、先验概率漂移——目标变量分布变化（如正样本比例从 5% 变为 15%）、概念漂移——特征与目标的关系变化（如过去"高收入→高消费"现在"高收入→低消费"因为经济环境变化）。数据漂移是必然的——真实世界在变化，模型训练时的数据分布只是某个时间窗口的快照。忽视漂移的后果是模型性能持续衰减，业务指标受影响。漂移检测需要：基准分布（训练数据的特征和预测分布）与当前生产窗口的分布对比，使用统计检验量化漂移程度，设置告警阈值，定期自动运行漂移检测作业。漂移检测不是一次性的——必须在模型上线后持续运行。',
        stage: 6,
        provenance: 'official',
      },
      {
        id: 'dp-ap-007',
        title: '实验无版本不可复现',
        content:
          '数据科学团队做实验但没有系统地记录实验信息，导致好模型找不回来、坏模型不知道为什么坏。症状：最好的模型是用什么数据和超参训的不知道——"我记得好像用了 0.01 的学习率？"、实验代码没有版本控制——"这份代码是实验最终版本还是中间探索？"、训练数据没有版本——"这个模型用了哪个时间范围的数据？"、实验结果散落在个人电脑和聊天记录中。根因是缺乏实验跟踪系统——团队依赖个人记忆和手动记录管理实验。解决方案：使用 MLflow、Weights & Biases 或 DVC 作为实验跟踪工具——每次训练运行自动记录代码版本、数据版本、超参、指标和模型产物。实验跟踪不是"最好有"——它是 ML 工程化的基础，就像代码版本控制是软件工程的基础。',
        stage: 5,
        provenance: 'official',
      },
      {
        id: 'dp-ap-008',
        title: '过拟合只看离线指标',
        content:
          '过度优化离线评估指标而忽视模型的泛化能力和线上表现——模型在测试集上表现极好但上线后效果远低于预期。症状：在测试集上反复调参和选择模型（"测试集泄露"——测试集不再独立评估而是成了开发过程的一部分）；离线指标选择过于简单（准确率在类别不平衡的数据集上无意义——99% 负样本的"99% 准确率"等于什么都没学到）；忽视模型的鲁棒性和泛化——测试集的分布与生产环境不同但团队只关注测试集分数；没有进行 A-B 测试就直接全量上线。离线指标是模型开发的重要指导但不是最终裁决——真正的模型评估必须在生产环境中用真实数据验证。最佳实践：测试集只使用一次（严格隔离）、选择适合业务的评估指标（准确率 vs 精确率/召回率 vs AUC vs 业务指标）、在开发环境中做回测（Backtest）验证时间泛化能力、通过 A-B 测试对比新旧模型在生产中的表现。',
        stage: 5,
        provenance: 'official',
      },
    ],

    // ── examples（示例）8 条 ──
    examples: [
      {
        id: 'dp-ex-001',
        title: '数据平台项目 WBS',
        content:
          '典型企业数据平台建设项目的 WBS 分解：阶段 1——平台规划（需求调研与用例收集、技术选型评估、架构设计、容量规划、安全合规评估、项目章程）；阶段 2——基础设施搭建（云/本地资源申请、Kubernetes 集群部署、存储系统 S3/HDFS、网络与安全组、监控系统 Prometheus+Grafana、日志系统 ELK/Loki）；阶段 3——数据接入（数据源识别与注册、连接器开发或配置 CDC/Debezium/Kafka Connect、Schema 注册与验证、数据质量校验、初始数据加载）；阶段 4——数据建模与存储（数据湖原始层、数仓 ODS/DWD/DWS/ADS 分层、维度建模或 Data Vault、数据目录与血缘）；阶段 5——数据服务（查询引擎 Presto/Trino、OLAP 引擎 ClickHouse/Doris、数据 API 网关、数据产品文档与 SLI、自助分析工具接入）；阶段 6——平台运营（监控告警、数据质量 SLI 看板、成本优化、用户培训、持续改进迭代）。每阶段可并行推进独立的数据产品（按业务领域划分而非整体平台一次性交付）。',
        stage: 1,
        provenance: 'official',
      },
      {
        id: 'dp-ex-002',
        title: 'ETL-ELT 管道设计',
        content:
          '典型 ETL/ELT 管道设计示例——从业务数据库到数据仓库的每日数据同步：E（提取）——使用 CDC（Change Data Capture）从 MySQL binlog 实时捕获变更（Debezium + Kafka），而非全量定时查询（减少源库压力）；L（加载）——原始变更数据以 Avro 格式加载到数据湖的原始层（保留所有历史变更——Insert/Update/Delete 完整记录）；T（转换）——使用 dbt（data build tool）或 Spark SQL 在数据仓库内完成数据转换：原始层清洗与去重→ODS 层（操作数据存储——与源系统 1:1）、ODS→DWD（数据仓库明细层——维度建模宽表）、DWD→DWS（数据服务层——聚合表供报表和 BI）、DWS→ADS（应用数据层——面向具体应用场景的定制视图）。管道的 SLA 设置：数据新鲜度——每日 6am 前完成、数据完整度——行数偏差 < 0.1%、数据准确度——关键指标与源系统校验。管道监控：每一步的执行时间、数据量、失败行数、数据质量规则通过率。',
        stage: 4,
        provenance: 'official',
      },
      {
        id: 'dp-ex-003',
        title: '数据仓库维度模型',
        content:
          '电子商务平台的数据仓库维度模型设计示例——销售主题域：事实表（fact_sales）——粒度：每行代表一次订单中的一个商品、维度：日期键、产品键、客户键、订单键、促销键；度量：销售数量（可加）、销售金额（可加）、成本金额（可加）、折扣金额（可加）、毛利（可加）。维度表：dim_date（日期、年份、季度、月份、周、是否节假日、是否促销季）、dim_product（产品名称、品类、品牌、SKU、单价、上架日期）、dim_customer（客户名称、注册日期、会员等级、城市、渠道）、dim_promotion（促销类型、折扣率、开始日期、结束日期、促销名称）。聚合查询示例："2025 年 Q4 每个品类的销售金额和同比增长率"、"新客户 vs 老客户的季度消费趋势"、"促销活动对毛利的实际影响（扣除折扣后的净增收入）"。维度模型设计的核心是为分析场景优化——表结构反映业务问题而非数据源结构。',
        stage: 3,
        provenance: 'official',
      },
      {
        id: 'dp-ex-004',
        title: '模型训练实验记录',
        content:
          '典型的模型训练实验记录应包含以下完整信息——实验标识：实验名称（描述实验目标——"XGBoost 基线 vs LightGBM + 新特征"）、实验 ID（自动生成）、实验状态（运行中/完成/失败）；环境信息：Git 提交哈希、代码分支、Python 版本、关键包版本（scikit-learn/XGBoost/PyTorch）、Docker 镜像 ID；数据信息：训练数据集版本（数据仓库的快照时间戳）、训练/验证/测试切分方式（时序切分/随机切分）、特征列表（名称+来源+类型）、样本量；超参：模型类型、学习率、最大深度、子采样率、正则化参数、随机种子；结果：训练集指标（Loss/AUC/准确率）、验证集指标、测试集指标、混淆矩阵、特征重要性 Top 20、模型文件路径和大小；备注：实验结论（"LightGBM 比 XGBoost AUC 高 0.02 但训练时间少 40%——建议采用"）、下一步计划、关键发现。使用 MLflow 的 Tracking API 自动记录这些信息——mlflow.log_params/mlflow.log_metrics/mlflow.sklearn.log_model。',
        stage: 5,
        provenance: 'official',
      },
      {
        id: 'dp-ex-005',
        title: '特征存储设计',
        content:
          '特征存储的设计示例——用户画像特征组（user_profile）：实体——user_id（主键）、特征——user_age（年龄）、user_gender（性别）、user_city（城市）、user_member_level（会员等级）、user_lifetime_value（生命周期价值）、user_registration_date（注册日期），更新频率——每日批量更新，数据源——用户数据库 + CRM 系统。用户行为特征组（user_behavior）：实体——user_id + date（联合主键）、特征——login_count_7d（近 7 天登录次数）、purchase_count_30d（近 30 天购买次数）、avg_order_value_30d（近 30 天平均订单金额）、last_purchase_category（最近购买品类）、search_count_7d（近 7 天搜索次数），更新频率——每日批量或近实时流计算，数据源——点击流 Kafka Topic + 订单数据库。训练数据构造：给定模型训练日期范围 [2025-01-01, 2025-06-30]，特征存储对每个 user_id 返回该用户在 2025-06-30 时的特征快照（时点查询确保无数据泄露——不使用 2025-07-01 之后的数据）。在线推理：给定 user_id="12345"，特征服务 API 返回该用户的 user_profile 和 user_behavior 特征的最新值，延迟 < 10ms。',
        stage: 4,
        provenance: 'official',
      },
      {
        id: 'dp-ex-006',
        title: '数据质量规则集',
        content:
          "生产级数据质量规则集示例——完整性检查：主键非空（customers.customer_id）、关键业务字段非空（orders.order_amount）、必填字段填充率 > 99.9%；唯一性检查：主键唯一（orders.order_id）、业务唯一键不重复（customers.email + customers.phone 联合唯一）；一致性检查：订单金额 = 数量 × 单价（业务逻辑校验）、跨表引用完整（orders.customer_id 在 customers 中存在）、同一实体的属性在多个数据源中一致（CRM 的 customer_level 与数据仓库的 customer_level）；准确性检查：金额字段在合理范围（order_amount > 0 AND < 1000000）、日期在合理范围（order_date >= '2020-01-01' AND order_date <= CURRENT_DATE）；及时性检查：数据新鲜度——订单表的 max(order_date) 在最近 1 小时内、数据延迟——ETL 完成时间 vs SLA 时间；分布检查：关键字段的分布与历史基线对比（突然变化超过 3 个标准差触发告警）、类别字段的新值出现率（新 category 值的比例）。数据质量规则配置为 YAML/JSON，规则引擎（Great Expectations/dbt tests）自动执行并在 CI/CD 中作为门禁。",
        stage: 4,
        provenance: 'official',
      },
      {
        id: 'dp-ex-007',
        title: 'MLOps 流水线',
        content:
          '端到端 MLOps 流水线示例——触发：每天 6am 自动触发（数据仓库 ETL 完成后）或代码提交到模型仓库时触发；步骤 1 数据验证：检查训练数据的新鲜度（max timestamp 是否在 24h 内）、数据量是否在预期范围、Schema 是否与预期一致、数据质量规则全部通过；步骤 2 特征工程：从特征存储拉取训练特征（Feast/Tecton API）、构造训练集（特征 + label）、切分训练/验证/测试集（时序切分）；步骤 3 模型训练：使用 MLflow 或 Kubeflow 编排训练任务（Docker 容器化训练环境）、分布式训练（多 GPU/多节点）、自动超参搜索（Optuna/Hyperopt）；步骤 4 模型评估：在验证集上评估模型性能（AUC/准确率/精确率/召回率）、与当前生产模型对比（Champion/Challenger 比较）、生成评估报告（含特征重要性、偏依赖图、SHAP 值）；步骤 5 模型注册：通过评估门禁的模型注册到模型注册表（MLflow Model Registry）、标记为"Staging"阶段；步骤 6 模型部署：Staging 模型部署到 A-B 测试环境（5% 流量）、监控 24h 的线上指标、通过后提升为"Production"并全量部署。流水线的每一步都有明确的成功/失败标准，任何步骤失败自动通知模型负责人。',
        stage: 5,
        provenance: 'official',
      },
      {
        id: 'dp-ex-008',
        title: '数据治理目录与血缘',
        content:
          '数据治理目录的典型内容结构——数据资产注册：每个数据集的注册信息包括——名称、描述、所有者团队、数据管家、创建日期、最后更新日期、标签（PII/非 PII、内部/外部）、分类（原始数据/衍生数据/聚合数据）；Schema 信息：列名、数据类型、是否可空、业务含义（列级注释——"customer_lifetime_value 代表客户从注册到当前的总消费金额，单位元"）、敏感标记（PII 列标记）、数据质量 SLI（完整度、准确度、新鲜度）；血缘信息：上游数据源——这个数据集从哪些原始表/API 生成、下游消费——哪些报表/模型/API 使用这个数据集、转换逻辑——SQL/Spark 代码的链接或摘要；访问控制：谁可以读取、谁可以写入、谁可以管理、访问审计日志；统计信息：行数、存储大小、列级统计（数值列——min/max/avg/null count、类别列——distinct count/top values）、更新频率和最后更新时间。数据目录通过自动扫描（DataHub/Atlas 的 Crawler）和手动注册结合维护，与数据管道的 CI/CD 集成确保目录与代码同步更新。',
        stage: 3,
        provenance: 'official',
      },
    ],

    // ── checklists（检查清单）8 条 ──
    checklists: [
      {
        id: 'dp-chk-001',
        title: '数据需求评审检查清单',
        content:
          '数据项目启动前的需求评审检查清单——确保在开始写代码之前充分理解业务问题和数据可行性。1. 业务目标明确：这个数据项目要解决什么业务问题？成功的度量标准是什么（业务 KPIs 而非技术指标）？2. 数据可用性评估：所需数据是否已存在？数据在哪里（数据库/API/文件/外部）？数据是否可以访问（权限/合规/合同限制）？3. 数据质量初评：数据是否完整（有没有关键字段缺失）？数据是否准确（有没有已知的质量问题）？数据是否及时（更新频率是否满足业务需求）？4. 干系人识别：谁是数据产品的消费者？他们需要什么粒度/频率/格式的数据？5. 技术约束：对延迟的要求（实时/近实时/批量）？对数据量的预估（TB/PB 级）？6. 合规与隐私：数据是否包含 PII？是否需要脱敏/匿名化？是否有 GDPR/个人信息保护法合规要求？7. 资源评估：谁来做（团队技能匹配）？需要多长时间（粗略估算）？需要什么基础设施（云资源/工具）？8. 风险识别：最大的不确定性是什么（数据不存在？数据质量太差？需求不清晰？技术太新？）？',
        stage: 1,
        provenance: 'official',
      },
      {
        id: 'dp-chk-002',
        title: '数据接入就绪检查清单',
        content:
          '新数据源接入数据平台的就绪检查清单——确保数据能可靠、安全、高效地进入平台。1. 数据源信息：数据源类型（关系数据库/NoSQL/API/文件/流）、连接信息（主机/端口/认证）、数据量估算（行数/字节数/每日增量）。2. Schema 定义：完整的字段列表（名称/类型/是否可空）、主键和唯一键、更新模式（全量替换/增量追加/Upsert）。3. 连接器就绪：CDC 配置（Debezium connector 配置/Kafka Connect）、批处理连接器（Spark JDBC/Sqoop）、Schema 注册（Avro/Protobuf Schema 定义与注册）。4. 数据质量预检：抽样检查数据格式和内容、检查 Schema 一致性、识别数据异常（空值比例/异常值/乱码）。5. 安全与权限：网络连通性（VPC/防火墙/专线）、认证方式（用户名密码/Certificate/SSO）、授权范围（只读/读写/特定表）。6. SLA 定义：数据新鲜度要求、数据完整度要求、数据延迟要求。7. 监控与告警：接入管道的监控设置（数据量/延迟/错误率）、告警通知配置。8. 文档：数据源信息录入数据目录、接入管道的 Runbook（故障处理流程）。',
        stage: 3,
        provenance: 'official',
      },
      {
        id: 'dp-chk-003',
        title: '特征工程就绪检查清单',
        content:
          '模型开发前的特征工程就绪检查清单——确保特征已准备好供训练和推理使用。1. 特征需求：模型需要哪些特征？每个特征的定义和计算逻辑是否明确？2. 特征来源：每个特征的数据来自哪里（数据仓库/数据湖/实时流/外部 API）？数据是否可以访问（权限/延迟）？3. 特征注册：所有特征是否已在特征存储中注册（名称/类型/数据源/计算逻辑/所有者）？训练和推理是否从同一个特征存储获取特征？4. 时点一致性：训练数据的特征快照是否在模型训练日期范围内（无未来数据泄露）？在线推理能否以低延迟（<10ms）获取最新特征值？5. 特征质量：特征值的分布是否合理（统计概要——min/max/avg/null 比例）？特征缺失率是否可接受？特征与目标变量的相关性是否已分析？6. 特征复用：是否检查了特征目录中已有可复用的特征（避免重复计算）？新特征是否与已有特征有重叠？7. 特征文档：每个特征的含义、单位、取值范围是否已文档化？特征的计算逻辑是否有代码链接？8. 特征管道：特征计算的管道是否已开发完成并通过测试？管道是否设置了监控和告警？',
        stage: 4,
        provenance: 'official',
      },
      {
        id: 'dp-chk-004',
        title: '模型训练就绪检查清单',
        content:
          '模型训练启动前的就绪检查清单——确保训练能一次性成功并产出可复现的结果。1. 代码就绪：训练代码已通过代码评审、所有依赖锁定（requirements.txt/Dockerfile）、代码在版本控制中。2. 数据就绪：训练数据已准备好（特征存储快照）、训练/验证/测试集已正确切分（时序切分或随机切分——已确认无泄露）、数据质量检查已通过。3. 实验配置：实验名称和描述已设定、超参范围已定义、随机种子已固定、评估指标已选择。4. 环境就绪：训练环境可用（GPU/TPU 资源已分配）、Docker 镜像已构建并通过安全扫描、分布式训练配置已就绪（如果适用）。5. 跟踪就绪：实验跟踪工具（MLflow/W&B）已配置、自动日志设置已启用（mlflow.autolog）、模型产物保存路径已配置。6. 评估就绪：测试集已锁定且只被使用一次、评估脚本已就绪、与生产模型的对比基准已确定。7. 回滚就绪：训练失败的处理流程（自动重试/通知/清理）、资源回收策略（训练完成后自动释放 GPU）。8. 门禁就绪：训练成功标准已定义（最低 AUC/准确率）、失败标准已定义（训练 Loss 不收敛/梯度爆炸）。',
        stage: 5,
        provenance: 'official',
      },
      {
        id: 'dp-chk-005',
        title: '模型评估门禁检查清单',
        content:
          '模型从开发环境晋升到生产环境的评估门禁检查清单——确保模型的质量和安全性满足上线标准。1. 离线指标：测试集上的核心指标（AUC/准确率/精确率/召回率/F1）是否达到预设阈值？是否与当前生产模型进行了对比（Champion/Challenger）？2. 切片评估：模型在不同子群体上的表现是否一致（性别/年龄/地域/会员等级）？是否存在某些群体的指标显著低于平均值？3. 鲁棒性：模型在数据扰动下的表现（加入噪声/缺失特征）？在极端情况下的表现（长尾用户/冷启动）？4. 公平性：模型的预测是否存在对敏感属性（性别/种族/年龄）的系统性偏差？是否通过了公平性评估？5. 可解释性：是否能解释模型的预测（SHAP/LIME）？模型的前 3 个最重要的特征是什么？是否合理？6. 性能：模型的推理延迟是否满足 SLA（<100ms 或 <10ms）？模型的吞吐量是否满足预估的请求量？7. 安全：模型是否对对抗攻击鲁棒（对抗样本）？模型是否可能泄露训练数据（成员推断攻击）？8. 合规：模型是否满足监管合规要求？是否需要模型卡片（Model Card）/数据表（Datasheet）？',
        stage: 5,
        provenance: 'official',
      },
      {
        id: 'dp-chk-006',
        title: '上线发布就绪检查清单',
        content:
          '模型上线发布前的就绪检查清单——确保部署过程安全、可回滚、可监控。1. 部署策略：使用什么部署策略（蓝绿部署/金丝雀发布/影子模式）？流量切换方案已确定（5%→25%→50%→100%）？2. 基础设施：模型服务已部署到生产环境（Kubernetes/云函数/模型服务平台）、自动扩缩容已配置、负载均衡已就绪。3. 监控：模型监控已配置——输入数据漂移检测、预测漂移检测、性能指标监控（延迟/吞吐/错误率）、业务指标监控。4. 告警：告警规则已设置（漂移超过阈值/错误率超过 SLO/延迟超过 SLA）、告警通知已配置（Slack/邮件/PagerDuty）、告警 Runbook 已编写。5. 回滚：回滚方案已确定（一键回滚到上一个模型版本）、回滚触发条件已定义（错误率超过 X%/漂移超过 X%）、回滚演练已完成。6. A-B 测试：A-B 测试配置已就绪（流量分组/指标对比/统计显著性检验）、A-B 测试的评估周期已确定（至少 1-2 周）。7. 文档：模型卡片已编写（模型用途/训练数据/评估指标/限制/伦理考量）、上线 Runbook 已编写（故障处理流程/联系人）。8. 审批：相关审批已完成（模型评审委员会/安全评审/合规评审）、上线时间窗口已确认（业务低峰期）。',
        stage: 6,
        provenance: 'official',
      },
      {
        id: 'dp-chk-007',
        title: '数据质量监控部署检查清单',
        content:
          '数据质量监控系统部署的检查清单——确保数据管道和模型的数据输入持续健康。1. 监控覆盖：所有关键数据表的数据质量监控是否已部署？新数据的质量规则是否已配置（完整性/唯一性/一致性/准确性/及时性）？2. 漂移检测：关键特征的数据漂移检测是否已配置？漂移的统计检验方法是否已确定（KS 检验/卡方检验/Wasserstein 距离）？3. 告警：数据质量告警规则是否已设置（质量规则失败率超过阈值/漂移超过阈值）？告警通知是否已配置？4. 仪表板：数据质量仪表板已创建——整体质量评分、各表质量趋势、漂移趋势、问题追踪。5. 响应流程：数据质量问题处理流程已建立——谁负责响应/如何诊断/如何修复/如何通知下游。6. SLA：数据质量 SLA 已定义——完整度/准确度/新鲜度的目标值和最低值。7. 自动化：数据质量检查已集成到 CI/CD 流水线中——数据质量门禁不通过则阻断部署。8. 迭代：数据质量规则定期评审和更新——新增规则/调整阈值/删除不再适用的规则。',
        stage: 6,
        provenance: 'official',
      },
      {
        id: 'dp-chk-008',
        title: '模型退役与归档检查清单',
        content:
          '模型退役与归档的检查清单——确保不再使用的模型被正确下线而非简单"关掉"。1. 退役决策：为什么这个模型需要退役？新模型已上线并显著优于旧模型、业务场景已不存在、数据源已不可用、合规要求。2. 影响分析：哪些下游系统在使用这个模型（API/报表/自动化决策）？停止服务对业务的影响是什么？3. 迁移方案：下游系统迁移到新模型或替代方案的方案已确定？迁移时间线已确认？4. 归档：模型文件（权重/配置）已归档到长期存储（S3/GCS/Blob Storage）、模型元数据（训练运行/评估指标/部署历史）已归档、归档日期和归档负责人已记录。5. 通知：所有相关方已收到模型退役通知（下游团队/业务方/运维团队）、退役时间窗口已确认。6. 监控：退役后的监控期——在完全停止服务前保持一段时间的监控以确保无意外影响。7. 审计：退役决策和过程已记录到审计日志——谁/何时/为什么退役。8. 知识保留：模型的经验教训已记录——为什么这个模型成功了或失败了、下一个模型可以从中学到什么。',
        stage: 6,
        provenance: 'official',
      },
    ],

    // ── rubric（评分标准）8 维度 ──
    rubric: [
      {
        id: 'dp-rub-001',
        title: '数据质量分评分标准',
        content:
          '评估数据项目的整体数据质量成熟度——从数据沼泽到数据资产的演进。1 分——数据沼泽：无数据目录、无质量规则、无所有权、数据散落各系统、质量问题全靠人工发现（用户投诉）。3 分——基本治理：关键数据表有质量规则（完整度/准确度）、数据目录已建立（但覆盖不全）、数据所有权已分配、质量问题有监控告警。5 分——数据即产品：全量数据目录覆盖、自动化质量规则 CI/CD 集成、数据 SLI 看板公开、数据质量问题自动检测→通知→修复闭环、数据消费者对数据质量满意。评分要点：质量规则覆盖率、自动化程度、数据发现和理解的便利性、数据信任度。',
        stage: 6,
        provenance: 'official',
      },
      {
        id: 'dp-rub-002',
        title: '模型离线指标评分标准',
        content:
          '评估模型在离线测试集上的性能——从随机猜测到接近人类专家。1 分——差：核心指标（AUC/准确率/F1）接近随机基线、模型几乎没有学到任何模式。3 分——可用：核心指标达到业务可接受水平（如 AUC > 0.75、准确率 > 80%）、在不同子群体上的表现基本一致（无严重偏差）、与当前生产模型相当或略好。5 分——卓越：核心指标显著优于业务基线（AUC > 0.90、准确率 > 90%）、在所有关键子群体上表现一致且优秀、与生产模型相比有显著提升（AUC 提升 > 0.03 或准确率提升 > 3%）。评分要点：指标选择是否合理（准确率 vs AUC vs 精确率/召回率取决于业务场景）、是否有过拟合迹象（训练集与测试集指标差距）、是否在时间切分数据上验证泛化能力。',
        stage: 5,
        provenance: 'official',
      },
      {
        id: 'dp-rub-003',
        title: '模型线上指标评分标准',
        content:
          '评估模型在生产环境中的实际表现——从上线即衰减到持续稳定创造价值。1 分——差：上线后指标显著低于离线评估（衰减 > 10%）、模型预测分布漂移严重、模型延迟或吞吐不满足 SLA、对业务指标无正向影响。3 分——稳定：线上指标与离线评估接近（衰减 < 5%）、模型延迟和吞吐满足 SLA、模型对业务指标有可观测的正向影响、A-B 测试确认统计显著性。5 分——卓越：线上指标与离线评估一致甚至更好（无衰减）、模型延迟和吞吐远超 SLA 要求、业务指标有显著提升（收入/效率/用户满意度提升 > 5%）、模型已成为业务决策的核心依赖。评分要点：训练-服务偏差、A-B 测试结果、业务指标影响、模型稳定性（上线后指标趋势）。',
        stage: 6,
        provenance: 'official',
      },
      {
        id: 'dp-rub-004',
        title: '管道可靠性 SLA 评分标准',
        content:
          '评估数据管道的可靠性和运维成熟度——从天天救火到无人值守。1 分——脆弱：管道每周至少失败 1 次、失败后需人工介入恢复、无自动重试或重试成功率低、SLA 达成率 < 95%。3 分——可靠：管道失败率低于每天 1 次、自动重试覆盖 90% 的失败场景、SLA 达成率 > 99%、管道监控和告警已配置。5 分——卓越：管道失败率低于每周 1 次、自动重试+自愈覆盖几乎所有失败场景（需人工介入 < 1%）、SLA 达成率 > 99.9%、管道运维几乎零人工干预（"无人值守"）。评分要点：失败率、平均恢复时间（MTTR）、自动重试成功率、SLA 达成率、人工干预频率。',
        stage: 6,
        provenance: 'official',
      },
      {
        id: 'dp-rub-005',
        title: '特征复用率评分标准',
        content:
          '评估组织内特征的复用程度——从每个团队独立造轮子到组织级特征资产共享。1 分——孤岛：每个团队各自计算特征（无特征存储）、特征重复计算率 > 50%、相同特征在不同团队中有不同定义和口径。3 分——部分复用：特征存储已建立、核心特征（>30%）已注册到特征存储、新项目优先查询特征目录、特征复用率 30-60%。5 分——高度复用：特征存储是组织级基础设施、>70% 的新特征在特征目录中已有相似特征（只需增量扩展）、特征重复计算率 < 10%、特征定义和口径全组织统一。评分要点：特征存储采用率、特征注册覆盖率、特征重复计算率、新项目特征发现率。',
        stage: 4,
        provenance: 'official',
      },
      {
        id: 'dp-rub-006',
        title: '实验可复现率评分标准',
        content:
          '评估数据科学实验的可复现程度——从"我记得..."到 100% 自动复现。1 分——不可复现：实验无系统化记录（散落在个人电脑/聊天记录）、代码无版本控制、训练数据无版本、结果无法复现或复现成本极高（需找原作者回忆）。3 分——基本可复现：实验跟踪系统已采用（MLflow/W&B）、核心实验（>50%）有完整记录、关键实验可复现但需要一些手动步骤（数据准备/环境配置）。5 分——完全可复现：100% 实验自动记录和追踪、任意实验一键复现（代码+数据+环境+超参全锁定）、实验的复现时间 < 1 小时（含环境重建和数据准备）。评分要点：实验跟踪覆盖率、复现成功率、复现时间、依赖锁定程度。',
        stage: 5,
        provenance: 'official',
      },
      {
        id: 'dp-rub-007',
        title: '数据时效性评分标准',
        content:
          '评估数据从产生到可用的延迟——从"昨天的数据明天才能用"到实时数据服务。1 分——T+1 或更差：数据延迟超过 24 小时、报表和模型使用的是昨天的数据（甚至更旧）、业务决策基于过时信息。3 分——小时级：关键数据延迟在 4 小时内、大多数报表和模型使用当天数据、实时场景（推荐/风控）延迟在分钟级。5 分——分钟级或实时：核心数据延迟 < 5 分钟、关键业务场景（实时推荐/风控/监控）延迟 < 1 秒、批流一体架构实现 Lambda 的实时+准确平衡。评分要点：端到端数据延迟、实时场景覆盖率、数据新鲜度 SLA 达成率、批流一体成熟度。',
        stage: 6,
        provenance: 'official',
      },
      {
        id: 'dp-rub-008',
        title: '模型迭代周期评分标准',
        content:
          '评估从模型 idea 到生产部署的迭代速度——从"半年一个新模型"到"每周迭代"。1 分——慢：从模型 idea 到上线超过 3 个月、大部分时间花在数据准备和环境配置（而非建模）、模型上线流程大量手动步骤（手动部署/手动测试）。3 分——中等：模型迭代周期 2-4 周、特征工程和训练自动化程度较高、部署流程半自动化（CI/CD 已集成但需人工审批）。5 分——快速：模型迭代周期 < 1 周、从实验到上线全自动化流水线（数据→特征→训练→评估→部署→监控全自动）、团队每周可上线多个模型版本、A-B 测试快速验证 idea。评分要点：迭代周期时间、自动化程度、上线频率、从 idea 到价值的延迟。',
        stage: 6,
        provenance: 'official',
      },
    ],
  },
}
