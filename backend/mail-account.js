const { httpError } = require('./errors.js');
const imap = require('./mail-imap.js');

// 邮箱绑定：验证凭据、保存、查询、重新验证、解绑。目前只支持 Zoho 邮箱，且只做登录验证，不读取或发送邮件。
// 对外（返回给界面的内容）永远不包含密码。
function createMailAccounts({ store, verify = imap.verifyLogin, now = () => new Date().toISOString() }) {
  let busy = false;

  const publicView = account => account ? {
    provider: 'zoho', email: account.email, site: account.site, accountType: account.accountType,
    host: account.host, port: account.port, boundAt: account.boundAt, verifiedAt: account.verifiedAt,
    ...(account.senderName ? { senderName: account.senderName } : {})
  } : null;

  // 把验证失败转换成界面可以直接显示的应答：输入问题 400，登录被拒 422，网络类 502。
  function asHttp(error) {
    const status = { invalid_input: 400, auth_failed: 422, protocol: 502, network: 502, tls: 502, timeout: 504 }[error?.code];
    if (!status) throw error;
    return httpError(status, error.message, { code: error.code });
  }

  async function exclusive(task) {
    if (busy) throw httpError(409, '正在验证邮箱，请稍候', { code: 'busy' });
    busy = true;
    try { return await task(); } finally { busy = false; }
  }

  function status() {
    return { ok: true, available: true, account: publicView(store.readMailAccount()) };
  }

  function bind(input) {
    return exclusive(async () => {
      const request = input && typeof input === 'object' ? input : {};
      let email, password, server;
      try {
        email = imap.normalizeEmail(request.email);
        password = imap.normalizePassword(request.password);
        server = imap.resolveServer({ email, site: request.site ?? 'cn', accountType: request.accountType ?? 'auto' });
      } catch (error) { throw asHttp(error); }
      try { await verify({ email, password, site: server.site, accountType: server.accountType }); }
      catch (error) { throw asHttp(error); }
      const time = now();
      const account = { provider: 'zoho', email, password, site: server.site, accountType: server.accountType, host: server.host, port: server.port, boundAt: time, verifiedAt: time };
      store.writeMailAccount(account);
      return { ok: true, available: true, account: publicView(account) };
    });
  }

  // 用已保存的凭据再登录一次；失败不会删除绑定，只报告原因。
  function reverify() {
    return exclusive(async () => {
      const account = store.readMailAccount();
      if (!account) throw httpError(404, '还没有绑定邮箱', { code: 'not_bound' });
      try { await verify({ email: account.email, password: account.password, site: account.site, accountType: account.accountType }); }
      catch (error) { throw asHttp(error); }
      const updated = { ...account, verifiedAt: now() };
      store.writeMailAccount(updated);
      return { ok: true, available: true, account: publicView(updated) };
    });
  }

  function unbind() {
    if (busy) throw httpError(409, '正在验证邮箱，请稍候', { code: 'busy' });
    store.deleteMailAccount();
    return { ok: true, available: true, account: null };
  }

  return { status, bind, reverify, unbind };
}

module.exports = { createMailAccounts };
