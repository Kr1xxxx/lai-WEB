# 网页试用版的重建与检查

网页试用版是一份发布出去的单页 HTML，用来在浏览器里试用来财Lai。它等于应用的那份单页
（`src/template.html` 加 `src/` 下各文件），再加上几段**只存在于已发布页面、不在仓库里**的内容：
用浏览器本地存储代替本机数据服务的「数据替身」、「试用数据」面板、外层滚动容器样式。

所以它不能从零构建，只能以线上页面为底，把改动过的 `src/` 代码块换进去。

## 每次发布前

1. **先读线上最新版本，存成文件。** 可能有别的会话刚发布过；用旧底版发布会覆盖对方的改动。
2. 确认线上页面是从哪个提交构建的（看上一次发布时记下的提交号；不确定时试 `main` 的最新提交和最近推送的几个分支，脚本对不上会停下）。
3. 重建：

   ```
   python3 -I scripts/web-trial/rebuild.py --base 线上页面.html --old-ref 提交号 --out lai-web.html
   ```

   `src/` 新增了脚本文件时，用 `--insert 新文件.js:它要排在谁前面.js` 指明位置（顺序看 `src/template.html`），可以写多次。

   脚本对不上时会停下并说明原因（提交号不对、新增的文件没有用 `--insert` 指明位置等），不会硬换。
   提交号给对、代码没变时，输出与底版逐字节相同。
4. 检查（可选，按改动大小决定做多少）：

   ```
   node scripts/web-trial/serve.cjs lai-web.html &
   PLAYWRIGHT_CORE=/某处/node_modules/playwright-core SHOTS=/某处/shots/ node scripts/web-trial/favorites-check.cjs 1440
   ```

   `favorites-check.cjs` 走一遍「常用」心形的 35 项检查并截图。`playwright-core` 装在仓库之外，不要装进仓库。
5. 发布 `lai-web.html`。

## 文件

- `rebuild.py`：重建脚本。
- `serve.cjs`：本地服务，每次请求重新读文件。
- `favorites-check.cjs`：「常用」功能的浏览器走查。
- `leads-check.cjs`：「线索」模块的浏览器走查（28 项，从空数据开始）。
- `mail-demo.js`：试用版的示例邮箱（网页里连不到真实邮箱），发布时位于数据替身脚本之后。

## 已知限制

- 「数据替身」和「试用数据」面板本身仍不在仓库里，丢了线上页面就得重写。
- 网页试用版里不能下载文件、不能连接真实邮箱，这两类功能要在 Mac 应用里验证。
