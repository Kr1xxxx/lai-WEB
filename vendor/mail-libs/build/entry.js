// 来财用到的第三方邮件库，打包成单个文件随应用分发。来源与许可证见同目录的 README 与 LICENSES。
const { ImapFlow } = require('../imapflow/src/imap-flow.ts');
const nodemailer = require('../nodemailer/src/nodemailer.ts');
const MailComposer = require('../nodemailer/src/mail-composer/index.ts');
const PostalMime = require('../postal-mime/src/postal-mime.ts');
module.exports = { ImapFlow, createTransport: nodemailer.createTransport, MailComposer: MailComposer.default || MailComposer, PostalMime: PostalMime.default || PostalMime };
