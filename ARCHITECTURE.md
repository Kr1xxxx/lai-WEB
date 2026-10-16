# 来财源码与运行方式

当前源码1.4.126/build356，macOS本地应用。本文描述现有实现，不是后续公司共享架构已经落地。

## 运行链路

`Swift AppKit宿主 → WKWebView → 本机Node HTTP服务 → SQLite`

- Swift负责应用窗口、单实例协调、详情窗口及本地服务的启动／关闭、来源约束和原生桥接。
- Web UI由本地HTML／JavaScript／CSS构成；构建工具将项目资源组装为统一页面。不是依赖TOS程序的外部预览。
- 服务只绑定127.0.0.1，提供鉴权、读取／保存、备份与相关本地接口。
- SQLite为本机正式持久化；保存携带revision，拒绝过期快照覆盖。现有整体状态保存不等于公司多人完整协作。
- 不包含真实客户种子；新库从空数据开始。已有库不因无seed构建而重置。

## 目录职责

| 路径 | 内容 |
| --- | --- |
| `src/app.js` | 应用路由、客户／客群／详情交互与保存协调；当前仍较大，不因本次上传进行无关拆分 |
| `src/model.js` | 客户列表派生、客户业务数据基础模型；保留已有历史数据语义 |
| `src/customer-editor-ui.js` | 客户与联系人编辑表单、旧记录属性与身份保留 |
| `src/customer-detail-ui.js` | 客户详情展示与对应已有信息 |
| `src/customer-list-ui.js`、`customer-fields.js` | 列表绘制与字段目录。目录中有字段不代表对应外部服务上线 |
| `src/segments.js`、`modules.js` | 客群匹配及现有桶操作／查重等模型 |
| `src/nav-favorites.js` | 常用导航：哪些既有导航条目被设为常用及其顺序（存于`laiSettings.favoriteNav`，只存条目ID如`screen:active`、`route:order-list`、`mail:inbox`，不含业务字段）；从未设置过时为空。可设为常用的清单不在这里另抄，直接取自`rail-menu.js`，所以在菜单里加页面就自动能设为常用。依赖`rail-menu.js` |
| `src/rail-menu.js` | 左侧栏各菜单有哪些真实页面入口（悬停浮层、各菜单二级导航、可设为常用的清单都读这一份）；沟通有聊天记录、聊天模板两项（WhatsApp）；Leads 里还留着一个保留入口。不依赖其他模块，装载在`nav-favorites.js`之前 |
| `src/workbench.js` | 新界面（粉色、橙色主题）的工作台页面：纯函数 `markup(input, escape)` 生成整页 HTML，`mailRows` 生成未读邮件行；不碰 DOM、不发请求。小满主题的工作台仍在 `business-ui.js` 的 `renderDashboard()` 里。邮件列表由 `business-ui.js` 在页面画好后向 `ctx.mailSummary()` 要，再只更新对应几处 |
| `src/settings-hub.js` | 设置中心页面（设置 → 设置中心）：纯函数 `markup(info, escape)` 生成整页 HTML；`GROUPS` 列出每一项设置和它打开的真实页面或弹窗，不重复实现任何设置 |
| `src/orders-page.js` | 全部订单页面（新界面）：纯函数 `markup(input, escape)` 生成设计稿 Orders 的整页 HTML，`inPeriod` 按本月／上月／本季度／今年筛选；按钮和输入框沿用 `data-biz-*` 和 id，处理代码仍在 `business-ui.js`；小满主题仍用原来的订单表格 |
| `src/lead-model.js`、`lead-ui.js` | 线索：数据保存在`laiLeads`；model 负责校验、跟进记录、状态流转、查重提示、转为客户（新建客户档案走`model.js`的`upsertCustomer`，或关联已有客户）、列表筛选与计数，ui 只生成标记；页面事件和保存接在`business-ui.js`里 |
| `src/opportunity-model.js`、`opportunity-ui.js` | 商机：数据保存在`laiOpportunities`；model 负责校验、命名、阶段流转、看板汇总、分析和客户维度统计，ui 只生成看板、表单、菜单、分析页的标记；控制逻辑在`business-ui.js`。销售流程（每个流程一组阶段）保存在`laiOpportunityFlows`，没保存过时用内置默认流程；阶段的类别（进行中／赢单／输单）一律通过`stageOf(state, item)`按商机所在流程取，其他模块不要直接用`STAGES`。附件：商机里只存元数据（`attachments`），文件由本机服务存到 `attachments/opportunities/<商机>/`（`backend/opportunity-files.js`，上传请求体就是文件字节；读取只放行两层路径，图片内联、其余下载），备份靠 `fileUrl` 被现有的附件备份逻辑扫到；手动排序存在商机的 `sortRank`，`reorder` 只改这一列里需要变的商机；上传和删除的先后顺序（先存文件再存数据／先存数据再删文件）见 VALIDATION.md |
| `src/whatsapp-model.js`、`whatsapp-ui.js`、`whatsapp.css` | 沟通（WhatsApp，D-023）：model 负责电话转国际格式、wa.me 链接、模板变量、解析导出的聊天文件（含 .zip）、把聊天写进客户动态、导入记录与撤销、按电话和名字找客户、合并客户时聊天去重；ui 生成聊天记录页、聊天模板页、导入／记一笔／打开 WhatsApp 的抽屉和动态里的聊天条目（`create(ctx)` 控制器，按钮用 `data-chat-action`）。接线在 `app.js`：model 经一个适配层给页面用（找客户的参数和返回值不同），页面登记为 `LaiExtraPages.chats`／`chat-templates`。聊天放在客户的 `history`，导入记录放在 `laiChatImports`，没有改数据库结构 |
| `src/export-model.js`、`field-model.js` | 导出（把页面已经筛好的行变成表格、CSV、TSV）和通用自定义字段（客户、线索共用）的纯逻辑，暂时还没有页面入口 |
| `src/mail-ui.js`、`mail.css` | 邮件页：邮件／客户／下属页签、文件夹列表、阅读、独立的写信页（回复／转发／群发共用）、附件、草稿、邮箱绑定与设置、按客户查看往来邮件。只通过本机接口通信，界面不保存密码；收到的邮件 HTML 放在禁用脚本的隔离框里，远程图片不加载 |
| `src/mail-editor.js` | 写信用的富文本编辑器：开源编辑器 Squire 加一条工具栏；放进编辑器的 HTML（含引用的原邮件）先经 DOMPurify 净化，两个库缺失时退回纯文本 |
| `backend/mail-libs.js` | 加载 `vendor/mail-libs` 里打包好的第三方邮件库（imapflow、nodemailer、postal-mime） |
| `backend/mail-imap.js` | Zoho 服务器地址（固定主机）、输入校验、连接参数（正式使用一律 TLS）、登录验证、把库的错误换成界面能显示的说明 |
| `backend/mail-client.js` | 收信：imapflow 之上的薄封装——列出文件夹、搜索、取邮件头与全文、改标记、移动（都可一次多封）、探测连接是否还在；一次登录可以连续做多件事，连接留多久由 `mail-service.js` 决定 |
| `backend/mail-smtp.js` | 发信：由 nodemailer 生成邮件并经 TLS 465 提交，主机固定；全部收件人被拒时报错，部分被拒时照常发给其余人并报告被拒地址 |
| `backend/mail-mime.js` | 把 postal-mime 的解析结果整理成来财用的形状（地址、正文、附件、内嵌图片），以及文件名净化 |
| `backend/mail-service.js` | 邮件服务：文件夹列表与分页、搜索、阅读、待处理／未读标记、删除（移到服务器的已删除）、保存附件、发送、本机草稿、客户往来 |
| `backend/mail-account.js` | 邮箱绑定服务：先验证后保存、查询、重新验证、解绑；对外应答不含密码 |
| `src/team-model.js`、`team-ui.js` | 团队数据四类报表（客户资产、跟进情况、任务完成、订单业绩）：只用现有客户／跟进／任务／订单数据，按跟进人名称汇总；model 为纯统计，ui 只生成页面标记与明细列表；商机指标（新建商机数、赢单商机数、赢单金额）取自 `opportunity-model.js` 的数据，在 `team-model.js` 的 `opportunityStats` 里按月汇总，目标完成情况的「商机目标」页签和团队墙使用。 |
| `src/business-model.js`、`business-ui.js` | 现有订单、工作台、日历／待办和统计规则及界面。`window.LaiExtraPages[路由] = {title, render, afterRender, click, input, change, submit}` 是页面登记处：别的模块不用改这个文件就能加页面，点击、输入、提交会转给当前路由登记的页面；不能盖掉自带页面 |
| `src/customer-motion.js`及导航／建议组件 | 既有菜单、抽屉、页签、建议控件与局部动效 |
| `src/ui-tokens.css`及各CSS | 已有UI基础规则及各界面样式 |
| `backend/server.js`、`auth.js` | 本地路由、会话鉴权／来源保护 |
| `backend/storage.js`、`storage-path.js` | SQLite、修订号、兼容历史属性、备份、数据路径隔离 |
| `native/Sources/LaiNative/main.swift` | AppKit／WKWebView宿主及服务管理 |
| `native/Sources/LaiCore` | 单实例锁和运行策略 |
| `native/Sources/LaiCoreTests`、`LaiInstanceTests` | 原生策略与锁相关测试入口 |
| `scripts/build.py` | 本地Swift编译、资源组装、运行时复制与ad-hoc签名；禁止直接输出到Applications |
| `scripts/export-source.py` | 允许清单源码导出、链接拒绝、高置信凭据拦截；不是远程发布工具 |
| `scripts/*acceptance*`等 | 隔离验证工具，输出本地evidence；脚本存在不代表所有场景已经通过 |
| `tests` | Node模型／UI／后端测试及Python导出／构建边界测试；夹具是合成记录 |
| `vendor/sheetjs-0.20.3` | 本地第三方库及许可证 |
| `assets/AppIcon.icns` | 应用图标资源 |

## 与TOS的关系

项目按用户要求从既有TOS基础演进为独立来财；已有客户／订单数据语义和基础逻辑有历史沿用，不宣称完全从零编写。当前源码构建不需要本机TradeOrderSystem、历史baseline或真实业务种子，原TOS程序及数据保持独立，不随来财上传或修改。

## 当前字段与规则边界

公司基础字段按已确认的公司名、国家、来源、编号、阶段和标签执行，未恢复用户删除的小满字段。公司名、国家、来源的新建必填、历史缺失与未知属性保留有不同处理，不能借清理代码迁移正式旧客户。

现有订单包含编号、客户、国家、产品文本、金额／币种、已收款数值、六阶段、创建日期、跟进人文本、物流单号／承运商、备注、下一步和草稿。阶段为报价、定金、生产中、尾款、已发货、已完成。产品是文本，不是SKU数量单价明细表；跟进人文本不是员工账号。附件／日志未知属性保留不等于具有完整编辑或上传功能。

金额按币种分别统计，草稿不进入有效订单金额／阶段统计；现有已发货／已完成口径以全额计已收款。订单统计月份使用orderMonth或创建日期回退；旧订单修改日期与月份关系、新客户名自动建最小档案等规则仍待确认后才调整。

现有待办使用任务名称、日期、完成状态；日历合并订单创建日期、客户下次跟进和任务日期。没有新增提醒服务或真实个人／团队权限。

## 数据与上传范围

上传当前允许清单源码、测试、构建／导出脚本、图标、第三方库许可证和经过整理的交接说明。不上传正式／合成运行数据库、seed、业务附件、备份、应用包、原站采集截图、完整本地日志、凭据、原项目历史README或全部开发目录。

旧验收脚本可能依赖本地历史候选、采集参考或已被替代的验证时点。仓库刻意不复制真实采集和历史应用包；需要外部参考的专项检查必须另备不含业务数据的参考文件，不能只运行脚本就认为证据完整。基础构建及单元／集成的独立运行方式见[VALIDATION.md](VALIDATION.md)。

仓库保持私人，不新增项目自有代码开源许可；私人上传不等于授权对外发布。公司共享部署、公开发行、公证和外部账号接入另行决定。

## 邮件（2026-10-06 起）

`界面 → 本机接口 /api/mail-account/*、/api/mail/* → backend/mail-account.js、mail-service.js → mail-client.js（IMAP 993）／mail-smtp.js（SMTP 465）→ Zoho`

- 协议与解析不再自己实现：IMAP 用 imapflow，SMTP 与邮件生成用 nodemailer，解析用 postal-mime，富文本编辑用 Squire，HTML 净化用 DOMPurify。它们以 vendor 形式随源码保存（来源、版本、提交、许可证见 `vendor/mail-libs/README.md` 及各目录的 LICENSE），构建时不联网下载。库的日志（pino）与代理（socks）在打包时换成空实现。
- 写信是邮件页里的独立页面，不是抽屉。正在写信时切换文件夹或离开邮件页，会先把内容自动存成草稿；存不下来就留在写信页。群发没有草稿，离开前要再点一次确认放弃。
- 发出的邮件是 HTML 加一份纯文本；编辑器里粘贴的图片在服务端改成内嵌附件。草稿保存 HTML 和附件（附件单独一张表 `mail_draft_files`，列草稿箱时不读附件内容）。
- 这是应用唯一的对外连接。绑定了邮箱且没关掉「自动检查新邮件」时，应用开着就每分钟问一次收件箱概况（未读数、待处理数、最大编号），窗口不在前台或正在写信时不问；其余连接都由用户操作触发。不把邮件内容存到磁盘。页面在内存里留着最近读过的 40 封正文和两分钟内查过的往来邮件，再点同一封不用重新下载；关闭应用、解绑或换邮箱后就没有了。
- 邮箱连接复用：登录后连接保留 3 分钟，期间的操作不重新登录；同一个账号只留一条，同时发生的操作排队共用。闲了 20 秒以上再用之前先发 NOOP 探测，断了就重新登录；操作途中断开时，只读操作和改标记重新登录再做一次，移动邮件不重做（可能已经移过去了）。单次操作超过 2 分钟放弃并丢掉连接。解绑、换邮箱时立刻退出连接，之前开始的登录和重试一律作废。
- 收件箱概况不用 STATUS 命令（对正打开着的文件夹发 STATUS 不合规范）：在打开的收件箱里用搜索得到未读数、待处理数，用最后一封的编号加一当作“下一封新邮件的编号”。
- 会话串联只按邮件头里的编号（Message-ID、In-Reply-To、References）归并，不按主题猜。范围是当前这页列表加上阅读区「最近往来」里查到的邮件，不向服务器做专门的会话查询。
- 模板存在本机 `mail_templates` 表。存模板时去掉签名（写信时签名带 `lai-signature` 记号）和引用的原邮件。{{姓名}}、{{公司}} 只在恰好一位收件人且他是客户时当场替换；其余情况保留，发送前有未替换的会被拦住。群发仍由后端逐封替换。
- 把邮件「记到动态」是往客户档案的 `history` 里加一条 `type:'email'` 的记录（带 `mailRef`，同一封只记一次），走和其他客户资料改动相同的保存路径；不改下次跟进，也不算写过跟进。客户详情「动态 › 往来邮件」上方那块是从邮箱实时查的，不保存。
- 邮件页是三栏版面（参考常见桌面邮件客户端的布局，没有使用它们的代码）：左侧导航里的文件夹｜邮件列表（发件人、主题、正文预览）｜阅读区，阅读区右侧是联系人栏（对应的客户、最近往来）。窗口宽度不超过 1080px 时退回单栏；联系人栏在 1360px 以上默认显示，可手动开关。列表宽度可拖动，只在本次运行期间记住。
- 列表里的正文预览：取邮件头时顺带取每封正文的前 4096 字节（`BODY.PEEK[TEXT]<0.4096>`，不改已读状态），和邮件头拼成一封截断的邮件交给 postal-mime 解码，去掉引用的原文后取前 140 个字。服务器不支持或解析失败时预览为空，列表照常显示。
- 键盘快捷键只在邮件页、没有弹窗、焦点不在输入框时生效：↑↓ 或 J／K 切换，R／A／F 回复、回复全部、转发，S 待处理，U 未读，Delete 删除（仍要确认），C 写信，/ 搜索，Esc 收起阅读区。
- 凭据按用户决定以明文存放在本机 SQLite 的 `mail_account` 表（单行）。它不属于 `/api/data` 快照，不随 `/api/save` 改动，接口应答与界面都不含密码；但数据库文件和 `backups/` 里的备份文件都包含它，解绑只删除当前库里的记录，不清理旧备份。
- 连接主机不可由界面指定：中国站 `imap.zoho.com.cn`／`imappro.zoho.com.cn`、`smtp.zoho.com.cn`／`smtppro.zoho.com.cn`，国际站为不带 `.cn` 的同名主机，按站点与账号类型（个人／企业域名）选择。
- 界面文件夹与服务器的对应：收件箱＝INBOX 全部，未读邮件＝INBOX 未读，待处理邮件＝INBOX 里加了星标（\Flagged）的邮件，发件箱＝服务器的已发送文件夹。删除＝移到服务器的已删除文件夹。已发送、已删除文件夹先按服务器标记找，再按常见名称找。
- 发信后不往已发送文件夹另存副本，依赖 Zoho 自身保存已发送邮件；若用户在 Zoho 里关闭了该选项，发件箱里就看不到从来财发出的信。
- 草稿只存在本机 `mail_drafts` 表，不同步到 Zoho 的草稿箱，也不保存附件。
- 群发：`mail-service.js` 把一批拆成每位收件人单独一封（信封里只有他一个人），逐封发送并把结果写入本机 `mail_bulk` 表；封与封之间停 1.5 秒，一批最多 200 位，同一时间只跑一批。遇到发信登录失败或连续 5 封失败自动停止，可手动停止。应用在发送途中关闭的批次不会自动续发（无法确定最后一封是否已发出），下次打开时标为「已中断」。主题、正文里的 `{{姓名}}`（联系人姓名，没有则用客户名）、`{{公司}}` 在发送时替换。
- 发件人名称与签名存在 `mail_account` 记录里（`/api/mail-account/settings`），新写、回复、转发、群发时自动带上签名。
- 客户列表批量栏和客户详情页的「写邮件」由 `app.js` 转给邮件模块：一位客户打开写信，多位客户打开群发。
- 附件保存到用户的「下载」文件夹（文件名净化、不覆盖同名文件）并在访达中显示。
- 客户与邮件的对应只按邮箱地址匹配客户档案里的公司邮箱与联系人邮箱，不改动客户数据。
- 网页试用版没有本机服务，无法连接邮箱；它的数据替身对 `/api/mail-account` 返回 `available:false`，绑定与写信随之禁用。
- 测试用开关：数据目录被改到测试目录（`storage-path.js` 只允许系统临时目录下的 `lai-test-*`）时，`LAI_MAIL_TEST_ENDPOINTS` 可把连接指向本机回环地址上的假服务器，附件也改存到该测试目录；正式数据目录下不起作用。

## 保存方式（只传改动，D-020）
页面保存时，`persist()`（`src/app.js`）用 `src/model.js` 的 `snapshotState/diffState` 把新数据和上次保存的快照按文字比较，只把变了的客户、订单（含它们在各分栏里的先后顺序）和其它设置发给 `POST /api/save-changes`（`backend/storage.js` 的 `applyChanges`）。后端在同一个事务里先核对 `baseRevision`，套用后核对各表条数和订单顺序，对不上就整体撤销返回 422，页面随后改走整包的 `POST /api/save`（导入等整批改动也走它）。读取仍是整包 `GET /api/data`。
- 整包保存在写事务里先核对：服务器已有的顶层字段都要在、类型要对（`validateReplacement`），否则 400 `incomplete_save`。
- 版本冲突（409）时页面取最新数据，用 `model.js` 的 `rebaseChanges` 判断这次改动碰到的记录在别处有没有被改：没有就套到最新数据上重试一次，有就报出是哪些客户／订单。
- 一次删掉 5 个以上客户或订单前先做 `before-delete-*` 备份，备份失败就不删（503）。

## 备份（storage.js）
- 保存不再当场备份：`business_backup_revision`／`mail_backup_revision`（metadata 表）记着有没备份的改动，`queueBackup` 在上次备份满一小时时做一份，失败一分钟后重试；`close()` 不做备份，下次启动按记号重新排队；启动和每次备份前删掉残留的 `*.partial`；`GET /api/backup-status` 给页面看（`app.js` 的 `updateBackupNotice`）。
- 文件名：自动 `lai-data-*`、删除前 `before-delete-*`、手动 `manual-*`（`POST /api/manual-backup`）。分层保留见 `pruneBackups`（`before-delete-*` 不占分层名额，留 30 天）；手动备份不自动删除。备份文件做好后删旧备份、写 `backup-meta.json` 出错都不算失败（记录先留在内存里，下次读时再写）。
- 附件只认相对地址 `/attachments/...`；缺失的附件文件、读不懂的行都跳过并计数（`missingAttachments`、`invalidRows`）。
- `/api/health` 不做完整性检查和整包读取；完整性检查只在启动时做。数据目录的符号链接／硬链接检查只在启动时做一次（`laiDataDirectory({ scan })`，跳过 `backups/`）。

