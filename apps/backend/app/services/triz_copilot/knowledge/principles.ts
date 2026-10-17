// TRIZ 静态知识包 · 40 条发明原则全量（v3-triz-contradiction-copilot 任务 1.1）。
//
// 素材来源（逐条可追溯）：docs/v2-v3/planning/ui-redesign/research/triz-fundamentals.md §二
// 「40 条发明原则全景拆解」；每条 entry 的 source 字段标注其来源章节。
//
// 呈现约定：nameZh / nameEn / nameRu 保留调研素材的标准三语名（含古典机械物理术语），
// 仅供溯源与检索；对用户可见的文案一律取 displayName（现代管理语汇，见 spec 词汇条）。
// 本模块为只读静态数据：无写库、无权限判定、不接受任何作用域参数、无网络与模型调用。

export interface TrizPrincipleEntry {
  /** 原则编号 1–40 */
  number: number
  /** 标准中文名（调研素材原文，含古典术语，仅供溯源） */
  nameZh: string
  /** 标准英文名 */
  nameEn: string
  /** 标准俄文名 */
  nameRu: string
  /** 现代管理语汇呈现名（用户可见文案一律用它） */
  displayName: string
  /** 一句话定义 */
  definition: string
  /** 软件 / 管理领域典型实例 */
  softwareExamples: string
  /** 面向 PM 的矛盾求解释义 */
  pmInterpretation: string
  /** 来源章节标注 */
  source: string
}

/** 40 条发明原则全量，按编号升序。 */
export const TRIZ_PRINCIPLES: readonly TrizPrincipleEntry[] = [
  {
    number: 1,
    nameZh: '分割原则',
    nameEn: 'Segmentation',
    nameRu: 'Дробление',
    displayName: '拆分与模块化',
    definition:
      '将一个整体系统分割为独立的部分，提高其模块化程度，或使分割后的各部分更易于单独替换或调整。',
    softwareExamples:
      '微服务架构（Microservices）；敏捷开发中将季度史诗任务拆解为小颗粒度的用户故事（User Story）；组织中拆解大部制为跨职能两披萨团队。',
    pmInterpretation:
      '当 PM 面对一个庞大且风险不可控的交期延误风险时，AI 自动将关键路径任务纵向切片为 3 个可独立灰度验收的微里程碑，消除全盘失控风险。',
    source: 'triz-fundamentals.md §二 · 原则 1',
  },
  {
    number: 2,
    nameZh: '分离 / 抽取原则',
    nameEn: 'Taking out / Extraction',
    nameRu: 'Отделение',
    displayName: '剥离非核心',
    definition:
      '从系统中抽取产生负面影响或多余的属性/部件，仅保留产生核心正面价值的单一属性/部件。',
    softwareExamples:
      '从主单体应用中将高耗资源的报表导出逻辑剥离为异步 Worker；把会议中扯皮的架构争吵抽离到专属的技术裁决委员会。',
    pmInterpretation:
      '当项目资源不足时，AI 识别出某复杂需求中 80% 的成本来自 20% 的边缘非核心逻辑，建议 PM 将该边缘特性抽出放入 V2 待办池。',
    source: 'triz-fundamentals.md §二 · 原则 2',
  },
  {
    number: 3,
    nameZh: '局部质量原则',
    nameEn: 'Local Quality',
    nameRu: 'Местное качество',
    displayName: '差异化处理',
    definition: '打破环境或对象的均匀结构，让不同部分在不同局部具备最契合其特定功能的最优属性。',
    softwareExamples:
      '冷热数据分级存储（热数据存 Redis，冷数据存 S3）；研发团队中设立“快速突击岗”（负责线上紧急 Bug）与“深水研发岗”（攻关核心算法）。',
    pmInterpretation:
      'AI 监测项目健康度时，不再对团队所有人推行一刀切的工时或进度监控，而是针对核心高危路径上的 2 名攻关工程师提供最高密度的上下文喂养与防打扰保护。',
    source: 'triz-fundamentals.md §二 · 原则 3',
  },
  {
    number: 4,
    nameZh: '不对称原则',
    nameEn: 'Asymmetry',
    nameRu: 'Асимметрия',
    displayName: '非对称投入',
    definition: '将对称或均等的形状/流程变为不对称；若已是不对称，则进一步强化其不对称程度。',
    softwareExamples:
      '非对称加密算法（公钥解密/私钥签名）；非均匀的 Sprint 排期（发版周排 3 天开发、2 天稳定缓冲，非发版周排 5 天全速开发）。',
    pmInterpretation:
      '面对工期吃紧矛盾，AI 建议对不同模块实行“非对称测试策略”：核心支付交易链路执行 100% 覆盖率与变异测试，后台运营面板仅做烟雾测试。',
    source: 'triz-fundamentals.md §二 · 原则 4',
  },
  {
    number: 5,
    nameZh: '合并 / 组合原则',
    nameEn: 'Merging / Consolidation',
    nameRu: 'Объединение',
    displayName: '合并与协同',
    definition: '在空间或时间上将相同或执行相近功能的对象/步骤紧密并置或组装在一起。',
    softwareExamples:
      'CI/CD 流水线将代码静态扫描、构建、单元测试合并同批并发执行；单点登录（SSO）统一多系统认证。',
    pmInterpretation:
      '当跨部门对齐成本过高时，AI 自动识别出 3 个正在彼此独立开会的子项目组存在重叠依赖，自动生成联合对齐议程并合并评审。',
    source: 'triz-fundamentals.md §二 · 原则 5',
  },
  {
    number: 6,
    nameZh: '多功能性 / 普遍性原则',
    nameEn: 'Universality',
    nameRu: 'Универсальность',
    displayName: '一岗多能',
    definition:
      '使一个对象或流程能够同时执行多种互补或原本属于其他组件的功能，从而淘汰其他冗余组件。',
    softwareExamples:
      '全栈开发工程师（Full-stack）；TypeScript 既做类型校验又生成运行时代码；Kubernetes 集成调度、健康检查与服务发现。',
    pmInterpretation:
      '在紧凑项目中，AI 充当“影子 Scrum Master + 自动化日报员”，一个 AI Agent 同时接管会议纪要、风险追踪和需求变更影响分析。',
    source: 'triz-fundamentals.md §二 · 原则 6',
  },
  {
    number: 7,
    nameZh: '嵌套原则',
    nameEn: 'Nesting doll / \"Matryoshka\"',
    nameRu: 'Матрёшка',
    displayName: '嵌套与分层',
    definition: '将一个对象放入另一个对象中，或将一个流程嵌套在另一个流程内部流转。',
    softwareExamples:
      'Docker 容器运行在虚拟机内；嵌套事务（Nested Transactions）；在大型项目评审会中嵌套微型 5 分钟站立决策会。',
    pmInterpretation:
      'AI 帮助 PM 构建“任务中的任务”动态沙箱，让初级工程师在正式代码库的分支内嵌套独立验证试验田，降低错误外溢风险。',
    source: 'triz-fundamentals.md §二 · 原则 7',
  },
  {
    number: 8,
    nameZh: '反重量 / 重量补偿原则',
    nameEn: 'Anti-weight',
    nameRu: 'Компенсация веса',
    displayName: '借力减负',
    definition: '将对象与能提供上升力或抵消力的外力环境相结合，以补偿其自身的“下坠/沉重”负担。',
    softwareExamples:
      '云原生无服务器（Serverless）架构将运维基础设施负担卸载给公有云；利用开源成熟生态抵消从零研发的重力。',
    pmInterpretation:
      '当项目因外部合规审计而变得进度奇慢时，AI 引入“高管赞助人背书”机制，通过组织势能补偿阻力，开辟合规快速通道。',
    source: 'triz-fundamentals.md §二 · 原则 8',
  },
  {
    number: 9,
    nameZh: '预先反作用原则',
    nameEn: 'Preliminary anti-action',
    nameRu: 'Предварительное антидействие',
    displayName: '事前预演',
    definition: '预先施加与不可避免的有害应力相反的作用力，以抵消即将到来的负面效应。',
    softwareExamples:
      'Chaos Engineering（混沌工程，如 Netflix Chaos Monkey，在生产前主动注入故障）；项目立项时的“事前验尸会”（Pre-mortem）。',
    pmInterpretation:
      '在项目启动之初，AI 结合历史同类项目失误数据，提前模拟“第三周核心员工离职”或“第三方接口超时”的灾难演练，预先配置冗余人手。',
    source: 'triz-fundamentals.md §二 · 原则 9',
  },
  {
    number: 10,
    nameZh: '预先作用原则',
    nameEn: 'Preliminary action',
    nameRu: 'Предварительное действие',
    displayName: '提前准备',
    definition: '在必要动作发生前，提前完成全部或部分预备操作，以便在关键时刻瞬间激活。',
    softwareExamples:
      '页面预渲染（SSR Pre-rendering）；连接池预热（Connection Pooling）；上线前预先配置好 DNS 与权限矩阵。',
    pmInterpretation:
      'AI 预见明日 Sprint 计划会中将出现对某个新业务名词的分歧，在会前 1 小时自动将业务领域词典与背景摘要私发给所有核心参会人。',
    source: 'triz-fundamentals.md §二 · 原则 10',
  },
  {
    number: 11,
    nameZh: '预先防范 / 预先应急原则',
    nameEn: 'Beforehand cushioning',
    nameRu: 'Заранее подложенная подушка',
    displayName: '预留缓冲',
    definition: '面对相对不可靠的流程或对象，预先准备好应急补偿措施，形成安全气囊。',
    softwareExamples:
      '熔断降级机制（Hystrix/Sentinel）；数据库异地多活冷备；项目合同中的违约金与不可抗力豁免条款。',
    pmInterpretation:
      '当排期紧凑时，AI 自动在关键节点后配置不可压缩的 48 小时“灰度静默窗口”，并在后台预生成一键回滚版本及公告草稿。',
    source: 'triz-fundamentals.md §二 · 原则 11',
  },
  {
    number: 12,
    nameZh: '等势原则',
    nameEn: 'Equipotentiality',
    nameRu: 'Эквипотенциальность',
    displayName: '消除层级摩擦',
    definition: '在工作流程中改变条件，消除势能差，避免不必要的升降或层级摩擦。',
    softwareExamples:
      '基于事件总线的扁平发布-订阅系统（Pub/Sub）；去中心化自组织团队（Spotify Model Squads）；无阻碍内部开源（InnerSource）。',
    pmInterpretation:
      '消除 PM 与研发间的汇报势能差，AI 搭建基于 Git 提交与 PR 的全透明看板，无需 PM 频繁发起“现在进度怎样了”的问询拉扯。',
    source: 'triz-fundamentals.md §二 · 原则 12',
  },
  {
    number: 13,
    nameZh: '逆向操作 / 反向思维原则',
    nameEn: 'The other way round / Inversion',
    nameRu: '«Наоборот»',
    displayName: '反其道而行',
    definition:
      '不做常规要求的动作，而是做完全相反的动作；使静止的运动，运动的静止；或者颠倒因果顺序。',
    softwareExamples:
      '测试驱动开发（TDD，先写失败的测试，再写实现代码）；控制反转（IoC / DI）；倒排工期（从不可变更的展会节点反推里程碑）。',
    pmInterpretation:
      '常规是“按需求估算时间”，AI 建议 PM 采用逆向操作：“固定下周五发版窗口，由 AI 倒推并裁剪只够这 5 天完成的高价值功能集合”（Fixed Timebox Scope Reduction）。',
    source: 'triz-fundamentals.md §二 · 原则 13',
  },
  {
    number: 14,
    nameZh: '曲面化 / 球面化原则',
    nameEn: 'Spheroidality / Curvature',
    nameRu: 'Сфероидальность',
    displayName: '闭环小循环',
    definition: '从直线转向曲线，从平面转向球面，从单向线性推进转向周期循环或闭环结构。',
    softwareExamples:
      '敏捷双周迭代循环替代瀑布流单向线性推进；环形缓冲队列（Circular Buffer）；PDCA 质量改善环。',
    pmInterpretation:
      '当线性的 Gantt 图因持续延期不断拉长时，AI 建议切换为“两日一闭环”的快速微循环交付模式，高频验证真实进展。',
    source: 'triz-fundamentals.md §二 · 原则 14',
  },
  {
    number: 15,
    nameZh: '动态化原则',
    nameEn: 'Dynamics / Dynamicity',
    nameRu: 'Динамичность',
    displayName: '动态调整',
    definition: '使对象或流程的特性能够在各个阶段根据最佳运行条件自适应地调整，变刚性为弹性。',
    softwareExamples:
      '云原生自动弹性扩缩容（K8s HPA）；动态配置中心（Apollo/Nacos）；自适应比特率流媒体；敏捷浮动估算点。',
    pmInterpretation:
      '固定 Deadline 下，AI 实时根据团队燃烧速率（Burn-down Rate）动态重平衡每个人的任务负荷，每天早上动态推荐今日最优排班。',
    source: 'triz-fundamentals.md §二 · 原则 15',
  },
  {
    number: 16,
    nameZh: '部分超越或过量作用原则',
    nameEn: 'Partial or excessive actions',
    nameRu: 'Частичное или избыточное действие',
    displayName: '适度过量',
    definition:
      '如果 100% 恰到好处的作用极其难以达成，则采用“稍欠一点”或“稍微过量一点”来大幅降低问题解决难度。',
    softwareExamples:
      '内存预分配（Over-provisioning）；极限编程中的“结对编程”（看似 200% 人力消耗，实则大幅压低后期 Bug 修复成本）。',
    pmInterpretation:
      '关键链路攻关时，AI 建议 PM 安排两名资深架构师采用不同技术栈进行“双轨原型竞标”（过量设计），用 120% 的短期代价规避 500% 的路线失败风险。',
    source: 'triz-fundamentals.md §二 · 原则 16',
  },
  {
    number: 17,
    nameZh: '维数转变 / 空间转换原则',
    nameEn: 'Another dimension',
    nameRu: 'Переход в другое измерение',
    displayName: '多维视角',
    definition: '将对象或流程从一维推向二维、二维推向三维，或者利用多层次/多维度的空间映射。',
    softwareExamples:
      '多维报表分析（OLAP Cube）；从单平面看板演进为“时间 × 团队 × 依赖链”的三维拓扑图谱；全息微服务追踪（Distributed Tracing）。',
    pmInterpretation:
      '当平面的甘特图无法展示复杂的任务卡点时，AI 将任务映射为“资源-依赖-风险”三维网络图，一键揪出隐蔽的循环依赖环。',
    source: 'triz-fundamentals.md §二 · 原则 17',
  },
  {
    number: 18,
    nameZh: '机械振动原则',
    nameEn: 'Mechanical vibration',
    nameRu: 'Использование механических колебаний',
    displayName: '高频轻触',
    definition: '使对象处于振动或高频脉动状态；如果已在振动，提高其频率或引入共振。',
    softwareExamples:
      '分布式系统中的 Heartbeat 心跳检测；网络重试中的带有随机抖动的指数退避（Exponential Backoff with Jitter）；每日 15 分钟站立会。',
    pmInterpretation:
      '针对拖延卡顿的任务，AI 不采用低效的每周催促，而是引入“高频轻量微震动”：在 IDE 内以无打扰的微提示在每次提交代码后更新进展。',
    source: 'triz-fundamentals.md §二 · 原则 18',
  },
  {
    number: 19,
    nameZh: '周期性作用原则',
    nameEn: 'Periodic action',
    nameRu: 'Периодическое действие',
    displayName: '周期化',
    definition: '将连续动作替换为周期性动作（脉冲）；若已经是周期性的，改变其频率或间隔。',
    softwareExamples:
      '定时批量轮询（Cron Job）；定期垃圾回收（GC Sweep）；每两周的 Sprint 演示与回顾会。',
    pmInterpretation:
      '项目团队饱受业务方随机插需求之苦，AI 建议 PM 与业务方确立“每周二、四上午 10 点统一收订变更请求”，用离散脉冲阻断连续干扰。',
    source: 'triz-fundamentals.md §二 · 原则 19',
  },
  {
    number: 20,
    nameZh: '有效作用的连续性原则',
    nameEn: 'Continuity of useful action',
    nameRu: 'Непрерывность полезного действия',
    displayName: '消除空转',
    definition: '使系统的所有部件持续满负荷运转，消除所有空闲、间歇或纯消耗性的等待动作。',
    softwareExamples: 'CPU 流水线指令重排；生产流水线流水作业；非阻塞 I/O（Node.js / Netty）。',
    pmInterpretation:
      '消除研发人员等待 PR 评审（Code Review）的空转耗时，AI 在代码提交瞬间接管初审，自动跑通静态测试并提供评审概要，缩短等待周期。',
    source: 'triz-fundamentals.md §二 · 原则 20',
  },
  {
    number: 21,
    nameZh: '快速通过 / 跃过原则',
    nameEn: 'Skipping / Hurrying',
    nameRu: 'Проскок',
    displayName: '快通道',
    definition: '以极高的速度飞快通过高危、有害或不稳定的阶段，减少危险停留时间。',
    softwareExamples:
      '数据库锁竞争时的“快速失败”（Fail-fast）；生产环境紧急漏洞修复采用 Hotfix 极速补丁跳过冗长常规发版审批流程。',
    pmInterpretation:
      '面对线上重大 P0 事故，AI 触发“急诊通道协议”，一键屏蔽全部非必要二阶审批，以极速流水线直推修复代码上线。',
    source: 'triz-fundamentals.md §二 · 原则 21',
  },
  {
    number: 22,
    nameZh: '变害为利 / 转化有害为有益原则',
    nameEn: 'Blessing in disguise',
    nameRu: 'Обращение вреда в пользу',
    displayName: '变废为宝',
    definition:
      '利用有害因素、副产物或外部威胁，将其转化为有益的创新要素；或者用两种有害因素相互抵消。',
    softwareExamples:
      '把被攻击的蜜罐网络（Honeypot）流量转化为网络安全威胁情报；将线上崩溃报错日志转化为产品体验优化的黄金清单。',
    pmInterpretation:
      '面对客户密集的挑剔吐槽和需求变更，AI 自动进行语义聚类，转化为竞品防御护城河分析报告，并为下次商务谈判提供增购抓手。',
    source: 'triz-fundamentals.md §二 · 原则 22',
  },
  {
    number: 23,
    nameZh: '反馈原则',
    nameEn: 'Feedback',
    nameRu: 'Обратная связь',
    displayName: '闭环反馈',
    definition: '引入反馈回路以控制并优化流程；如果反馈已存在，增强其灵敏度或改变其作用方向。',
    softwareExamples:
      '监控报警系统（Prometheus + Alertmanager）；持续交付中的蓝绿发布实时指标比对；敏捷回顾会（Retrospective）。',
    pmInterpretation:
      'AI 实时监控代码库活跃度与任务看板偏差，一旦偏离预期 10% 立即给 PM 发送负反馈微调建议，阻断偏差累积。',
    source: 'triz-fundamentals.md §二 · 原则 23',
  },
  {
    number: 24,
    nameZh: '中介物原则',
    nameEn: 'Intermediary',
    nameRu: '«Посредник»',
    displayName: '引入中介',
    definition:
      '引入临时中介物来传递作用或连接两个不兼容的实体；或者在作用完成后易于消除该中介物。',
    softwareExamples:
      '软件设计模式中的适配器模式（Adapter）、代理模式（Proxy）、消息中间件（Kafka/RabbitMQ）；敏捷项目中的敏捷教练（Agile Coach）。',
    pmInterpretation:
      '当业务产品经理与底层架构师因为术语不通陷入沟通僵局时，AI 作为“翻译中介物”，将技术限制实时转译为业务风险并提出折衷方案。',
    source: 'triz-fundamentals.md §二 · 原则 24',
  },
  {
    number: 25,
    nameZh: '自服务原则',
    nameEn: 'Self-service',
    nameRu: 'Самообслуживание',
    displayName: '自助服务',
    definition: '使系统具备自给自足能力，通过自我修复、自我组织、自我消耗辅助资源完成功能。',
    softwareExamples:
      '微服务自愈机制（Kubernetes Pod 自动重启与调度）；开发者自助云门户（Internal Developer Platform / IDP）。',
    pmInterpretation:
      '打造“自助式项目状态报告系统”，业务方无需催问 PM，由 AI 自动根据代码仓库和看板变动生成个性化的千人千面进度大屏。',
    source: 'triz-fundamentals.md §二 · 原则 25',
  },
  {
    number: 26,
    nameZh: '复制原则',
    nameEn: 'Copying',
    nameRu: 'Копирование',
    displayName: '影子复制',
    definition: '用简单、廉价的副本代替昂贵、易碎或复杂的原型；或者利用虚拟数码孪生代替实体。',
    softwareExamples: '测试驱动中的 Mock/Stub 服务替身；容器镜像复制；数字孪生（Digital Twin）。',
    pmInterpretation:
      '在项目重构前，AI 建立生产流量的影子录制与镜像回放系统（Traffic Shadowing），在虚拟沙箱中零风险检验新旧系统逻辑一致性。',
    source: 'triz-fundamentals.md §二 · 原则 26',
  },
  {
    number: 27,
    nameZh: '廉价替代品 / 一次性用品原则',
    nameEn: 'Cheap short-living objects',
    nameRu: 'Дешевая недолговечность',
    displayName: '用完即弃',
    definition: '用一组低成本、短寿命的对象替代昂贵而耐久的单一对象，降低维护代价。',
    softwareExamples:
      '云原生不可变基础设施（Immutable Infrastructure，实例坏了直接销毁重建，不现场修补）；临时 Disposable 预览环境。',
    pmInterpretation:
      '为每个待评审的 PR 自动拉起一个生命周期仅 2 小时的低成本临时测试预览分支环境，测试完毕自动销毁，节省 80% 长期服务器固定开销。',
    source: 'triz-fundamentals.md §二 · 原则 27',
  },
  {
    number: 28,
    nameZh: '机械系统替代 / 场替代原则',
    nameEn: 'Mechanics substitution',
    nameRu: 'Замена механической схемы',
    displayName: '自动化替代',
    definition: '用光学、声学、电磁场、热场或信息场等无形系统，替代繁重的实体机械物理交互。',
    softwareExamples:
      '物理机房被云计算虚拟化替代；纸质签字审批流被数字签名与自动化流水线门禁替代；手写复杂 SQL 被语义向量搜索替代。',
    pmInterpretation:
      '淘汰 PM 依赖 Excel/飞书文档手工搬运任务状态的机械劳动，由 AI 通过监听 GitHub/GitLab Webhook 事件自动推进看板流转。',
    source: 'triz-fundamentals.md §二 · 原则 28',
  },
  {
    number: 29,
    nameZh: '气动与液压结构原则',
    nameEn: 'Pneumatics and hydraulics',
    nameRu: 'Использование пневмо- и гидроконструкций',
    displayName: '流动化调度',
    definition: '用气体或液体的流动性、柔顺性和压力传导性，替代刚性的固体结构。',
    softwareExamples:
      '流式数据处理（Reactive Streams / Flink）；动态流控与背压机制（Backpressure）；弹性的自由流动人力资源池（Liquid Workforce）。',
    pmInterpretation:
      '项目间打破刚性的人力编制墙，AI 识别出 A 项目处于空闲等待期、B 项目处于攻坚期，动态建议建立“液态支援人力池”进行临时压力缓冲。',
    source: 'triz-fundamentals.md §二 · 原则 29',
  },
  {
    number: 30,
    nameZh: '柔性壳体和薄膜原则',
    nameEn: 'Flexible shells and thin films',
    nameRu: 'Использование гибких оболочек и тонких пленок',
    displayName: '轻量隔离层',
    definition: '用柔性壳体或微薄隔离层，替代传统的厚重刚性隔离结构。',
    softwareExamples:
      '轻量级容器化（Docker）替代重量级虚拟机（VM）；微前端架构中的 iframe 隔离；API 契约层保护内部实现细节。',
    pmInterpretation:
      '在新旧系统交替期间，AI 为老系统表面包裹一层轻量级的“防腐层（Anticorruption Layer）”API 薄膜，阻断历史技术债务向新模块蔓延。',
    source: 'triz-fundamentals.md §二 · 原则 30',
  },
  {
    number: 31,
    nameZh: '多孔材料原则',
    nameEn: 'Porous materials',
    nameRu: 'Применение пористых материалов',
    displayName: '留白缓冲',
    definition:
      '使物体具备多孔结构，或在原本致密的实体中引入缝隙、孔洞，以便于物质渗透或缓冲吸收。',
    softwareExamples:
      '数据库稀疏索引（Sparse Index）；代码架构中的插件式扩展点（Hook / SPI）；敏捷迭代日程中预留 15% 的“多孔缓冲时间”。',
    pmInterpretation:
      '排期时坚决拒绝 100% 填满排班，AI 强制在每个 Sprint 注入 20% 的“透气孔”，专门用于吸收不可预见的技术债与突发故障。',
    source: 'triz-fundamentals.md §二 · 原则 31',
  },
  {
    number: 32,
    nameZh: '改变颜色原则',
    nameEn: 'Color changes',
    nameRu: 'Изменение окраски',
    displayName: '可视化标识',
    definition: '改变对象或环境的颜色、透明度或可见性；利用可视化信号揭示深层状态。',
    softwareExamples:
      'IDE 代码语法高亮；CI/CD 红绿构建状态指示灯；看板红黄色高亮卡点任务；金丝雀灰度发布（Canary Release）。',
    pmInterpretation:
      '项目风险全自动染色机制：AI 依据语义分析实时将每个需求卡片渲染为不同饱和度的热力颜色，让 PM 一眼看穿潜伏的暗冰风险。',
    source: 'triz-fundamentals.md §二 · 原则 32',
  },
  {
    number: 33,
    nameZh: '同质性原则',
    nameEn: 'Homogeneity',
    nameRu: 'Однородность',
    displayName: '统一语言',
    definition: '让相互作用的对象采用相同材质或高度兼容的基底，消除界面排斥与摩擦损耗。',
    softwareExamples:
      '全栈统一技术栈（前后端全用 TypeScript/Node.js）；前后端统一数据模型定义（Protocol Buffers / GraphQL Schema）。',
    pmInterpretation:
      '消灭业务、设计与研发的术语鸿沟，AI 维护一套全项目唯一的“领域通用语言（Ubiquitous Language）”知识图谱，所有人对话同频。',
    source: 'triz-fundamentals.md §二 · 原则 33',
  },
  {
    number: 34,
    nameZh: '抛弃与再生原则',
    nameEn: 'Discarding and recovering',
    nameRu: 'Очищение и восстановление частей',
    displayName: '用完回收',
    definition: '在完成功能后，使消耗性部件自动剥离、销毁或恢复再生，不成为系统累赘。',
    softwareExamples:
      'Java JVM 垃圾回收机制；无状态容器在请求处理完毕后自动回收内存；项目阶段交付后的归档清理。',
    pmInterpretation:
      '临时组建的跨部门攻坚虚拟专项组，在攻坚指标达成后立即解散，AI 自动将沉淀的技术文档沉淀至知识库，释放人员回原部门。',
    source: 'triz-fundamentals.md §二 · 原则 34',
  },
  {
    number: 35,
    nameZh: '参数变化 / 物理化学参数改变原则',
    nameEn: 'Parameter changes',
    nameRu: 'Изменение параметров',
    displayName: '切换工作模式',
    definition: '改变系统的聚集状态、浓度、温度、灵活性或其他关键物理/逻辑状态参数。',
    softwareExamples:
      '批处理模式转换为实时流处理模式；关系型行存储转换为分析型列存储；薪酬激励由固定月薪调整为高弹性项目分红。',
    pmInterpretation:
      '当交付压力激增时，AI 建议项目进入“非常规聚集状态”：工作空间物理/虚拟集中，沟通从异步飞书转为连续语音连麦，极限提速。',
    source: 'triz-fundamentals.md §二 · 原则 35',
  },
  {
    number: 36,
    nameZh: '相变原则',
    nameEn: 'Phase transitions',
    nameRu: 'Применение фазовых переходов',
    displayName: '临界点切换',
    definition: '利用物质相变过程中产生的体积剧变、吸放热或其他物理/逻辑特性的本质突变。',
    softwareExamples:
      '冷数据转热数据的缓存击穿保护；从单机模式相变为分布式集群模式；产品从免费试用相变为付费订阅。',
    pmInterpretation:
      'AI 监测项目生命周期，当技术债务率超过 40% 临界点时，触发“项目相变”：停止一切新业务功能开发，全员强制进入为期 3 天的“重构固化周”。',
    source: 'triz-fundamentals.md §二 · 原则 36',
  },
  {
    number: 37,
    nameZh: '热膨胀原则',
    nameEn: 'Thermal expansion',
    nameRu: 'Применение теплового расширения',
    displayName: '弹性伸缩',
    definition: '利用材料的热胀冷缩特性，在受到外部激发（温度）时实现尺寸或压力的弹性变化。',
    softwareExamples:
      '高并发脉冲流量下线程池的弹性打满扩容与平稳期收缩；大促期间业务系统临时关闭边缘计算模块。',
    pmInterpretation:
      '大促上线当周，项目容量“热膨胀”：AI 协调测试外包团队接入临时扩充测试带宽，大促结束后自动收缩回缩编制。',
    source: 'triz-fundamentals.md §二 · 原则 37',
  },
  {
    number: 38,
    nameZh: '强氧化剂 / 加速氧化原则',
    nameEn: 'Strong oxidants',
    nameRu: 'Применение сильных окислителей',
    displayName: '极限压力测试',
    definition: '用富氧或高活性环境取代普通环境，极速加速化学/业务反应进程。',
    softwareExamples:
      '极限编程马拉松（Hackathon）；模糊测试（Fuzzing）对接口灌入海量异常变异数据进行极限破坏测试。',
    pmInterpretation:
      '在项目上线前夕，AI 扮演极端破坏性“红军攻击者”，高频制造并发脉冲、模拟主库断电与接口篡改，极限激发系统防御韧性。',
    source: 'triz-fundamentals.md §二 · 原则 38',
  },
  {
    number: 39,
    nameZh: '惰性环境原则',
    nameEn: 'Inert atmosphere',
    nameRu: 'Инертная среда',
    displayName: '免打扰保护',
    definition: '用惰性或真空环境替代活跃环境，防止发生不良反应或有害相互作用。',
    softwareExamples:
      'Docker 容器安全沙箱（gVisor/Kata Containers）；只读从库隔离分析查询；开发人员专属的“深度工作免打扰时间（Focus Time）”。',
    pmInterpretation:
      'AI 为项目核心攻坚工程师开启“真空保护罩”：拦截所有非紧急会议邀请、过滤即时通讯软件的催促进展弹窗，捍卫认知沉浸度。',
    source: 'triz-fundamentals.md §二 · 原则 39',
  },
  {
    number: 40,
    nameZh: '复合材料原则',
    nameEn: 'Composite materials',
    nameRu: 'Применение композиционных материалов',
    displayName: '人机复合',
    definition: '将不同特性的材料复合结合，使其获得单一均质材料所不具备的综合优异性能。',
    softwareExamples:
      '混合持久化架构（Polyglot Persistence：图数据库 + 关系数据库 + 时序数据库）；跨界复合型人才（懂产品的架构师）。',
    pmInterpretation:
      '构建“混合智能作战单元”：AI Agent 与资深 PM 形成人机复合体，AI 负责海量文档扫描、风险概率精算与指标监控，人类专家负责商务政治博弈与人性关怀。',
    source: 'triz-fundamentals.md §二 · 原则 40',
  },
]
