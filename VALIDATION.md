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
