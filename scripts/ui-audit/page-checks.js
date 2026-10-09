// 页面内执行的检查（由 ui-audit.cjs 注入）：返回 covered（被别的东西盖住的文字／按钮）、spill（文字溢出容器）、dd（下拉框样式签名）。
(scope) => {
  const root = scope ? document.querySelector(scope) : document;
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
  const path = (e) => { const p = []; while (e && e.nodeType === 1 && p.length < 4) { let c = typeof e.className === 'string' ? e.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.') : ''; p.push(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (c ? '.' + c : '')); e = e.parentElement; } return p.join(' < '); };
  const txt = (e) => (e.innerText || e.value || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 24);
  const out = { covered: [], spill: [], dd: [] };
  // 1 被遮挡：元素中心点（和左右两侧四分之一处）最上层不是它自己或它的子孙/祖先
  const cand = root.querySelectorAll('button, a, label, h1, h2, h3, th, td, input, select, textarea, [role=tab], .rail-item span, .nav-label, .sh-text strong, .opp-card-name, .lcd-card h3');
  for (const e of cand) {
    if (!vis(e)) continue;
    const r = e.getBoundingClientRect();
    const pts = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + r.width * 0.2, r.top + r.height / 2], [r.left + r.width * 0.8, r.top + r.height / 2]];
    let hit = 0, by = null;
    for (const [x, y] of pts) {
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
      const t = document.elementFromPoint(x, y);
      if (!t || t === e || e.contains(t) || t.contains(e)) continue;
      if (e.labels && [...e.labels].some(l => l.contains(t))) continue;
      if (t.closest('label') && t.closest('label').contains(e)) continue;
      hit++; by = t;
    }
    if (hit >= 2) out.covered.push({ el: path(e), text: txt(e), by: path(by), byText: txt(by) });
  }
  // 2 文字溢出：没有子元素的文字节点超出自己的盒子，且没有省略号处理
  for (const e of root.querySelectorAll('span, b, strong, em, label, button, a, h1, h2, h3, td, th, p, div')) {
    if (!vis(e) || e.children.length) continue;
    const s = getComputedStyle(e);
    if (!e.textContent.trim()) continue;
    const over = e.scrollWidth - e.clientWidth;
    if (over > 3 && s.textOverflow !== 'ellipsis' && e.clientWidth > 0) out.spill.push({ el: path(e), text: txt(e), over, ov: s.overflow });
  }
  // 3 下拉框：原生 select 和自绘的下拉触发按钮
  const triggers = [...root.querySelectorAll('select'), ...root.querySelectorAll('[aria-haspopup], [aria-expanded], .select-trigger, .dropdown-trigger, [class*="select"]:is(button), [class*="dropdown"]:is(button), [class*="filter"]:is(button)')];
  const seen = new Set();
  for (const e of triggers) {
    if (seen.has(e) || !vis(e)) continue; seen.add(e);
    if (e.matches('.rail-item, .lcd-info-toggle, .lcd-card-toggle, details > summary')) continue;
    const s = getComputedStyle(e), r = e.getBoundingClientRect();
    const after = getComputedStyle(e, '::after');
    const arrow = e.tagName === 'SELECT' ? (s.backgroundImage !== 'none' ? 'bg' : s.appearance !== 'none' ? 'native' : 'none') : (e.querySelector('svg') ? 'svg' : after.content && after.content !== 'none' ? 'after' : /[▾▼⌄˅]/.test(e.textContent) ? 'char' : 'none');
    out.dd.push({ el: path(e), text: txt(e), tag: e.tagName.toLowerCase(), h: Math.round(r.height), w: Math.round(r.width), rad: s.borderRadius, bw: s.borderTopWidth, bc: s.borderTopColor, bg: s.backgroundColor, fs: s.fontSize, fw: s.fontWeight, ff: s.fontFamily.split(',')[0].trim(), pl: s.paddingLeft, color: s.color, arrow, ap: s.appearance });
  }
  return out;
}
