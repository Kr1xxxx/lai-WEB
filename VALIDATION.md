# 验证记录与复跑方法

记录日期2026-10-06。产品源码此次上传没有变化，因此未为上传重复已有通过的业务测试。以下区分已有执行记录、可复跑入口和未验内容。

## 当前126的记录

| 验证 | 开发执行 | 独立审核 | 覆盖限制 |
| --- | --- | --- | --- |
| Node单元 | 335通过，0失败，0跳过 | 同335通过 | 单元不是原生、整模块或像素验收 |
| 隔离集成 | 10分组通过 | 同10分组通过 | 合成SQLite保存／备份／重启、鉴权、路径及签名等；不是公司多人权限 |
| Python发行工具 | 6通过 | 6通过 | 含模拟构建边界，不是完整真实release编译证据 |
| 实际release | Swift构建并strict签名通过，无seed／TOS访问 | 检查候选strict签名、源码组装HTML逐字节一致；未重跑完整release | 本地ad-hoc签名，不是Apple公证或用户验收 |
| 原生拖动类 | 同生产类125红5／保护1；126绿6 | 独立编译真实类6绿；未重跑旧125 | 命中与消息路由，非真实鼠标拖动 |
| 筛选局部视觉 | 600×180输出、三层源阴影／右侧箭头断言通过；28 DOM帧 | 原样专项复跑及截图核对通过 | disable-gpu浏览器；不是全页像素／GPU连续呈现 |
| 候选原生流程 | 合成库主／详情、搜索编辑、普通／高级筛选、Escape、退出；data／revision保持 | 核查开发前后数据和AX／截图记录 | 部分AX为增量；非审核者独立原生业务操作；搜索setValue不是物理点击证明 |

独立npm三个保护器各41进程、视觉各2进程PID匹配，正式路径／TOS／app-seed拦截记录为空。第一次候选视觉启动因guard拒绝app-seed存在检查而失败，原记录保留；后来测试先初始化合成库后通过，没有放松保护。

原生业务运行未传完整Node FS guard，不声称native全文件系统零访问；其隔离来自canonical LAI_DATA_DIR、启动前合成SQLite初始化、无seed运行策略和退出清理。此前125的原生成功订单保存／退出重启及长内容实际保存／重启属于另外限定批次，不是126整模块验收。

## 独立基础复跑

需要macOS 13.5+、支持Swift6的Xcode Command Line Tools、Python3.9+和含node:sqlite的Node24+。不自动安装这些工具，不需要TOS。

```sh
node --version
npm run test:model
python3 -m unittest discover -s tests -p 'test_release_tools.py' -v
python3 scripts/build.py --node-runtime "$(command -v node)"
npm test
python3 scripts/native-drag-acceptance.py
```

`npm test`的集成需要先构建的dist/来财Lai.app或设置LAI_ACCEPTANCE_APP指向指定测试候选。构建无真实seed。不要运行正式安装包来代替测试候选，不要将输出直接设到Applications。

原生类测试单独编译生产类和测试入口，不启动正式业务后端。单独编译现有startup闭包会显示lastFailure并发捕获警告，当前作为既有警告保留，不伪装成已经处理。

## 可用专项入口

| 入口 | 目的 |
| --- | --- |
| `scripts/customer-review-fixes-acceptance.mjs` | 联系人／新建必填原问题回归 |
| `scripts/customer-hybrid-identity-acceptance.mjs` | 混合历史联系人身份与属性保留 |
| `scripts/customer-date-preservation-acceptance.mjs` | 编辑历史日期保留 |
| `scripts/customer-long-save-acceptance.mjs` | 已有长字段、跟进与客群规则保存和重启 |
| `scripts/order-workflow-acceptance.mjs` | 现有订单编辑／取消／编号冲突／归档恢复等 |
| `scripts/task-workflow-acceptance.mjs` | 现有任务／日历流程 |
| `scripts/analysis-workflow-acceptance.mjs` | 现有统计／月份／币种／空态及跳转 |
| `scripts/public-visual-comparison.mjs` | 公共布局与DOM轨迹、可选源阴影与箭头断言 |

这些脚本有独立的APP／EVIDENCE环境变量，先读脚本开头与夹具。旧脚本并非全部在126最新运行过，可能使用DOM赋值／合成API准备场景；不是全程手工输入或真实业务数据。使用app-seed保护器时，未预初始化合成库的旧脚本可能被安全拦截；不要删除保护器或改成读取正式seed来让测试通过。

公共视觉探针的源比较需额外提供`source-geometry.json`；此仓库不上传原站采集。LAI_ASSERT_FILTER_REFERENCE=1才启用源阴影／箭头断言。当前脚本即使关闭源断言，也会读取参考JSON；缺失会以ENOENT失败，不能算成功。需先提供不含业务数据的参考JSON，关闭断言时也不能宣称源一致。

## 不在这次上传验收内

实际鼠标拖动、普通Tab完整原生组合、全页同状态同DPR像素、连续GPU观感、所有历史参考脚本最新全跑、公司多账号并发权限、正式数据导入、真实图片附件、外部服务和用户日常业务验收。上传时另核对文件清单／哈希、仓库私人状态及远端内容；上传成功不扩大产品验收结论。

## 2026-10-06 经营统计模型增量（A5，仅模型层）

- 范围：把经营统计页的月度计算（阶段数量／比例、客户贡献、金额概览）抽成`business-model.js`的`monthlyAnalysis`，页面改为调用它；口径不变（草稿排除、月份取orderMonth否则createdAt、按币种分别统计、不换汇、不增指标）。
- 修正：客户贡献此前未按金额概览同样规整币种（如`usd`、带空格的币种会拆成另一行），金额也未同样按不小于0处理；现两处一致。新订单经`upsertOrder`本来就是大写币种，此项只影响历史数据。
- 新增测试：模型2项（用手算的合成订单核对月份规则、草稿、币种分组与排序、阶段数量和比例、空月份／仅草稿／无效月份）、页面1项（在旧代码上失败、新代码通过）。
- 执行环境：Linux、Node 22.22.0；`npm run test:model` 338通过、0失败；Python发行工具6项通过。
- 未做：该环境没有macOS／Xcode／Chrome，未运行隔离集成、`analysis-workflow-acceptance.mjs`等浏览器专项、原生构建与实际界面审核；A5的整模块独立审核和用户验收仍未完成。

## 2026-10-06 A5 分支复核记录（作者自查，不是独立审核）

对象：`claude/a5-analysis-model`提交`094bc95`相对其父提交`2c5a9f0`；源码只有`business-model.js`和`business-ui.js`有变化。以下由实现者在同一会话内完成，独立审核仍需另行指定，不得据此记为已审核。

| 检查 | 结果 |
| --- | --- |
| 干净合成数据（大写三位币种、非负数字金额、已知阶段）：旧页面与新页面对比 | 300组夹具×4个月份共1200页，HTML逐字节一致 |
| 历史异常合成数据（小写／带空格／缺失币种、负数／非数字／无穷金额、未知阶段）：同一对比 | 第一组种子1200页中731页不同，第二组种子1200页中668页不同；差异全部只在「客户贡献」表，页面其余部分（金额概览、阶段分布）无差异 |
| 不变量：每个币种的客户贡献订单数与金额之和等于金额概览 | 旧代码在每个有差异的页面都不满足；新代码1200页全部满足；有差异的页面与旧代码不满足不变量的页面完全重合（1200／1200） |
| 手算夹具 | 新增模型测试2项、页面测试1项，页面测试在旧代码上失败（2行对1行）、新代码通过 |

代码阅读中的既有行为，本次未改：阶段不在六个已知阶段内的订单计入分母但不进任何阶段条，比例之和可小于100%；这是否算问题需要你确认口径。

局限：对比脚本在会话临时目录，没有提交进仓库；没有浏览器，未做页面实际渲染与点击审核；不含原生。

## 2026-10-06 后端持久化复核记录（A2／A3在Linux可运行的部分）

环境：Linux x86_64、Node 22.22.0（`node:sqlite`可用，不是构建脚本要求的Node 24）。在会话临时目录用仓库的`backend/*.js`、`build.py`的`assemble_html()`和本机Node组装了与应用`Contents/Resources`同结构的目录（没有Swift原生部分），用独立的临时SQLite启动服务。

- `scripts/integration-test.mjs`的临时副本（只去掉原生哈希和codesign两处macOS步骤）通过：鉴权、来源拒绝、路径隔离、客户／订单保存、旧修订拒绝、重启读取、手动备份、外部路由不存在。副本末尾的输出文字提到原生签名，实际没有执行该检查。
- 另写的合成数据脚本全部通过：①40个客户、40笔订单含任意嵌套未知字段、特殊字符串、长字符串往返读取完全一致；②旧、缺失、非法`baseRevision`分别返回409／428，数据与修订号不变；③重复订单ID、缺订单ID的保存失败后整体回滚、修订号不变；④两个客户端基于同一修订并发保存，恰好一个成功一个409；⑤重启后数据与修订号完全一致；⑥订单归档再恢复后全部字段（含未知字段）不变。

未验：全部页面流程（新建、联系人、跟进、客群、筛选、列表／详情、草稿保留、保存失败提示）、整模块页面审核和原生验收。

## 浏览器类验收脚本的可移植性（盘点）

脚本目录共114项，其中100个脚本写死`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，103个从构建好的`Contents/Resources`读取资源。Linux环境没有Chrome；尝试通过npm获取Chromium包时，registry返回403（安全策略禁止），因此未继续寻找其他来源。要让这些脚本在Linux或其他路径运行，需要把Chrome路径改为可由环境变量覆盖（默认值保持不变），这个机械改动尚未做，也无法在本环境验证。

