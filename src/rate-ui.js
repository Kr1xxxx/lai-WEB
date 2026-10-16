(function (root) {
  'use strict';
  // 汇率设置页面（交易 → 汇率设置，路由 rates，权限 settings.rate）。登记在 business-ui.js 的页面登记处，逻辑在 rate-model.js。
  // 表：币种 / 每 100 折合美元 / 折合人民币（由人民币那一行算出） / 更新日期。美元固定为 100；只能手动填，不自带汇率。
  const RT = () => root.LaiRateModel || (typeof module !== 'undefined' && module.exports ? require('./rate-model.js') : null);
  const PERM = 'settings.rate';
  // 页面上的临时状态：正在修改哪个币种、哪个币种的删除按钮已经点过一次、上一条错误。
  const view = { editing: '', armed: '', error: '' };

  function markup(state, c) {
    const M = RT(), E = c.escape;
    const editable = c.can(PERM);
    const rows = M.list(state), missing = M.missing(state);
    const cnyCell = (code) => {
      const value = M.cny100(state, code);
      return value === null ? '<span class="muted">—</span>' : E(M.format(value, 4));
    };
    const rateInput = (code, value) =>
      `<input class="rate-input" name="usd100" form="rate-edit-form" value="${E(value)}" inputmode="decimal" aria-label="${E(code)} 每 100 折合美元" autocomplete="off">`;
    const editActions = `<button type="submit" class="primary" form="rate-edit-form">保存</button><button type="button" data-rate-action="cancel">取消</button>`;
    const body = [
      ...rows.map((row) => {
        if (row.fixed) return `<tr data-rate-row="USD"><td><span class="currency-badge">USD</span></td><td>100</td><td>${cnyCell('USD')}</td><td><span class="muted">固定</span></td><td><span class="muted tiny">美元固定为 100</span></td></tr>`;
        const editing = view.editing === row.code;
        const actions = !editable ? '' : editing ? editActions
          : `<button type="button" data-rate-action="edit" data-code="${E(row.code)}">修改</button><button type="button" class="${view.armed === row.code ? 'danger' : ''}" data-rate-action="delete" data-code="${E(row.code)}">${view.armed === row.code ? '确认删除' : '删除'}</button>`;
        return `<tr data-rate-row="${E(row.code)}"><td><span class="currency-badge">${E(row.code)}</span></td><td>${editing ? rateInput(row.code, M.format(row.usd100)) : E(M.format(row.usd100))}</td><td>${cnyCell(row.code)}</td><td>${E(row.updatedAt || '—')}</td><td><div class="rate-actions">${actions}</div></td></tr>`;
      }),
      ...missing.map((code) => {
        const editing = view.editing === code;
        const actions = !editable ? '' : editing ? editActions : `<button type="button" data-rate-action="edit" data-code="${E(code)}">设置</button>`;
        return `<tr data-rate-row="${E(code)}" class="rate-missing"><td><span class="currency-badge">${E(code)}</span></td><td>${editing ? rateInput(code, '') : '<span class="tag">未设置</span>'}</td><td><span class="muted">—</span></td><td>—</td><td><div class="rate-actions">${actions}</div></td></tr>`;
      }),
    ].join('');
    const addForm = editable
      ? `<form id="rate-add-form" class="rate-add" autocomplete="off"><label class="field">币种代码<input name="code" maxlength="3" placeholder="例如 EUR" aria-label="币种代码"></label><label class="field">每 100 折合美元<input name="usd100" inputmode="decimal" placeholder="例如 108.5" aria-label="每 100 折合美元"></label><button type="submit" class="primary">添加</button></form>`
      : '';
    return `<div class="pagebar"><div class="business-title"><h1>汇率设置</h1><span>外币订单按这里的汇率折成美元，用来算客户的成交金额和客户等级</span></div><div class="page-actions"></div></div>`
      + `<div class="business-scroll rate-page"><section class="business-section"><div class="section-head"><h3>汇率表</h3><span class="muted tiny">每 100 外币折合多少美元，美元固定为 100；汇率要自己填</span></div>`
      + `<form id="rate-edit-form" data-code="${E(view.editing)}" hidden></form>`
      + `<table class="order-table rate-table"><thead><tr><th>币种</th><th>每 100 折合美元</th><th>折合人民币</th><th>更新日期</th><th>操作</th></tr></thead><tbody>${body}</tbody></table>`
      + addForm
      + `<div class="error${view.error ? ' visible' : ''}" id="rate-error" role="alert">${E(view.error)}</div>`
      + `<p class="settings-copy rate-note">改汇率不会改已经保存的订单。没设置汇率的币种不折算，有这种订单的客户不显示成交金额，也不自动判断等级。</p>`
      + `</section></div>`;
  }

  async function save(c, makeNext) {
    if (!c.need(PERM)) return;
    let next;
    try {
      next = makeNext(c.state());
    } catch (error) {
      view.error = error.message;
      return c.refresh();
    }
    try {
      await c.save(next);
      view.editing = ''; view.armed = ''; view.error = '';
      c.toast('已保存到来财');
    } catch (error) {
      view.error = error.message;
    }
    c.refresh();
  }

  const page = {
    title: '汇率设置',
    render(c) {
      // 从别的页面进来时，清掉上次没做完的修改。
      if (typeof document !== 'undefined' && document.querySelector && !document.querySelector('.rate-page')) Object.assign(view, { editing: '', armed: '', error: '' });
      return markup(c.state(), c);
    },
    click(c, e) {
      const button = e.target?.closest?.('[data-rate-action]');
      if (!button) {
        // 点到别处时，取消「确认删除」。
        if (view.armed && e.target?.closest?.('.rate-page')) { view.armed = ''; c.refresh(); }
        return false;
      }
      const action = button.dataset.rateAction, code = button.dataset.code || '';
      if (action === 'cancel') { Object.assign(view, { editing: '', armed: '', error: '' }); c.refresh(); return true; }
      if (!c.need(PERM)) return true;
      if (action === 'edit') { Object.assign(view, { editing: code, armed: '', error: '' }); c.refresh(); return true; }
      if (action === 'delete') {
        const use = RT().usage(c.state(), code);
        if (use.total) {
          view.armed = '';
          view.error = `还有${RT().usageText(use)}在用 ${code}，不能删除`;
          c.refresh();
          return true;
        }
        if (view.armed !== code) { view.armed = code; view.error = ''; c.refresh(); return true; }
        save(c, (state) => RT().removeRate(state, code));
        return true;
      }
      return false;
    },
    submit(c, e) {
      const form = e.target;
      if (!form || (form.id !== 'rate-add-form' && form.id !== 'rate-edit-form')) return false;
      e.preventDefault?.();
      const value = (name) => {
        const own = form.elements?.[name];
        if (own) return own.value;
        // 修改表单的输入框在表格里（form="rate-edit-form"）。
        const outside = typeof document !== 'undefined' ? document.querySelector?.(`[form="${form.id}"][name="${name}"]`) : null;
        return outside ? outside.value : '';
      };
      if (form.id === 'rate-add-form') save(c, (state) => RT().setRate(state, value('code'), value('usd100'), { adding: true }));
      else save(c, (state) => RT().setRate(state, form.dataset.code, value('usd100')));
      return true;
    },
  };

  root.LaiExtraPages = root.LaiExtraPages || {};
  root.LaiExtraPages.rates = page;
  const api = { page, markup, view };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LaiRateUI = api;
})(typeof window !== 'undefined' ? window : globalThis);
