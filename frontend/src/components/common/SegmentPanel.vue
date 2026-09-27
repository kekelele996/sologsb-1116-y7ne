<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { CodeSegment } from '@/types'
import { useStore } from '@/hooks/usePersistentStore'
import { segmentStore, SegmentError } from '@/stores/segmentStore'
import {
  availableCount,
  formatSegmentCode,
  issuedCount,
  nextIssueNumber,
  rangeText,
  segmentSize,
  statusView
} from '@/utils/segment'

const props = defineProps<{ pointId: string }>()

const segmentState = useStore(segmentStore)

const segments = computed<CodeSegment[]>(() =>
  segmentState.segments.filter((seg) => seg.pointId === props.pointId)
)
const liveSegments = computed(() => segments.value.filter((seg) => seg.status !== 'returned'))

const totalIssued = computed(() =>
  liveSegments.value.reduce((sum, seg) => sum + issuedCount(seg), 0)
)
const totalAvailable = computed(() =>
  liveSegments.value.reduce((sum, seg) => sum + availableCount(seg), 0)
)

const showRegister = ref(false)
const draft = reactive({ prefix: '', start: 1, end: 100, note: '' })

const previewCode = computed(() => {
  const prefix = draft.prefix.trim()
  const end = Number(draft.end)
  if (!prefix || !Number.isInteger(end) || end <= 0) return ''
  const width = Math.max(3, String(end).length)
  const start = Number(draft.start)
  const sample = Number.isInteger(start) && start > 0 ? start : 1
  return `${prefix}${String(sample).padStart(width, '0')} … ${prefix}${String(end).padStart(width, '0')}`
})

function openRegister(): void {
  draft.prefix = ''
  draft.start = 1
  draft.end = 100
  draft.note = ''
  showRegister.value = true
}

async function submitRegister(): Promise<void> {
  try {
    const seg = await segmentStore.getState().register({
      pointId: props.pointId,
      prefix: draft.prefix,
      start: Number(draft.start),
      end: Number(draft.end),
      note: draft.note
    })
    ElMessage.success(`编号段已登记：${rangeText(seg)}`)
    showRegister.value = false
  } catch (err) {
    if (err instanceof SegmentError) ElMessage.warning(err.message)
    else throw err
  }
}

async function toggleStatus(seg: CodeSegment): Promise<void> {
  if (seg.status === 'active') {
    await ElMessageBox.confirm(
      `停用后该段不再发号，已发出的号不受影响。确认停用「${rangeText(seg)}」？`,
      '停用确认',
      { type: 'warning' }
    )
    await segmentStore.getState().setStatus(seg.id, 'disabled')
    ElMessage.success('编号段已停用')
  } else if (seg.status === 'disabled') {
    await segmentStore.getState().setStatus(seg.id, 'active')
    ElMessage.success('编号段已重新启用')
  }
}

async function returnSegment(seg: CodeSegment): Promise<void> {
  await ElMessageBox.confirm(
    `整段退回后「${rangeText(seg)}」不再占用编号，同前缀可重新登记新段。确认退回？`,
    '整段退回确认',
    { type: 'warning' }
  )
  try {
    await segmentStore.getState().returnSegment(seg.id)
    ElMessage.success('未用编号段已整段退回')
  } catch (err) {
    if (err instanceof SegmentError) ElMessage.warning(err.message)
    else throw err
  }
}

function nextCode(seg: CodeSegment): string {
  const n = nextIssueNumber(seg)
  return n === null ? '—' : formatSegmentCode(seg, n)
}

function progressPercent(seg: CodeSegment): number {
  return Math.round((issuedCount(seg) / segmentSize(seg)) * 100)
}
</script>

<template>
  <div class="segments">
    <div class="seg-summary">
      <span class="seg-summary-title">编号段（{{ liveSegments.length }}）</span>
      <span class="muted">已发 {{ totalIssued }} 个 · 剩余 {{ totalAvailable }} 个</span>
      <el-button size="small" text type="primary" class="register-btn" @click="openRegister">
        登记编号段
      </el-button>
    </div>

    <el-empty v-if="segments.length === 0" :image-size="56" description="尚未登记编号段，新条目无法领号" />

    <div v-for="seg in segments" :key="seg.id" class="seg-row">
      <div class="seg-row-head">
        <span class="seg-range mono">{{ rangeText(seg) }}</span>
        <el-tag :type="statusView(seg).type" size="small" effect="plain">{{ statusView(seg).text }}</el-tag>
      </div>
      <el-progress
        :percentage="progressPercent(seg)"
        :stroke-width="8"
        :status="availableCount(seg) === 0 && seg.status !== 'returned' ? 'exception' : undefined"
      />
      <div class="seg-meta muted">
        已用 {{ issuedCount(seg) }} / {{ segmentSize(seg) }} · 剩余 {{ availableCount(seg) }}
        <template v-if="seg.status === 'active' && availableCount(seg) > 0">
          · 下一编号 <span class="mono">{{ nextCode(seg) }}</span>
        </template>
      </div>
      <div v-if="seg.note" class="seg-note muted">{{ seg.note }}</div>
      <div class="seg-actions">
        <el-button
          v-if="seg.status === 'active'"
          size="small"
          plain
          @click="toggleStatus(seg)"
        >
          停用
        </el-button>
        <el-button
          v-else-if="seg.status === 'disabled'"
          size="small"
          type="success"
          plain
          @click="toggleStatus(seg)"
        >
          启用
        </el-button>
        <el-button
          v-if="seg.status === 'active' && issuedCount(seg) === 0"
          size="small"
          type="warning"
          plain
          @click="returnSegment(seg)"
        >
          整段退回
        </el-button>
      </div>
    </div>

    <el-dialog v-model="showRegister" title="登记编号段" width="460px" append-to-body>
      <el-form label-width="84px">
        <el-form-item label="所属采集点">
          <span class="muted">当前采集点</span>
        </el-form-item>
        <el-form-item label="前缀" required>
          <el-input v-model="draft.prefix" placeholder="原样拼接序号，如 BHS-2026-" maxlength="24" />
        </el-form-item>
        <el-form-item label="起止号" required>
          <div class="range-inputs">
            <el-input-number v-model="draft.start" :min="1" :step="1" :controls="false" />
            <span class="range-sep">至</span>
            <el-input-number v-model="draft.end" :min="1" :step="1" :controls="false" />
          </div>
        </el-form-item>
        <el-form-item label="编号预览">
          <span class="mono preview">{{ previewCode || '填写前缀与起止号后预览' }}</span>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="draft.note" placeholder="如 秋季样线领用段（可选）" maxlength="40" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showRegister = false">取消</el-button>
        <el-button type="primary" @click="submitRegister">登记</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.segments {
  border-top: 1px dashed #e0d8c8;
  padding-top: 10px;
  margin-top: 4px;
}
.seg-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.seg-summary-title {
  font-size: 13px;
  font-weight: 600;
}
.register-btn {
  margin-left: auto;
}
.seg-row {
  padding: 8px 10px;
  margin-bottom: 6px;
  background: #faf7f1;
  border: 1px solid #eee6d8;
  border-radius: 8px;
}
.seg-row-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}
.seg-range {
  font-size: 13px;
  font-weight: 600;
}
.seg-meta {
  margin-top: 4px;
  line-height: 1.6;
}
.seg-note {
  margin-top: 2px;
}
.seg-actions {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}
.range-inputs {
  display: flex;
  align-items: center;
  gap: 8px;
}
.range-sep {
  color: #7f8d82;
}
.preview {
  color: #3f7a4d;
}
</style>
