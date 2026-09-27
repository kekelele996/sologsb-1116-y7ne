import { createStore } from 'zustand/vanilla'
import type { CodeRange, IssuedCode, RangeStatus } from '@/types'
import { db, syncAll, syncPut } from '@/hooks/usePersistentStore'
import { formatCode, overlapError } from '@/utils/codeRange'
import { uid } from '@/utils/id'

export interface RegisterRangeInput {
  pointId: string
  prefix: string
  start: number
  end: number
  note: string
}

export interface CodeRangeState {
  ranges: CodeRange[]
  issued: IssuedCode[]
  loaded: boolean
  hydrate: () => Promise<void>
  /** 登记编号段：同前缀范围不重叠，已发出的号不再登记 */
  register: (input: RegisterRangeInput) => Promise<CodeRange>
  /** 按段内顺序领取下一个号并与条目绑定；发出的号不再回收 */
  issue: (rangeId: string, recordId: string) => Promise<IssuedCode>
  /** 停用 / 启用（已退回的段不可变更） */
  setStatus: (id: string, status: RangeStatus) => Promise<void>
  /** 整段退回未用号码，返回退回数量 */
  returnUnused: (id: string) => Promise<number>
  /** 条目作废：台账标记作废，号码保留不回收 */
  voidByRecord: (recordId: string) => Promise<void>
}

const today = (): string => new Date().toISOString().slice(0, 10)

export const codeRangeStore = createStore<CodeRangeState>((set, get) => ({
  ranges: [],
  issued: [],
  loaded: false,
  hydrate: async () => {
    const ranges = await syncAll<CodeRange>(db.codeRanges)
    ranges.sort((a, b) => a.prefix.localeCompare(b.prefix, 'zh-Hans-CN') || a.start - b.start)
    const issued = await syncAll<IssuedCode>(db.issuedCodes)
    issued.sort((a, b) => a.prefix.localeCompare(b.prefix, 'zh-Hans-CN') || a.num - b.num)
    set({ ranges, issued, loaded: true })
  },
  register: async (input) => {
    const prefix = input.prefix.trim()
    if (!prefix) throw new Error('请填写编号前缀')
    const { start, end } = input
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
      throw new Error('起止号须为不小于 0 的整数，且起始号不大于终止号')
    }
    const clash = overlapError(get().ranges, get().issued, prefix, start, end)
    if (clash) throw new Error(clash)
    const range: CodeRange = {
      id: uid('rng'),
      pointId: input.pointId,
      prefix,
      start,
      end,
      next: start,
      status: 'active',
      returnedCount: 0,
      createdAt: today(),
      note: input.note.trim()
    }
    await syncPut<CodeRange>(db.codeRanges, range)
    await get().hydrate()
    return range
  },
  issue: async (rangeId, recordId) => {
    const range = get().ranges.find((item) => item.id === rangeId)
    if (!range) throw new Error('编号段不存在')
    if (range.status !== 'active') throw new Error('编号段已停用或退回，不能发号')
    if (range.next > range.end) throw new Error('编号段已领完，不能发号')
    const entry: IssuedCode = {
      id: uid('isc'),
      rangeId,
      pointId: range.pointId,
      prefix: range.prefix,
      num: range.next,
      code: formatCode(range.prefix, range.next),
      recordId,
      status: 'inuse',
      issuedAt: today()
    }
    // 段指针前移与台账落库放在同一事务，保证已发出的号不会重发
    await db.transaction('rw', db.codeRanges, db.issuedCodes, async () => {
      await db.codeRanges.update(rangeId, { next: range.next + 1 })
      await db.issuedCodes.add(entry)
    })
    await get().hydrate()
    return entry
  },
  setStatus: async (id, status) => {
    const range = get().ranges.find((item) => item.id === id)
    if (!range) throw new Error('编号段不存在')
    if (range.status === 'returned') throw new Error('已退回的编号段不能变更状态')
    await db.codeRanges.update(id, { status })
    await get().hydrate()
  },
  returnUnused: async (id) => {
    const range = get().ranges.find((item) => item.id === id)
    if (!range) throw new Error('编号段不存在')
    if (range.status === 'returned') throw new Error('该编号段已整段退回')
    const count = Math.max(0, range.end - range.next + 1)
    await db.codeRanges.update(id, { status: 'returned', returnedCount: count, returnedAt: today() })
    await get().hydrate()
    return count
  },
  voidByRecord: async (recordId) => {
    const targets = get().issued.filter((entry) => entry.recordId === recordId && entry.status === 'inuse')
    if (targets.length === 0) return
    const voidedAt = today()
    await db.transaction('rw', db.issuedCodes, async () => {
      await Promise.all(targets.map((entry) => db.issuedCodes.update(entry.id, { status: 'voided', voidedAt })))
    })
    await get().hydrate()
  }
}))
