import type LmdbDatabase from '../lmdb'
import { storageManager, type StorageManager } from '../storage/storageManager'

const REMOVED_CLOUD_DOCUMENT_IDS = [
  'AUTH/official-account',
  'SYNC/accounts',
  'SYNC/current-account',
  'SYNC/config',
  'SYNC/separated-auth-migrated',
  'SYNC/profile',
  'SYNC/private-session',
  'ZTOOLS/notification-public-state'
] as const

export interface RemovedCloudFeatureCleanupResult {
  removedDocuments: number
  removedCheckpoints: number
  removedTasks: number
}

/**
 * 删除 LMDB 子库内具有指定前缀的键。
 * @param database 待清理的 LMDB 子库。
 * @param prefix 需要删除的键前缀。
 * @returns 实际删除的键数量。
 */
function removeKeysByPrefix(database: any, prefix: string): number {
  // 先快照目标键，避免在遍历游标时修改同一子库。
  const keys = Array.from(
    database.getRange({ start: prefix, end: `${prefix}\xFF` }),
    (entry: { key: string }) => entry.key
  )
  for (const key of keys) database.removeSync(key)
  return keys.length
}

/**
 * 清理单个本地数据空间内废弃的云端文档与同步队列。
 * @param database 待清理的本地 LMDB 数据库。
 * @returns 此数据空间实际删除的状态数量。
 */
function cleanupDatabase(database: LmdbDatabase): RemovedCloudFeatureCleanupResult {
  let removedDocuments = 0

  // 只删除明确列出的云端状态，保留普通文档和附件。
  for (const documentId of REMOVED_CLOUD_DOCUMENT_IDS) {
    if (!database.get(documentId)) continue
    database.remove(documentId)
    removedDocuments += 1
  }

  return {
    removedDocuments,
    removedCheckpoints: removeKeysByPrefix(database.getMetaDb(), '_sync_checkpoint'),
    removedTasks: removeKeysByPrefix(database.getSyncTaskDb(), 'task:')
  }
}

/**
 * 幂等清理已移除的官方账号、远程同步与通知状态。
 * @param manager 可覆盖的存储管理器，默认使用应用全局实例。
 * @returns 各类废弃状态的实际删除数量。
 */
export function cleanupRemovedCloudFeatureState(
  manager: StorageManager = storageManager
): RemovedCloudFeatureCleanupResult {
  const totals: RemovedCloudFeatureCleanupResult = {
    removedDocuments: 0,
    removedCheckpoints: 0,
    removedTasks: 0
  }

  /**
   * 将单个数据空间的清理结果累加到总数。
   * @param database 待清理的数据空间。
   * @returns 无返回值。
   */
  const cleanupAndAccumulate = (database: LmdbDatabase): void => {
    const result = cleanupDatabase(database)
    totals.removedDocuments += result.removedDocuments
    totals.removedCheckpoints += result.removedCheckpoints
    totals.removedTasks += result.removedTasks
  }

  const currentAccountUid = manager.getCurrentAccountUid()
  cleanupAndAccumulate(manager.getAccountDb())

  if (currentAccountUid) {
    // 清完历史账号空间后切回默认本地空间，阻止后续读取账号分区。
    manager.switchAccount(null)
    cleanupAndAccumulate(manager.getAccountDb())
  }

  // 最后清理设备状态，包含切换本地空间时产生的旧账号指针。
  cleanupAndAccumulate(manager.getDeviceDb())
  return totals
}
