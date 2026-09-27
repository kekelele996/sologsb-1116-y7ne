import type { CodeRange, IssuedCode } from '@/types'

/** 完整编号：前缀 + 至少 3 位序号（不足补零） */
export function formatCode(prefix: string, num: number): string {
  return `${prefix}${String(num).padStart(3, '0')}`
}

/** 已发出数量（含条目已作废的号，发出的号不回收） */
export function issuedCount(range: CodeRange): number {
  return Math.max(0, range.next - range.start)
}

/** 剩余可领数量：已整段退回的段未用号码已归还，剩余计 0 */
export function remainingCount(range: CodeRange): number {
  if (range.status === 'returned') return 0
  return Math.max(0, range.end - range.next + 1)
}

/** 是否还能发号：停用或领完的段不再发号 */
export function issuable(range: CodeRange): boolean {
  return range.status === 'active' && range.next <= range.end
}

/** 采集点维度的领用进度汇总 */
export interface RangeStats {
  total: number
  used: number
  remaining: number
  returned: number
}

export function summarizeRanges(ranges: CodeRange[]): RangeStats {
  const stats: RangeStats = { total: 0, used: 0, remaining: 0, returned: 0 }
  for (const range of ranges) {
    stats.total += range.end - range.start + 1
    stats.used += issuedCount(range)
    stats.remaining += remainingCount(range)
    stats.returned += range.returnedCount
  }
  return stats
}

/**
 * 登记校验：同一前缀的范围不能重叠（已退回段的未用号码已归还，可再登记）；
 * 但已发出的号（含条目已作废的）永远不再发放，任何新段都不得覆盖。
 */
export function overlapError(
  ranges: CodeRange[],
  issued: IssuedCode[],
  prefix: string,
  start: number,
  end: number
): string | null {
  const clash = ranges.find(
    (range) => range.prefix === prefix && range.status !== 'returned' && start <= range.end && end >= range.start
  )
  if (clash) return `与已登记段「${prefix}${clash.start} ~ ${clash.end}」范围重叠`
  const hit = issued.find((entry) => entry.prefix === prefix && entry.num >= start && entry.num <= end)
  if (hit) return `号码 ${hit.code} 已经发出过，不能再次登记发放`
  return null
}
