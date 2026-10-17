(function (root) {
  'use strict';
  // 功能开关页面（设置 → 功能开关，路由 feature-switch，权限 settings.switch）。登记在 business-ui.js 的页面登记处，逻辑在 feature-switch-model.js。
  // 每个能关的模块一个开关。关掉只是不显示、不在后台运行，数据都保留。
  const FS = () => root.LaiFeatureSwitch || (typeof module !== 'undefined' && module.exports ? require('./feature-switch-model.js') : null);
  const CSM = () => root.LaiCustomerSettings || (typeof module !== 'undefined' && module.exports ? require('./customer-settings-model.js') : null);
  const PERM = 'settings.switch';
  const FIXED = '客户、订单、工作台、设置、企业管理是基础功能，不能关闭。';
  const view = { error: '' };

  function markup(state, c) {
    const M = FS(), E = c.escape, editable = c.can(PERM);
    const lock = editable ? '' : ' disabled';
    // 商机关了、而成交又设成“按商机”时，在商机这一行说明现在改按订单算。
    const dealNote = (id) => {
      if (id !== 'opp' || M.enabled(state, 'opp')) return '';
      const CS = CSM();
      return CS && CS.get(state).dealRule.by === 'opportunity' ? '<p class="fs-hint">客户设置里“成交”选的是按商机，商机关着时先按订单算；重新打开后恢复。</p>' : '';
    };
    // 组件套件（D-028）：一张卡片里一行一个模块，和设置中心的行一样：左边名称和说明，右边开关（k-switch）和已开启／已关闭。
    const rows = M.MODULES.map((m) => {
      const on = M.enabled(state, m.id);
      return `<div class="fs-item" data-fs-module="${E(m.id)}"><div class="fs-text"><h3>${E(m.label)}</h3><p class="fs-note">${E(m.note)}</p>${dealNote(m.id)}</div>`
        + `<label class="fs-switch"><input type="checkbox" class="k-switch" role="switch" data-fs-toggle="${E(m.id)}" aria-label="${E(m.label)}功能开关"${on ? ' checked' : ''}${lock}><span>${on ? '已开启' : '已关闭'}</span></label></div>`;
    }).join('');
    return `<div class="k-pageheader sh-header"><div class="k-pageheader-text"><h1 class="k-pageheader-title">功能开关</h1><span class="k-pageheader-desc">关掉后，这个功能不再显示；数据都保留，重新打开就能用。</span></div><div class="k-pageheader-actions"></div></div>`
      + `<div class="business-scroll fs-page"><section class="k-card fs-card"><div class="k-card-body fs-list">${rows}</div></section>`
      + `<div class="k-error${view.error ? ' visible' : ''}" id="fs-error" role="alert">${E(view.error)}</div>`
      + `<p class="fs-fixed">${E(FIXED)}${editable ? '' : '你的角色只能查看，不能修改。'}</p></div>`;
  }

  async function toggle(c, id, on) {
    if (!c.need(PERM)) return c.refresh();
    try {
      await c.save(FS().set(c.state(), id, on));
      view.error = '';
      c.toast(`${FS().label(id)}已${on ? '开启' : '关闭'}，数据都保留`);
    } catch (error) {
      view.error = error.message;
      return c.refresh();
    }
    // 左侧栏、常用、设置中心按新的开关整个界面重画。
    if (typeof c.rerenderApp === 'function') await c.rerenderApp();
    else c.refresh();
  }

  const page = {
    title: '功能开关',
    render(c) {
      if (typeof document !== 'undefined' && document.querySelector && !document.querySelector('.fs-page')) view.error = '';
      return markup(c.state(), c);
    },
    change(c, e) {
      const target = e.target;
      if (!target || !target.dataset || !target.dataset.fsToggle) return false;
      toggle(c, target.dataset.fsToggle, target.checked === true);
      return true;
    },
  };

  root.LaiExtraPages = root.LaiExtraPages || {};
  root.LaiExtraPages['feature-switch'] = page;
  const api = { page, markup, view };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LaiFeatureSwitchUI = api;
})(typeof window !== 'undefined' ? window : globalThis);
