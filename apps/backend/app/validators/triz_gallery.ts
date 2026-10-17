import vine from '@vinejs/vine'
import { TRIZ_GALLERY_ARTIFACT_TYPES } from '#services/triz_copilot/triz_gallery_artifact_service'
import { TRIZ_GALLERY_PREFILL_ARTIFACT_TYPES } from '#services/triz_copilot/triz_gallery_prefill_service'

/**
 * v3-triz-contradiction-copilot 任务 4.1 / 4.2 —— 分馆产物与矩阵查询的入参校验。
 *
 * 只校验形状与闭集：产物存在性、组织归属、权限、内容低敏（体积 / 键名黑名单）由
 * Controller 与服务层判定（跨组织 / 不存在统一 404）。产物内容用 `vine.record(vine.any())`
 * 收敛为「普通对象」形态（数组 / 标量直接 422），深度低敏校验见服务层
 * `assertStructuredArtifactContent`。
 */
const contentValidator = vine.record(vine.any())

const listValidator = vine.compile(
  vine.object({
    projectId: vine.number().withoutDecimals().positive(),
    artifactType: vine.enum(TRIZ_GALLERY_ARTIFACT_TYPES).optional(),
    /** 历史查询：含已软删产物（软删不物理破坏历史） */
    includeDeleted: vine.boolean().optional(),
    /** 按版本展开（默认每类只给当前版本） */
    history: vine.boolean().optional(),
    page: vine.number().withoutDecimals().positive().optional(),
    perPage: vine.number().withoutDecimals().positive().max(100).optional(),
  }),
)

const showValidator = vine.compile(
  vine.object({
    projectId: vine.number().withoutDecimals().positive(),
    artifactId: vine.number().withoutDecimals().positive(),
    includeDeleted: vine.boolean().optional(),
    /** 版本回退读路径：取回链内指定版本的内容 */
    version: vine.number().withoutDecimals().positive().optional(),
  }),
)

const versionsValidator = vine.compile(
  vine.object({
    projectId: vine.number().withoutDecimals().positive(),
    artifactId: vine.number().withoutDecimals().positive(),
    includeDeleted: vine.boolean().optional(),
  }),
)

const storeValidator = vine.compile(
  vine.object({
    projectId: vine.number().withoutDecimals().positive(),
    artifactType: vine.enum(TRIZ_GALLERY_ARTIFACT_TYPES),
    content: contentValidator,
  }),
)

const updateValidator = vine.compile(
  vine.object({
    projectId: vine.number().withoutDecimals().positive(),
    artifactId: vine.number().withoutDecimals().positive(),
    content: contentValidator,
  }),
)

const destroyValidator = vine.compile(
  vine.object({
    projectId: vine.number().withoutDecimals().positive(),
    artifactId: vine.number().withoutDecimals().positive(),
  }),
)

/** 矩阵参数对查询：编号闭集 1–39（越界 / 非整数一律 422）。 */
const matrixPrinciplesValidator = vine.compile(
  vine.object({
    projectId: vine.number().withoutDecimals().positive(),
    improving: vine.number().withoutDecimals().min(1).max(39),
    worsening: vine.number().withoutDecimals().min(1).max(39),
  }),
)

/** 预填查询：只支持九屏幕与功能分析两类（其余两类为参数带入 / 只读件，无需脚手架）。 */
const prefillValidator = vine.compile(
  vine.object({
    projectId: vine.number().withoutDecimals().positive(),
    artifactType: vine.enum(TRIZ_GALLERY_PREFILL_ARTIFACT_TYPES),
  }),
)

export {
  listValidator,
  showValidator,
  versionsValidator,
  storeValidator,
  updateValidator,
  destroyValidator,
  matrixPrinciplesValidator,
  prefillValidator,
}
