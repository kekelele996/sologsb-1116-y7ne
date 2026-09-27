import type { CodeSegment } from '@/types'

/** 段内容量（起止号闭区间） */
export function segmentSize(seg: Pick<CodeSegment, 'start' | 'end'>): number {
  return seg.end - seg.start + 1
}

/** 已发出号数（条目作废后号仍计入，不回收） */
export function issuedCount(seg: Pick<CodeSegment, 'issuedNumbers'>): number {
  return seg.issuedNumbers.length
}

/** 剩余可发号数 */
export function availableCount(seg: Pick<CodeSegment, 'start' | 'end' | 'issuedNumbers'>): number {
  return Math.max(0, segmentSize(seg) - seg.issuedNumbers.length)
}

/** 段内序号是否已全部领完 */
export function isExhausted(seg: Pick<CodeSegment, 'start' | 'end' | 'issuedNumbers'>): boolean {
  return seg.issuedNumbers.length >= segmentSize(seg)
}

/** 是否还能发号：仅「发号中」且未领完的段可以 */
export function canIssue(seg: CodeSegment): boolean {
  return seg.status === 'active' && !isExhausted(seg)
}

/** 段内下一个可领取的序号（取最小空号）；无号可领时返回 null */
export function nextIssueNumber(seg: CodeSegment): number | null {
  if (seg.status !== 'active') return null
  const used = new Set(seg.issuedNumbers)
  for (let n = seg.start; n <= seg.end; n++) {
    if (!used.has(n)) return n
  }
  return null
}

/** 按登记时锁定的补零宽度拼出完整采集编号 */
export function formatSegmentCode(seg: Pick<CodeSegment, 'prefix' | 'padWidth'>, n: number): string {
  return `${seg.prefix}${String(n).padStart(seg.padWidth, '0')}`
}

/** 登记新段时锁定补零宽度：止号位数，至少 3 位 */
export function padWidthFor(end: number): number {
  return Math.max(3, String(end).length)
}

/** 完整编号区间文本 */
export function rangeText(seg: CodeSegment): string {
  return `${formatSegmentCode(seg, seg.start)} ~ ${formatSegmentCode(seg, seg.end)}`
}

/**
 * 从若干编号段中选出本次应发号的段与序号：
 * 只取发号中且未领完的段，按登记时间先后（再按起始号）排序，领段内最小空号。
 */
export function pickIssue(
  segments: CodeSegment[]
): { segment: CodeSegment; number: number } | null {
  const choices = segments
    .map((segment) => ({ segment, number: nextIssueNumber(segment) }))
    .filter((item): item is { segment: CodeSegment; number: number } => item.number !== null)
  if (choices.length === 0) return null
  choices.sort((a, b) => {
    const byTime = a.segment.createdAt.localeCompare(b.segment.createdAt)
    return byTime !== 0 ? byTime : a.segment.start - b.segment.start
  })
  return choices[0]
}

export interface SegmentStatusView {
  type: 'success' | 'warning' | 'danger' | 'info'
  text: string
}

/** 卡片标签用的状态：领完是发号中段的终态，优先于「发号中」展示 */
export function statusView(seg: CodeSegment): SegmentStatusView {
  if (seg.status === 'returned') return { type: 'info', text: '已退回' }
  if (seg.status === 'disabled') return { type: 'warning', text: '已停用' }
  if (isExhausted(seg)) return { type: 'danger', text: '已领完' }
  return { type: 'success', text: '发号中' }
}
