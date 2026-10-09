# 网页试用版的重建与检查

网页试用版是一份发布出去的单页 HTML，用来在浏览器里试用来财Lai。它等于应用的那份单页
（`src/template.html` 加 `src/` 下各文件），再加上几段**只存在于已发布页面、不在仓库里**的内容：
用浏览器本地存储代替本机数据服务的「数据替身」、外层滚动容器样式。（「测试数据」面板、示例邮箱、示例数据已在仓库里，见下面的文件表。）

**两种做法。** 现在可以只靠仓库做出整页：`python3 -I scripts/web-trial/build.py --out lai-web.html`（发布用 `--publish`，输出
去掉页面外壳的形式）。数据替身在 `data-shim.js`，第三方脚本直接内嵌，示例邮箱、示例数据、测试数据面板一并放好。
它和下面「以线上页面为底」的旧做法的差别：不带外层滚动容器（`100vw` 换成 `var(--lai-w)`、1100px 下限），页面按浏览器宽度排版。
线上已经有页面、只想换改过的代码块时，仍然可以用 `rebuild.py`。

## 每次发布前

1. **先读线上最新版本，存成文件。** 可能有别的会话刚发布过；用旧底版发布会覆盖对方的改动。
2. 确认线上页面是从哪个提交构建的（看上一次发布时记下的提交号；不确定时试 `main` 的最新提交和最近推送的几个分支，脚本对不上会停下）。
3. 重建：

   ```
   python3 -I scripts/web-trial/rebuild.py --base 线上页面.html --old-ref 提交号 --out lai-web.html
   ```

   脚本对不上时会停下并说明原因（提交号不对、`src/` 新增了文件需要手工放置代码块等），不会硬换。
   提交号给对、代码没变时，输出与底版逐字节相同。
4. 检查（可选，按改动大小决定做多少）：

   ```
   node scripts/web-trial/serve.cjs lai-web.html &
   PLAYWRIGHT_CORE=/某处/node_modules/playwright-core SHOTS=/某处/shots/ node scripts/web-trial/favorites-check.cjs 1440
   ```

   `favorites-check.cjs` 走一遍「常用」心形的 35 项检查并截图。`playwright-core` 装在仓库之外，不要装进仓库。
5. 发布 `lai-web.html`。

## 文件

- `build.py`：从仓库直接做出整页（不需要线上页面）。
- `data-shim.js`：数据替身，用浏览器本地存储模拟本机数据服务（`/api/data`、`/api/save` 等），并提供 `window.LaiWebTrial`；
  存不了数据时留在页面内存里。测试：`tests/web-trial-shim.test.cjs`。
- `rebuild.py`：以线上页面为底的重建脚本。
- `serve.cjs`：本地服务，每次请求重新读文件。
- `favorites-check.cjs`：「常用」功能的浏览器走查。
- `mail-demo.js`：试用版的示例邮箱（网页里连不到真实邮箱），发布时位于数据替身脚本之后。
- `demo-seed.js`：首次打开时写入的示例客户、订单、商机、待办（美国、欧洲睫毛公司，全部美元），在应用脚本之前运行。
- `data-panel.js`：「测试数据」面板（载入示例数据、备份与恢复、清空）；入口是设置中心里的「测试数据」一项（只在试用版出现），同时适配小满和粉色、橙色界面，发布时位于数据替身脚本之后。

## 已知限制

- 「数据替身」本身仍不在仓库里，丢了线上页面就得重写。
- 网页试用版里不能下载文件、不能连接真实邮箱，这两类功能要在 Mac 应用里验证。
