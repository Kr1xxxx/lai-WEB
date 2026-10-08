/* 来财Lai 网页试用版：「试用数据」按钮和面板。
   在左侧栏底部放一个按钮，点开是一张浅色卡片：当前数据、载入示例数据、备份与恢复、清空。
   数据保存在浏览器里（由数据替身脚本提供的 window.LaiWebTrial 读写）；网页里不能下载文件，所以备份用复制和粘贴。
   样式同时适配两套界面：小满（深蓝左栏）和粉色、橙色新界面（浅色玻璃左栏）。
   发布试用版时把本文件作为一个 <script> 放在数据替身脚本之后。 */
(function () {
  'use strict';
  var INK = 'var(--skin-ink-rgb, 35, 23, 32)', BRAND = 'var(--brand-500, #be185d)';
  var CSS = [
    // ---- 按钮：放在左侧栏底部、应用自带「刷新」按钮的正上方，是左侧栏自己的空间，不会压到页面内容 ----
    '#lai-web-data-button{position:absolute;left:8px;bottom:80px;z-index:10;width:56px;height:44px;padding:0;border:1px dashed rgba(183,189,210,.55);border-radius:10px;background:#0c163d;box-shadow:0 -13px 18px 8px #0c163d;color:#b7bdd2;font:12px/1.3 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;cursor:pointer}',
    '#lai-web-data-button:hover,#lai-web-data-button:focus-visible,#lai-web-data-button[aria-expanded="true"]{background:#222c57;color:#fff}',
    ':root[data-skin="glass"] #lai-web-data-button{left:18px;bottom:84px;border-color:rgba(' + INK + ',.3);background:rgba(255,255,255,.94);box-shadow:none;color:rgb(' + INK + ')}',
    ':root[data-skin="glass"] #lai-web-data-button:hover,:root[data-skin="glass"] #lai-web-data-button:focus-visible,:root[data-skin="glass"] #lai-web-data-button[aria-expanded="true"]{background:#fff;border-color:' + BRAND + ';color:' + BRAND + '}',
    '.rail{padding-bottom:12px !important}',
    '.rail::after{content:"";order:1;flex:0 0 56px}',
    '.rail .rail-refresh{position:sticky !important;left:auto !important;bottom:0 !important;order:2;margin-top:auto}',
    // ---- 面板 ----
    '#lai-web-panel{position:absolute;left:80px;bottom:12px;z-index:30;box-sizing:border-box;width:min(400px,calc(100vw - 24px));max-height:calc(100vh - 76px);overflow:auto;padding:16px;border:1px solid rgba(' + INK + ',.1);border-radius:14px;background:#fff;color:rgb(' + INK + ');font:13px/1.55 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;box-shadow:0 14px 32px rgba(' + INK + ',.18),0 2px 6px rgba(' + INK + ',.08)}',
    ':root[data-skin="glass"] #lai-web-panel{left:92px}',
    '#lai-web-panel[hidden]{display:none}',
    '#lai-web-panel *{box-sizing:border-box}',
    '#lai-web-panel .lw-head{display:flex;align-items:center;justify-content:space-between;margin:0 0 10px}',
    '#lai-web-panel h2{margin:0;font-size:15px;font-weight:700}',
    '#lai-web-panel h3{margin:0 0 4px;font-size:13px;font-weight:700}',
    '#lai-web-panel .lw-x{width:26px;height:26px;padding:0;border:0;border-radius:8px;background:transparent;color:rgba(' + INK + ',.55);font-size:18px;line-height:1;cursor:pointer}',
    '#lai-web-panel .lw-x:hover{background:rgba(' + INK + ',.07);color:rgb(' + INK + ')}',
    '#lai-web-panel .lw-stats{display:flex;gap:8px;margin:0 0 8px}',
    '#lai-web-panel .lw-stat{flex:1;padding:8px 10px;border-radius:10px;background:rgba(' + INK + ',.05)}',
    '#lai-web-panel .lw-stat b{display:block;font-size:20px;line-height:1.2}',
    '#lai-web-panel .lw-stat span{font-size:11px;color:rgba(' + INK + ',.6)}',
    '#lai-web-panel .lw-note{margin:0 0 12px;font-size:12px;color:rgba(' + INK + ',.62)}',
    '#lai-web-panel .lw-warn{margin:0 0 8px;padding:6px 10px;border-radius:8px;background:#fdecea;color:#b02a1c;font-size:12px}',
    '#lai-web-panel .lw-block{margin:0 0 12px;padding:12px;border:1px solid rgba(' + INK + ',.08);border-radius:12px}',
    '#lai-web-panel .lw-block p{margin:0 0 8px;font-size:12px;color:rgba(' + INK + ',.68)}',
    '#lai-web-panel details{margin:0 0 12px;border:1px solid rgba(' + INK + ',.08);border-radius:12px}',
    '#lai-web-panel summary{padding:10px 12px;font-weight:700;cursor:pointer;list-style:none}',
    '#lai-web-panel summary::-webkit-details-marker{display:none}',
    '#lai-web-panel summary::after{content:"›";float:right;color:rgba(' + INK + ',.5);transition:transform .15s}',
    '#lai-web-panel details[open] summary::after{transform:rotate(90deg)}',
    '#lai-web-panel .lw-inner{padding:0 12px 12px}',
    '#lai-web-panel .lw-inner h3{margin-top:8px}',
    '#lai-web-panel textarea{width:100%;height:68px;margin:0 0 6px;padding:6px 8px;border:1px solid rgba(' + INK + ',.14);border-radius:8px;background:rgba(' + INK + ',.03);color:rgb(' + INK + ');font:11px/1.4 ui-monospace,Menlo,Consolas,monospace;resize:vertical}',
    '#lai-web-panel .lw-btn{height:30px;padding:0 12px;border:1px solid rgba(' + INK + ',.16);border-radius:8px;background:#fff;color:rgb(' + INK + ');font:inherit;cursor:pointer}',
    '#lai-web-panel .lw-btn:hover{border-color:' + BRAND + ';color:' + BRAND + '}',
    '#lai-web-panel .lw-primary{border-color:rgb(' + INK + ');background:rgb(' + INK + ');color:#fff;font-weight:700}',
    '#lai-web-panel .lw-primary:hover{border-color:rgb(' + INK + ');color:#fff;opacity:.9}',
    '#lai-web-panel .lw-danger{border-color:#c0392b;color:#c0392b}',
    '#lai-web-panel .lw-danger:hover{border-color:#c0392b;color:#c0392b;background:#fdecea}',
    '#lai-web-panel .lw-armed,#lai-web-panel .lw-armed:hover{background:#c0392b;border-color:#c0392b;color:#fff}',
    '#lai-web-panel button:focus-visible,#lai-web-panel textarea:focus-visible,#lai-web-panel summary:focus-visible,#lai-web-data-button:focus-visible{outline:2px solid ' + BRAND + ';outline-offset:2px}',
    '#lai-web-msg{min-height:1.5em;margin:0;font-size:12px;color:#1e6b3a}#lai-web-msg.lw-bad{color:#b02a1c}'
  ].join('\n');

  function mount() {
    var trial = window.LaiWebTrial;
    if (!trial || document.getElementById('lai-web-data-button')) return;
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    var button = document.createElement('button');
    button.id = 'lai-web-data-button'; button.type = 'button'; button.textContent = '试用数据';
    button.title = '网页试用版数据：载入示例数据、备份、恢复、清空'; button.setAttribute('aria-expanded', 'false');
    var panel = document.createElement('section');
    panel.id = 'lai-web-panel'; panel.hidden = true; panel.setAttribute('aria-label', '网页试用版数据');
    panel.innerHTML =
      '<div class="lw-head"><h2>试用数据</h2><button type="button" class="lw-x" id="lai-web-close" aria-label="关闭">×</button></div>' +
      '<p class="lw-warn" id="lai-web-nostore" hidden>当前环境不能保存数据，刷新页面会丢失。</p>' +
      '<div class="lw-stats"><div class="lw-stat"><b id="lai-web-customers">0</b><span>位客户</span></div><div class="lw-stat"><b id="lai-web-orders">0</b><span>笔订单</span></div></div>' +
      '<p class="lw-note">数据只保存在你当前这个浏览器里，不会上传，也不会同步到其他设备。换浏览器、清除网站数据或用无痕窗口都会看不到它。</p>' +
      '<div class="lw-block"><h3>示例数据</h3><p>载入 7 家美国、欧洲睫毛公司的客户、订单、商机和待办（邮件页的示例邮件始终都在）。会替换当前的客户和订单。</p>' +
      '<button type="button" class="lw-btn lw-primary" id="lai-web-demo">载入示例数据</button></div>' +
      '<details><summary>备份与恢复</summary><div class="lw-inner">' +
      '<h3>备份</h3><textarea id="lai-web-backup" readonly aria-label="备份内容"></textarea>' +
      '<button type="button" class="lw-btn" id="lai-web-copy">复制备份</button>' +
      '<h3>从备份恢复</h3><textarea id="lai-web-restore" aria-label="粘贴备份内容" placeholder="把之前复制的备份粘贴到这里"></textarea>' +
      '<button type="button" class="lw-btn" id="lai-web-restore-button">恢复备份</button></div></details>' +
      '<div class="lw-block"><h3>清空</h3><p>删除这个浏览器里的全部客户和订单。</p>' +
      '<button type="button" class="lw-btn lw-danger" id="lai-web-clear">清空全部数据</button></div>' +
      '<p id="lai-web-msg" role="status" aria-live="polite"></p>';
    // 挂在页面舞台里，窗口变窄出现横向滚动时会跟着左侧栏一起移动，而不是悬在别的内容上。
    var host = document.getElementById('lai-stage') || document.body;
    host.appendChild(panel);
    host.appendChild(button);

    var $ = function (id) { return panel.querySelector('#' + id); };
    function say(text, bad) { $('lai-web-msg').textContent = text; $('lai-web-msg').className = bad ? 'lw-bad' : ''; }
    function refresh() {
      var s = trial.stats();
      $('lai-web-customers').textContent = s.customers; $('lai-web-orders').textContent = s.orders;
      $('lai-web-nostore').hidden = trial.persistent();
      $('lai-web-backup').value = trial.snapshot();
    }
    function setOpen(open) {
      panel.hidden = !open; button.setAttribute('aria-expanded', String(open));
      if (open) { refresh(); say(''); }
    }
    function reload(text) {
      say(text + '正在刷新页面；如果没有自动刷新，请手动刷新。');
      setTimeout(function () { try { location.reload(); } catch (error) {} }, 600);
    }
    // 会替换数据的按钮：第一次点击先变成「再点一次确认」，5 秒内再点才执行。
    function armed(target, label, action, needsConfirm) {
      var timer = null;
      target.addEventListener('click', function () {
        if (!timer && (!needsConfirm || needsConfirm())) {
          target.textContent = '再点一次确认'; target.classList.add('lw-armed');
          timer = setTimeout(function () { timer = null; target.textContent = label; target.classList.remove('lw-armed'); }, 5000);
          return;
        }
        if (timer) clearTimeout(timer);
        timer = null; target.textContent = label; target.classList.remove('lw-armed');
        try { action(); } catch (error) { say(error.message, true); }
      });
    }

    button.addEventListener('click', function () { setOpen(panel.hidden); });
    $('lai-web-close').addEventListener('click', function () { setOpen(false); button.focus(); });
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && !panel.hidden) { setOpen(false); button.focus(); } });
    $('lai-web-copy').addEventListener('click', function () {
      var area = $('lai-web-backup'); area.value = trial.snapshot();
      var done = function () { say('备份已复制。'); };
      var fallback = function () { area.focus(); area.select(); say('请按 Ctrl+C（苹果电脑按 Cmd+C）复制上面选中的内容。'); };
      try { navigator.clipboard.writeText(area.value).then(done, fallback); } catch (error) { fallback(); }
    });
    armed($('lai-web-demo'), '载入示例数据', function () {
      var seed = window.LaiWebTrialDemoSeed;
      if (!seed) throw new Error('这个版本没有带示例数据');
      trial.restore(JSON.stringify(seed.build(new Date()))); refresh();
      reload('示例数据已载入。');
    }, function () { var s = trial.stats(); return s.customers + s.orders > 0; });
    armed($('lai-web-restore-button'), '恢复备份', function () {
      trial.restore($('lai-web-restore').value);
      $('lai-web-restore').value = ''; refresh();
      reload('已恢复。');
    }, function () { return true; });
    armed($('lai-web-clear'), '清空全部数据', function () {
      trial.clear(); refresh();
      reload('已清空。');
    }, function () { return true; });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
