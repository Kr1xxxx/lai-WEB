const fs = require('node:fs');
const path = require('node:path');

// 第三方邮件库（imapflow、nodemailer、postal-mime）的单文件打包，来源与许可证见 vendor/mail-libs/README.md。
// 应用包里它在 vendor/mail-libs.cjs，源码仓库里在 ../vendor/mail-libs/mail-libs.cjs。用到时才加载。
let cached = null;
function mailLibs() {
  if (!cached) {
    const file = [path.join(__dirname, 'vendor', 'mail-libs.cjs'), path.join(__dirname, '..', 'vendor', 'mail-libs', 'mail-libs.cjs')].find(candidate => fs.existsSync(candidate));
    if (!file) throw Object.assign(new Error('邮件组件缺失，请重新安装来财应用。'), { code: 'protocol' });
    cached = require(file);
  }
  return cached;
}
module.exports = { mailLibs };
