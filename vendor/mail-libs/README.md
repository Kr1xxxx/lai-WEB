# 邮件相关的第三方库

`mail-libs.cjs` 是下面这些开源库打包成的单个文件，随应用分发，供 `backend/` 的邮件代码使用。来财自己不再实现 IMAP、SMTP 协议和邮件解析。

| 库 | 版本 | 许可证 | 来源 | 提交 | 用途 |
| --- | --- | --- | --- | --- | --- |
| imapflow | 2.5.2 | MIT | https://github.com/postalsys/imapflow | `bdfd4d288230f85a2c4a8ba228767b72a27bc56f` | IMAP 客户端（收信） |
| nodemailer | 10.1.2 | MIT-0 | https://github.com/nodemailer/nodemailer | `8454a24ba7ad3b32cca1aed07ae7fc05aa960f19` | SMTP 发信与邮件生成 |
| postal-mime | 4.0.8 | MIT-0 | https://github.com/postalsys/postal-mime | `fd4d0a578045d40b98b6ae861661b3386eca9627` | 邮件解析 |
| libmime | 5.4.9 | MIT | https://github.com/nodemailer/libmime | `42210e0af1389e4e81fd45ab3023c6fc78732fba` | imapflow 依赖 |
| libqp | 2.1.3 | MIT | https://github.com/nodemailer/libqp | `1adf9bb082cd29d8a3914cf4f90f8812c9a53a9c` | imapflow 依赖 |
| libbase64 | 1.3.3 | MIT | https://github.com/nodemailer/libbase64 | `bd447086192dd41b09615e96ccb584304faeb1ca` | imapflow 依赖 |
| @zone-eu/mailsplit | 5.4.23 | (MIT OR EUPL-1.1+) | https://github.com/zone-eu/mailsplit | `8b082bf29dbdd0e207a0dba37700814c9bba1c98` | imapflow 依赖 |
| encoding-japanese | 2.4.0 | MIT | https://github.com/polygonplanet/encoding.js | `1cbb978530559d32bfe3c35cf8c3ec30493d7e1f` | imapflow 依赖（日文编码） |
| iconv-lite | 0.7.3 | MIT | https://github.com/ashtuchkin/iconv-lite | `43694e28291d3b0cb3a452c77be40c4fd3a4bd85` | imapflow 依赖（字符集转换） |
| safer-buffer | 2.1.2 | MIT | https://github.com/ChALkeR/safer-buffer | `ed7f4fbca47c851873bc39a5a465d0de6d380950` | iconv-lite 依赖 |

各库的许可证全文见 `LICENSES.txt`。

## 怎么生成的

1. 从上表的 GitHub 仓库按提交取源码（不经过 npm；提交即 npm 上该版本的 `gitHead`，与版本标签一致），并排放在同一个目录里：
   `imapflow/ nodemailer/ postal-mime/ libmime/ libqp/ libbase64/ mailsplit/ encoding.js/ iconv-lite/ safer-buffer/`。
   本目录 `build/` 的三个文件复制到旁边的 `bundle/`。
2. imapflow 与 nodemailer 的源码各缺一个由其构建脚本（`scripts/build.js`）生成的小文件，按同样的内容补上：
   `src/package-info.ts`（名称、版本、主页，取自 package.json；imapflow 用双引号，nodemailer 用单引号）；nodemailer 另有
   `src/well-known/services.ts`（内容即 `services.json`，键保持文件里的顺序，4 空格缩进）。
3. 在该目录下建 `node_modules/` 链接，让裸引用找到上面的源码：`libmime libqp libbase64 iconv-lite safer-buffer` 各链到同名目录，
   `encoding-japanese` → `encoding.js`，`@zone-eu/mailsplit` → `mailsplit`。
4. 在该目录下用 esbuild 0.28.2 打包：

   ```sh
   esbuild bundle/entry.js --bundle --platform=node --format=cjs --target=node22 \
     --alias:pino=./bundle/pino-stub.js --alias:socks=./bundle/socks-stub.js \
     --legal-comments=inline --outfile=mail-libs.cjs
   ```

   2026-10-17 验证过：按这些步骤用上一版的提交（imapflow 2.2.6 那组，见本文件的 git 历史）重新打包，得到的文件与当时提交的 `mail-libs.cjs` 逐字节相同。

## 与上游的差别

- `pino`（日志）换成 `build/pino-stub.js`：一个什么都不做的记录器。来财不输出这些库的日志，也避免把邮件内容或凭据写进日志。
- `socks`（代理）换成 `build/socks-stub.js`：来财不通过代理连接邮箱。
- 除此之外没有改动上游代码。

升级时重复上面的步骤，更新本表的版本与提交、`LICENSES.txt` 每段开头的版本号，并跑一遍 `npm run test:model` 和 `npm run test:e2e`。

最近一次升级：2026-10-17（imapflow 2.2.6 → 2.5.2，nodemailer 10.0.15 → 10.1.2，postal-mime 4.0.4 → 4.0.8，以及 libmime、libqp、libbase64、mailsplit；各库许可证文本没有变化）。
