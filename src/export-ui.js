(function (root) {
  'use strict';
  // 导出窗口：客户、订单、商机、线索四个列表共用。window.LaiExportUI.open(kind, ctx)。
  // 只读：不改数据、不写日志。行永远来自页面上已经按账号范围筛好的列表（ctx.scopes），列过字段权限（ctx.gate）。
  // ctx = {
  //   state, can(key), toast(text), dialog(title, body, footer, type), closeDialog(), denied?(key),
  //   scopes: { filtered, selected?, all }   // 每项是行数组，或返回行数组的函数
  //   gate?: { columnVisible(id) }           // 字段权限；管理员可不传
  //   columns?: [字段id]                     // 客户：「按列表字段设置」用的列顺序
  //   XLSX?, trial?: boolean                 // 默认取 window.XLSX / 有没有 window.LaiWebTrial
  // }
  const node = typeof module !== 'undefined' && module.exports;
  const EM = node ? require('./export-model.js') : root.LaiExportModel;

  const KINDS = {
    customer: { perm: 'customer.export', title: '导出客户', file: '客户', unit: '位客户' },
    order: { perm: 'order.export', title: '导出订单', file: '订单', unit: '笔订单' },
    opp: { perm: 'opp.export', title: '导出商机', file: '商机', unit: '个商机' },
    lead: { perm: 'lead.export', title: '导出线索', file: '线索', unit: '条线索' },
  };
  const HINT = '表里有客户联系方式，请妥善保管。';
  const TRIAL_NOTE = '网页试用版不能下载文件。';
  const COPY_TIP = '请按 Ctrl+C（苹果电脑按 Cmd+C）复制';
  const PREVIEW_ROWS = 5;
  const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const get = value => typeof value === 'function' ? value() : Array.isArray(value) ? value : [];
  const isTrial = ctx => ctx.trial === true || (ctx.trial === undefined && !!root.LaiWebTrial);
  const pad = n => String(n).padStart(2, '0');
  const stamp = date => `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const fileName = (kind, ext, date = new Date()) => `来财-${KINDS[kind].file}-${stamp(date)}.${ext}`;

  // 可选的范围；只有客户列表有「已选的」。
  function scopeChoices(kind, ctx) {
    const scopes = ctx.scopes || {};
    const out = [{ id: 'filtered', label: '当前筛选结果', count: get(scopes.filtered).length }];
    const selected = kind === 'customer' ? get(scopes.selected).length : 0;
    if (selected > 0) out.push({ id: 'selected', label: '已选的', count: selected });
    out.push({ id: 'all', label: '全部我能看到的', count: get(scopes.all).length });
    return out;
  }
  const rowsOf = (ctx, scope) => get((ctx.scopes || {})[scope]);

  // 把行做成表（一个或几个工作表）。超过上限时模型会抛出中文提示。
  function sheetsFor(kind, rows, ctx, choice = {}) {
    const gate = ctx.gate;
    if (kind === 'customer') {
      const columns = choice.columns === 'all' ? undefined : ctx.columns;
      return [{ name: '客户', ...EM.customerRows(rows, { gate, columns }) }];
    }
    if (kind === 'order') {
      const sheets = [{ name: '订单', ...EM.orderRows(rows, { gate }) }];
      if (choice.format !== 'csv' && choice.format !== 'tsv') sheets.push({ name: '产品明细', ...EM.orderItemRows(rows) });
      return sheets;
    }
    if (kind === 'opp') return [{ name: '商机', ...EM.opportunityRows(rows, ctx.state, { gate }) }];
    if (kind === 'lead') return [{ name: '线索', ...EM.leadRows(rows, ctx.state, { gate }) }];
    throw new Error('不能导出这个列表');
  }

  function previewMarkup(sheet) {
    if (!sheet) return '';
    const cell = value => esc(String(value ?? '').slice(0, 40));
    const head = sheet.header.map(name => `<th scope="col">${esc(name)}</th>`).join('');
    const body = sheet.data.slice(0, PREVIEW_ROWS).map(row => `<tr>${row.map(value => `<td>${cell(value)}</td>`).join('')}</tr>`).join('');
    return `<table class="export-table"><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${Math.max(1, sheet.header.length)}" class="export-empty">没有可导出的内容</td></tr>`}</tbody></table>`;
  }

  // view = { scopes, scope, columns, format, trial, preview (sheet), error }
  function bodyMarkup(kind, view) {
    const radio = (name, id, label, checked, extra = '') =>
      `<label class="export-choice"><input type="radio" name="export-${name}" value="${id}"${checked ? ' checked' : ''}><span>${esc(label)}${extra}</span></label>`;
    const scope = `<fieldset class="export-group"><legend>范围</legend>${view.scopes.map(item => radio('scope', item.id, `${item.label}（${item.count} 条）`, item.id === view.scope)).join('')}</fieldset>`;
    const columns = kind === 'customer'
      ? `<fieldset class="export-group"><legend>列</legend>${radio('columns', 'list', '按列表字段设置', view.columns !== 'all')}${radio('columns', 'all', '全部字段', view.columns === 'all')}</fieldset>` : '';
    const format = view.trial ? '' : `<fieldset class="export-group"><legend>格式</legend>${radio('format', 'xlsx', 'Excel（.xlsx）', view.format !== 'csv')}${radio('format', 'csv', 'CSV', view.format === 'csv')}${kind === 'order' ? '<small class="export-note">产品明细只在 Excel 里有，CSV 只导出订单表。</small>' : ''}</fieldset>`;
    return `<div class="drawer-body export-body">${scope}${columns}${format}<p class="export-hint">${esc(HINT)}</p><section class="export-preview-wrap" aria-label="预览"><h3>预览（前 ${PREVIEW_ROWS} 行）</h3><div class="export-preview">${previewMarkup(view.preview)}</div></section><div class="export-copybox" hidden><p class="export-copytip">${esc(COPY_TIP)}</p><textarea readonly rows="6" aria-label="表格内容"></textarea></div><div class="error" id="export-error" role="alert">${esc(view.error || '')}</div></div>`;
  }
  function footerMarkup(kind, view) {
    const disabled = view.error || view.empty ? ' disabled' : '';
    const action = view.trial
      ? `<button type="button" class="primary" data-export-do="copy"${disabled}>复制表格</button>`
      : `<button type="button" class="primary" data-export-do="download"${disabled}>导出</button>`;
    return `${view.trial ? `<span class="export-trial-note">${esc(TRIAL_NOTE)}</span>` : ''}<button type="button" data-action="close-modal">取消</button>${action}`;
  }

  // 根据当前选择算出窗口内容（预览、错误、能不能点导出）。
  function viewFor(kind, ctx, choice) {
    const scopes = scopeChoices(kind, ctx);
    const scope = scopes.some(item => item.id === choice.scope) ? choice.scope : scopes[0].id;
    const count = scopes.find(item => item.id === scope).count;
    const view = { scopes, scope, columns: choice.columns === 'all' ? 'all' : 'list', format: choice.format === 'csv' ? 'csv' : 'xlsx', trial: isTrial(ctx), preview: null, error: '', empty: count === 0, count };
    if (count > EM.MAX_ROWS) { view.error = EM.MAX_ERROR; return view; }
    try {
      view.preview = sheetsFor(kind, rowsOf(ctx, scope).slice(0, PREVIEW_ROWS), ctx, view)[0];
    } catch (error) { view.error = error.message; }
    return view;
  }

  // 真正导出：返回 { count, sheets }，出错（例如太多行）会抛出。
  function build(kind, ctx, choice) {
    const view = viewFor(kind, ctx, choice);
    if (view.error) throw new Error(view.error);
    const rows = rowsOf(ctx, view.scope);
    return { count: rows.length, sheets: sheetsFor(kind, rows, ctx, { ...view, format: view.trial ? 'tsv' : view.format }), view };
  }

  function saveFile(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function open(kind, ctx) {
    const info = KINDS[kind];
    if (!info || !ctx) return false;
    if (!ctx.can(info.perm)) { ctx.toast(ctx.denied ? ctx.denied(info.perm) : '你没有导出的权限'); return false; }
    const choice = { scope: scopeChoices(kind, ctx).some(item => item.id === 'selected') ? 'selected' : 'filtered', columns: 'list', format: 'xlsx' };
    const first = viewFor(kind, ctx, choice);
    choice.scope = first.scope;
    ctx.dialog(info.title, bodyMarkup(kind, first), footerMarkup(kind, first), 'export');
    const panel = document.querySelector('#overlay-root .drawer');
    if (!panel) return false;
    panel.classList.add('export-dialog');
    const $ = selector => panel.querySelector(selector);

    function refresh() {
      const view = viewFor(kind, ctx, choice);
      choice.scope = view.scope;
      $('.export-preview').innerHTML = previewMarkup(view.preview);
      $('#export-error').textContent = view.error || '';
      const box = $('.export-copybox');
      if (box) box.hidden = true;
      for (const button of panel.querySelectorAll('[data-export-do]')) button.disabled = !!(view.error || view.empty);
    }
    panel.addEventListener('change', event => {
      const input = event.target;
      if (!input || input.tagName !== 'INPUT') return;
      if (input.name === 'export-scope') choice.scope = input.value;
      else if (input.name === 'export-columns') choice.columns = input.value;
      else if (input.name === 'export-format') choice.format = input.value;
      else return;
      refresh();
    });
    panel.addEventListener('click', event => {
      const button = event.target.closest && event.target.closest('[data-export-do]');
      if (!button || button.disabled) return;
      if (!ctx.can(info.perm)) { ctx.toast(ctx.denied ? ctx.denied(info.perm) : '你没有导出的权限'); return; }
      const error = $('#export-error');
      let result;
      try { result = build(kind, ctx, choice); } catch (err) { error.textContent = err.message; return; }
      error.textContent = '';
      const done = verb => ctx.toast(`${verb} ${result.count} ${info.unit}`);
      if (button.dataset.exportDo === 'copy') return copy(result, done);
      try {
        if (choice.format === 'csv') saveFile(new Blob([EM.toCSV(result.sheets[0])], { type: 'text/csv;charset=utf-8' }), fileName(kind, 'csv'));
        else {
          const XLSX = ctx.XLSX || root.XLSX;
          if (!XLSX) throw new Error('导出组件没有载入，请刷新页面再试');
          const data = XLSX.write(EM.toWorkbook(XLSX, result.sheets), { bookType: 'xlsx', type: 'array' });
          saveFile(new Blob([data], { type: XLSX_TYPE }), fileName(kind, 'xlsx'));
        }
      } catch (err) { error.textContent = err.message || '导出失败，请再试一次'; return; }
      done('已导出');
      ctx.closeDialog();
    });

    // 网页试用版不能下载：把表格（制表符分隔，粘贴到 Excel 会自动分列）放进剪贴板。
    function copy(result, done) {
      const text = EM.toTSV(result.sheets[0]);
      const fallback = () => {
        const box = $('.export-copybox'), area = box.querySelector('textarea');
        box.hidden = false;
        area.value = text;
        area.focus();
        area.select();
      };
      const copied = () => done('已复制');
      try { navigator.clipboard.writeText(text).then(copied, fallback); } catch (error) { fallback(); }
    }
    return true;
  }

  const api = { KINDS, HINT, TRIAL_NOTE, COPY_TIP, PREVIEW_ROWS, fileName, scopeChoices, sheetsFor, viewFor, build, bodyMarkup, footerMarkup, previewMarkup, open };
  if (node) module.exports = api; else root.LaiExportUI = api;
})(typeof window !== 'undefined' ? window : globalThis);
