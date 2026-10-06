// 来财不需要第三方库的日志输出：用一个什么都不做的记录器代替 pino。
const noop = () => {};
function make() { const logger = { level: 'silent', child: () => make() }; for (const name of ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']) logger[name] = noop; return logger; }
module.exports = () => make();
module.exports.default = module.exports;
