<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { CodeRange, CollectPoint } from '@/types'
import GeoPointForm from '@/components/common/GeoPointForm.vue'
import { useStore } from '@/hooks/usePersistentStore'
import { pointStore } from '@/stores/pointStore'
import { recordStore } from '@/stores/recordStore'
import { codeRangeStore } from '@/stores/codeRangeStore'
import { issuedCount, remainingCount, summarizeRanges, type RangeStats } from '@/utils/codeRange'
import { uid } from '@/utils/id'

const pointState = useStore(pointStore)
const recordState = useStore(recordStore)
const codeRangeState = useStore(codeRangeStore)

const editingId = ref<string | null>(null)
const draft = reactive<CollectPoint>({
  id: '',
  name: '',
  longitude: 116.4,
  latitude: 39.9,
  altitude: 800,
  vegetation: '针阔混交林',
  substrate: '落叶层',
  companionTrees: '',
  collectDate: new Date().toISOString().slice(0, 10),
  collector: ''
})

const coordError = computed<string | null>(() => {
  const { longitude, latitude } = draft
  if (longitude < -180 || longitude > 180) return '经度必须在 -180 ~ 180 之间'
  if (latitude < -90 || latitude > 90) return '纬度必须在 -90 ~ 90 之间'
  if (longitude === 0 && latitude === 0) return '经纬度不能同时为 0'
  return null
})

watch(
  () => pointState.loaded,
  () => {
    if (!editingId.value && !draft.name && pointState.points.length > 0) {
      draft.name = ''
    }
  }
)

function resetDraft(): void {
  editingId.value = null
  draft.id = ''
  draft.name = ''
  draft.longitude = 116.4
  draft.latitude = 39.9
  draft.altitude = 800
  draft.vegetation = '针阔混交林'
  draft.substrate = '落叶层'
  draft.companionTrees = ''
  draft.collector = ''
  draft.collectDate = new Date().toISOString().slice(0, 10)
}

function edit(point: CollectPoint): void {
  editingId.value = point.id
  Object.assign(draft, point)
}

async function submit(): Promise<void> {
  if (!draft.name.trim()) {
    ElMessage.warning('请填写采集点名称')
    return
  }
  if (coordError.value) {
    ElMessage.warning(coordError.value)
    return
  }
  const row: CollectPoint = {
    ...draft,
    id: editingId.value ?? uid('pt'),
    name: draft.name.trim(),
    companionTrees: draft.companionTrees.trim(),
    collector: draft.collector.trim()
  }
  await pointStore.getState().save(row)
  ElMessage.success(editingId.value ? '采集点已更新' : '采集点已建立')
  resetDraft()
}

function recordsOf(pointId: string): number {
  return recordState.records.filter((record) => record.pointId === pointId).length
}

/** 主要基物：该采集点下条目最常见的基物（采集点自身基物优先） */
function mainSubstrate(point: CollectPoint): string {
  const list = recordState.records.filter((record) => record.pointId === point.id)
  if (list.length === 0) return point.substrate
  return point.substrate
}

async function remove(point: CollectPoint): Promise<void> {
  const count = recordsOf(point.id)
  if (count > 0) {
    ElMessage.error(`「${point.name}」下仍有 ${count} 条菌物条目，请先清理条目`)
    return
  }
  await ElMessageBox.confirm(`确认删除采集点「${point.name}」？`, '删除确认', { type: 'warning' })
  await pointStore.getState().remove(point.id)
  ElMessage.success('采集点已删除')
}

/* ---------- 编号段管理 ---------- */

function rangesOf(pointId: string): CodeRange[] {
  return codeRangeState.ranges.filter((range) => range.pointId === pointId)
}

function rangeStatsOf(pointId: string): RangeStats {
  return summarizeRanges(rangesOf(pointId))
}

function progressPercent(stats: RangeStats): number {
  return stats.total > 0 ? Math.round((stats.used / stats.total) * 100) : 0
}

/** 段状态标签：已退回 / 已停用 / 已领完 / 启用中 */
function rangeTag(range: CodeRange): { label: string; type: 'success' | 'warning' | 'info' } {
  if (range.status === 'returned') return { label: '已退回', type: 'info' }
  if (range.status === 'disabled') return { label: '已停用', type: 'warning' }
  if (range.next > range.end) return { label: '已领完', type: 'warning' }
  return { label: '启用中', type: 'success' }
}

const rangeDialogVisible = ref(false)
const rangeForm = reactive({ pointId: '', prefix: '', start: 1, end: 100, note: '' })

const rangePointName = computed(
  () => pointState.points.find((point) => point.id === rangeForm.pointId)?.name ?? ''
)

function openRangeDialog(point: CollectPoint): void {
  rangeForm.pointId = point.id
  rangeForm.prefix = ''
  rangeForm.start = 1
  rangeForm.end = 100
  rangeForm.note = ''
  rangeDialogVisible.value = true
}

async function submitRange(): Promise<void> {
  try {
    const range = await codeRangeStore.getState().register({ ...rangeForm })
    rangeDialogVisible.value = false
    ElMessage.success(`编号段 ${range.prefix}${range.start} ~ ${range.end} 已登记，可按段领号`)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '编号段登记失败')
  }
}

async function toggleRange(range: CodeRange): Promise<void> {
  try {
    const next = range.status === 'active' ? 'disabled' : 'active'
    await codeRangeStore.getState().setStatus(range.id, next)
    ElMessage.success(next === 'disabled' ? '编号段已停用，不再发号' : '编号段已重新启用')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '状态变更失败')
  }
}

async function returnRange(range: CodeRange): Promise<void> {
  const left = remainingCount(range)
  await ElMessageBox.confirm(
    `将把「${range.prefix}${range.start} ~ ${range.end}」段内未用的 ${left} 个号码整段退回；已发出的 ${issuedCount(range)} 个号留痕且不回收。退回后该段不再发号，确认退回？`,
    '整段退回',
    { type: 'warning' }
  )
  try {
    const count = await codeRangeStore.getState().returnUnused(range.id)
    ElMessage.success(`已整段退回 ${count} 个未用号码`)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '退回失败')
  }
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2 class="page-title">采集点管理</h2>
        <p class="page-sub">
          经纬度与海拔表单带格式校验；每个采集点展示条目数、主要基物与编号段领用进度，删除前校验下级条目数。
        </p>
      </div>
      <el-button @click="resetDraft">清空表单</el-button>
    </div>

    <el-card shadow="never" class="form-card">
      <template #header>{{ editingId ? '编辑采集点' : '新增采集点' }}</template>
      <GeoPointForm v-model="draft" with-meta />
      <div class="actions">
        <el-button type="primary" @click="submit">{{ editingId ? '保存修改' : '新增采集点' }}</el-button>
      </div>
    </el-card>

    <h3 class="section-title">采集点清单（{{ pointState.points.length }}）</h3>
    <div class="card-grid">
      <el-card v-for="point in pointState.points" :key="point.id" shadow="hover" class="point-card">
        <div class="point-head">
          <div>
            <div class="point-name">{{ point.name }}</div>
            <div class="muted">
              {{ point.longitude.toFixed(4) }}, {{ point.latitude.toFixed(4) }} · {{ point.altitude }} m
            </div>
          </div>
          <el-tag effect="plain" size="small">条目 {{ recordsOf(point.id) }}</el-tag>
        </div>
        <el-descriptions :column="1" size="small" border class="desc">
          <el-descriptions-item label="植被类型">{{ point.vegetation }}</el-descriptions-item>
          <el-descriptions-item label="主要基物">{{ mainSubstrate(point) }}</el-descriptions-item>
          <el-descriptions-item label="伴生树种">{{ point.companionTrees || '—' }}</el-descriptions-item>
          <el-descriptions-item label="采集日期">{{ point.collectDate }}</el-descriptions-item>
          <el-descriptions-item label="采集人">{{ point.collector || '—' }}</el-descriptions-item>
        </el-descriptions>
        <div class="range-block">
          <div class="range-head">
            <span class="range-title">编号段领用</span>
            <el-button size="small" text type="primary" @click="openRangeDialog(point)">登记编号段</el-button>
          </div>
          <template v-if="rangeStatsOf(point.id).total > 0">
            <el-progress :percentage="progressPercent(rangeStatsOf(point.id))" :stroke-width="10" />
            <div class="range-stats muted">
              已用 {{ rangeStatsOf(point.id).used }} / 共 {{ rangeStatsOf(point.id).total }} · 剩余
              {{ rangeStatsOf(point.id).remaining }}
              <template v-if="rangeStatsOf(point.id).returned > 0">
                · 已退回 {{ rangeStatsOf(point.id).returned }}
              </template>
            </div>
            <div v-for="range in rangesOf(point.id)" :key="range.id" class="range-row">
              <div class="range-line">
                <span class="mono">{{ range.prefix }}{{ range.start }} ~ {{ range.end }}</span>
                <el-tag :type="rangeTag(range).type" size="small" effect="plain">{{ rangeTag(range).label }}</el-tag>
              </div>
              <div class="range-line">
                <span class="muted">
                  已发 {{ issuedCount(range) }}
                  <template v-if="range.status === 'returned'"> · 退回 {{ range.returnedCount }}</template>
                  <template v-else> · 剩余 {{ remainingCount(range) }}</template>
                </span>
                <span class="range-ops">
                  <el-button v-if="range.status !== 'returned'" size="small" text @click="toggleRange(range)">
                    {{ range.status === 'active' ? '停用' : '启用' }}
                  </el-button>
                  <el-button
                    v-if="range.status !== 'returned' && remainingCount(range) > 0"
                    size="small"
                    text
                    type="warning"
                    @click="returnRange(range)"
                  >
                    整段退回
                  </el-button>
                </span>
              </div>
            </div>
          </template>
          <p v-else class="muted range-empty">尚未登记编号段，新建条目时需手动填写编号</p>
        </div>
        <div class="point-actions">
          <el-button size="small" @click="edit(point)">编辑</el-button>
          <el-button size="small" type="danger" plain @click="remove(point)">删除</el-button>
        </div>
      </el-card>
      <el-empty v-if="pointState.points.length === 0" description="暂无采集点" />
    </div>

    <el-dialog v-model="rangeDialogVisible" title="登记编号段" width="480px">
      <el-form label-width="90px">
        <el-form-item label="采集点">
          <el-input :model-value="rangePointName" readonly />
        </el-form-item>
        <el-form-item label="编号前缀" required>
          <el-input v-model="rangeForm.prefix" placeholder="如 BHS-2026-" />
        </el-form-item>
        <el-form-item label="起始号" required>
          <el-input-number v-model="rangeForm.start" :min="0" :precision="0" :controls="false" style="width: 100%" />
        </el-form-item>
        <el-form-item label="终止号" required>
          <el-input-number v-model="rangeForm.end" :min="0" :precision="0" :controls="false" style="width: 100%" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="rangeForm.note" placeholder="如 春季样线标签段" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="rangeDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitRange">登记</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.form-card {
  border-radius: 12px;
}
.actions {
  margin-top: 12px;
}
.point-card {
  border-radius: 12px;
}
.point-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 10px;
}
.point-name {
  font-size: 15px;
  font-weight: 600;
}
.desc {
  margin-bottom: 10px;
}
.range-block {
  border-top: 1px dashed #e8e2d6;
  padding-top: 10px;
  margin-bottom: 10px;
}
.range-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}
.range-title {
  font-size: 13px;
  font-weight: 600;
}
.range-stats {
  margin: 4px 0 8px;
}
.range-row {
  padding: 6px 0;
  border-top: 1px solid #f0ebdf;
}
.range-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  min-height: 24px;
}
.range-ops {
  display: flex;
  gap: 4px;
}
.range-empty {
  margin: 0;
}
.point-actions {
  display: flex;
  gap: 8px;
}
</style>
