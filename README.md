# 野生菌采集鉴定图谱（gbfungiguide）

面向蘑菇野外调查爱好者与地方菌物名录整理者，把「采集点 → 形态描述 → 孢子印 → 菌褶/菌管着生方式 → 鉴定结论」整理成可对照的图谱条目，解决形态特征记不全、描述口径不一、鉴定结论缺乏依据留痕的问题。**纯前端单页应用**，数据全部保存在浏览器 IndexedDB，不依赖任何后端服务或外部接口。

> 免责声明：本工具仅用于采集记录与形态整理，**内容不可作为食用依据**；鉴定须与权威图鉴和专业人员复核。

## 一、Docker 一键启动（推荐）

```bash
cp .env.example .env      # 首次启动先复制环境变量文件
docker compose up -d --build
```

启动后访问：<http://localhost:21816>

```bash
docker compose ps        # 查看容器状态
docker compose logs -f   # 查看日志
docker compose down      # 停止并移除容器（数据在浏览器本地）
```

`.env` 可调：

```
COMPOSE_PROJECT_NAME=gbfungiguide
FRONTEND_PORT=21816
```

## 二、技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | Vue 3（Composition API） |
| 语言 | TypeScript（`vue-tsc` 类型检查零错误） |
| UI 组件库 | Element Plus |
| 状态管理 | Zustand（`zustand/vanilla` createStore + Vue 响应式桥接） |
| 路由 | Vue Router 4（History 模式，nginx `try_files` 回落） |
| 构建 | Vite 6 |
| 本地存储 | IndexedDB（Dexie 封装，含 `schemaVersion` 与升级迁移） |
| 部署 | 多阶段 Dockerfile：`node:20-alpine` 构建 → `nginx:alpine` 托管 |

## 三、本地开发

```bash
cd frontend
npm install
npm run dev        # http://localhost:21816
npm run build      # 类型检查 + 生产构建
```

## 四、目录结构

```
sologsb-1116/
├── docker-compose.yml          # 顶层 name: gbfungiguide，无 version 字段
├── .env.example                # COMPOSE_PROJECT_NAME / FRONTEND_PORT
├── frontend/
│   ├── Dockerfile              # 多阶段构建，nginx 阶段 chmod -R a+rX 静态资源
│   ├── nginx.conf              # try_files 前端路由回落 + gzip
│   ├── public/favicon.svg
│   └── src/
│       ├── types/              # record.ts / spore.ts / point.ts / segment.ts / identify.ts / index.ts
│       ├── stores/             # recordStore / sporeStore / pointStore / segmentStore / identifyStore（Zustand）
│       ├── components/common/  # SporePrintSwatch / TraitsSummary / GillAttachmentTag / GeoPointForm / SegmentPanel
│       ├── hooks/              # usePersistentStore / useCandidateMatch
│       ├── pages/              # AtlasPage / RecordDetailPage / PointsPage / IdentifyPage / ComparePage
│       ├── router/index.ts
│       └── utils/              # spore.ts / export.ts / id.ts / segment.ts
```

## 五、数据模型与存储

| 模型 | 说明 | Dexie 表 |
| --- | --- | --- |
| FungusRecord 菌物条目 | 采集编号（按编号段自动领取）、暂定名、菌盖（直径/形状/边缘/质地）、菌肉厚度与变色反应、着生方式、菌褶密度、菌柄、菌环菌托、气味、关联树种 | `records` |
| SporePrint 孢子印 | 印色、印形、获取时长、观察日期、样本干湿度 | `spores` |
| CollectPoint 采集点 | 地点名、经纬度、海拔、植被类型、基物、伴生树种、日期、采集人 | `points` |
| CodeSegment 编号段 | 所属采集点、前缀、起止序号、补零宽度、已发序号、状态（发号中/已停用/已退回） | `segments` |
| IdentifyLog 鉴定结论 | 结论学名、依据、参考图鉴与页码、置信度、是否待复核、复核人 | `identifies` |

- 数据库名 `gbfungiguide`，`meta` 表保存 `schemaVersion`；
- `version(2)` 升级迁移会为历史条目补齐「菌肉变色反应」默认值（不变色）；
- `version(3)` 新增编号段表，老编号按「前缀 + 序号」自动补建为编号段并回填条目的 `segmentId`：历史已发号不回收，段内空号仍可继续顺序领取；
- 编号段规则：
  - 出发前登记前缀与起止号，同一前缀的区间不能重叠（已退回的段不占号）；
  - 新建条目在一个 Dexie 事务内领号：按段登记先后取「发号中且未领完」的段，发放段内最小空号；
  - 已发出的号保存在段的 `issuedNumbers` 中，条目作废（删除）后**号也不回收、不再发放**；
  - 已停用、已领完、已退回的段不再发号；零发出的段可以**整段退回**，退回后同前缀可重新登记新段；
- 数据仅存于浏览器本地，容器无状态、不挂载命名卷。

## 六、主要页面

| 路由 | 功能 |
| --- | --- |
| `/atlas` | 图谱总览：网格卡片展示菌盖形态要点、孢子印色块与鉴定状态，按印色/着生方式筛选并新建条目 |
| `/atlas/:id` | 条目详情：形态描述分区折叠、孢子印观察登记、采集点编辑（含坐标校验）、鉴定留痕 |
| `/points` | 采集点管理：经纬度格式校验、编号段登记（前缀/起止号/同前缀重叠校验）、领用进度条与已用/剩余统计、停用启用、未用段整段退回、删除前校验下级条目与编号段 |
| `/identify` | 鉴定工作页：左侧勾选形态特征与印色，右侧实时给出候选名录排序，确认后落鉴定结论 |
| `/compare` | 条目对比：并排最多 3 条，逐项对照菌盖/菌褶菌管/孢子印差异并高亮 |

## 七、候选排序规则

- 权重：着生方式 26、孢子印 22、菌盖形状 12、表面质地 10、菌褶密度 10、菌盖边缘 8、菌肉反应 8、关联树种 4；
- 印色与条目着生方式若属于该印色的先验组合（如白色↔离生/弯生），计半分；
- 排序先比总分，总分相同则优先展示着生方式一致的条目。
