const imap = require('./mail-imap.js');
const { mailLibs } = require('./mail-libs.js');

// 收信：在开源库 imapflow 之上的一层薄封装。每次操作单独登录、用完退出。
// 只连接 mail-imap.js 里固定的 Zoho 主机（隔离测试除外）。

const LIST_HEADERS = ['from', 'to', 'cc', 'subject', 'date', 'message-id', 'content-type'];

async function open(account, { endpoint } = {}) {
  const { server, options } = imap.clientOptions(account, endpoint);
  const { ImapFlow } = mailLibs();
  const client = new ImapFlow(options);
  client.on('error', () => {});
  const wrap = error => imap.translate(error, server.host);
  try { await client.connect(); }
  catch (error) {
    try { client.close(); } catch (_) {}
    const translated = wrap(error);
    if (translated.code === 'auth_failed') throw imap.mailError('auth_failed', '邮箱登录失败。应用专用密码可能已失效或被撤销，请在邮件页重新验证或更换邮箱。');
    throw translated;
  }
  const refused = what => imap.mailError('imap_no', `邮箱服务器没有完成「${what}」，请稍后重试。`);
  const guard = task => async (...args) => { try { return await task(...args); } catch (error) { throw wrap(error); } };

  return {
    server,
    // 文件夹列表：路径与服务器给的用途标记（\Sent、\Trash 等）。
    listMailboxes: guard(async () => (await client.list()).map(box => ({ name: box.path, specialUse: String(box.specialUse || '').toLowerCase(), flags: [...(box.flags || [])].map(flag => String(flag).toLowerCase()) }))),
    // 在某个文件夹里执行一组操作；readOnly 时不会改动任何邮件状态。
    withMailbox: guard(async (mailbox, readOnly, task) => {
      const lock = await client.getMailboxLock(mailbox, { readOnly });
      try { return await task(); } finally { lock.release(); }
    }),
    // imapflow 在服务器拒绝命令时返回 false 而不是抛错；这里一律当作失败报告，不能把“出错”显示成“没有邮件”。
    search: guard(async (query) => { const found = await client.search(query, { uid: true }); if (!Array.isArray(found)) throw refused('搜索'); return [...found].sort((a, b) => a - b); }),
    fetchSummaries: guard(async (uids) => {
      const messages = [];
      if (!uids.length) return messages;
      for await (const message of client.fetch(uids.join(','), { uid: true, flags: true, size: true, internalDate: true, headers: LIST_HEADERS }, { uid: true }))
        messages.push({ uid: message.uid, flags: [...(message.flags || [])].map(flag => String(flag).toLowerCase()), size: message.size || 0, internalDate: message.internalDate || null, headers: message.headers || Buffer.alloc(0) });
      return messages;
    }),
    fetchMeta: guard(async (uid) => {
      const message = await client.fetchOne(String(uid), { uid: true, flags: true, size: true }, { uid: true });
      return message ? { uid: message.uid, flags: [...(message.flags || [])].map(flag => String(flag).toLowerCase()), size: message.size || 0 } : null;
    }),
    fetchSource: guard(async (uid) => {
      const message = await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true });
      return message && message.source ? message.source : null;
    }),
    addFlags: guard(async (uid, flags) => { if (!(await client.messageFlagsAdd(String(uid), flags, { uid: true }))) throw refused('修改标记'); }),
    removeFlags: guard(async (uid, flags) => { if (!(await client.messageFlagsRemove(String(uid), flags, { uid: true }))) throw refused('修改标记'); }),
    move: guard(async (uid, target) => { if (!(await client.messageMove(String(uid), target, { uid: true }))) throw refused('移动邮件'); }),
    async close() { try { await client.logout(); } catch (_) { try { client.close(); } catch (__) {} } },
  };
}

module.exports = { open, LIST_HEADERS };
