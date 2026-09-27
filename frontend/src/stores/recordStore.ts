import { createStore } from 'zustand/vanilla'
import type { CodeSegment, FungusRecord } from '@/types'
import { db, syncAll, syncDelete } from '@/hooks/usePersistentStore'
import { formatSegmentCode, pickIssue } from '@/utils/segment'
import { segmentStore } from '@/stores/segmentStore'
import { uid } from '@/utils/id'

/** 该采集点没有可发号的编号段（停用 / 领完 / 未登记） */
export class NoAvailableSegmentError extends Error {}

export type NewRecordDraft = Omit<FungusRecord, 'id' | 'code' | 'segmentId'>

export interface RecordState {
  records: FungusRecord[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (record: FungusRecord) => Promise<void>
  /** 按编号段顺序领号并新建条目；段更新与条目写入在同一事务内完成 */
  createWithSegment: (draft: NewRecordDraft) => Promise<FungusRecord>
  remove: (id: string) => Promise<void>
}

export const recordStore = createStore<RecordState>((set, get) => ({
  records: [],
  loaded: false,
  hydrate: async () => {
    const records = await syncAll<FungusRecord>(db.records)
    records.sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN'))
    set({ records, loaded: true })
  },
  save: async (record) => {
    await db.records.put(record)
    await get().hydrate()
  },
  createWithSegment: async (draft) => {
    let created: FungusRecord | null = null
    await db.transaction('rw', db.segments, db.records, async () => {
      const segments = await db.segments.where('pointId').equals(draft.pointId).toArray()
      const choice = pickIssue(segments)
      if (!choice) {
        throw new NoAvailableSegmentError('该采集点没有可发号的编号段（未登记、已停用或已领完）')
      }
      const { segment, number } = choice
      const updated: CodeSegment = {
        ...segment,
        issuedNumbers: [...segment.issuedNumbers, number].sort((a, b) => a - b)
      }
      const record: FungusRecord = {
        ...draft,
        id: uid('rec'),
        code: formatSegmentCode(segment, number),
        segmentId: segment.id
      }
      await db.segments.put(updated)
      await db.records.put(record)
      created = record
    })
    await Promise.all([get().hydrate(), segmentStore.getState().hydrate()])
    return created!
  },
  remove: async (id) => {
    // 仅删条目：对应编号保留在段的 issuedNumbers 中，条目作废后也不再发放
    await syncDelete<FungusRecord>(db.records, id)
    await get().hydrate()
  }
}))
