import { afterEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { cleanupRemovedCloudFeatureState } from '../../src/main/core/privacy/removedCloudFeatureState'
import { StorageManager } from '../../src/main/core/storage/storageManager'

const managers: StorageManager[] = []
const tempRoots: string[] = []

/**
 * 创建使用隔离临时目录的本地存储管理器。
 * @returns 已初始化的临时存储管理器。
 */
function createManager(): StorageManager {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-cloud-cleanup-'))
  const manager = new StorageManager({ homeDir, mapSize: 128 * 1024 * 1024 })
  tempRoots.push(homeDir)
  managers.push(manager)
  manager.init()
  return manager
}

afterEach(() => {
  // 先关闭所有 LMDB 句柄，再删除测试专用目录。
  for (const manager of managers.splice(0)) manager.close()
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('removed cloud feature state cleanup', () => {
  it('removes obsolete cloud state while preserving local documents and attachments', () => {
    const manager = createManager()
    const deviceDb = manager.getDeviceDb()
    const accountDb = manager.getAccountDb()

    for (const id of [
      'AUTH/official-account',
      'SYNC/accounts',
      'SYNC/current-account',
      'SYNC/config',
      'SYNC/separated-auth-migrated',
      'ZTOOLS/notification-public-state'
    ]) {
      deviceDb.put({ _id: id, data: { secret: true } })
    }
    for (const id of ['SYNC/profile', 'SYNC/private-session']) {
      accountDb.put({ _id: id, data: { secret: true } })
    }
    accountDb.put({ _id: 'PLUGIN/notes', data: { text: 'keep me' } })
    accountDb.postAttachment('PLUGIN/notes', Buffer.from('local attachment'), 'text/plain')

    deviceDb.getMetaDb().putSync('_sync_checkpoint:device', '{}')
    accountDb.getMetaDb().putSync('_sync_checkpoint:account', '{}')
    deviceDb.getSyncTaskDb().putSync('task:device', '{}')
    accountDb.getSyncTaskDb().putSync('task:account', '{}')

    expect(cleanupRemovedCloudFeatureState(manager)).toEqual({
      removedDocuments: 8,
      removedCheckpoints: 2,
      removedTasks: 2
    })
    expect(deviceDb.get('AUTH/official-account')).toBeNull()
    expect(deviceDb.get('SYNC/config')).toBeNull()
    expect(accountDb.get('SYNC/profile')).toBeNull()
    expect(accountDb.get('SYNC/private-session')).toBeNull()
    expect(accountDb.get('PLUGIN/notes')).toMatchObject({ data: { text: 'keep me' } })
    expect(accountDb.getAttachment('PLUGIN/notes')).not.toBeNull()

    expect(cleanupRemovedCloudFeatureState(manager)).toEqual({
      removedDocuments: 0,
      removedCheckpoints: 0,
      removedTasks: 0
    })
  })
})
