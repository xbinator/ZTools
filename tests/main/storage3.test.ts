import { afterEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import LmdbDatabase from '../../src/main/core/lmdb'
import { LegacyImportService } from '../../src/main/core/storage/legacyImportService'
import { StorageManager } from '../../src/main/core/storage/storageManager'

const managers: StorageManager[] = []
const tempRoots: string[] = []

/**
 * 创建测试专用的临时根目录。
 * @returns 新建临时目录的绝对路径。
 */
function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-storage3-'))
  tempRoots.push(root)
  return root
}

/**
 * 创建并登记一个隔离的存储管理器。
 * @param homeDir 测试数据根目录。
 * @param legacyUserDataPath 可选的旧版数据目录。
 * @returns 已初始化的存储管理器。
 */
function createManager(homeDir: string, legacyUserDataPath?: string): StorageManager {
  const manager = new StorageManager({
    homeDir,
    legacyUserDataPath,
    mapSize: 128 * 1024 * 1024
  })
  managers.push(manager)
  manager.init()
  return manager
}

afterEach(() => {
  // 先关闭 LMDB 句柄，确保 Windows 能移除临时目录。
  for (const manager of managers.splice(0)) manager.close()
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('ZTools local storage routing', () => {
  it('keeps device settings and local plugin data in their intended databases', () => {
    const manager = createManager(makeTempRoot())
    const router = manager.getRouter()

    router.put({ _id: 'ZTOOLS/settings-general', data: { theme: 'dark' } })
    router.put({ _id: 'ZTOOLS/ai-models', data: { providers: [] } })
    router.put({ _id: 'PLUGIN/demo/settings', data: { local: true } })

    expect(manager.getDeviceDb().get('ZTOOLS/settings-general')).not.toBeNull()
    expect(manager.getAccountDb().get('ZTOOLS/ai-models')).not.toBeNull()
    expect(manager.getAccountDb().get('PLUGIN/demo/settings')).not.toBeNull()
    expect(manager.getDeviceDb().get('PLUGIN/demo/settings')).toBeNull()
  })

  it('tracks versions only for local user and plugin documents', () => {
    const manager = createManager(makeTempRoot())
    const router = manager.getRouter()

    router.put({ _id: 'ZTOOLS/settings-general', data: { theme: 'dark' } })
    router.put({ _id: 'ZTOOLS/ai-models', data: { providers: [] } })
    router.put({ _id: 'PLUGIN/demo/settings', data: { local: true } })

    expect(router.getChangesSince(0).map((change) => change.docId)).toEqual([
      'ZTOOLS/ai-models',
      'PLUGIN/demo/settings'
    ])
  })
})

describe('ZTools legacy local import', () => {
  it('imports ordinary local plugin data but drops account and remote sync state', () => {
    const homeDir = makeTempRoot()
    const legacyUserDataPath = path.join(homeDir, 'legacy-user-data')
    const legacyLmdbPath = path.join(legacyUserDataPath, 'lmdb')
    fs.mkdirSync(legacyLmdbPath, { recursive: true })
    const legacyDb = new LmdbDatabase({
      path: legacyLmdbPath,
      mapSize: 128 * 1024 * 1024,
      maxDbs: 6
    })

    legacyDb.put({ _id: 'PLUGIN/notes', data: { text: 'keep me' } })
    legacyDb.postAttachment('PLUGIN/notes', Buffer.from('local attachment'), 'text/plain')
    legacyDb.put({ _id: 'AUTH/official-account', data: { token: 'must disappear' } })
    legacyDb.put({ _id: 'SYNC/config', data: { token: 'must disappear' } })
    legacyDb.close()

    const manager = createManager(homeDir, legacyUserDataPath)
    const service = new LegacyImportService(manager, { homeDir, legacyUserDataPath })
    const result = service.importSelected({ mode: 'full' })

    expect(result.importedDocs).toBe(1)
    expect(result.skippedDocs).toBe(2)
    expect(result.importedAttachments).toBe(1)
    expect(manager.getAccountDb().get('PLUGIN/notes')).toMatchObject({
      data: { text: 'keep me' }
    })
    expect(Buffer.from(manager.getAccountDb().getAttachment('PLUGIN/notes') || []).toString()).toBe(
      'local attachment'
    )
    expect(manager.getDeviceDb().get('AUTH/official-account')).toBeNull()
    expect(manager.getDeviceDb().get('SYNC/config')).toBeNull()
    expect(manager.getAccountDb().get('SYNC/config')).toBeNull()
  })

  it('detects legacy data only before the local layout is initialized', () => {
    const homeDir = makeTempRoot()
    const legacyUserDataPath = path.join(homeDir, 'legacy-user-data')
    fs.mkdirSync(path.join(legacyUserDataPath, 'lmdb'), { recursive: true })
    const manager = new StorageManager({ homeDir, legacyUserDataPath })
    const service = new LegacyImportService(manager, { homeDir, legacyUserDataPath })

    expect(service.detect()).toMatchObject({ shouldPrompt: true, legacyLmdbFound: true })
    service.startFresh()
    expect(service.detect()).toMatchObject({ shouldPrompt: false, initialized: true })
  })
})
