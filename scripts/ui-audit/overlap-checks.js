// 页面内执行的重叠检查（由 overlap-sweep-lib.cjs 注入；脚本 overlap-sweep.cjs 和 e2e 测试 overlap-sweep.e2e.mjs 共用这一份）。
// 参数 { scope: 选择器或 null }，返回 { overlap, clipped, offscreen, allowed, counts }：
//   overlap   两个看得见的小元素（按钮、链接、输入框、文字、图标、徽标）互相压住超过 2px，并且在重叠处确实有一个盖住了另一个
//   clipped   文字被切掉又没有省略号（自己 overflow 隐藏且装不下，或被外层 overflow 隐藏的容器切掉一部分）
//   offscreen 元素伸出窗口左右边缘，或整个页面出现横向滚动条
//   allowed   被下面的白名单放过的数量，按规则统计（用来发现规则太宽）
// 只用标准 DOM，不依赖应用代码。
(opts) => {
  opts = opts || {};
  // scope：选择器（可以匹配多个根，例如刚弹出的几个浮层）；不给就查整个页面
  const roots = opts.scope ? [...document.querySelectorAll(opts.scope)] : [document.body];
  const scope = roots[0];
  const out = { overlap: [], clipped: [], offscreen: [], allowed: {}, samples: {}, counts: { candidates: 0 } };
  if (!scope) return out;
  const W = innerWidth, H = innerHeight;

  // ============================ 白名单（所有「故意重叠／故意裁切」只在这里登记，每条写清原因）============================
  // a、b 是两个元素的信息：{ el, tag, cls, kind: 'ctrl'|'text'|'icon'|'badge', box: {l,t,r,b}, pos: 计算后的 position, abs: 自己或祖先是否 absolute/fixed 定位 }
  const inside = (x, y) => x.l >= y.l - 1.5 && x.r <= y.r + 1.5 && x.t >= y.t - 1.5 && x.b <= y.b + 1.5;
  const isField = (i) => i.tag === 'input' || i.tag === 'select' || i.tag === 'textarea';
  const OVERLAP_ALLOW = [
    {
      id: 'badge-on-icon',
      reason: '数字角标（左栏邮件的红点、各处计数）故意压在图标的角上',
      test: (a, b) => b.kind === 'badge' && b.abs && a.kind === 'icon' && !!a.el.closest('button, a') && a.el.closest('button, a') === b.el.closest('button, a'),
    },
    {
      id: 'frozen-actions-column',
      reason: '客户表格最右「操作」列冻结（position: sticky），横向滚动时盖住后面的列，是设计',
      test: (a, b) => { const c = a.el.closest('.actions-col'); return !!c && !c.contains(b.el) && !!b.el.closest('table') && c.closest('table') === b.el.closest('table') && getComputedStyle(c).position === 'sticky'; },
    },
    {
      id: 'icon-inside-input',
      reason: '输入框／下拉框里面故意放的图标和小按钮（下拉箭头、清除、搜索图标），输入框右边留了位置',
      test: (a, b) => isField(a) && (b.kind === 'icon' || b.kind === 'ctrl') && b.abs && inside(b.box, a.box),
    },
    {
      id: 'text-in-ring',
      reason: '环形进度、图表的 svg 当背景，文字故意写在它里面',
      test: (a, b) => a.kind === 'icon' && a.box.r - a.box.l >= 40 && a.box.b - a.box.t >= 40 && b.kind !== 'icon' && inside(b.box, a.box),
    },
    {
      id: 'sort-arrows',
      reason: '表头排序的上下两个小三角，两个 13px 的图标盒子故意各让 3px 靠在一起（图形本身不重叠）',
      test: (a, b) => a.kind === 'icon' && b.kind === 'icon' && !!a.el.closest('.column-sort') && a.el.closest('.column-sort') === b.el.closest('.column-sort'),
    },
  ];
  const CLIPPED_ALLOW = [
    {
      id: 'carousel-strip',
      reason: '客户详情里的活动类型标签条是带左右翻页箭头的轮播（外层 overflow 隐藏、里面 translateX 移动），被切掉的标签点箭头翻过去就能看到',
      test: (f) => !!f.el.closest('.lcd-activity-clip'),
    },
  ];
  const OFFSCREEN_ALLOW = [
  ];
  // ===========================================================================================================================

  const gcs = (() => { const m = new Map(); return (e) => { let s = m.get(e); if (!s) { s = getComputedStyle(e); m.set(e, s); } return s; }; })();
  const NONE = { l: -Infinity, t: -Infinity, r: Infinity, b: Infinity };
  const inter = (a, b) => ({ l: Math.max(a.l, b.l), t: Math.max(a.t, b.t), r: Math.min(a.r, b.r), b: Math.min(a.b, b.b) });
  const empty = (a, min = 1) => a.r - a.l < min || a.b - a.t < min;
  const toBox = (r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom });
  const opCache = new Map();
  const opacityOf = (e) => {
    if (!e || e === document.documentElement) return 1;
    let v = opCache.get(e);
    if (v === undefined) { v = (parseFloat(gcs(e).opacity) || 0) * opacityOf(e.parentElement); opCache.set(e, v); }
    return v;
  };
  const padBox = (p) => {
    const r = p.getBoundingClientRect(), s = gcs(p);
    return { l: r.left + (parseFloat(s.borderLeftWidth) || 0), t: r.top + (parseFloat(s.borderTopWidth) || 0), r: r.right - (parseFloat(s.borderRightWidth) || 0), b: r.bottom - (parseFloat(s.borderBottomWidth) || 0) };
  };
  const padCache = new Map();
  const padOf = (p) => { let v = padCache.get(p); if (!v) { v = padBox(p); padCache.set(p, v); } return v; };
  const makesCB = (s) => s.position !== 'static' || s.transform !== 'none' || s.filter !== 'none' || /paint|layout/.test(s.contain || '') || s.willChange === 'transform';
  // 祖先里 overflow 不是 visible 的容器把元素切成什么样：返回切口，并记下是哪个祖先在切（hidden：hidden／clip，不含可滚动的 auto／scroll）
  const clipInfo = (e, forText) => {
    let c = NONE, mode = gcs(e).position;
    const cutters = [];
    for (let p = e.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const s = gcs(p);
      const cb = makesCB(s);
      if (mode === 'fixed' && !cb) continue;
      if (mode === 'absolute' && !cb) continue;
      const ox = s.overflowX, oy = s.overflowY;
      if (ox !== 'visible' || oy !== 'visible') {
        const b = padOf(p);
        // 文字：带省略号的祖先在内容区右边缘收住文字（不是 padding 的边缘）
        const shrink = forText && s.textOverflow === 'ellipsis' ? { l: b.l + (parseFloat(s.paddingLeft) || 0), r: b.r - (parseFloat(s.paddingRight) || 0) } : b;
        const bb = { l: ox !== 'visible' ? shrink.l : -Infinity, r: ox !== 'visible' ? shrink.r : Infinity, t: oy !== 'visible' ? b.t : -Infinity, b: oy !== 'visible' ? b.b : Infinity };
        c = inter(c, bb);
        cutters.push({ el: p, ox, oy, b: bb, hidden: /hidden|clip/.test(ox + oy) });
      }
      mode = s.position === 'static' && cb ? 'relative' : s.position;
    }
    return { clip: c, cutters };
  };
  const shortSel = (e) => {
    const parts = [];
    for (let n = e; n && n.nodeType === 1 && parts.length < 3; n = n.parentElement) {
      const cls = typeof n.className === 'string' ? n.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.') : '';
      parts.push(n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (cls ? '.' + cls : ''));
    }
    return parts.join(' < ');
  };
  const textOf = (e) => ((e.innerText || e.value || e.getAttribute('aria-label') || e.getAttribute('title') || '') + '').trim().replace(/\s+/g, ' ').slice(0, 30);
  const rnd = (b) => ({ l: Math.round(b.l), t: Math.round(b.t), r: Math.round(b.r), b: Math.round(b.b) });

  // ---- 收集候选 ----
  const CTRL = 'button, a, input, select, textarea, label, summary, img, canvas, [role=button], [role=tab], [role=menuitem], [role=option]';
  const BADGE = /(^|[\s_-])(badge|tag|chip|pill|dot|count)([\s_-]|$)/i;
  const SKIP_TEXT = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'OPTION', 'OPTGROUP', 'TEXTAREA', 'TITLE', 'SELECT']);
  const cands = [];
  const seenEl = new Map(); // el → { ok, clip, cutters }
  // 没画出来的内容：收起的 <details>（除了 summary）和 content-visibility:hidden 里面的东西，量出来的盒子是旧的，不能当真
  const notRendered = (e) => {
    for (let c = e, p = e.parentElement; p && p !== document.documentElement; c = p, p = p.parentElement) {
      if (p.tagName === 'DETAILS' && !p.open && c.tagName !== 'SUMMARY') return true;
      if (gcs(p).contentVisibility === 'hidden') return true;
    }
    return false;
  };
  const prep = (e) => {
    let v = seenEl.get(e);
    if (v) return v;
    const s = gcs(e);
    v = { ok: s.visibility === 'visible' && s.display !== 'none' && opacityOf(e) > 0.05 && !notRendered(e), ...clipInfo(e) };
    seenEl.set(e, v);
    return v;
  };
  const posAbs = (e) => { for (let n = e; n && n !== document.body; n = n.parentElement) { const p = gcs(n).position; if (p === 'absolute' || p === 'fixed') return true; } return false; };
  const add = (e, kind, box, tn) => {
    const v = prep(e);
    if (!v.ok) return;
    let clip = v.clip, cut = v.cutters;
    if (tn) {
      if (!v.text) v.text = clipInfo(e, true);
      clip = v.text.clip; cut = v.text.cutters; // 文字片段还要被自己的 overflow 切（带省略号的元素：文字的原始宽度会超出自己的盒子）
      const s = gcs(e);
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
        const b = { ...padOf(e) }, x = s.overflowX !== 'visible', y = s.overflowY !== 'visible';
        if (s.textOverflow === 'ellipsis') { b.l += parseFloat(s.paddingLeft) || 0; b.r -= parseFloat(s.paddingRight) || 0; } // 省略号在内容区的右边缘收住，不是在 padding 的右边缘
        const bb = { l: x ? b.l : -Infinity, r: x ? b.r : Infinity, t: y ? b.t : -Infinity, b: y ? b.b : Infinity };
        clip = inter(clip, bb);
        cut = [{ el: e, ox: s.overflowX, oy: s.overflowY, b: bb, hidden: /hidden|clip/.test(s.overflowX + s.overflowY), self: true }, ...cut];
      }
    }
    const vis = inter(box, clip);
    if (empty(vis, 1)) return; // 被外层完全切掉（折叠、滚到看不见）：按「不可见」处理
    cands.push({ el: e, kind, tn: !!tn, full: box, vis, cut, tag: e.tagName.toLowerCase() });
  };
  const all = [...new Set(roots.flatMap((r) => (r === document.body ? [] : [r]).concat([...r.querySelectorAll('*')])))];
  for (const e of all) {
    const tag = e.tagName.toLowerCase();
    if (tag !== 'svg' && e.closest('svg')) continue;
    if (tag === 'svg') {
      if (e.parentElement && e.parentElement.closest('svg')) continue;
      const b = toBox(e.getBoundingClientRect());
      if (b.r - b.l >= 3 && b.b - b.t >= 3) add(e, 'icon', b);
      continue;
    }
    if (e.matches(CTRL)) {
      if (tag === 'input' && e.type === 'hidden') continue;
      const b = toBox(e.getBoundingClientRect());
      if (b.r - b.l >= 3 && b.b - b.t >= 3) add(e, 'ctrl', b);
    } else if (typeof e.className === 'string' && BADGE.test(e.className)) {
      const b = toBox(e.getBoundingClientRect());
      if (b.r - b.l >= 3 && b.b - b.t >= 3) add(e, 'badge', b);
    }
    if (!SKIP_TEXT.has(e.tagName) && !(e.parentElement && e.parentElement.closest('select, textarea'))) {
      for (const n of e.childNodes) {
        if (n.nodeType !== 3 || !n.nodeValue.trim()) continue;
        const rg = document.createRange();
        rg.selectNodeContents(n);
        for (const r of rg.getClientRects()) if (r.width >= 2 && r.height >= 2) add(e, 'text', toBox(r), true);
      }
    }
  }
  // 里面还装着别的小元素（图标、文字、徽标）的按钮／链接／标签：只用里面的内容参与比较，外框不算
  // （邮件列表一整行是个大按钮，右边的小按钮故意叠在它的空白处）。
  const inner = new Set();
  for (const c of cands) for (let n = c.el.parentElement; n && n !== document.body; n = n.parentElement) inner.add(n);
  for (let i = cands.length - 1; i >= 0; i--) {
    const c = cands[i];
    if (c.kind === 'ctrl' && !/^(input|select|textarea|img|canvas)$/.test(c.tag) && inner.has(c.el)) cands.splice(i, 1);
  }
  out.counts.candidates = cands.length;

  const info = (c) => ({ el: c.el, tag: c.tag, cls: typeof c.el.className === 'string' ? c.el.className : '', kind: c.kind, box: c.vis, full: c.full, abs: posAbs(c.el), pos: gcs(c.el).position, text: c.kind === 'text' ? c.el.textContent.trim().slice(0, 30) : textOf(c.el) });
  const allowed = (list, ...args) => { for (const rule of list) { let hit = false; try { hit = rule.test(...args); } catch (_) { hit = false; } if (hit) {
      out.allowed[rule.id] = (out.allowed[rule.id] || 0) + 1;
      const smp = (out.samples[rule.id] = out.samples[rule.id] || []);
      if (smp.length < 3) smp.push(args.map((x) => shortSel(x.el).split(' < ')[0] + '「' + (x.text || '').slice(0, 10) + '」').join(' ~ '));
      return true;
    } } return false; };

  // ---- (a) 重叠 ----
  const view = { l: 0, t: 0, r: W, b: H };
  const order = cands.map((c, i) => i).sort((x, y) => cands[x].vis.l - cands[y].vis.l);
  const reported = new Set();
  const idOf = new Map();
  const nodeId = (e) => { let v = idOf.get(e); if (v === undefined) { v = idOf.size; idOf.set(e, v); } return v; };
  for (let ii = 0; ii < order.length; ii++) {
    const A = cands[order[ii]];
    for (let jj = ii + 1; jj < order.length; jj++) {
      const B = cands[order[jj]];
      if (B.vis.l >= A.vis.r - 2) break; // 按左边排序：后面的都在 A 右边了
      if (A.el === B.el) continue;
      const ix = Math.min(A.vis.r, B.vis.r) - Math.max(A.vis.l, B.vis.l);
      const iy = Math.min(A.vis.b, B.vis.b) - Math.max(A.vis.t, B.vis.t);
      if (ix <= 2 || iy <= 2) continue;
      // 包含关系：DOM 里一个装着另一个就不算（按钮里的图标、标签里的输入框）；但元素自己的文字片段要和它里面的子元素比
      if (A.el.contains(B.el) && !A.tn) continue;
      if (B.el.contains(A.el) && !B.tn) continue;
      if (A.tn && B.tn && (A.el.contains(B.el) || B.el.contains(A.el))) continue;
      const ia = nodeId(A.el), ib = nodeId(B.el);
      const key = ia < ib ? ia + ':' + ib : ib + ':' + ia;
      if (reported.has(key)) continue;
      // 在两者的重叠区取样：最上层是其中一个（的子孙）才算真的有一个盖住了另一个；最上层是第三个元素（弹层、遮罩）就跳过这个点
      const box = inter(inter(A.vis, B.vis), view);
      if (empty(box, 1)) continue;
      let hit = false;
      for (const fx of [0.5, 0.15, 0.85]) {
        for (const fy of [0.5, 0.15, 0.85]) {
          const x = box.l + (box.r - box.l) * fx, y = box.t + (box.b - box.t) * fy;
          const t = document.elementFromPoint(x, y);
          if (t && (A.el.contains(t) || B.el.contains(t))) { hit = true; break; }
        }
        if (hit) break;
      }
      if (!hit) continue;
      reported.add(key);
      const a = info(A), b = info(B);
      if (allowed(OVERLAP_ALLOW, a, b) || allowed(OVERLAP_ALLOW, b, a)) continue;
      out.overlap.push({ a: { sel: shortSel(A.el), text: a.text, kind: A.kind, box: rnd(A.vis) }, b: { sel: shortSel(B.el), text: b.text, kind: B.kind, box: rnd(B.vis) }, inter: rnd(box) });
    }
  }

  // ---- (b) 文字被切掉没有省略号 ----
  const clippedSeen = new Set();
  const ellipsisOrClamp = (s) => s.textOverflow === 'ellipsis' || (s.getPropertyValue('-webkit-line-clamp') || 'none') !== 'none';
  for (const e of all) {
    const tag = e.tagName.toLowerCase();
    if (e.closest('svg') || tag === 'input' || tag === 'select' || tag === 'textarea' || SKIP_TEXT.has(e.tagName)) continue;
    const s = gcs(e);
    if (!/hidden|clip/.test(s.overflowX + s.overflowY)) continue;
    if (s.display === 'none' || s.visibility !== 'visible') continue;
    const hasText = [...e.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim()) || (!e.children.length && e.textContent.trim());
    if (!hasText) continue;
    const v = prep(e);
    if (!v.ok) continue;
    const r = e.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || empty(inter(toBox(r), v.clip), 1)) continue; // 窄到 4px 以下的是收起来的（悬停才展开的标签），不算
    const overW = e.clientWidth > 0 && e.scrollWidth - e.clientWidth > 1 && /hidden|clip/.test(s.overflowX);
    const overH = e.clientHeight > 0 && e.scrollHeight - e.clientHeight > 1 && /hidden|clip/.test(s.overflowY);
    if (!overW && !overH) continue;
    if (ellipsisOrClamp(s)) continue;
    clippedSeen.add(e);
    const f = { el: e, tag, cls: typeof e.className === 'string' ? e.className : '', text: textOf(e), box: toBox(r), how: overW ? '宽 ' + e.scrollWidth + ' > ' + e.clientWidth : '高 ' + e.scrollHeight + ' > ' + e.clientHeight };
    if (allowed(CLIPPED_ALLOW, f)) continue;
    out.clipped.push({ sel: shortSel(e), text: f.text, how: f.how, box: rnd(f.box) });
  }
  // 被外层 overflow 隐藏的容器切掉一部分的文字（宽度或高度丢了 2px 以上）：外层或自己有省略号／行数限制就算有处理
  const seenTextEl = new Set();
  for (const c of cands) {
    if (c.kind !== 'text' || seenTextEl.has(c.el)) continue;
    if (!c.cut.some((x) => x.hidden)) continue;
    // 每个方向单独算丢了多少：中间隔着可滚动的容器（auto／scroll）就能滚出来，不算丢；只有 hidden／clip 切掉的才算
    let l = c.full.l, r = c.full.r, t = c.full.t, b = c.full.b, xDone = false, yDone = false;
    for (const k of c.cut) {
      if (!xDone) { if (k.ox === 'auto' || k.ox === 'scroll') xDone = true; else if (k.ox !== 'visible') { l = Math.max(l, k.b.l); r = Math.min(r, k.b.r); } }
      if (!yDone) { if (k.oy === 'auto' || k.oy === 'scroll') yDone = true; else if (k.oy !== 'visible') { t = Math.max(t, k.b.t); b = Math.min(b, k.b.b); } }
    }
    const lostW = (c.full.r - c.full.l) - Math.max(0, r - l), lostH = (c.full.b - c.full.t) - Math.max(0, b - t);
    if (lostW <= 2 && lostH <= 2) continue;
    let handled = false;
    for (let n = c.el; !handled && n && n !== document.body; n = n.parentElement) if (ellipsisOrClamp(gcs(n))) handled = true;
    if (handled) continue;
    seenTextEl.add(c.el);
    if (clippedSeen.has(c.el)) continue;
    const cutter = c.cut.find((x) => x.hidden).el;
    const f = { el: c.el, tag: c.tag, cls: typeof c.el.className === 'string' ? c.el.className : '', text: c.el.textContent.trim().slice(0, 30), box: c.full, cutter, how: '被外层切掉 ' + Math.round(Math.max(lostW, lostH)) + 'px' };
    if (allowed(CLIPPED_ALLOW, f)) continue;
    out.clipped.push({ sel: shortSel(c.el), text: f.text, how: f.how + '（' + shortSel(cutter).split(' < ')[0] + '）', box: rnd(c.full) });
  }

  // ---- (c) 伸出窗口左右边缘／整页横向滚动 ----
  const de = document.documentElement;
  if (!opts.scope) {
    const sw = Math.max(de.scrollWidth, document.body.scrollWidth);
    if (sw > W + 1) out.offscreen.push({ sel: 'html', text: '整页横向滚动', how: 'scrollWidth ' + sw + ' > ' + W, box: { l: 0, t: 0, r: sw, b: 0 } });
  }
  const offSeen = new Set();
  for (const c of cands) {
    if (offSeen.has(c.el)) continue;
    const v = seenEl.get(c.el);
    const b = inter(c.full, v.clip); // 先只用外层切口，不用窗口
    if (empty(b, 1)) continue;
    if (b.r <= 0 || b.l >= W) continue; // 整个在窗口外（关着的抽屉、屏幕外的隐藏项）：按「不可见」处理
    if (b.r <= W + 1 && b.l >= -1) continue;
    const f = { el: c.el, tag: c.tag, cls: typeof c.el.className === 'string' ? c.el.className : '', kind: c.kind, box: b, text: c.kind === 'text' ? c.el.textContent.trim().slice(0, 30) : textOf(c.el) };
    offSeen.add(c.el);
    if (allowed(OFFSCREEN_ALLOW, f)) continue;
    out.offscreen.push({ sel: shortSel(c.el), text: f.text, how: b.r > W + 1 ? '右边伸出 ' + Math.round(b.r - W) + 'px' : '左边伸出 ' + Math.round(-b.l) + 'px', box: rnd(b) });
  }
  return out;
}
