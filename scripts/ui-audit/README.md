# 界面扫描脚本

每次改界面、发布网页试用版之前跑一遍。它把清单（`UI_CHECKLIST.md`）里能自动查的几项变成命令：

| 检查 | 查什么 | 判定 |
| --- | --- | --- |
| 被遮挡 | 每个按钮、文字、表格格子：取中心点和左右两个点，看最上层是不是它自己 | 左栏被遮挡必须是 0；其他页面的数量不能比 `baseline.json` 多 |
| 原生下拉框 | 页面上还剩几个没换成统一下拉的 `<select>` | 必须是 0 |
| 下拉框样式种类 | 按主题统计下拉触发框的高度、字号、字重、圆角、箭头有几种组合 | 只报告；现在是「客户模块 14 号／其他 13 号」×「32／36 高」几种 |
| 点击前后字体 | 逐个点开下拉、输入框、带弹出的按钮，再输入、再关闭，比较字号、字重、字体、行高、尺寸、字色 | 必须是 0 处变化（字色只允许变成主题主色） |
| 页面报错 | 扫描过程中的 JavaScript 报错 | 必须是 0 |

范围：19 个页面＋客户公海／查重／设置＋客户详情＋4 个新建弹窗／抽屉；粉色、橙色、小满三套主题；1440×900、1280×720、1440×640 三种窗口。

## 用法

```
python3 -I scripts/web-trial/rebuild.py --base 线上页面.html --old-ref 提交号 --out lai-web.html   # 先重建网页试用版
node scripts/web-trial/serve.cjs lai-web.html &
PLAYWRIGHT_CORE=/某处/node_modules/playwright-core node scripts/ui-audit/ui-audit.cjs
```

脚本需要网页试用版自带的示例数据（`LaiWebTrialDemoSeed`），所以对着它跑，不能对着本机数据服务跑。
`playwright-core` 装在仓库之外；Chromium 默认 `/opt/pw-browsers/chromium`，可用 `CHROMIUM` 改。

常用选项：`--themes pink` `--views 1440x900` `--routes customers,order-list` 缩小范围；`--no-font` 跳过最慢的点击前后字体检查；`--out DIR` 指定报告目录（里面的 `report.json` 有每一处的详情）。
完整选项见脚本开头的注释。退出码 0 通过、1 有新增问题、2 脚本出错。

## 基线

`baseline.json` 记录「已核实不算问题」的被遮挡数量，例如客户表格冻结在右边的操作列压住后面的列、折叠起来的客群子分组。
只有在确认现有的每一处都是已知、可接受时，才用 `--write-baseline` 更新它，并在 VALIDATION.md 里写明原因。

## 局限

- 在无头 Chromium 里跑，看不到真实浏览器里的系统下拉菜单、系统日期选择，这些仍要在真实浏览器里确认（清单 E20）。
- 被遮挡检查在窗口很矮时会把「滚动区里被裁掉的内容」误报成遮挡；发现时先把那个区域滚到底看一眼再下结论。
