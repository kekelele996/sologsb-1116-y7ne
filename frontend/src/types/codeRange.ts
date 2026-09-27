/** 编号段状态：active 启用中 / disabled 已停用 / returned 已整段退回 */
export const RANGE_STATUSES = ['active', 'disabled', 'returned'] as const
export type RangeStatus = (typeof RANGE_STATUSES)[number]

/** CodeRange 编号段：采集点领取采集编号的号源 */
export interface CodeRange {
  id: string
  pointId: string
  /** 编号前缀，如 BHS-2026- */
  prefix: string
  /** 起始号（含） */
  start: number
  /** 终止号（含） */
  end: number
  /** 下一个待领号码，只增不减，保证已发出的号不再使用 */
  next: number
  status: RangeStatus
  /** 整段退回时退回的未用号码数量 */
  returnedCount: number
  createdAt: string
  /** 整段退回日期 */
  returnedAt?: string
  note: string
}

/** IssuedCode 已发号台账：号码一经发出即留痕，条目作废也不回收 */
export interface IssuedCode {
  id: string
  rangeId: string
  pointId: string
  prefix: string
  /** 段内序号 */
  num: number
  /** 完整编号，如 BHS-2026-003 */
  code: string
  /** 领取该号的条目 */
  recordId: string
  /** inuse 在用 / voided 条目已作废（号码仍保留不回收） */
  status: 'inuse' | 'voided'
  issuedAt: string
  voidedAt?: string
}
