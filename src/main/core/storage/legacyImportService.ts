import fs from 'fs'
import path from 'path'
import LmdbDatabase from '../lmdb'
import {
  ensure3Layout,
  getZToolsDataLayout,
  hasLegacyLmdb,
  type AppDataPathOptions
} from '../appData/appDataPaths'
import { readDataVersion, writeDataVersion } from '../appData/appDataVersion'
import { getStorageScopeForKey } from './storageRouting'
import { storageManager, type StorageManager } from './storageManager'
import {
  HOST_STORAGE_KEYS,
  LEGACY_CAMEL_CASE_STORAGE_KEYS,
  toHostDocId
} from '../../../shared/storageKeys'
import { rewriteLegacyStoragePaths } from './legacyPathRewriter'

export type LegacyImportMode = 'full' | 'compact'

export interface LegacyImportDetection {
  initialized: boolean
  legacyLmdbFound: boolean
  shouldPrompt: boolean
  legacyLmdbPath: string
}

export interface LegacyImportOptions {
  mode?: LegacyImportMode
  baseSettings?: boolean
  pluginInstallState?: boolean
  pluginOrder?: boolean
  pluginData?: boolean
  aiModels?: boolean
}

export interface LegacyImportResult {
  mode: LegacyImportMode
  importedDocs: number
  skippedDocs: number
  importedAttachments: number
  skippedAttachments: number
  copiedDirs: string[]
}

const BASE_SETTING_KEYS = new Set([toHostDocId(HOST_STORAGE_KEYS.settingsGeneral)])
const PLUGIN_INSTALL_KEYS = new Set([
  toHostDocId(HOST_STORAGE_KEYS.plugins),
  toHostDocId(HOST_STORAGE_KEYS.disabledPlugins)
])
const PLUGIN_ORDER_KEYS = new Set([toHostDocId(HOST_STORAGE_KEYS.pluginOrder)])
const AI_MODEL_KEYS = new Set([toHostDocId(HOST_STORAGE_KEYS.aiModels)])
const REMOVED_CLOUD_DOCUMENT_IDS = new Set([
  'AUTH/official-account',
  'ZTOOLS/notification-public-state'
])

const FULL_IMPORT_KEY_MAP = new Map<string, string>(
  [
    [HOST_STORAGE_KEYS.pinnedCommands, HOST_STORAGE_KEYS.pinnedCommands],
    [HOST_STORAGE_KEYS.superPanelPinned, HOST_STORAGE_KEYS.superPanelPinned],
    [HOST_STORAGE_KEYS.localShortcuts, HOST_STORAGE_KEYS.localShortcuts],
    [HOST_STORAGE_KEYS.globalShortcuts, HOST_STORAGE_KEYS.globalShortcuts],
    [HOST_STORAGE_KEYS.appShortcuts, HOST_STORAGE_KEYS.appShortcuts],
    [HOST_STORAGE_KEYS.commandAliases, HOST_STORAGE_KEYS.commandAliases],
    [HOST_STORAGE_KEYS.disabledCommands, HOST_STORAGE_KEYS.disabledCommands],
    [HOST_STORAGE_KEYS.pluginCenterPinned, HOST_STORAGE_KEYS.pluginCenterPinned],
    [HOST_STORAGE_KEYS.commandHistory, HOST_STORAGE_KEYS.commandHistory],
    [HOST_STORAGE_KEYS.commandUsageStats, HOST_STORAGE_KEYS.commandUsageStats],
    [HOST_STORAGE_KEYS.searchPreference, HOST_STORAGE_KEYS.searchPreference],
    [HOST_STORAGE_KEYS.lastMatchState, HOST_STORAGE_KEYS.lastMatchState],
    [LEGACY_CAMEL_CASE_STORAGE_KEYS.autoStartPlugin, HOST_STORAGE_KEYS.autoStartPlugin],
    [LEGACY_CAMEL_CASE_STORAGE_KEYS.autoDetachPlugin, HOST_STORAGE_KEYS.autoDetachPlugin],
    [LEGACY_CAMEL_CASE_STORAGE_KEYS.outKillPlugin, HOST_STORAGE_KEYS.outKillPlugin],
    [
      LEGACY_CAMEL_CASE_STORAGE_KEYS.disabledMainPushPlugin,
      HOST_STORAGE_KEYS.enabledMainPushPlugin
    ],
    [LEGACY_CAMEL_CASE_STORAGE_KEYS.detachedWindowSizes, HOST_STORAGE_KEYS.detachedWindowSizes],
    [HOST_STORAGE_KEYS.devPluginRegistry, HOST_STORAGE_KEYS.devPluginRegistry],
    [HOST_STORAGE_KEYS.mcpDisabledPlugins, HOST_STORAGE_KEYS.mcpDisabledPlugins]
  ].map(([source, target]) => [toHostDocId(source), toHostDocId(target)])
)

export class LegacyImportService {
  constructor(
    private manager: StorageManager = storageManager,
    private pathOptions: AppDataPathOptions = {}
  ) {}

  detect(): LegacyImportDetection {
    const layout = getZToolsDataLayout(this.pathOptions)
    const initialized = Boolean(readDataVersion(this.pathOptions))
    const legacyLmdbFound = !initialized && hasLegacyLmdb(this.pathOptions)
    return {
      initialized,
      legacyLmdbFound,
      shouldPrompt: legacyLmdbFound,
      legacyLmdbPath: layout.legacyLmdbPath
    }
  }

  startFresh(): void {
    ensure3Layout(this.pathOptions)
    writeDataVersion({ importedFromLegacy: false }, this.pathOptions)
  }

  importSelected(options: LegacyImportOptions): LegacyImportResult {
    const mode = options.mode || 'compact'
    const layout = ensure3Layout(this.pathOptions)
    if (!fs.existsSync(layout.legacyLmdbPath)) {
      const copiedDirs = copyLegacyDataDirs(layout)
      return {
        mode,
        importedDocs: 0,
        skippedDocs: 0,
        importedAttachments: 0,
        skippedAttachments: 0,
        copiedDirs
      }
    }

    const legacyDb = new LmdbDatabase({
      path: layout.legacyLmdbPath,
      mapSize: 2 * 1024 * 1024 * 1024,
      maxDbs: 6
    })

    let importedDocs = 0
    let skippedDocs = 0
    let importedAttachments = 0
    let skippedAttachments = 0
    const copiedDirs = copyLegacyDataDirs(layout)

    try {
      const docs = legacyDb.allDocs()
      const docsById = new Map(docs.map((doc) => [doc._id, doc]))
      for (const doc of docs) {
        const targetDocId = getImportTargetDocId(doc._id, options)
        if (!targetDocId) {
          skippedDocs++
          continue
        }
        const targetDb =
          getStorageScopeForKey(targetDocId) === 'device'
            ? this.manager.getDeviceDb()
            : this.manager.getAccountDb()
        const existing = targetDb.get(targetDocId)
        const importedDoc = sanitizeLegacyDocForImport(doc, layout, targetDocId, docsById)
        targetDb.put({ ...importedDoc, _rev: existing?._rev })
        importedDocs++
      }

      for (const item of legacyDb.listAttachments()) {
        const targetDocId = getImportTargetDocId(item.docId, options)
        if (!targetDocId) {
          skippedAttachments++
          continue
        }
        const targetDb =
          getStorageScopeForKey(targetDocId) === 'device'
            ? this.manager.getDeviceDb()
            : this.manager.getAccountDb()
        if (targetDb.getAttachment(targetDocId)) {
          skippedAttachments++
          continue
        }
        const body = legacyDb.getAttachment(item.docId)
        if (!body) {
          skippedAttachments++
          continue
        }
        const meta = legacyDb.getAttachmentType(item.docId)
        const result = targetDb.postAttachment(
          targetDocId,
          body,
          meta?.type || item.contentType || 'application/octet-stream'
        )
        if (result.ok) {
          importedAttachments++
        } else {
          skippedAttachments++
        }
      }
    } finally {
      legacyDb.close()
    }

    writeDataVersion({ importedFromLegacy: true }, this.pathOptions)
    return { mode, importedDocs, skippedDocs, importedAttachments, skippedAttachments, copiedDirs }
  }
}

/**
 * 清理旧文档的同步元数据、重写数据目录路径，并处理特殊配置迁移。
 * @param doc 旧版 LMDB 中的原始文档
 * @param layout 旧版与 3.x 数据目录布局
 * @param targetDocId 导入后的目标文档 ID
 * @param docsById 旧版文档索引，用于依赖其他文档的转换
 * @returns 可写入 3.x 数据库的文档
 */
function sanitizeLegacyDocForImport(
  doc: any,
  layout: ReturnType<typeof getZToolsDataLayout>,
  targetDocId: string,
  docsById: Map<string, any>
): any {
  const {
    _rev,
    _cloudSynced,
    _lastModified,
    _deleted,
    _conflicts,
    _revisions,
    _sync,
    ...cleanDoc
  } = doc || {}

  // 同时迁移裸绝对路径和 file URL，避免图标继续指向已移除的 2.x 目录。
  const pathRewrittenDoc = rewriteLegacyStoragePaths(
    { ...cleanDoc, _id: targetDocId },
    layout
  ).value

  if (
    doc?._id === toHostDocId(LEGACY_CAMEL_CASE_STORAGE_KEYS.disabledMainPushPlugin) &&
    targetDocId === toHostDocId(HOST_STORAGE_KEYS.enabledMainPushPlugin)
  ) {
    const disabledNames = normalizePluginNames(pathRewrittenDoc.data)
    const pluginsDoc = docsById.get(toHostDocId(HOST_STORAGE_KEYS.plugins))
    const installedNames = Array.isArray(pluginsDoc?.data)
      ? pluginsDoc.data
          .map((plugin: any) => (typeof plugin?.name === 'string' ? plugin.name : ''))
          .filter(Boolean)
      : []
    pathRewrittenDoc.data = installedNames.filter((name: string) => !disabledNames.includes(name))
  }

  return pathRewrittenDoc
}

function normalizePluginNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item: any) =>
      typeof item === 'string' ? item : typeof item?.pluginName === 'string' ? item.pluginName : ''
    )
    .filter(Boolean)
}

function copyLegacyDataDirs(layout: ReturnType<typeof getZToolsDataLayout>): string[] {
  const copied: string[] = []
  const pairs = [
    ['plugins', layout.pluginsPath],
    ['avatar', layout.avatarPath],
    ['clipboard', layout.clipboardPath],
    ['extends', layout.extendsPath]
  ] as const

  for (const [dirName, targetPath] of pairs) {
    const sourcePath = path.join(layout.legacyUserDataPath, dirName)
    if (!fs.existsSync(sourcePath)) continue
    if (copyDirectoryContents(sourcePath, targetPath)) {
      copied.push(dirName)
    }
  }
  return copied
}

function copyDirectoryContents(sourceDir: string, targetDir: string): boolean {
  let copied = false
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true })
    copied = true
  }
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name)
    const targetPath = path.join(targetDir, entry.name)
    if (entry.isDirectory()) {
      copied = copyDirectoryContents(sourcePath, targetPath) || copied
      continue
    }
    if (entry.isFile() && !fs.existsSync(targetPath)) {
      fs.copyFileSync(sourcePath, targetPath)
      copied = true
    }
  }
  return copied
}

function getImportTargetDocId(docId: string, options: LegacyImportOptions): string | null {
  // 旧账号、远程同步和通知状态不得从历史目录恢复。
  if (REMOVED_CLOUD_DOCUMENT_IDS.has(docId) || docId.startsWith('SYNC/')) return null

  if (options.mode) {
    if (BASE_SETTING_KEYS.has(docId)) return docId
    if (PLUGIN_INSTALL_KEYS.has(docId)) return docId
    if (PLUGIN_ORDER_KEYS.has(docId)) return docId
    if (docId.startsWith('PLUGIN/')) return docId
    if (AI_MODEL_KEYS.has(docId)) return docId
    if (options.mode === 'full') return FULL_IMPORT_KEY_MAP.get(docId) || null
    return null
  }

  if (options.baseSettings && BASE_SETTING_KEYS.has(docId)) return docId
  if (options.pluginInstallState && PLUGIN_INSTALL_KEYS.has(docId)) return docId
  if (options.pluginOrder && PLUGIN_ORDER_KEYS.has(docId)) return docId
  if (options.pluginData && docId.startsWith('PLUGIN/')) return docId
  if (options.aiModels && AI_MODEL_KEYS.has(docId)) return docId
  return null
}

export const legacyImportService = new LegacyImportService()
