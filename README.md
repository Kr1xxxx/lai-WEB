# 来财Lai

当前源码：**1.4.126 / build356**；当前正式安装记录：**1.4.125 / build355**。本仓库是去除业务数据的完整源码交接，不代表全部模块或像素验收完成。2026-10-06用户要求暂停收尾，先上传并整理现状。

- [开发规则（给开发人员和 agent，先读这份）](AGENTS.md)
- [现在做到哪、任务板](docs/HANDOFF.md)、[负责人的决定](docs/DECISIONS.md)、[功能验证清单](docs/features.json)
- [源码结构、运行方式与字段规则](ARCHITECTURE.md)
- [验证记录、复跑方法与未验范围](VALIDATION.md)

本地运行的客户与经营管理应用（网页版；Mac 应用已于 2026-10-17 移除，D-026）。此源码包包含当前客户列表、档案与联系人、客群、跟进，以及已有订单、工作台、日历和经营统计实现。功能完成和验收范围以实际交付为准，保留入口不代表深入功能已上线。

## 本地运行与测试

需要 Python 3.9+，以及含 `node:sqlite` 的 Node 24+。不需要安装 TradeOrderSystem，不需要历史源码或客户种子文件。不自动下载运行时或安装依赖。

```sh
node --version
npm run test:model
python3 -m unittest discover -s tests -p 'test_release_tools.py' -v
npm run test:e2e   # 需要另装 Playwright，见 AGENTS.md
```

页面由 `scripts/build.py` 的 `assemble_html()` 从 `src/` 拼成一个 HTML 文件；本地后端在 `backend/`。网页试用版的构建方法见 `scripts/web-trial/README.md`。

新数据目录从空库开始；已存在的 Lai 数据库按既有逻辑保留。正式导入仍禁用。测试使用临时隔离数据库，不需要客户数据。

## 源码导出与数据边界

```sh
python3 scripts/export-source.py --output ../lai-source-export
```

上述命令只导出既有允许清单源码，不包含本次另行整理的 PROGRESS.md、NEXT_STEPS.md、ARCHITECTURE.md、VALIDATION.md；再次导出会缺少这些交接文档，不能替代本次193文件上传包。需要重新交接时，须另行复制经审核的四份说明，并重新生成清单、核对链接与隐私。

导出采用源码允许清单。排除业务数据、数据库、附件、备份、历史构建、本机 baseline、采集截图和验收证据；拒绝符号链接、硬链接及可识别的高置信凭据。`.gitignore` 是第二层保护，不能替代导出扫描或上传前核对。

源码中的测试数据为合成夹具；字段目录夹具只有设置项名称，没有客户行。导出工具不能识别任意文字中的所有隐私，新增文件或手工修改后仍需审核。不要直接上传整个开发目录，不提交实际数据库、日志、认证信息或环境配置。

此步骤只生成本地源码包，不提交、推送、创建发布或安装应用。业务规则、公司共享部署及权限需要单独确认。

## 第三方依赖

邮件功能使用的开源库同样以本地 vendor 形式保留，构建时不联网：imapflow、nodemailer、postal-mime 及其依赖打包为 `vendor/mail-libs/mail-libs.cjs`（MIT／MIT-0 等，清单与全文见 `vendor/mail-libs/README.md`、`LICENSES.txt`），富文本编辑器 Squire（MIT，`vendor/squire`），HTML 净化库 DOMPurify（MPL-2.0 或 Apache-2.0，`vendor/dompurify`）。分发应用时需随附这些许可证，构建脚本已把它们复制进应用包。

SheetJS 0.20.3 以本地 vendor 形式保留，许可证见 `vendor/sheetjs-0.20.3/LICENSE`。Node 运行时由构建者自行提供；分发应用时应遵守对应 Node 发行版的许可证要求。代码库没有为项目自有代码新增开源许可，私人仓库不等于授权公开分发。
