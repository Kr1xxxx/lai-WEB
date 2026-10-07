# 来财Lai

当前源码：**1.4.127 / build357**。此版本包含邮件账号隔离与可靠保存、完整自动备份、实际收款与分币种统计、客户联系方式和关联校验，以及独立的销售订单编号规则设置。编号规则仅影响以后新建订单，历史编号保持不变；手工编号和多窗口保存继续校验重复与数据版本。

本次发布分支为 `claude/lai-reliability-numbering-1.4.127`，从 `main` 创建；推送该分支不代表已合入 `main`。仓库只包含源码、测试和文档，不含业务数据、邮箱凭据或打包运行时。安装与发布结果另行提供；自动测试和隔离原生验收不代表全部模块、像素或真实邮箱已获用户验收。

- [完整进度：已完成、未完成与限制](PROGRESS.md)
- [后续待办与工作方式](NEXT_STEPS.md)
- [源码结构、运行方式与字段规则](ARCHITECTURE.md)
- [验证记录、复跑方法与未验范围](VALIDATION.md)

独立的 macOS 客户与经营管理应用。此源码包包含当前客户列表、档案与联系人、客群、跟进，以及已有订单、工作台、日历和经营统计实现。功能完成和验收范围以实际交付为准，保留入口不代表深入功能已上线。

## 本地构建

需要 macOS 13.5+、支持 Swift 6 的 Xcode Command Line Tools、Python 3.9+，以及含 `node:sqlite` 的 Node 24+。不需要安装 TradeOrderSystem，不需要历史源码或客户种子文件。不自动下载运行时或安装依赖。

```sh
node --version
npm run test:model
python3 -m unittest discover -s tests -p 'test_release_tools.py' -v
python3 scripts/build.py --node-runtime "$(command -v node)"
npm test
```

输出 `dist/来财Lai.app`，采用本地 ad-hoc 签名，不属于 Apple 公证发行。`--output` 可以指定其他本地构建路径，禁止直接构建到 `/Applications`。

构建包没有 `trade-order-data.json`。新数据目录从空库开始；已存在的 Lai 数据库按既有逻辑保留，不因空数据构建而重置。正式导入仍禁用。测试使用临时隔离数据库，不需要客户数据。

## 源码导出与数据边界

```sh
python3 scripts/export-source.py --output ../lai-source-export
```

上述命令按工具自身允许清单导出，不包含全部仓库交接文档或新增测试夹具，不能替代完整仓库。重新交接时，须核对所需文档、测试夹具与实际文件清单，并检查链接与隐私。

导出采用源码允许清单。排除业务数据、数据库、附件、备份、历史构建、本机 baseline、采集截图和验收证据；拒绝符号链接、硬链接及可识别的高置信凭据。`.gitignore` 是第二层保护，不能替代导出扫描或上传前核对。

源码中的测试数据为合成夹具；字段目录夹具只有设置项名称，没有客户行。导出工具不能识别任意文字中的所有隐私，新增文件或手工修改后仍需审核。不要直接上传整个开发目录，不提交实际数据库、日志、认证信息或环境配置。

此步骤只生成本地源码包，不提交、推送、创建发布或安装应用。业务规则、公司共享部署及权限需要单独确认。

## 第三方依赖

邮件功能使用的开源库同样以本地 vendor 形式保留，构建时不联网：imapflow、nodemailer、postal-mime 及其依赖打包为 `vendor/mail-libs/mail-libs.cjs`（MIT／MIT-0 等，清单与全文见 `vendor/mail-libs/README.md`、`LICENSES.txt`），富文本编辑器 Squire（MIT，`vendor/squire`），HTML 净化库 DOMPurify（MPL-2.0 或 Apache-2.0，`vendor/dompurify`）。分发应用时需随附这些许可证，构建脚本已把它们复制进应用包。

SheetJS 0.20.3 以本地 vendor 形式保留，许可证见 `vendor/sheetjs-0.20.3/LICENSE`。Node 运行时由构建者自行提供；分发应用时应遵守对应 Node 发行版的许可证要求。代码库没有为项目自有代码新增开源许可，私人仓库不等于授权公开分发。
