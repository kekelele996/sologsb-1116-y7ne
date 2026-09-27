import { createStore } from 'zustand/vanilla'
import type { CodeSegment, SegmentStatus } from '@/types'
import { db, syncAll } from '@/hooks/usePersistentStore'
import { issuedCount, padWidthFor, segmentSize } from '@/utils/segment'
import { uid } from '@/utils/id'

/** 编号段登记/操作失败（消息直接面向用户） */
export class SegmentError extends Error {}

export interface SegmentState {
  segments: CodeSegment[]
  loaded: boolean
  hydrate: () => Promise<void>
  register: (input: {
    pointId: string
    prefix: string
    start: number
    end: number
    note?: string
  }) => Promise<CodeSegment>
  setStatus: (id: string, status: SegmentStatus) => Promise<void>
  /** 整段退回：只有零发出的发号中段可以退回 */
  returnSegment: (id: string) => Promise<void>
  /** 删除采集点时连带清理其已退回的段 */
  removeByPoint: (pointId: string) => Promise<void>
}

export const segmentStore = createStore<SegmentState>((set, get) => ({
  segments: [],
  loaded: false,
  hydrate: async () => {
    const segments = await syncAll<CodeSegment>(db.segments)
    segments.sort((a, b) =>
      a.createdAt === b.createdAt ? a.start - b.start : a.createdAt.localeCompare(b.createdAt)
    )
    set({ segments, loaded: true })
  },

  register: async ({ pointId, prefix, start, end, note }) => {
    const cleanPrefix = prefix.trim()
    if (!pointId) throw new SegmentError('请先选择所属采集点')
    if (!cleanPrefix) throw new SegmentError('请填写编号前缀')
    if (cleanPrefix.length > 24) throw new SegmentError('前缀过长（不超过 24 个字符）')
    if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end <= 0) {
      throw new SegmentError('起止号必须为正整数')
    }
    if (start > end) throw new SegmentError('起始号不能大于截止号')
    if (segmentSize({ start, end }) > 100000) throw new SegmentError('单段容量过大（不超过 10 万个号）')

    // 同一前缀范围不能重叠：已退回的段不再占号，不参与比较
    const overlap = get().segments.find(
      (seg) =>
        seg.prefix === cleanPrefix &&
        seg.status !== 'returned' &&
        seg.start <= end &&
        seg.end >= start
    )
    if (overlap) {
      throw new SegmentError(
        `与同前缀编号段「${overlap.start} ~ ${overlap.end}」范围重叠，请调整起止号`
      )
    }

    const now = new Date().toISOString()
    const segment: CodeSegment = {
      id: uid('seg'),
      pointId,
      prefix: cleanPrefix,
      start,
      end,
      padWidth: padWidthFor(end),
      issuedNumbers: [],
      status: 'active',
      createdAt: now,
      note: note?.trim() ?? ''
    }
    await db.segments.put(segment)
    await get().hydrate()
    return segment
  },

  setStatus: async (id, status) => {
    const seg = get().segments.find((item) => item.id === id)
    if (!seg) throw new SegmentError('编号段不存在')
    if (seg.status === status || seg.status === 'returned') return
    await db.segments.update(id, { status })
    await get().hydrate()
  },

  returnSegment: async (id) => {
    const seg = get().segments.find((item) => item.id === id)
    if (!seg) throw new SegmentError('编号段不存在')
    if (seg.status === 'returned') return
    if (issuedCount(seg) > 0) {
      throw new SegmentError(`该段已发出 ${issuedCount(seg)} 个号，已发号不能退回，仅可整段退回未用段`)
    }
    await db.segments.update(id, { status: 'returned' })
    await get().hydrate()
  },

  removeByPoint: async (pointId) => {
    const rows = get().segments.filter((seg) => seg.pointId === pointId && seg.status === 'returned')
    if (rows.length > 0) await db.segments.bulkDelete(rows.map((seg) => seg.id))
    await get().hydrate()
  }
}))
