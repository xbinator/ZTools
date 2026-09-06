/**
 * LMDB 本地版本与附件测试。
 *
 * 仅验证设备内的数据版本、冲突元数据、变更日志和附件，不启动网络服务。
 */

import { afterEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import LmdbDatabase from '../../src/main/core/lmdb/index'

const databases: LmdbDatabase[] = []
const tempDirs: string[] = []

/**
 * 创建位于隔离临时目录内的真实 LMDB。
 * @returns 已初始化的 LMDB 实例。
 */
function createTempDb(): LmdbDatabase {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-local-lmdb-'))
  const database = new LmdbDatabase({
    path: dir,
    mapSize: 128 * 1024 * 1024,
    maxDbs: 6
  })
  tempDirs.push(dir)
  databases.push(database)
  return database
}

afterEach(() => {
  // 先释放数据库句柄，再清理测试专用目录。
  for (const database of databases.splice(0)) database.close()
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('LMDB local versions and attachments', () => {
  it('writes, updates, reads and removes versioned local documents', () => {
    const database = createTempDb()
    const created = database.put({ _id: 'PLUGIN/example', value: 'first' })
    const updated = database.put({ _id: 'PLUGIN/example', _rev: created.rev, value: 'second' })

    expect(created.ok).toBe(true)
    expect(updated.ok).toBe(true)
    expect(database.get('PLUGIN/example')).toMatchObject({ value: 'second', _rev: updated.rev })

    const removed = database.remove({ _id: 'PLUGIN/example', _rev: updated.rev })
    expect(removed.ok).toBe(true)
    expect(database.get('PLUGIN/example')).toBeNull()
  })

  it('records local document changes and compacts old changelog entries', () => {
    const database = createTempDb()
    database.put({ _id: 'PLUGIN/a', value: 1 })
    database.put({ _id: 'PLUGIN/b', value: 2 })
    database.put({ _id: 'PLUGIN/c', value: 3 })

    expect(database.getChangesSince(1).map((change) => change.docId)).toEqual([
      'PLUGIN/b',
      'PLUGIN/c'
    ])
    expect(database.getLastSeq()).toBe(3)

    database.compactChangelog(2)
    expect(database.getChangesSince(0).map((change) => change.seq)).toEqual([3])
  })

  it('does not add host-only documents to the local data changelog', () => {
    const database = createTempDb()
    database.put({ _id: 'command-history/example', command: 'open' })

    expect(database.getChangesSince(0)).toEqual([])
  })

  it('stores and removes attachment bodies with their local document metadata', () => {
    const database = createTempDb()
    database.put({ _id: 'PLUGIN/attachment', title: 'local file' })
    database.postAttachment('PLUGIN/attachment', Buffer.from('private bytes'), 'text/plain')

    expect(Buffer.from(database.getAttachment('PLUGIN/attachment') || []).toString()).toBe(
      'private bytes'
    )
    expect(database.getAttachmentType('PLUGIN/attachment')).toMatchObject({ type: 'text/plain' })
    expect((database.get('PLUGIN/attachment') as any)._attachments.default.stub).toBe(true)

    database.removeAttachment('PLUGIN/attachment')
    expect(database.getAttachment('PLUGIN/attachment')).toBeNull()
    expect((database.get('PLUGIN/attachment') as any)._attachments?.default).toBeUndefined()
  })

  it('retains revision ancestry and resolves divergent local versions', () => {
    const database = createTempDb()
    const first = database.put({ _id: 'PLUGIN/conflict', value: 'local' })
    database.applyRemoteChange({
      docId: 'PLUGIN/conflict',
      rev: '9-imported',
      parentRev: null,
      deleted: false,
      timestamp: Date.now() + 1_000,
      doc: { _id: 'PLUGIN/conflict', _rev: '9-imported', value: 'imported' }
    })

    expect(database.getConflicts('PLUGIN/conflict')).toHaveLength(1)
    const resolved = database.resolveConflict('PLUGIN/conflict', first.rev || '')
    expect(resolved.ok).toBe(true)
    expect(database.get('PLUGIN/conflict')?.value).toBe('local')
    expect(database.getConflicts('PLUGIN/conflict')).toEqual([])
    expect(database.getRevisionHistory('PLUGIN/conflict', resolved.rev)).toContain('9-imported')
  })

  it('keeps imported changes local by excluding them from the outgoing changelog', () => {
    const database = createTempDb()
    database.applyRemoteDoc({ _id: 'PLUGIN/imported', _rev: '3-imported', value: 'local copy' })

    expect(database.get('PLUGIN/imported')).toMatchObject({ value: 'local copy' })
    expect(database.getChangesSince(0)).toEqual([])
  })
})
