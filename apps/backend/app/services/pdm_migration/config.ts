/**
 * v2-pdm-migration-compatibility —— Config（Section 1.4 / Section 11.3）。
 *
 * 迁移配置管理。支持三种读模式：V1 主读（默认）、双读验证、PDM Adapter 主读。
 * 通过双读门禁的域才可切换读路径。
 */
import type { MigrationConfig, ReadMode } from './types.js'
import { DEFAULT_READ_MODE, READ_MODE_V1_PRIMARY } from './types.js'

const configStore: MigrationConfig = {
  defaultDryRun: true,
  maxProjectsPerRun: 1,
  readMode: DEFAULT_READ_MODE,
  dualReadPassedDomains: [],
}

export class PdmMigrationConfig {
  /**
   * 获取当前配置。
   */
  get(): MigrationConfig {
    return { ...configStore }
  }

  /**
   * 设置读模式。
   */
  setReadMode(mode: ReadMode): void {
    configStore.readMode = mode
  }

  /**
   * 获取当前读模式。
   */
  getReadMode(): ReadMode {
    return configStore.readMode
  }

  /**
   * 标记域的读路径可切换。
   */
  markDomainPassed(domain: string): void {
    if (!configStore.dualReadPassedDomains.includes(domain)) {
      configStore.dualReadPassedDomains.push(domain)
    }
  }

  /**
   * 判断域是否可以通过 PDM Adapter 读取。
   */
  canReadFromPdm(domain: string): boolean {
    if (configStore.readMode === READ_MODE_V1_PRIMARY) return false
    if (configStore.readMode === 'pdm_primary') return true
    // dual_read mode
    return configStore.dualReadPassedDomains.includes(domain)
  }

  /**
   * 重置配置。
   */
  reset(): void {
    configStore.defaultDryRun = true
    configStore.maxProjectsPerRun = 1
    configStore.readMode = READ_MODE_V1_PRIMARY
    configStore.dualReadPassedDomains = []
  }
}
