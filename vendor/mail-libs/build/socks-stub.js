// 来财不通过代理连接邮箱：SOCKS 代理支持被去掉。
exports.SocksClient = { createConnection() { return Promise.reject(new Error('proxy connections are not supported in this build')); } };
