/** 编号段状态：发号中 / 已停用（暂不发号）/ 已整段退回（未用号交回） */
export type SegmentStatus = 'active' | 'disabled' | 'returned'

/**
 * CodeSegment 编号段
 *
 * 采集队出发前登记的一段编号：固定前缀 + 起止序号。
 * 新建条目时按段内顺序领取序号；已发出的序号（含对应条目后来作废的）
 * 永久保留在 issuedNumbers 中，不会再次发放。
 */
export interface CodeSegment {
  id: string
  /** 所属采集点 */
  pointId: string
  /** 编号前缀，原样拼接序号，如 BHS-2026- */
  prefix: string
  /** 起始序号 */
  start: number
  /** 截止序号 */
  end: number
  /** 序号补零宽度，登记时按止号位数锁定（至少 3 位） */
  padWidth: number
  /** 已发出的序号，含对应条目已作废的号，永不复用 */
  issuedNumbers: number[]
  status: SegmentStatus
  /** 登记时间（ISO 字符串），多个段可发号时按登记先后领取 */
  createdAt: string
  /** 备注（如领用人、领用批次） */
  note: string
}
