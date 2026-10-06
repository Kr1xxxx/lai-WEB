# 邮件相关的第三方库

`mail-libs.cjs` 是下面这些开源库打包成的单个文件，随应用分发，供 `backend/` 的邮件代码使用。来财自己不再实现 IMAP、SMTP 协议和邮件解析。

| 库 | 版本 | 许可证 | 来源 | 提交 | 用途 |
| --- | --- | --- | --- | --- | --- |
| imapflow | 2.2.6 | MIT | https://github.com/postalsys/imapflow | `e4ce9e3d39c90498dfd1a7e1c3f5512ed713889e` | IMAP 客户端（收信） |
| nodemailer | 10.0.15 | MIT-0 | https://github.com/nodemailer/nodemailer | `c17efc045a8165810a4a6910a6a6d18e705187c8` | SMTP 发信与邮件生成 |
| postal-mime | 4.0.4 | MIT-0 | https://github.com/postalsys/postal-mime | `659e56e052827acc4e61b56c4fa9771eebba3a7b` | 邮件解析 |
| libmime | 5.4.7 | MIT | https://github.com/nodemailer/libmime | `9877835ef3b7fbb9b74ac486630f57483d6e77f8` | imapflow 依赖 |
| libqp | 2.1.2 | MIT | https://github.com/nodemailer/libqp | `400af6af5a525d4bbe9072d5fd6e81f08b9a3059` | imapflow 依赖 |
| libbase64 | 1.3.2 | MIT | https://github.com/nodemailer/libbase64 | `8b278eab13614db69b59e9d1290d3a93c57ab72f` | imapflow 依赖 |
| @zone-eu/mailsplit | 5.4.20 | (MIT OR EUPL-1.1+) | https://github.com/zone-eu/mailsplit | `3d063f6fedacb3fef94036ef0bf94b55cb16112d` | imapflow 依赖 |
| encoding-japanese | 2.4.0 | MIT | https://github.com/polygonplanet/encoding.js | `1cbb978530559d32bfe3c35cf8c3ec30493d7e1f` | imapflow 依赖（日文编码） |
| iconv-lite | 0.7.3 | MIT | https://github.com/ashtuchkin/iconv-lite | `43694e28291d3b0cb3a452c77be40c4fd3a4bd85` | imapflow 依赖（字符集转换） |
| safer-buffer | 2.1.2 | MIT | https://github.com/ChALkeR/safer-buffer | `ed7f4fbca47c851873bc39a5a465d0de6d380950` | iconv-lite 依赖 |

各库的许可证全文见 `LICENSES.txt`。

## 怎么生成的

1. 从上表的 GitHub 仓库按版本标签取源码（不经过 npm）。
2. imapflow 与 nodemailer 的源码各缺一个由其构建脚本生成的小文件，按同样的内容补上：`src/package-info.ts`（名称、版本、主页，取自 package.json）；nodemailer 另有 `src/well-known/services.ts`（内容即 `services.json`）。
3. 用 esbuild 0.28.2 打包：

   ```sh
   esbuild build/entry.js --bundle --platform=node --format=cjs --target=node22 \
     --alias:pino=./build/pino-stub.js --alias:socks=./build/socks-stub.js \
     --legal-comments=inline --outfile=mail-libs.cjs
   ```

   `build/entry.js` 里的相对路径按取源码的位置调整。

## 与上游的差别

- `pino`（日志）换成 `build/pino-stub.js`：一个什么都不做的记录器。来财不输出这些库的日志，也避免把邮件内容或凭据写进日志。
- `socks`（代理）换成 `build/socks-stub.js`：来财不通过代理连接邮箱。
- 除此之外没有改动上游代码。

升级时重复上面的步骤，更新本表的版本与提交，并跑一遍 `npm run test:model`。
