import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import XLSX from "../vendor/sheetjs-0.20.3/xlsx.full.min.js";

const app = process.env.LAI_ACCEPTANCE_APP || path.resolve("dist/来财Lai.app");
const resources = path.join(app, "Contents/Resources");
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const evidence = path.resolve(process.env.LAI_MOTION_EVIDENCE || "evidence/ui-1.4.7/full-motion");
const temporary = fs.mkdtempSync(
  path.join(fs.realpathSync(os.tmpdir()), "lai-test-motion-"),
);
const children = [];

const freePort = () =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, label, attempts = 120) {
  for (let index = 0; index < attempts; index += 1) {
    const result = await check().catch(() => null);
    if (result) return result;
    await wait(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  return {
    call(method, params = {}) {
      const id = ++sequence;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    close() {
      socket.close();
    },
  };
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    wait(1500),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

try {
  fs.mkdirSync(evidence, { recursive: true });
  const backendPort = await freePort();
  const token = crypto.randomBytes(32).toString("hex");
  const backend = spawn(
    path.join(resources, "node-runtime"),
    [path.join(resources, "server.js")],
    {
      env: {
        ...process.env,
        LAI_DATA_DIR: path.join(temporary, "database"),
        LAI_APP_PORT: String(backendPort),
        LAI_API_TOKEN: token,
        LAI_INSTANCE_NONCE: "motion-acceptance",
        LAI_APP_NO_OPEN: "1",
      },
      stdio: "ignore",
    },
  );
  children.push(backend);
  const base = `http://127.0.0.1:${backendPort}`;
  await waitFor(
    async () => (await fetch(`${base}/api/health`)).ok,
    "Lai test backend",
  );

  const debugPort = await freePort();
  const browser = spawn(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--disable-default-apps",
      `--user-data-dir=${path.join(temporary, "chrome")}`,
      `--remote-debugging-port=${debugPort}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  children.push(browser);
  const target = await waitFor(async () => {
    const pages = await (
      await fetch(`http://127.0.0.1:${debugPort}/json/list`)
    ).json();
    return pages.find((page) => page.type === "page" && page.webSocketDebuggerUrl);
  }, "headless browser", 400);
  const cdp = await connect(target.webSocketDebuggerUrl);
  await cdp.call("Page.enable");
  await cdp.call("Runtime.enable");
  await cdp.call("Page.addScriptToEvaluateOnNewDocument", {source: "window.__laiImportPreview = true;"});
  await cdp.call("Emulation.setDeviceMetricsOverride", {
    width: 1756,
    height: 1022,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.call("Page.navigate", {
    url: `${base}/trade-order-system.html?token=${encodeURIComponent(token)}#customers`,
  });
  const evaluate = async (expression) => {
    const result = await cdp.call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails)
      throw new Error(`Browser evaluation failed: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`);
    return result.result.value;
  };
  const pointerClick = async (selector) => {
    const point = await evaluate(`(() => {
      const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await cdp.call("Input.dispatchMouseEvent", {
      type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1,
    });
    await cdp.call("Input.dispatchMouseEvent", {
      type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1,
    });
  };
  await waitFor(
    async () =>
      evaluate(
        `document.readyState === "complete" && Boolean(document.querySelector(".company-link"))`,
      ),
    "customer list",
  );
  const quickFilterDefault = await evaluate(`({field:document.querySelector('#search-field')?.value,
    label:document.querySelector('#search-field')?.selectedOptions[0]?.textContent})`);
  assert.deepEqual(quickFilterDefault,{field:'name',label:'公司名称'},'customer list opens with source default field');
  await evaluate(`(() => {const field=document.querySelector('#search-field');field.value='country';field.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  assert.equal(await evaluate(`document.querySelector('#search-field')?.value`),'country');
  await cdp.call('Page.reload');
  await waitFor(async()=>evaluate(`document.readyState === 'complete' && Boolean(document.querySelector('.company-link'))`),'reloaded customer list');
  const quickFilterAfterReload = await evaluate(`({field:document.querySelector('#search-field')?.value,
    label:document.querySelector('#search-field')?.selectedOptions[0]?.textContent})`);
  assert.deepEqual(quickFilterAfterReload,{field:'name',label:'公司名称'},'source resets unsaved quick field after reload');
  const initialListFrame = await cdp.call("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  fs.writeFileSync(
    path.join(evidence, "customer-list-initial.png"),
    Buffer.from(initialListFrame.data, "base64"),
  );
  await pointerClick('#search-field + .lai-select-trigger');
  const quickFieldEntry=await evaluate(`(() => {const m=document.querySelector('.lai-select-menu.is-inline-search'),s=getComputedStyle(m);
    return {name:s.animationName,duration:s.animationDuration,easing:s.animationTimingFunction,origin:s.transformOrigin};})()`);
  assert.deepEqual(quickFieldEntry,{name:'lai-stage-select-in',duration:'0.2s',
    easing:'cubic-bezier(0.23, 1, 0.32, 1)',origin:'0px 0px'},'source-like quick menu entry');
  await waitFor(async()=>evaluate(`getComputedStyle(document.querySelector('.lai-select-menu.is-inline-search')).animationName==='none'`),'quick-field menu settled');
  const quickFieldMenu = await evaluate(`(() => {const m=document.querySelector('.lai-select-menu.is-inline-search');
    const trigger=document.querySelector('#search-field + .lai-select-trigger');
    const r=m.getBoundingClientRect(),a=trigger.getBoundingClientRect(),s=getComputedStyle(m);
    const option=m.querySelector('[role="option"]'),o=getComputedStyle(option),list=m.querySelector('[role="listbox"]');
    return {width:r.width,height:r.height,gap:r.top-a.bottom,padding:s.padding,border:s.borderTopWidth,
      shadow:s.boxShadow,
      listHeight:list.clientHeight,optionHeight:option.getBoundingClientRect().height,
      optionPadding:o.padding,optionLineHeight:o.lineHeight,optionFontSize:o.fontSize};})()`);
  assert.deepEqual(quickFieldMenu,{width:150,height:272,gap:4,padding:'8px 0px',border:'0px',
    shadow:'rgba(0, 0, 0, 0.12) 0px 3px 6px -4px, rgba(0, 0, 0, 0.08) 0px 6px 16px 0px, rgba(0, 0, 0, 0.05) 0px 9px 28px 8px',
    listHeight:256,optionHeight:36,optionPadding:'5px 12px',optionLineHeight:'26px',optionFontSize:'14px'},
    'quick-field dropdown matches observed source geometry');
  const quickMenuFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-quick-field-menu.png'),Buffer.from(quickMenuFrame.data,'base64'));
  await cdp.call('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  const quickFieldExit=await evaluate(`(() => {const m=document.querySelector('.lai-select-menu.is-inline-search'),s=getComputedStyle(m);
    return {name:s.animationName,duration:s.animationDuration,easing:s.animationTimingFunction,inert:m.inert,hidden:m.getAttribute('aria-hidden')};})()`);
  assert.deepEqual(quickFieldExit,{name:'lai-stage-select-out',duration:'0.2s',
    easing:'cubic-bezier(0.755, 0.05, 0.855, 0.06)',inert:true,hidden:'true'},'source-like quick menu exit');
  await pointerClick('#search-field + .lai-select-trigger');
  const quickFieldReopen=await evaluate(`(() => {const menus=[...document.querySelectorAll('.lai-select-menu.is-inline-search')];
    const trigger=document.querySelector('#search-field + .lai-select-trigger');
    return {count:menus.length,expanded:trigger.getAttribute('aria-expanded'),
      entry:menus.length===1?getComputedStyle(menus[0]).animationName:null,
      inert:menus.length===1?menus[0].inert:null};})()`);
  assert.deepEqual(quickFieldReopen,{count:1,expanded:'true',entry:'lai-stage-select-in',inert:false},
    'quick field reopens as one interactive entering menu during exit');
  await cdp.call('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await waitFor(async()=>evaluate(`!document.querySelector('.lai-select-menu')`),'quick-field menu exit');
  assert.equal(await evaluate(`document.activeElement===document.querySelector('#search-field + .lai-select-trigger')`),true);
  await evaluate(`(() => {const field=document.querySelector('#search-field');field.value='name';field.dispatchEvent(new Event('change',{bubbles:true}));
    const input=document.querySelector('#search');input.value='ZZZ_CAPTURE_NO_MATCH_20260921';
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
  const quickSearchEmpty=await evaluate(`({count:document.querySelectorAll('.customer-table [data-select]').length,
    filters:document.querySelector('.active-filters')?.textContent,clear:!!document.querySelector('[data-action="clear-query"]')})`);
  assert.deepEqual(quickSearchEmpty,{count:0,filters:'1 个筛选条件清空',clear:true});
  const quickSearchLayout=await evaluate(`({gap:Math.round(document.querySelector('.table-wrap').getBoundingClientRect().top-
    document.querySelector('.replica-tools').getBoundingClientRect().bottom),
    badge:document.querySelector('.quick-filter .filter-count')?.textContent,
    inlineClear:!!document.querySelector('.quick-filter [data-action="reset-all"]'),
    extraRow:!!document.querySelector('.list-area > .active-filters')})`);
  assert.deepEqual(quickSearchLayout,{gap:0,badge:'1',inlineClear:true,extraRow:false});
  const quickSearchEmptyCenter=await evaluate(`(() => {const empty=document.querySelector('.table-wrap > .empty').getBoundingClientRect();
    const table=document.querySelector('.table-wrap').getBoundingClientRect();
    return {actual:Math.round(empty.top+empty.height/2),expected:Math.round((table.top+50+table.bottom)/2)};})()`);
  assert.ok(Math.abs(quickSearchEmptyCenter.actual-quickSearchEmptyCenter.expected)<=8,
    `empty search state is not centered in the table body: ${JSON.stringify(quickSearchEmptyCenter)}`);
  const quickSearchEmptyFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-search-empty.png'),Buffer.from(quickSearchEmptyFrame.data,'base64'));
  await cdp.call('Emulation.setDeviceMetricsOverride',{width:1024,height:720,deviceScaleFactor:1,mobile:false});
  const compactQuickSearch=await evaluate(`(() => {const heading=document.querySelector('.list-heading').getBoundingClientRect();
    const tools=document.querySelector('.quick-filter').getBoundingClientRect();
    const list=document.querySelector('.list-area').getBoundingClientRect();
    return {gap:Math.round(tools.left-heading.right),overflow:Math.round(tools.right-list.right)};})()`);
  assert.ok(compactQuickSearch.gap>=8&&compactQuickSearch.overflow<=0,
    `compact search toolbar overlaps: ${JSON.stringify(compactQuickSearch)}`);
  const compactQuickSearchFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-search-empty-1024.png'),Buffer.from(compactQuickSearchFrame.data,'base64'));
  await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:1022,deviceScaleFactor:1,mobile:false});
  await pointerClick('[data-action="clear-query"]');
  const quickSearchClearedDraft=await evaluate(`({value:document.querySelector('#search')?.value,
    count:document.querySelectorAll('.customer-table [data-select]').length,
    filters:document.querySelector('.active-filters')?.textContent})`);
  assert.deepEqual(quickSearchClearedDraft,{value:'',count:0,filters:'1 个筛选条件清空'});
  const quickSearchPendingFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-search-pending-clear.png'),Buffer.from(quickSearchPendingFrame.data,'base64'));
  await evaluate(`document.querySelector('#search').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  const quickSearchRestored=await evaluate(`({count:document.querySelectorAll('.customer-table [data-select]').length,
    filters:!!document.querySelector('.active-filters')})`);
  assert.deepEqual(quickSearchRestored,{count:20,filters:false});
  await pointerClick('[data-action="table-options"]');
  await evaluate(`document.querySelector('.table-popover [data-action="settings"]').click()`);
  const mappedFields = await evaluate(`(() => ({
    contact:document.querySelector('[data-column-toggle="contactPaymentMethod"]')?.closest('label')?.textContent.trim(),
    customer:document.querySelector('[data-column-toggle="customerPaymentMethod"]')?.closest('label')?.textContent.trim(),
    social:document.querySelector('[data-column-toggle="socialPlatforms"]')?.closest('label')?.textContent.trim(),
  }))()`);
  assert.deepEqual(mappedFields,{contact:'付款方式',customer:'客户付款方式',social:'社交平台'});
  await evaluate(`document.querySelector('[data-column-toggle="contactPaymentMethod"]').click()`);
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-drag-field="contactPaymentMethod"]'))`),true);
  const fieldSettingsFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-field-mapping.png'),Buffer.from(fieldSettingsFrame.data,'base64'));
  await evaluate(`document.querySelector('[data-action="close-modal"]').click()`);
  const customerName = await evaluate(`document.querySelector('.company-link').textContent`);

  const nativeDetailOpen = await evaluate(`(() => {
    window.webkit = {messageHandlers:{windowDragRegions:{postMessage(){}},
      openCustomerDetail:{postMessage(body){window.__laiOpenedCustomer=body;}}}};
    document.querySelector('.company-link').click();
    const result = {opened:window.__laiOpenedCustomer, listVisible:!!document.querySelector('.customer-table')};
    delete window.webkit;
    delete window.__laiOpenedCustomer;
    return result;
  })()`);
  assert.equal(nativeDetailOpen.opened?.name, customerName);
  assert.equal(nativeDetailOpen.listVisible, true, 'native detail opening keeps the customer list in place');
  await cdp.call('Page.navigate', {url:`${base}/trade-order-system.html?customer=${encodeURIComponent(customerName)}#customers`});
  await waitFor(async()=>evaluate(`document.querySelector('.lcd-root')?.textContent.includes(${JSON.stringify(customerName)})`),'direct customer detail window');
  await cdp.call('Page.navigate', {url:`${base}/trade-order-system.html#customers`});
  await waitFor(async()=>evaluate(`Boolean(document.querySelector('.company-link'))`),'customer list after detail URL');

  const point = await evaluate(`(() => {
    const rect = document.querySelector(".company-link").getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await cdp.call("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: point.x,
    y: point.y,
  });
  await cdp.call("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
  await wait(60);
  const pressed = await evaluate(`(() => {
    const link = document.querySelector(".company-link");
    const cell = link.closest("td");
    const pointTarget = document.elementFromPoint(${point.x}, ${point.y});
    return {
      transform: getComputedStyle(link).transform,
      background: getComputedStyle(cell).backgroundColor,
      active: link.matches(":active"),
      pointTarget: pointTarget?.className || pointTarget?.tagName || "",
      rect: link.getBoundingClientRect().toJSON()
    };
  })()`);
  if (pressed.transform === "none")
    console.log(JSON.stringify({ pressDiagnostic: pressed }));
  assert.notEqual(pressed.transform, "none");
  assert.equal(pressed.background, "rgb(241, 247, 255)");
  await evaluate(`(() => {
    window.__laiDetailEnterObserved = null;
    const observer = new MutationObserver(() => {
      const root = document.querySelector('.lcd-root');
      if (!root || window.__laiDetailEnterObserved) return;
      const style = getComputedStyle(root);
      window.__laiDetailEnterObserved = { entered: root.classList.contains('lcd-view-enter'), name: style.animationName, duration: style.animationDuration };
      observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  })()`);
  await cdp.call("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
  const heldPress = await evaluate(`(() => {
    const link = document.querySelector(".company-link");
    return { held: link.classList.contains("customer-opening"), transform: getComputedStyle(link).transform };
  })()`);
  assert.equal(heldPress.held, true);
  assert.notEqual(heldPress.transform, "none");
  const listExit = await evaluate(`(() => {
    const main = document.querySelector(".customer-main");
    const style = getComputedStyle(main);
    return { leaving: main.classList.contains("customer-list-exit"), name: style.animationName, duration: style.animationDuration };
  })()`);
  assert.deepEqual(listExit, {
    leaving: true,
    name: "lai-list-exit",
    duration: "0.1s",
  });
  await wait(40);
  const listExitFrame = await cdp.call("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  fs.writeFileSync(
    path.join(evidence, "customer-list-exit.png"),
    Buffer.from(listExitFrame.data, "base64"),
  );
  await waitFor(
    async () => evaluate(`Boolean(document.querySelector(".lcd-root"))`),
    "customer detail",
  );
  const detail = await evaluate(`window.__laiDetailEnterObserved`);
  assert.deepEqual(detail, {
    entered: true,
    name: "lai-detail-enter",
    duration: "0.24s",
  });

  const screenshot = await cdp.call("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  fs.writeFileSync(
    path.join(evidence, "customer-detail-motion.png"),
    Buffer.from(screenshot.data, "base64"),
  );
  const detailGeometry = await evaluate(`(() => ({
    summaryBottom:Math.round(document.querySelector('.lcd-summary').getBoundingClientRect().bottom),
    contactsTop:Math.round(document.querySelector('.lcd-contacts').getBoundingClientRect().top),
  }))()`);
  assert.ok(Math.abs(detailGeometry.summaryBottom-726)<=24,`customer summary too far from reference: ${JSON.stringify(detailGeometry)}`);
  assert.ok(Math.abs(detailGeometry.contactsTop-741)<=24,`contact card too far from reference: ${JSON.stringify(detailGeometry)}`);

  await pointerClick('[data-action="summary-fields"]');
  await wait(50);
  const summaryFieldsDrawer = await evaluate(`(() => {
    const drawer=document.querySelector('#overlay-root .drawer');
    const overlay=document.querySelector('#overlay-root .overlay');
    return {title:drawer?.getAttribute('aria-label'),width:Math.round(drawer?.getBoundingClientRect().width||0),
      motion:overlay?.classList.contains('modal-motion'),opened:overlay?.classList.contains('modal-open'),
      options:document.querySelectorAll('#summary-fields-form [name="summaryField"]').length};
  })()`);
  assert.deepEqual(summaryFieldsDrawer,{title:'客户摘要字段设置',width:688,motion:true,opened:true,options:12});
  await wait(260);
  const summaryFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-summary-field-drawer.png'),Buffer.from(summaryFrame.data,'base64'));
  await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:720,deviceScaleFactor:1,mobile:false});
  const compactSummaryDrawer=await evaluate(`(() => {
    const drawer=document.querySelector('#overlay-root .drawer').getBoundingClientRect();
    const save=document.querySelector('[form="summary-fields-form"][type="submit"]').getBoundingClientRect();
    return {width:Math.round(drawer.width),right:Math.round(drawer.right),saveRight:Math.round(save.right),
      saveBottom:Math.round(save.bottom)};
  })()`);
  assert.equal(compactSummaryDrawer.width,688);
  assert.equal(compactSummaryDrawer.right,894);
  assert.ok(compactSummaryDrawer.saveRight<=1100 && compactSummaryDrawer.saveBottom<=720,
    `summary save button outside compact window: ${JSON.stringify(compactSummaryDrawer)}`);
  const compactSummaryFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-summary-field-drawer-1100.png'),Buffer.from(compactSummaryFrame.data,'base64'));
  await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:1022,deviceScaleFactor:1,mobile:false});
  await evaluate(`(() => {
    const form=document.querySelector('#summary-fields-form');
    form.querySelectorAll('[name="summaryField"]').forEach(input=>{input.checked=['source','level'].includes(input.value)});
    form.requestSubmit();
  })()`);
  await waitFor(async()=>evaluate(`document.querySelectorAll('.lcd-summary-fields dt').length===2`),'saved summary selection');
  const savedSummaryFields=await evaluate(`(async()=>({
    labels:[...document.querySelectorAll('.lcd-summary-fields dt')].map(node=>node.textContent),
    saved:(await (await fetch('/api/data',{cache:'no-store'})).json()).data.previewDetailSummaryFields,
  }))()`);
  assert.deepEqual(savedSummaryFields,{labels:['客户来源:','客户等级:'],saved:['source','level']});
  await evaluate(`document.querySelector('[data-action="summary-fields"]').click()`);
  const summaryValidation=await evaluate(`(() => {
    const form=document.querySelector('#summary-fields-form');
    form.querySelectorAll('[name="summaryField"]').forEach(input=>{input.checked=false});
    form.requestSubmit();
    return {error:document.querySelector('#workspace-error')?.textContent,
      drawerOpen:!!document.querySelector('#summary-fields-form')};
  })()`);
  assert.deepEqual(summaryValidation,{error:'请至少保留一个摘要字段',drawerOpen:true});
  await evaluate(`(() => {
    document.querySelector('#reset-summary-fields').click();
    document.querySelector('#summary-fields-form').requestSubmit();
  })()`);
  await waitFor(async()=>evaluate(`document.querySelectorAll('.lcd-summary-fields dt').length===7`),'restored summary defaults');
  const resetSummaryFields=await evaluate(`(async()=>({
    labels:[...document.querySelectorAll('.lcd-summary-fields dt')].map(node=>node.textContent),
    saved:(await (await fetch('/api/data',{cache:'no-store'})).json()).data.previewDetailSummaryFields,
  }))()`);
  assert.deepEqual(resetSummaryFields,{labels:['客户阶段:','客户分组:','客户星级:','评分:','客户来源:','公司网址:','主营产品.:'],
    saved:['stage','group','customerStars','score','source','website','productType']});
  const keyboardSummaryDrawer=await evaluate(`(() => {
    document.querySelector('[data-action="summary-fields"]').click();
    return {open:!!document.querySelector('#summary-fields-form'),
      animated:document.querySelector('#overlay-root .overlay')?.classList.contains('modal-motion')};
  })()`);
  assert.deepEqual(keyboardSummaryDrawer,{open:true,animated:false});
  await evaluate(`document.querySelector('[data-action="close-modal"]').click()`);
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await pointerClick('[data-action="summary-fields"]');
  await wait(40);
  const reducedSummaryDrawer=await evaluate(`(() => {
    const drawer=document.querySelector('#overlay-root .drawer');
    return {open:!!drawer,transition:getComputedStyle(drawer).transitionDuration,
      transform:getComputedStyle(drawer).transform};
  })()`);
  assert.deepEqual(reducedSummaryDrawer,{open:true,transition:'0.08s',transform:'matrix(1, 0, 0, 1, -344, 0)'});
  await evaluate(`document.querySelector('[data-action="close-modal"]').click()`);
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});

  await waitFor(
    async () => evaluate(`Boolean(document.querySelector(".lcd-active-indicator.ready"))`),
    "ready detail tab indicator",
  );
  await evaluate(`(() => {
    document.querySelector(".topbar").dataset.motionProbe = "preserved";
    const indicator = document.querySelector(".lcd-active-indicator");
    indicator.dataset.beforeTransform = indicator.style.transform;
    return true;
  })()`);
  const tabPoint = await evaluate(`(() => {
    const rect = document.querySelector('[data-tab="activity"]').getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await cdp.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: tabPoint.x, y: tabPoint.y });
  await cdp.call("Input.dispatchMouseEvent", {
    type: "mousePressed", x: tabPoint.x, y: tabPoint.y, button: "left", clickCount: 1,
  });
  await cdp.call("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: tabPoint.x, y: tabPoint.y, button: "left", clickCount: 1,
  });
  const tab = await evaluate(`(() => {
    const body = document.querySelector(".lcd-body");
    const style = getComputedStyle(body);
    const indicator = document.querySelector(".lcd-active-indicator");
    return {
      entered: body.classList.contains("lcd-tab-enter"),
      name: style.animationName,
      duration: style.animationDuration,
      shellPreserved: document.querySelector(".topbar").dataset.motionProbe === "preserved",
      indicatorMoves: indicator?.style.transform !== indicator?.dataset.beforeTransform,
      indicatorDuration: indicator ? getComputedStyle(indicator).transitionDuration : "none",
    };
  })()`);
  assert.deepEqual(tab, {
    entered: false,
    name: "none",
    duration: "0s",
    shellPreserved: true,
    indicatorMoves: true,
    indicatorDuration: "0.3s",
  });
  await wait(70);
  const tabFrame = await cdp.call("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  fs.writeFileSync(
    path.join(evidence, "customer-tab-transition.png"),
    Buffer.from(tabFrame.data, "base64"),
  );

  await evaluate(`document.querySelector('[data-tab="info"]').click()`);
  const keyboardTab = await evaluate(`(() => ({
    selected: document.querySelector('[data-tab="info"]').getAttribute("aria-selected"),
    bodyAnimated: document.querySelector(".lcd-body").classList.contains("lcd-tab-enter"),
  }))()`);
  assert.deepEqual(keyboardTab, { selected: "true", bodyAnimated: false });

  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await pointerClick('[data-tab="activity"]');
  const reducedTabIndicator=await evaluate(`({selected:document.querySelector('[data-tab="activity"]')?.getAttribute('aria-selected'),
    duration:getComputedStyle(document.querySelector('.lcd-active-indicator')).transitionDuration})`);
  assert.equal(reducedTabIndicator.selected,'true');
  assert.ok(Number.parseFloat(reducedTabIndicator.duration)<0.001,`reduced tab indicator still moves: ${reducedTabIndicator.duration}`);
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  const historyBefore = await evaluate(`document.querySelectorAll('.lcd-timeline article').length`);
  await evaluate(`document.querySelector('[data-activity-filter="followup"]')?.click()`);
  const filteredHistory = await evaluate(`(() => ({
    selected: document.querySelector('[data-activity-filter="followup"]')?.getAttribute('aria-pressed'),
    count: document.querySelectorAll('.lcd-timeline article').length,
  }))()`);
  assert.ok(historyBefore >= filteredHistory.count);
  assert.equal(filteredHistory.selected, "true");
  await pointerClick('[data-activity-filter="all"]');
  const activityFilterMotion = await evaluate(`(() => {
    const body = document.querySelector('.lcd-body');
    const style = getComputedStyle(body);
    return {selected:document.querySelector('[data-activity-filter="all"]')?.getAttribute('aria-pressed'),
      entered:body.classList.contains('lcd-filter-enter'),name:style.animationName,duration:style.animationDuration};
  })()`);
  assert.deepEqual(activityFilterMotion, {selected:'true',entered:true,name:'lai-detail-filter-enter',duration:'0.14s'});
  await wait(55);
  const activityFilterFrame = await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-activity-filter-motion.png'),Buffer.from(activityFilterFrame.data,'base64'));
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await pointerClick('[data-activity-filter="followup"]');
  const reducedActivityFilter = await evaluate(`(() => {
    const style = getComputedStyle(document.querySelector('.lcd-body'));
    return {name:style.animationName,duration:style.animationDuration};
  })()`);
  assert.deepEqual(reducedActivityFilter,{name:'lai-detail-fade-in',duration:'0.08s'});
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await evaluate(`document.querySelector('[data-tab="info"]').click()`);
  await evaluate(`document.querySelector('[aria-label="添加联系人"]').click()`);
  const addContact = await evaluate(`(() => ({
    editorOpen: Boolean(document.querySelector('#customer-form.ce-body')),
    cards: document.querySelectorAll('#customer-form [data-contact-card]').length,
    keyboardAnimated: document.querySelector('#customer-form [data-contact-card]:last-child')?.classList.contains('ce-contact-enter'),
  }))()`);
  assert.deepEqual(addContact, {editorOpen:true,cards:2,keyboardAnimated:false});
  await evaluate(`(() => {
    const form = document.querySelector('#customer-form');
    const fields = {
      contactExtra: 'Lai test contact', emailExtra: 'lai-contact@example.test',
      phoneExtra: '+1 555 0100', addressExtra: 'Lai test address',
      alibabaIdExtra: 'LAI-SECOND', socialPlatformExtra: 'Facebook',
      socialAccountExtra: '@lai-second', alternateEmailExtra: 'lai-backup@example.test',
      birthdayExtra: '2000-02-02', contactPaymentMethodExtra: '银行转账',
      contactNoteExtra: 'Lai test note',
    };
    for (const [name, value] of Object.entries(fields)) form.elements.namedItem(name).value = value;
    form.requestSubmit(document.querySelector('button[type="submit"][form="customer-form"][value="save"]'));
    return true;
  })()`);
  await waitFor(async () => evaluate(`!document.querySelector('#customer-form')`), 'saved additional contact');
  const savedContact = await evaluate(`(() => {
    const card = document.querySelectorAll('.lcd-contact')[1];
    return card ? card.innerText : '';
  })()`);
  for (const expected of ['Lai test contact', 'LAI-SECOND', '@lai-second',
    'lai-backup@example.test', '2000-02-02', '银行转账', 'Lai test note'])
    assert.ok(savedContact.includes(expected), `saved contact missing ${expected}`);
  await evaluate(`document.querySelectorAll('.lcd-contact')[1].scrollIntoView({block:'center',behavior:'instant'})`);
  const savedContactFrame = await cdp.call('Page.captureScreenshot', {format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence, 'customer-contact-fields.png'), Buffer.from(savedContactFrame.data,'base64'));

  const setContactQuery=async(value)=>evaluate(`(()=>{const input=document.querySelector('#contact-search-input');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const contactSearchKey=async(key)=>{await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key,code:key});await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key,code:key});};
  await evaluate(`document.querySelector('[data-action="contact-search"]').scrollIntoView({block:'center',behavior:'instant'})`);
  await pointerClick('[data-action="contact-search"]');
  const searchOpen=await evaluate(`({visible:!document.querySelector('.lcd-contact-search-row').hidden,focused:document.activeElement.id,animation:getComputedStyle(document.querySelector('.lcd-contact-search-row')).animationName})`);
  assert.deepEqual(searchOpen,{visible:true,focused:'contact-search-input',animation:'none'});
  await setContactQuery('lai-contact@example.test');assert.equal(await evaluate(`[...document.querySelectorAll('.lcd-contact')].filter(c=>!c.hidden).length`),2);
  await contactSearchKey('Enter');
  const searchMatched=await evaluate(`({visible:[...document.querySelectorAll('.lcd-contact')].filter(c=>!c.hidden).map(c=>c.dataset.contactIndex),status:document.querySelector('#contact-search-status').textContent,count:document.querySelector('#contact-count-label').textContent,hidden:document.querySelector('.lcd-contact-search-row').hidden})`);
  assert.deepEqual(searchMatched,{visible:['1'],status:'\u627e\u5230 1 \u4f4d\u8054\u7cfb\u4eba',count:'\u8054\u7cfb\u4eba(1)',hidden:true});
  await pointerClick('[data-action="contact-search"]');
  const searchFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(evidence,'customer-contact-search.png'),Buffer.from(searchFrame.data,'base64'));
  await setContactQuery('__lai_unmatched__');await contactSearchKey('Enter');
  const searchEmpty=await evaluate(`({empty:!document.querySelector('#contact-search-empty').hidden,visible:[...document.querySelectorAll('.lcd-contact')].filter(c=>!c.hidden).length,count:document.querySelector('#contact-count-label').textContent,hidden:document.querySelector('.lcd-contact-search-row').hidden})`);
  assert.deepEqual(searchEmpty,{empty:true,visible:0,count:'\u8054\u7cfb\u4eba(0)',hidden:true});
  await pointerClick('[data-action="contact-search"]');await contactSearchKey('Escape');
  const searchClosed=await evaluate(`({hidden:document.querySelector('.lcd-contact-search-row').hidden,visible:[...document.querySelectorAll('.lcd-contact')].filter(c=>!c.hidden).length,focused:document.activeElement.dataset.action})`);
  assert.deepEqual(searchClosed,{hidden:true,visible:2,focused:'contact-search'});
  await pointerClick('[data-action="contact-search"]');await setContactQuery('test');await pointerClick('[data-action="clear-contact-search"]');
  const pointerSearchExit=await evaluate(`({visible:!document.querySelector('.lcd-contact-search-row').hidden,value:document.querySelector('#contact-search-input').value,focused:document.activeElement.id,count:document.querySelector('#contact-count-label').textContent})`);
  assert.deepEqual(pointerSearchExit,{visible:true,value:'',focused:'contact-search-input',count:'\u8054\u7cfb\u4eba(2)'});
  await contactSearchKey('Escape');await pointerClick('[data-action="contact-search"]');await wait(170);
  const interruptedSearchExit=await evaluate(`({visible:!document.querySelector('.lcd-contact-search-row').hidden,animating:document.querySelector('.lcd-contact-search-row').getAnimations().length,focused:document.activeElement.id})`);
  assert.deepEqual(interruptedSearchExit,{visible:true,animating:0,focused:'contact-search-input'});
  await contactSearchKey('Escape');await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await pointerClick('[data-action="contact-search"]');
  const reducedSearch=await evaluate(`({animation:getComputedStyle(document.querySelector('.lcd-contact-search-row')).animationName,animating:document.querySelector('.lcd-contact-search-row').getAnimations().length})`);
  assert.deepEqual(reducedSearch,{animation:'none',animating:0});await setContactQuery('__lai_unmatched__');await contactSearchKey('Enter');
  const reducedSearchExit=await evaluate(`({visible:!document.querySelector('.lcd-contact-search-row').hidden,animating:document.querySelector('.lcd-contact-search-row').getAnimations().length,count:document.querySelector('#contact-count-label').textContent})`);
  assert.deepEqual(reducedSearchExit,{visible:false,animating:0,count:'\u8054\u7cfb\u4eba(0)'});
  await pointerClick('[data-action="contact-search"]');await contactSearchKey('Escape');await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});

  const primaryContactBefore = await evaluate(`document.querySelectorAll('.lcd-contact')[0].textContent`);
  await evaluate(`document.querySelector('[data-contact-more="1"]').scrollIntoView({block:'center',behavior:'instant'})`);
  await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`);
  await evaluate(`document.querySelector('[data-contact-more="1"]').click()`);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.contact-menu')).animationName`), 'none');
  await evaluate(`document.querySelector('.contact-menu').remove()`);
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await pointerClick('[data-contact-more="1"]');
  const reducedContactMenu = await evaluate(`(() => {
    const style=getComputedStyle(document.querySelector('.contact-menu'));
    return {name:style.animationName,duration:style.animationDuration};
  })()`);
  assert.deepEqual(reducedContactMenu,{name:'lai-tag-popover-fade',duration:'0.08s'});
  await evaluate(`document.querySelector('.contact-menu').remove()`);
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await pointerClick('[data-contact-more="1"]');
  assert.equal(await evaluate(`Boolean(document.querySelector('.contact-menu [data-edit-contact="1"]'))`),true);
  const contactMenuMotion = await evaluate(`(() => {
    const style=getComputedStyle(document.querySelector('.contact-menu'));
    return {name:style.animationName,duration:style.animationDuration};
  })()`);
  assert.deepEqual(contactMenuMotion,{name:'lai-contact-menu-in',duration:'0.2s'});
  const menuFrame = await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-contact-menu.png'),Buffer.from(menuFrame.data,'base64'));
  await evaluate(`document.querySelector('.contact-menu [data-edit-contact="1"]').click()`);
  await wait(55);
  const editSecondContact = await evaluate(`(() => ({
    editorOpen:Boolean(document.querySelector('#customer-form')),
    value:document.querySelector('#customer-form [data-contact-card="1"] [name="contactExtra"]')?.value,
    focusedCard:document.activeElement?.closest('[data-contact-card]')?.dataset.contactCard,
  }))()`);
  assert.deepEqual(editSecondContact,{editorOpen:true,value:'Lai test contact',focusedCard:'1'});
  await evaluate(`(() => {
    const form=document.querySelector('#customer-form');
    form.querySelector('[data-contact-card="1"] [name="contactExtra"]').value='Lai test contact edited';
    form.querySelector('[data-contact-card="1"] [name="emailExtra"]').value='lai-edited@example.test';
    form.requestSubmit(document.querySelector('button[type="submit"][form="customer-form"][value="save"]'));
  })()`);
  await waitFor(async () => evaluate(`!document.querySelector('#customer-form') && document.querySelectorAll('.lcd-contact')[1]?.textContent.includes('lai-edited@example.test')`), 'saved edited second contact');
  const editedContacts = await evaluate(`(() => ({
    primary:document.querySelectorAll('.lcd-contact')[0].textContent,
    second:document.querySelectorAll('.lcd-contact')[1].textContent,
  }))()`);
  assert.equal(editedContacts.primary,primaryContactBefore);
  assert.ok(editedContacts.second.includes('Lai test contact edited'));

  await evaluate(`document.querySelector('[data-action="edit"]').click()`);
  const keyboardSocialMethod=await evaluate(`(() => {
    const button=document.querySelector('#customer-form [data-contact-card="0"] [data-method-type="social"]');
    button.click();
    const row=document.querySelector('#customer-form [data-contact-card="0"] [data-method-list="social"] [data-method-row]');
    row.querySelector('[data-method-select]').value='LinkedIn';
    row.querySelector('[data-method-value]').value='main-team';
    return {count:document.querySelectorAll('#customer-form [data-contact-card="0"] [data-method-list="social"] [data-method-row]').length,
      animated:row.classList.contains('ce-method-enter')};
  })()`);
  assert.deepEqual(keyboardSocialMethod,{count:1,animated:false});
  await evaluate(`document.querySelector('#customer-form [data-contact-card="0"] [data-method-type="phone"]').scrollIntoView({block:'center',behavior:'instant'})`);
  await pointerClick('#customer-form [data-contact-card="0"] [data-method-type="phone"]');
  const pointerPhoneMethod=await evaluate(`(() => {
    const row=document.querySelector('#customer-form [data-contact-card="0"] [data-method-list="phone"] [data-method-row]');
    row.querySelector('[data-method-select]').value='+44';
    row.querySelector('[data-method-value]').value='555 0122';
    const style=getComputedStyle(row);
    return {name:style.animationName,opacity:Number(style.opacity),transform:style.transform};
  })()`);
  assert.deepEqual(pointerPhoneMethod,{name:'none',opacity:1,transform:'none'});
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await evaluate(`document.querySelector('#customer-form [data-contact-card="1"] [data-method-type="social"]').scrollIntoView({block:'center',behavior:'instant'})`);
  await pointerClick('#customer-form [data-contact-card="1"] [data-method-type="social"]');
  const reducedSocialMethod=await evaluate(`(() => {
    const row=document.querySelector('#customer-form [data-contact-card="1"] [data-method-list="social"] [data-method-row]');
    row.querySelector('[data-method-select]').value='Facebook';
    row.querySelector('[data-method-value]').value='@second';
    const style=getComputedStyle(row);
    return {name:style.animationName,opacity:Number(style.opacity),transform:style.transform};
  })()`);
  assert.deepEqual(reducedSocialMethod,{name:'none',opacity:1,transform:'none'});
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  const multiMethodEditorFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-editor-multiple-methods.png'),Buffer.from(multiMethodEditorFrame.data,'base64'));
  await cdp.call('Emulation.setDeviceMetricsOverride',{width:1024,height:768,deviceScaleFactor:1,mobile:false});
  await wait(50);
  const compactEditorFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-editor-multiple-methods-1024.png'),Buffer.from(compactEditorFrame.data,'base64'));
  await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:1022,deviceScaleFactor:1,mobile:false});
  await evaluate(`document.querySelector('button[type="submit"][form="customer-form"][value="save"]').click()`);
  await waitFor(async()=>evaluate(`!document.querySelector('#customer-form') && document.querySelectorAll('.lcd-contact')[1]?.textContent.includes('@second')`),'saved contact methods');
  const savedMethods=await evaluate(`(() => ({
    main:document.querySelectorAll('.lcd-contact')[0].textContent,
    second:document.querySelectorAll('.lcd-contact')[1].textContent,
  }))()`);
  assert.ok(savedMethods.main.includes('+44 555 0122') && savedMethods.main.includes('LinkedIn main-team'));
  assert.ok(savedMethods.second.includes('Facebook @second'));
  assert.ok(!savedMethods.main.includes('@second') && !savedMethods.second.includes('main-team'));
  await evaluate(`document.querySelectorAll('.lcd-contact')[0].scrollIntoView({block:'center',behavior:'instant'})`);
  const multiMethodFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-contact-multiple-methods.png'),Buffer.from(multiMethodFrame.data,'base64'));
  await evaluate(`document.querySelector('[data-action="edit"]').click()`);
  const restoredMethods=await evaluate(`(() => ({
    mainPhone:document.querySelector('#customer-form [data-contact-card="0"] [data-method-list="phone"] [data-method-value]')?.value,
    mainSocial:document.querySelector('#customer-form [data-contact-card="0"] [data-method-list="social"] [data-method-value]')?.value,
    secondSocial:document.querySelector('#customer-form [data-contact-card="1"] [data-method-list="social"] [data-method-value]')?.value,
  }))()`);
  assert.deepEqual(restoredMethods,{mainPhone:'555 0122',mainSocial:'main-team',secondSocial:'@second'});
  await evaluate(`(() => {
    document.querySelector('#customer-form [data-contact-card="1"] [data-method-list="social"] [data-editor-action="remove-method"]').click();
    document.querySelector('button[type="submit"][form="customer-form"][value="save"]').click();
  })()`);
  await waitFor(async()=>evaluate(`!document.querySelector('#customer-form')`),'removed second contact social method');
  const afterMethodRemoval=await evaluate(`(() => ({
    main:document.querySelectorAll('.lcd-contact')[0].textContent,
    second:document.querySelectorAll('.lcd-contact')[1].textContent,
  }))()`);
  assert.ok(afterMethodRemoval.main.includes('LinkedIn main-team'));
  assert.ok(!afterMethodRemoval.second.includes('@second'));
  await evaluate(`document.querySelector('[data-action="edit"]').click()`);
  const contactAddPoint = await evaluate(`(() => {
    const button = document.querySelector('.ce-add-contact');
    button.scrollIntoView({block:'center',behavior:'instant'});
    const rect = button.getBoundingClientRect();
    return {x:rect.left+rect.width/2,y:rect.top+rect.height/2};
  })()`);
  await cdp.call('Input.dispatchMouseEvent', {type:'mousePressed', x:contactAddPoint.x, y:contactAddPoint.y, button:'left', clickCount:1});
  await cdp.call('Input.dispatchMouseEvent', {type:'mouseReleased', x:contactAddPoint.x, y:contactAddPoint.y, button:'left', clickCount:1});
  const contactEntry = await evaluate(`(() => {
    const card = document.querySelector('#customer-form [data-contact-card]:last-child');
    return {count:document.querySelectorAll('#customer-form [data-contact-card]').length,
      entered:card.classList.contains('ce-contact-enter'),
      animationName:getComputedStyle(card).animationName,
      duration:getComputedStyle(card).animationDuration};
  })()`);
  assert.deepEqual(contactEntry, {count:3,entered:true,animationName:'lai-contact-enter',duration:'0.18s'});
  await wait(60);
  const contactEntryFrame = await cdp.call('Page.captureScreenshot', {format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence, 'customer-contact-enter.png'), Buffer.from(contactEntryFrame.data,'base64'));

  await cdp.call('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  const reducedPoint = await evaluate(`(() => {
    const button = document.querySelector('.ce-add-contact');
    button.scrollIntoView({block:'center',behavior:'instant'});
    const rect = button.getBoundingClientRect();
    return {x:rect.left+rect.width/2,y:rect.top+rect.height/2};
  })()`);
  await cdp.call('Input.dispatchMouseEvent', {type:'mousePressed', x:reducedPoint.x, y:reducedPoint.y, button:'left', clickCount:1});
  await cdp.call('Input.dispatchMouseEvent', {type:'mouseReleased', x:reducedPoint.x, y:reducedPoint.y, button:'left', clickCount:1});
  const reducedContactEntry = await evaluate(`(() => {
    const card = document.querySelector('#customer-form [data-contact-card]:last-child');
    return {count:document.querySelectorAll('#customer-form [data-contact-card]').length,
      name:getComputedStyle(card).animationName,
      duration:getComputedStyle(card).animationDuration};
  })()`);
  assert.deepEqual(reducedContactEntry,{count:4,name:'lai-contact-fade',duration:'0.08s'});
  await cdp.call('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await evaluate(`document.querySelector('[data-action="close-modal"]').click()`);

  await evaluate(`(() => {
    document.querySelector('[data-tab="activity"]').click();
    const form = document.querySelector('#followup-form');
    form.elements.text.value = 'Lai acceptance followup';
    form.elements.nextFollow.value = '2026-10-01';
    form.requestSubmit();
    return true;
  })()`);
  await waitFor(async () => evaluate(`document.querySelector('.lcd-timeline')?.textContent.includes('Lai acceptance followup')`), 'saved followup in customer activity');
  await evaluate(`(() => {
    const draft=document.querySelector('#followup-text');
    draft.value='Unsaved search draft';
    draft.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('[data-action="activity-search"]').scrollIntoView({block:'center',behavior:'instant'});
  })()`);
  await pointerClick('[data-action="activity-search"]');
  const activitySearchEntry=await evaluate(`(() => {
    const row=document.querySelector('#activity-search-row');
    const style=getComputedStyle(row);
    return {visible:!row.hidden,focused:document.activeElement?.id,
      expanded:document.querySelector('[data-action="activity-search"]')?.getAttribute('aria-expanded'),
      animation:style.animationName,duration:style.animationDuration};
  })()`);
  assert.deepEqual(activitySearchEntry,{visible:true,focused:'activity-search-input',expanded:'true',animation:'none',duration:'0s'});
  const activitySearchMatched=await evaluate(`(() => {
    const input=document.querySelector('#activity-search-input');
    input.value='ACCEPTANCE followup';
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    return {count:document.querySelectorAll('#activity-results .lcd-timeline article').length,
      content:document.querySelector('#activity-results')?.textContent.includes('Lai acceptance followup'),
      status:document.querySelector('#activity-search-status')?.textContent,
      draft:document.querySelector('#followup-text')?.value};
  })()`);
  assert.deepEqual(activitySearchMatched,{count:1,content:true,status:'找到 1 条动态',draft:'Unsaved search draft'});
  const activitySearchFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-activity-search.png'),Buffer.from(activitySearchFrame.data,'base64'));
  await evaluate(`document.querySelector('[data-action="toggle-activity-detail"]').scrollIntoView({block:'center',behavior:'instant'})`);
  await pointerClick('[data-action="toggle-activity-detail"]');
  const activityDetailExpanded=await evaluate(`(() => {
    const button=document.querySelector('[data-action="toggle-activity-detail"]');
    const panel=document.getElementById(button.getAttribute('aria-controls'));
    return {expanded:button.getAttribute('aria-expanded'),hidden:panel.getAttribute('aria-hidden'),
      content:panel.textContent.includes('Lai acceptance followup'),
      channel:panel.querySelector('dt') && [...panel.querySelectorAll('dt')].some(label=>label.textContent==='渠道'),
      transition:getComputedStyle(panel).transitionDuration,
      draft:document.querySelector('#followup-text')?.value,
      placeholder:!!document.querySelector('#overlay-root .feature-dialog')};
  })()`);
  assert.deepEqual(activityDetailExpanded,{expanded:'true',hidden:'false',content:true,channel:false,
    transition:'0.16s, 0.16s',draft:'Unsaved search draft',placeholder:false});
  await wait(180);
  const activityDetailFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-activity-detail-expanded.png'),Buffer.from(activityDetailFrame.data,'base64'));
  const keyboardActivityDetail=await evaluate(`(() => {
    const button=document.querySelector('[data-action="toggle-activity-detail"]');
    button.click();
    const panel=document.getElementById(button.getAttribute('aria-controls'));
    return {expanded:button.getAttribute('aria-expanded'),hidden:panel.getAttribute('aria-hidden'),
      transition:getComputedStyle(panel).transitionDuration};
  })()`);
  assert.deepEqual(keyboardActivityDetail,{expanded:'false',hidden:'true',transition:'0s'});
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await pointerClick('[data-action="toggle-activity-detail"]');
  const reducedActivityDetail=await evaluate(`(() => {
    const button=document.querySelector('[data-action="toggle-activity-detail"]');
    const panel=document.getElementById(button.getAttribute('aria-controls'));
    return {expanded:button.getAttribute('aria-expanded'),transition:getComputedStyle(panel).transitionDuration};
  })()`);
  assert.deepEqual(reducedActivityDetail,{expanded:'true',transition:'0.08s'});
  await evaluate(`document.querySelector('[data-action="toggle-activity-detail"]').click()`);
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  const activitySearchEmpty=await evaluate(`(() => {
    const input=document.querySelector('#activity-search-input');
    input.value='__lai_no_match__';
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    return {empty:document.querySelector('#activity-results')?.textContent.includes('暂无数据'),
      count:document.querySelectorAll('#activity-results .lcd-timeline article').length};
  })()`);
  assert.deepEqual(activitySearchEmpty,{empty:true,count:0});
  await evaluate(`(async () => {
    const name=document.querySelector('.lcd-identity-text h2')?.firstChild?.textContent.trim();
    const snapshot=await (await fetch('/api/data',{cache:'no-store'})).json();
    const profile=snapshot.data.customers[name];
    profile.history=[...(profile.history||[]),{
      type:'followup',time:'2020-01-01T00:00:00Z',text:'Lai external refresh acceptance',owner:'Other workspace',
    }];
    const response=await fetch('/api/save',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({state:{app:'laicai-lai',version:'1.4.2',data:snapshot.data},baseRevision:snapshot.revision}),
    });
    if (!response.ok) throw Error('external isolated save failed');
  })()`);
  await evaluate(`(() => {
    const input=document.querySelector('#activity-search-input');
    input.value='external refresh';
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    window.__laiOriginalFetch=window.fetch;
    window.fetch=(...args)=>String(args[0])==='/api/data'
      ? new Promise(resolve=>{window.__laiUnblockRefresh=()=>resolve(window.__laiOriginalFetch(...args));})
      : window.__laiOriginalFetch(...args);
  })()`);
  assert.equal(await evaluate(`document.querySelectorAll('#activity-results .lcd-timeline article').length`),0);
  // Source hides the toolbar while querying. Clear and blur before physically
  // refreshing; then reopen the query against the new backend revision.
  assert.equal(await evaluate(`document.querySelector('[data-action="refresh-activity"]').checkVisibility()`),false);
  await pointerClick('[data-action="clear-activity-search"]');
  await evaluate(`document.querySelector('#activity-search-input').blur()`);
  assert.equal(await evaluate(`document.querySelector('[data-action="refresh-activity"]').checkVisibility()`),true);
  await pointerClick('[data-action="refresh-activity"]');
  const activityRefreshLoading=await evaluate(`(() => {
    const button=document.querySelector('[data-action="refresh-activity"]');
    return {busy:document.querySelector('#activity-results')?.getAttribute('aria-busy'),
      disabled:button.disabled,status:document.querySelector('#activity-refresh-status')?.textContent,
      animation:getComputedStyle(button.querySelector('svg')).animationName,
      draft:document.querySelector('#followup-text')?.value};
  })()`);
  assert.deepEqual(activityRefreshLoading,{busy:'true',disabled:true,status:'正在刷新…',animation:'lai-activity-refresh-pulse',draft:'Unsaved search draft'});
  await evaluate(`(() => {window.__laiUnblockRefresh(); window.fetch=window.__laiOriginalFetch; delete window.__laiUnblockRefresh; delete window.__laiOriginalFetch;})()`);
  await waitFor(async()=>evaluate(`document.querySelector('#activity-refresh-status')?.textContent==='动态已更新'`),'updated customer activity');
  assert.equal(await evaluate(`document.querySelector('#activity-search-row').hidden`),true);
  assert.equal(await evaluate(`document.querySelector('#followup-text').value`),'Unsaved search draft');
  await pointerClick('[data-action="activity-search"]');
  await evaluate(`(()=>{const i=document.querySelector('#activity-search-input');i.value='external refresh';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
  const activityRefreshResult=await evaluate(`(() => ({
    count:document.querySelectorAll('#activity-results .lcd-timeline article').length,
    content:document.querySelector('#activity-results')?.textContent.includes('Lai external refresh acceptance'),
    query:document.querySelector('#activity-search-input')?.value,
    draft:document.querySelector('#followup-text')?.value,
    expanded:document.querySelector('[data-action="activity-search"]')?.getAttribute('aria-expanded'),
    busy:document.querySelector('#activity-results')?.hasAttribute('aria-busy'),
  }))()`);
  assert.deepEqual(activityRefreshResult,{count:1,content:true,query:'external refresh',draft:'Unsaved search draft',expanded:'true',busy:false});
  const activityRefreshFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-activity-refresh.png'),Buffer.from(activityRefreshFrame.data,'base64'));
  await pointerClick('[data-action="clear-activity-search"]');
  const activitySearchClosing=await evaluate(`(() => ({
    focused:document.activeElement?.id,
    visible:!document.querySelector('#activity-search-row')?.hidden,
    restored:document.querySelector('#activity-results')?.textContent.includes('Lai acceptance followup'),
  }))()`);
  assert.deepEqual(activitySearchClosing,{focused:'activity-search-input',visible:true,restored:true});
  await evaluate(`document.querySelector('.lcd-identity-text h2').click(); document.querySelector('#activity-search-input').blur()`);
  await waitFor(async()=>evaluate(`document.querySelector('#activity-search-row')?.hidden`),'empty activity search blur');
  // Only the source's All category has collapsible year groups.
  await evaluate(`document.querySelector('[data-activity-filter="all"]').click()`);
  const oldActivityGroup=await evaluate(`(() => {
    const group=document.querySelector('[data-timeline-group="year:2020"]');
    const button=group?.querySelector('[data-action="toggle-activity-group"]');
    return {label:button?.textContent,expanded:button?.getAttribute('aria-expanded'),hidden:group?.querySelector('.lcd-time-group-body')?.hidden};
  })()`);
  assert.deepEqual(oldActivityGroup,{label:'›2020年(1)',expanded:'false',hidden:true});
  await evaluate(`document.querySelector('[data-timeline-group="year:2020"] button').scrollIntoView({block:'center',behavior:'instant'})`);
  await pointerClick('[data-timeline-group="year:2020"] button');
  const activityGroupEntry=await evaluate(`(() => {
    const group=document.querySelector('[data-timeline-group="year:2020"]');
    const panel=group.querySelector('.lcd-time-group-body');
    return {expanded:group.querySelector('button').getAttribute('aria-expanded'),hidden:panel.hidden,
      animation:getComputedStyle(panel).animationName,duration:getComputedStyle(panel).animationDuration,
      content:panel.textContent.includes('Lai external refresh acceptance')};
  })()`);
  assert.deepEqual(activityGroupEntry,{expanded:'true',hidden:false,animation:'lai-time-group-in',duration:'0.16s',content:true});
  const activityTimeGroupFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-activity-time-groups.png'),Buffer.from(activityTimeGroupFrame.data,'base64'));
  await evaluate(`document.querySelector('[data-timeline-group="year:2020"] button').click()`);
  const keyboardActivityGroup=await evaluate(`(() => {
    const group=document.querySelector('[data-timeline-group="year:2020"]');
    return {expanded:group.querySelector('button').getAttribute('aria-expanded'),hidden:group.querySelector('.lcd-time-group-body').hidden};
  })()`);
  assert.deepEqual(keyboardActivityGroup,{expanded:'false',hidden:true});
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await pointerClick('[data-timeline-group="year:2020"] button');
  const reducedActivityGroup=await evaluate(`(() => {
    const panel=document.querySelector('[data-timeline-group="year:2020"] .lcd-time-group-body');
    return {hidden:panel.hidden,animation:getComputedStyle(panel).animationName,duration:getComputedStyle(panel).animationDuration};
  })()`);
  assert.deepEqual(reducedActivityGroup,{hidden:false,animation:'lai-contact-search-fade',duration:'0.08s'});
  await evaluate(`document.querySelector('[data-timeline-group="year:2020"] button').click()`);
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await evaluate(`document.querySelector('[data-activity-filter="followup"]').click()`);
  await evaluate(`document.querySelector('[data-action="activity-sort"]').scrollIntoView({block:'center',behavior:'instant'})`);
  await wait(80);
  await pointerClick('[data-action="activity-sort"]');
  const activitySortMenu=await evaluate(`(() => {
    const menu=document.querySelector('.activity-sort-popover');
    const style=getComputedStyle(menu);
    return {visible:!!menu,expanded:document.querySelector('[data-action="activity-sort"]')?.getAttribute('aria-expanded'),
      newest:menu.querySelector('[data-activity-sort="newest"]')?.getAttribute('aria-pressed'),
      animation:style.animationName,duration:style.animationDuration};
  })()`);
  assert.deepEqual(activitySortMenu,{visible:true,expanded:'true',newest:'true',animation:'lai-activity-sort-in',duration:'0.2s'});
  const sortMenuFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-activity-sort-menu.png'),Buffer.from(sortMenuFrame.data,'base64'));
  await pointerClick('[data-activity-sort="oldest"]');
  const activitySortOldest=await evaluate(`(() => {
    const groups=[...document.querySelectorAll('#activity-results [data-timeline-group]')].map(group=>group.dataset.timelineGroup);
    const results=document.querySelector('#activity-results');
    return {groups,records:[...results.querySelectorAll('.lcd-activity-record')].map(r=>({text:r.querySelector('.lcd-event-body').firstChild.textContent,visible:r.checkVisibility()})),filter:document.querySelector('[data-activity-filter="followup"]')?.getAttribute('aria-pressed'),
      draft:document.querySelector('#followup-text')?.value,menuClosed:!document.querySelector('.activity-sort-popover') || (document.querySelector('.activity-sort-popover').inert && document.querySelector('.activity-sort-popover').getAttribute('aria-hidden') === 'true'),
      expanded:document.querySelector('[data-action="activity-sort"]')?.getAttribute('aria-expanded'),
      animation:getComputedStyle(results).animationName,duration:getComputedStyle(results).animationDuration};
  })()`);
  assert.deepEqual(activitySortOldest,{groups:[],records:[{text:'Lai external refresh acceptance',visible:true},{text:'Lai acceptance followup',visible:true}],filter:'true',draft:'Unsaved search draft',menuClosed:true,expanded:'false',animation:'lai-detail-filter-enter',duration:'0.14s'});
  await waitFor(async()=>evaluate(`!document.querySelector('.activity-sort-popover')`),'sort menu completed 200ms exit');
  const sortResultFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-activity-oldest-first.png'),Buffer.from(sortResultFrame.data,'base64'));
  await waitFor(async()=>evaluate(`!document.querySelector('#activity-results')?.classList.contains('lcd-filter-enter')`),'finished sort motion');
  await evaluate(`document.querySelector('[data-action="activity-sort"]').click()`);
  const keyboardSortMenu=await evaluate(`(() => ({
    expanded:document.querySelector('[data-action="activity-sort"]')?.getAttribute('aria-expanded'),
    animation:getComputedStyle(document.querySelector('.activity-sort-popover')).animationName,
  }))()`);
  assert.deepEqual(keyboardSortMenu,{expanded:'true',animation:'none'});
  await evaluate(`document.querySelector('[data-activity-sort="newest"]').click()`);
  const keyboardSortResult=await evaluate(`(() => ({
    groups:[...document.querySelectorAll('#activity-results [data-timeline-group]')].map(group=>group.dataset.timelineGroup),
    records:[...document.querySelectorAll('#activity-results .lcd-activity-record')].map(r=>({text:r.querySelector('.lcd-event-body').firstChild.textContent,visible:r.checkVisibility()})),
    animation:getComputedStyle(document.querySelector('#activity-results')).animationName,
  }))()`);
  assert.deepEqual(keyboardSortResult,{groups:[],records:[{text:'Lai acceptance followup',visible:true},{text:'Lai external refresh acceptance',visible:true}],animation:'none'});
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await pointerClick('[data-action="activity-sort"]');
  const reducedSortMenu=await evaluate(`(() => ({
    animation:getComputedStyle(document.querySelector('.activity-sort-popover')).animationName,
    duration:getComputedStyle(document.querySelector('.activity-sort-popover')).animationDuration,
  }))()`);
  assert.deepEqual(reducedSortMenu,{animation:'lai-tag-popover-fade',duration:'0.08s'});
  await pointerClick('[data-activity-sort="oldest"]');
  const reducedSortResult=await evaluate(`(() => ({
    animation:getComputedStyle(document.querySelector('#activity-results')).animationName,
    duration:getComputedStyle(document.querySelector('#activity-results')).animationDuration,
  }))()`);
  assert.deepEqual(reducedSortResult,{animation:'lai-detail-fade-in',duration:'0.08s'});
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  // Preserve advanced-filter group assertions in the source's grouped All view.
  await evaluate(`document.querySelector('[data-activity-filter="all"]').click()`);
  await evaluate(`document.querySelector('[data-action="activity-advanced-filter"]').scrollIntoView({block:'center',behavior:'instant'})`);
  await pointerClick('[data-action="activity-advanced-filter"]');
  const activityAdvancedMenu=await evaluate(`(() => {
    const menu=document.querySelector('.activity-filter-popover');
    const style=getComputedStyle(menu);
    return {open:!!menu,width:menu.offsetWidth,height:menu.offsetHeight,
      expanded:document.querySelector('[data-action="activity-advanced-filter"]').getAttribute('aria-expanded'),
      date:!!menu.querySelector('[name="startDate"]'),contact:!!menu.querySelector('[name="contact"]'),
      owner:!!menu.querySelector('[name="owner"]'),types:menu.querySelectorAll('[name="activityType"]').length,
      animation:style.animationName,duration:style.animationDuration};
  })()`);
  assert.deepEqual(activityAdvancedMenu,{open:true,width:344,height:348,expanded:'true',date:true,contact:true,owner:true,types:33,animation:'lai-activity-filter-in',duration:'0.2s'});
  await wait(220);
  const advancedMenuFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-activity-advanced-filter.png'),Buffer.from(advancedMenuFrame.data,'base64'));
  const advancedInvalidRange=await evaluate(`(() => {
    const form=document.querySelector('#activity-advanced-form');
    form.elements.startDate.value='2020-02-01';
    form.elements.endDate.value='2020-01-01';
    form.requestSubmit();
    return {error:form.querySelector('[role="alert"]').textContent,
      stillOpen:!!document.querySelector('.activity-filter-popover'),
      groups:document.querySelectorAll('#activity-results [data-timeline-group]').length};
  })()`);
  assert.deepEqual(advancedInvalidRange,{error:'开始日期不能晚于结束日期',stillOpen:true,groups:2});
  const advancedTypeTree=await evaluate(`(() => {
    const form=document.querySelector('#activity-advanced-form');
    form.elements.startDate.value='2020-01-01';
    form.elements.endDate.value='2020-01-01';
    form.elements.owner.value='Other workspace';
    const group=form.querySelector('[data-activity-type-group="followup"]');
    group.checked=true; group.dispatchEvent(new Event('change',{bubbles:true}));
    const child=form.querySelector('[name="activityType"][value="followup:quick"]');
    child.checked=false; child.dispatchEvent(new Event('change',{bubbles:true}));
    const parentCleared=!group.checked;
    group.checked=true; group.dispatchEvent(new Event('change',{bubbles:true}));
    return {parentCleared,childRestored:child.checked};
  })()`);
  assert.deepEqual(advancedTypeTree,{parentCleared:true,childRestored:true});
  await pointerClick('#activity-advanced-form [type="submit"]');
  const activityAdvancedResult=await evaluate(`(() => ({
    groups:[...document.querySelectorAll('#activity-results [data-timeline-group]')].map(g=>g.dataset.timelineGroup),
    oldRecord:document.querySelector('#activity-results')?.textContent.includes('Lai external refresh acceptance'),
    newRecord:document.querySelector('#activity-results')?.textContent.includes('Lai acceptance followup'),
    active:document.querySelector('[data-action="activity-advanced-filter"]')?.classList.contains('lcd-filter-active'),
    draft:document.querySelector('#followup-text')?.value,
    closed:!document.querySelector('.activity-filter-popover') || (document.querySelector('.activity-filter-popover').inert && document.querySelector('.activity-filter-popover').getAttribute('aria-hidden')==='true'),
    animation:getComputedStyle(document.querySelector('#activity-results')).animationName,
  }))()`);
  assert.deepEqual(activityAdvancedResult,{groups:['year:2020'],oldRecord:true,newRecord:false,active:true,draft:'Unsaved search draft',closed:true,animation:'lai-detail-filter-enter'});
  await waitFor(() => evaluate(`!document.querySelector('.activity-filter-popover')`), 'advanced filter exit removed');
  await pointerClick('[data-timeline-group="year:2020"] button');
  assert.equal(await evaluate(`!document.querySelector('[data-timeline-group="year:2020"] .lcd-time-group-body').hidden`),true);
  const advancedResultFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-activity-advanced-result.png'),Buffer.from(advancedResultFrame.data,'base64'));
  await pointerClick('[data-action="activity-advanced-filter"]');
  await pointerClick('[data-activity-filter-reset]');
  assert.equal(await evaluate(`(() => {
    const form=document.querySelector('#activity-advanced-form');
    return !form.elements.startDate.value && !form.elements.endDate.value && !form.elements.owner.value && !form.querySelector('[name="activityType"]:checked');
  })()`),true);
  await pointerClick('#activity-advanced-form [type="submit"]');
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('#activity-results [data-timeline-group]')].map(g=>g.dataset.timelineGroup)`),['year:2020','recent']);
  await evaluate(`document.querySelector('[data-action="activity-advanced-filter"]').click()`);
  const keyboardAdvancedMenu=await evaluate(`(() => ({animation:getComputedStyle(document.querySelector('.activity-filter-popover')).animationName,
    focused:document.activeElement?.getAttribute('aria-label')}))()`);
  assert.deepEqual(keyboardAdvancedMenu,{animation:'none',focused:'开始日期'});
  await cdp.call('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  assert.equal(await evaluate(`!document.querySelector('.activity-filter-popover') && document.activeElement?.dataset.action==='activity-advanced-filter'`),true);
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await pointerClick('[data-action="activity-advanced-filter"]');
  const reducedAdvancedMenu=await evaluate(`(() => ({animation:getComputedStyle(document.querySelector('.activity-filter-popover')).animationName,
    duration:getComputedStyle(document.querySelector('.activity-filter-popover')).animationDuration}))()`);
  assert.deepEqual(reducedAdvancedMenu,{animation:'lai-tag-popover-fade',duration:'0.08s'});
  await pointerClick('[data-activity-filter-reset]');
  await pointerClick('#activity-advanced-form [type="submit"]');
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await evaluate(`document.querySelector('[data-action="activity-search"]').click()`);
  const keyboardActivitySearch=await evaluate(`(() => ({
    visible:!document.querySelector('#activity-search-row').hidden,
    animation:getComputedStyle(document.querySelector('#activity-search-row')).animationName,
    focused:document.activeElement?.id,
  }))()`);
  assert.deepEqual(keyboardActivitySearch,{visible:true,animation:'none',focused:'activity-search-input'});
  await cdp.call('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  assert.equal(await evaluate(`!document.querySelector('#activity-search-row').hidden && document.activeElement?.id==='activity-search-input'`),true);
  await evaluate(`document.querySelector('#activity-search-input').blur()`);
  assert.equal(await evaluate(`document.querySelector('#activity-search-row').hidden`),true);
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await pointerClick('[data-action="activity-search"]');
  const reducedActivitySearch=await evaluate(`(() => ({
    animation:getComputedStyle(document.querySelector('#activity-search-row')).animationName,
    duration:getComputedStyle(document.querySelector('#activity-search-row')).animationDuration,
  }))()`);
  // Global reduced-motion CSS sets a 0.01ms duration on every node; with
  // animation-name none there is still no search entrance animation.
  assert.deepEqual(reducedActivitySearch,{animation:'none',duration:'1e-05s'});
  await evaluate(`document.querySelector('#activity-search-input').blur()`);
  await waitFor(async()=>evaluate(`document.querySelector('#activity-search-row')?.hidden`),'closed reduced-motion empty blur');
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await evaluate(`(() => {
    const draft=document.querySelector('#followup-text');
    draft.value='';
    draft.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await evaluate(`document.querySelector('[data-tab="info"]').click()`);
  const followupDetail = await evaluate(`(() => ({
    recent: [...document.querySelectorAll('.lcd-info-fields .lcd-field')]
      .find(field => field.querySelector('dt')?.textContent === '最近跟进时间')?.querySelector('dd')?.textContent,
    next: [...document.querySelectorAll('.lcd-info-fields .lcd-field')]
      .find(field => field.querySelector('dt')?.textContent === '下次跟进时间')?.querySelector('dd')?.textContent,
  }))()`);
  assert.ok(followupDetail.recent?.startsWith(new Date().toLocaleDateString('sv-SE')));
  assert.equal(followupDetail.next, '2026-10-01');

  const backPoint = await evaluate(`(() => {
    const rect = document.querySelector('[data-action="list"]').getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await cdp.call("Input.dispatchMouseEvent", {
    type: "mousePressed", x: backPoint.x, y: backPoint.y, button: "left", clickCount: 1,
  });
  await cdp.call("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: backPoint.x, y: backPoint.y, button: "left", clickCount: 1,
  });
  const exit = await evaluate(`(() => {
    const root = document.querySelector(".lcd-root");
    const style = getComputedStyle(root);
    return { leaving: root.classList.contains("lcd-view-exit"), name: style.animationName, duration: style.animationDuration };
  })()`);
  assert.deepEqual(exit, {
    leaving: true,
    name: "lai-detail-exit",
    duration: "0.16s",
  });
  await waitFor(
    async () =>
      evaluate(
        `Boolean(document.querySelector(".customer-main.customer-list-enter .company-link"))`,
      ),
    "animated return to customer list",
  );
  const followupList = await evaluate(`(() => {
    const headers = [...document.querySelectorAll('.customer-table th')].map(th => th.textContent.trim());
    const row = [...document.querySelectorAll('.customer-table tbody tr')]
      .find(tr => tr.querySelector('.company-link')?.textContent === ${JSON.stringify(customerName)});
    const values = [...row.querySelectorAll('td')].map(td => td.textContent.trim());
    return {recent:values[headers.findIndex(h => h.includes('最近跟进时间'))],
      activity:values[headers.findIndex(h => h.includes('最近动态'))]};
  })()`);
  assert.ok(followupList.recent?.startsWith(new Date().toLocaleDateString('sv-SE')), JSON.stringify(followupList));
  assert.equal(followupList.activity, 'Lai acceptance followup');
  await wait(200);
  await evaluate(`document.querySelector('.company-link').click()`);
  const keyboardOpen = await evaluate(`(() => ({
    listExiting: Boolean(document.querySelector('.customer-list-exit')),
    detailVisible: Boolean(document.querySelector('.lcd-root')),
    detailEntering: Boolean(document.querySelector('.lcd-view-enter')),
  }))()`);
  assert.deepEqual(keyboardOpen, {
    listExiting: false,
    detailVisible: true,
    detailEntering: false,
  });
  await evaluate(`document.querySelector('[data-action="list"]').click()`);
  const keyboardReturn = await evaluate(`(() => ({
    detailExiting: Boolean(document.querySelector('.lcd-view-exit')),
    listVisible: Boolean(document.querySelector('.customer-main .company-link')),
    listEntering: Boolean(document.querySelector('.customer-list-enter')),
  }))()`);
  assert.deepEqual(keyboardReturn, {
    detailExiting: false,
    listVisible: true,
    listEntering: false,
  });
  await evaluate(`(() => {window.__laiOriginalRaf=window.requestAnimationFrame;
    window.__laiSuppressedRaf=0;
    window.requestAnimationFrame=()=>{window.__laiSuppressedRaf+=1;return 0;};})()`);
  await pointerClick('[data-action="filter"]');
  assert.ok(await evaluate(`window.__laiSuppressedRaf>0`),'filter drawer queued a frame');
  const drawerOpen = await evaluate(`(() => {
    const overlay = document.querySelector('#overlay-root .overlay');
    const drawer = overlay?.querySelector('.drawer');
    return {
      motion: overlay?.classList.contains('modal-motion'),
      drawerTransition: drawer && getComputedStyle(drawer).transitionDuration,
      drawerProperty: drawer && getComputedStyle(drawer).transitionProperty,
    };
  })()`);
  assert.deepEqual(drawerOpen, {
    motion: true,
    drawerTransition: '0.3s',
    drawerProperty: 'transform',
  });
  await waitFor(async () => evaluate(`document.querySelector('#overlay-root .modal-open') !== null`), 'opened filter drawer');
  await evaluate(`(() => {window.requestAnimationFrame=window.__laiOriginalRaf;
    delete window.__laiOriginalRaf;delete window.__laiSuppressedRaf;})()`);
  await wait(340);
  const filterHeader = await evaluate(`(() => {
    const drawer = document.querySelector('#overlay-root .drawer.filter');
    const header = drawer.querySelector('.drawer-head');
    const title = header.querySelector('h2');
    const close = header.querySelector('[aria-label="关闭"]');
    const d = drawer.getBoundingClientRect(), h = header.getBoundingClientRect();
    const t = title.getBoundingClientRect(), c = close.getBoundingClientRect();
    return {
      headerHeight: h.height,
      titleLeft: t.left - d.left,
      titleFontSize: getComputedStyle(title).fontSize,
      titleWeight: getComputedStyle(title).fontWeight,
      titleLineHeight: getComputedStyle(title).lineHeight,
      closeWidth: c.width,
      closeHeight: c.height,
      closeRight: d.right - c.right,
      closeIconWidth: close.querySelector('svg')?.getBoundingClientRect().width,
    };
  })()`);
  fs.writeFileSync(path.join(evidence, "customer-filter-header-geometry.json"), JSON.stringify(filterHeader, null, 2));
  assert.equal(filterHeader.headerHeight, 60);
  assert.equal(filterHeader.titleFontSize, "16px");
  assert.equal(filterHeader.titleWeight, "500");
  assert.equal(filterHeader.titleLineHeight, "22px");
  assert.ok(Math.abs(filterHeader.titleLeft - 20) < 0.6);
  assert.equal(filterHeader.closeWidth, 16);
  assert.ok(Math.abs(filterHeader.closeHeight - 19.6953125) < 0.5);
  assert.ok(Math.abs(filterHeader.closeRight - 20) < 0.6);
  assert.equal(filterHeader.closeIconWidth, 16);
  const drawerFrame = await cdp.call("Page.captureScreenshot", {format:"png",captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence, "customer-filter-drawer.png"), Buffer.from(drawerFrame.data, "base64"));
  await pointerClick('[data-action="close-modal"]');
  const closingState = await evaluate(`(() => ({
    closing: Boolean(document.querySelector('#overlay-root .modal-closing')),
    overlay: Boolean(document.querySelector('#overlay-root .overlay')),
    buttons: document.querySelectorAll('[data-action="close-modal"]').length,
    filterMaskTiming: getComputedStyle(document.querySelector('#overlay-root .overlay')).transitionTimingFunction,
    filterDrawerTiming: getComputedStyle(document.querySelector('#overlay-root .drawer.filter')).transitionTimingFunction,
  }))()`);
  assert.equal(closingState.closing, true, JSON.stringify(closingState));
  assert.equal(closingState.filterMaskTiming, 'linear', JSON.stringify(closingState));
  assert.equal(closingState.filterDrawerTiming, 'cubic-bezier(0.23, 1, 0.32, 1)', JSON.stringify(closingState));
  await pointerClick('[data-action="filter"]');
  const filterCloseClick = await evaluate(`(() => {
    const root=document.querySelector('#overlay-root'),overlay=root?.querySelector('.overlay');
    const trigger=document.querySelector('[data-action="filter"]'),r=trigger.getBoundingClientRect();
    const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    return {overlays:root?.querySelectorAll('.overlay').length,
      closing:overlay?.classList.contains('modal-closing'),
      reopened:!!root?.querySelector('.modal-open'),
      triggerOccluded:!!overlay?.contains(hit)};
  })()`);
  assert.deepEqual(filterCloseClick,{overlays:1,closing:true,reopened:false,triggerOccluded:true},
    'clicking filter trigger during exit cannot reopen through the closing drawer');
  await waitFor(async () => evaluate(`document.querySelector('#overlay-root .overlay') === null`), 'closed filter drawer');

  await evaluate(`(() => {
    const trigger = document.querySelector('[data-action="filter"]');
    trigger.focus();
    trigger.click();
  })()`);
  const keyboardDrawer = await evaluate(`(() => ({
    visible: Boolean(document.querySelector('#overlay-root .drawer')),
    motion: Boolean(document.querySelector('#overlay-root .modal-motion')),
  }))()`);
  assert.deepEqual(keyboardDrawer, {visible:true, motion:false});
  await evaluate(`(() => {
    const mode = document.querySelector('[data-filter-mode="advanced"]');
    mode.focus();
    mode.click();
  })()`);
  await evaluate(`document.querySelector('[data-action="close-modal"]').click()`);
  assert.equal(await evaluate(`document.querySelector('#overlay-root .overlay') === null`), true);
  assert.equal(await evaluate(`document.activeElement?.dataset.action === 'filter'`), true);

  await cdp.call('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await pointerClick('[data-action="filter"]');
  const reducedDrawer = await evaluate(`(() => {
    const drawer = document.querySelector('#overlay-root .drawer');
    return { transform: getComputedStyle(drawer).transform,
      duration: getComputedStyle(drawer).transitionDuration };
  })()`);
  assert.deepEqual(reducedDrawer, {transform:'none', duration:'0.08s'});
  await pointerClick('[data-action="close-modal"]');
  await waitFor(async () => evaluate(`document.querySelector('#overlay-root .overlay') === null`), 'reduced-motion drawer close');
  await cdp.call('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await pointerClick('[data-action="table-options"]');
  await pointerClick('.popover [data-action="settings"]');
  const centeredDialog = await evaluate(`(() => {
    const overlay = document.querySelector('#overlay-root .overlay');
    const drawer = overlay?.querySelector('.center-dialog');
    return {motion:overlay?.classList.contains('modal-motion'), centered:Boolean(drawer)};
  })()`);
  assert.deepEqual(centeredDialog, {motion:true, centered:true});
  await wait(280);
  const centeredPosition = await evaluate(`(() => {
    const rect = document.querySelector('#overlay-root .center-dialog').getBoundingClientRect();
    return Math.abs(rect.left + rect.width / 2 - innerWidth / 2);
  })()`);
  assert.ok(centeredPosition < 1);
  const centeredFrame = await cdp.call("Page.captureScreenshot", {format:"png",captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence, "customer-settings-dialog.png"), Buffer.from(centeredFrame.data, "base64"));
  await pointerClick('[data-action="close-modal"]');
  await waitFor(async () => evaluate(`document.querySelector('#overlay-root .overlay') === null`), 'closed settings dialog');
  assert.equal(await evaluate(`document.activeElement?.dataset.action === 'table-options'`), true);

  const poolCustomer = await evaluate(`document.querySelector('.company-link').dataset.open`);
  await evaluate(`document.querySelector('.company-link').click()`);
  await waitFor(async () => evaluate(`Boolean(document.querySelector('.lcd-pagebar [data-action="customer-actions"]'))`), 'customer detail actions entry');
  const customerActionsEntry = await evaluate(`Boolean(document.querySelector('[data-action="customer-actions"]'))`);
  assert.equal(customerActionsEntry, true);
  await pointerClick('[data-action="customer-actions"]');
  assert.equal(await evaluate(`Boolean(document.querySelector('.drawer [data-action="move-current-pool"]'))`), true);
  const actionsWidth = await evaluate(`document.querySelector('#overlay-root .drawer').getBoundingClientRect().width`);
  assert.ok(actionsWidth >= 340 && actionsWidth <= 420, `customer actions drawer width: ${actionsWidth}`);
  await wait(280);
  const actionsFrame = await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-actions-drawer.png'),Buffer.from(actionsFrame.data,'base64'));
  await evaluate(`document.querySelector('.drawer [data-action="move-current-pool"]').click()`);
  assert.equal(await evaluate(`Boolean(document.querySelector('#confirm-transition'))`), true);
  await evaluate(`document.querySelector('#confirm-transition').click()`);
  await waitFor(async () => evaluate(`Boolean(document.querySelector('.customer-main .company-link')) && !document.querySelector('#overlay-root .overlay')`), 'customer moved to pool');
  await evaluate(`document.querySelector('[data-lai-screen="pool"]').click()`);
  const poolRow = await evaluate(`Boolean([...document.querySelectorAll('.module-page [data-open]')].find(button => button.dataset.open === ${JSON.stringify(poolCustomer)}))`);
  assert.equal(poolRow, true);
  await evaluate(`document.querySelector('.module-page .company-link').click()`);
  const poolInfoFields = await evaluate(`(() => {
    const fields=[...document.querySelectorAll('.lcd-body-info .lcd-field')];
    const value=name=>fields.find(field=>field.querySelector('dt')?.textContent===name)?.querySelector('dd')?.textContent?.trim();
    return {lastPoolEntry:value('最近进入公海时间'),poolEntryCount:value('进入公海次数'),
      systemInfo:document.querySelector('.lcd-body-info')?.textContent.includes('系统信息')};
  })()`);
  const localNow = new Date();
  const localDay = `${localNow.getFullYear()}-${String(localNow.getMonth()+1).padStart(2,'0')}-${String(localNow.getDate()).padStart(2,'0')}`;
  assert.ok(poolInfoFields.lastPoolEntry?.startsWith(localDay));
  assert.match(poolInfoFields.lastPoolEntry,/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.ok(Number(poolInfoFields.poolEntryCount) >= 1);
  assert.equal(poolInfoFields.systemInfo,true);
  await evaluate(`[...document.querySelectorAll('.lcd-body-info .lcd-field')].find(field=>field.querySelector('dt')?.textContent==='最近进入公海时间').scrollIntoView({block:'center',behavior:'instant'})`);
  const poolInfoFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-pool-entry-fields.png'),Buffer.from(poolInfoFrame.data,'base64'));
  await evaluate(`document.querySelector('.lcd-pagebar').scrollIntoView({block:'start',behavior:'instant'})`);
  await evaluate(`document.querySelector('[data-action="list"]').click()`);
  const poolReturn = await evaluate(`(() => ({
    title: document.querySelector('.pagebar h1')?.textContent,
    row: Boolean([...document.querySelectorAll('.module-page [data-open]')].find(button => button.dataset.open === ${JSON.stringify(poolCustomer)})),
  }))()`);
  assert.deepEqual(poolReturn, {title:'公海客户',row:true});
  await pointerClick('.module-page .company-link');
  await waitFor(async () => evaluate(`Boolean(document.querySelector('.lcd-root'))`), 'pool customer detail');
  await wait(260);
  await pointerClick('[data-action="list"]');
  await waitFor(async () => evaluate(`Boolean(document.querySelector('.pagebar h1')) && document.querySelector('.pagebar h1').textContent === '公海客户'`), 'animated return to pool');
  const pointerPoolReturn = await evaluate(`(() => ({
    title: document.querySelector('.pagebar h1')?.textContent,
    animated: Boolean(document.querySelector('.customer-list-enter')),
  }))()`);
  assert.deepEqual(pointerPoolReturn,{title:'公海客户',animated:true});
  await evaluate(`document.querySelector('[data-lai-screen="active"]').click()`);
  await evaluate(`document.querySelector('.row-more').click()`);
  await evaluate(`document.querySelector('.popover [data-edit-customer]').click()`);
  assert.equal(await evaluate(`Boolean(document.querySelector('#customer-form'))`),true);
  await evaluate(`document.querySelector('[data-action="close-modal"]').click()`);
  await evaluate(`document.querySelector('.row-more').click()`);
  await evaluate(`document.querySelector('.popover [data-follow]').click()`);
  await waitFor(async () => evaluate(`document.querySelector('#toast')?.textContent === '已关注客户'`), 'row follow save');
  const rowEditCancel = await evaluate(`(() => ({
    listVisible: Boolean(document.querySelector('.customer-table')),
    detailVisible: Boolean(document.querySelector('.lcd-root')),
  }))()`);
  assert.deepEqual(rowEditCancel,{listVisible:true,detailVisible:false});
  const tagCustomer = await evaluate(`document.querySelector('.company-link').dataset.open`);
  await evaluate(`document.querySelector('.company-link').click()`);
  await waitFor(async () => evaluate(`Boolean(document.querySelector('.lcd-root [data-action="customer-tags"]'))`), 'detail tag control');
  await pointerClick('[data-action="customer-tags"]');
  const tagPopover = await evaluate(`(() => ({
    visible: Boolean(document.querySelector('.tag-popover #customer-tags-form')),
    animation: getComputedStyle(document.querySelector('.tag-popover')).animationName,
    width: document.querySelector('.tag-popover').getBoundingClientRect().width,
  }))()`);
  assert.equal(tagPopover.visible,true);
  assert.equal(tagPopover.animation,'lai-tag-popover-in');
  assert.ok(tagPopover.width >= 280 && tagPopover.width <= 320);
  await waitFor(async () => evaluate(`!document.querySelector('#toast.show')`), 'prior toast to clear');
  await wait(220);
  const tagFrame = await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-tag-editor.png'),Buffer.from(tagFrame.data,'base64'));
  await evaluate(`(() => {
    const input=document.querySelector('#customer-tags-form [name="tags"]');
    input.value='Lai Acceptance, 复购';
    input.closest('form').requestSubmit();
  })()`);
  await waitFor(async () => evaluate(`Boolean([...document.querySelectorAll('.lcd-tags .lcd-tag')].find(tag=>tag.textContent==='Lai Acceptance')) && !document.querySelector('.tag-popover')`), 'saved customer tags');
  await evaluate(`document.querySelector('[data-action="list"]').click()`);
  const tagList = await evaluate(`(() => {
    const row=[...document.querySelectorAll('.customer-table tbody tr')].find(tr=>tr.querySelector('.company-link')?.dataset.open===${JSON.stringify(tagCustomer)});
    return Boolean(row?.textContent.includes('Lai Acceptance'));
  })()`);
  assert.equal(tagList,true);
  await cdp.call('Page.reload',{ignoreCache:true});
  await waitFor(async () => evaluate(`Boolean(document.querySelector('.customer-table .company-link'))`), 'reloaded customer list');
  await evaluate(`document.querySelector('.company-link').click()`);
  await waitFor(async () => evaluate(`Boolean(document.querySelector('.lcd-root'))`), 'reloaded customer detail');
  assert.equal(await evaluate(`Boolean([...document.querySelectorAll('.lcd-tags .lcd-tag')].find(tag=>tag.textContent==='Lai Acceptance'))`),true);
  await evaluate(`document.querySelector('[data-action="customer-tags"]').click()`);
  const keyboardTag = await evaluate(`(() => ({
    animation: getComputedStyle(document.querySelector('.tag-popover')).animationName,
    focused: document.activeElement?.id,
  }))()`);
  assert.deepEqual(keyboardTag,{animation:'none',focused:'customer-tags-input'});
  await cdp.call('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  const tagEscape = await evaluate(`(() => ({
    closed: !document.querySelector('.tag-popover'),
    focused: document.activeElement?.dataset.action,
  }))()`);
  assert.deepEqual(tagEscape,{closed:true,focused:'customer-tags'});
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await pointerClick('[data-action="customer-tags"]');
  const reducedTag = await evaluate(`(() => ({
    animation: getComputedStyle(document.querySelector('.tag-popover')).animationName,
    duration: getComputedStyle(document.querySelector('.tag-popover')).animationDuration,
  }))()`);
  assert.deepEqual(reducedTag,{animation:'lai-tag-popover-fade',duration:'0.08s'});
  await evaluate(`document.querySelector('[data-action="cancel-customer-tags"]').click()`);
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});

  await evaluate(`document.querySelector('[data-action="list"]').click()`);
  await waitFor(async () => evaluate(`document.querySelectorAll('.customer-table [data-select]').length >= 3`), 'batch tag customer list');
  const batchNames = await evaluate(`[...document.querySelectorAll('.customer-table [data-select]')].slice(0,3).map(input=>input.dataset.select)`);
  const batchActivityBefore = await evaluate(`(() => ${JSON.stringify(batchNames)}.map(name => {
    const index=[...document.querySelectorAll('.customer-table thead th')].findIndex(th=>th.textContent.includes('最近动态'));
    const row=[...document.querySelectorAll('.customer-table tbody tr')].find(tr=>tr.querySelector('[data-select]')?.dataset.select===name);
    return row?.cells[index]?.textContent;
  }))()`);
  for (const name of batchNames.slice(0,2)) {
    await evaluate(`[...document.querySelectorAll('.customer-table [data-select]')].find(input=>input.dataset.select===${JSON.stringify(name)}).click()`);
  }
  assert.equal(await evaluate(`document.querySelector('.replica-batch b')?.textContent`), '2');
  await pointerClick('[data-action="batch-tags"]');
  const batchDrawer = await evaluate(`(() => {
    const overlay=document.querySelector('#overlay-root .overlay');
    const drawer=overlay?.querySelector('.drawer');
    return {open:Boolean(document.querySelector('#batch-tags-form')),motion:overlay?.classList.contains('modal-motion'),
      width:drawer?.getBoundingClientRect().width,count:document.querySelector('.batch-tags-count')?.textContent,
      add:document.querySelector('#batch-tags-form [name="mode"]:checked')?.value};
  })()`);
  assert.equal(batchDrawer.open,true);
  assert.equal(batchDrawer.motion,true);
  assert.ok(batchDrawer.width >= 340 && batchDrawer.width <= 420);
  assert.equal(batchDrawer.count,'将标签应用到 2 位客户');
  assert.equal(batchDrawer.add,'add');
  await wait(280);
  const batchFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-batch-tags-drawer.png'),Buffer.from(batchFrame.data,'base64'));
  await evaluate(`(() => {
    const form=document.querySelector('#batch-tags-form');
    form.elements.namedItem('tags').value='LaiBatchAcceptance2026';
    form.requestSubmit();
  })()`);
  await waitFor(async () => evaluate(`!document.querySelector('#batch-tags-form') && !document.querySelector('.replica-batch')`), 'batch tags saved');
  const batchList = await evaluate(`(() => ${JSON.stringify(batchNames)}.map(name => {
    const index=[...document.querySelectorAll('.customer-table thead th')].findIndex(th=>th.textContent.includes('客户标签'));
    const row=[...document.querySelectorAll('.customer-table tbody tr')].find(tr=>tr.querySelector('[data-select]')?.dataset.select===name);
    return Boolean(row?.cells[index]?.textContent.includes('LaiBatchAcceptance2026'));
  }))()`);
  assert.deepEqual(batchList,[true,true,false]);
  const batchActivityAfter = await evaluate(`(() => ${JSON.stringify(batchNames)}.map(name => {
    const index=[...document.querySelectorAll('.customer-table thead th')].findIndex(th=>th.textContent.includes('最近动态'));
    const row=[...document.querySelectorAll('.customer-table tbody tr')].find(tr=>tr.querySelector('[data-select]')?.dataset.select===name);
    return row?.cells[index]?.textContent;
  }))()`);
  assert.deepEqual(batchActivityAfter,batchActivityBefore);
  await cdp.call('Page.reload',{ignoreCache:true});
  await waitFor(async () => evaluate(`document.querySelectorAll('.customer-table [data-select]').length >= 3`), 'reloaded batch tags list');
  const persistedBatch = await evaluate(`(() => ${JSON.stringify(batchNames)}.map(name => {
    const index=[...document.querySelectorAll('.customer-table thead th')].findIndex(th=>th.textContent.includes('客户标签'));
    const row=[...document.querySelectorAll('.customer-table tbody tr')].find(tr=>tr.querySelector('[data-select]')?.dataset.select===name);
    return Boolean(row?.cells[index]?.textContent.includes('LaiBatchAcceptance2026'));
  }))()`);
  assert.deepEqual(persistedBatch,[true,true,false]);
  await evaluate(`[...document.querySelectorAll('.customer-table .company-link')].find(link=>link.dataset.open===${JSON.stringify(batchNames[0])}).click()`);
  await waitFor(async () => evaluate(`Boolean(document.querySelector('.lcd-root [data-tab="history"]'))`), 'batch tag customer detail');
  await evaluate(`document.querySelector('[data-tab="history"]').click()`);
  assert.equal(await evaluate(`document.querySelector('.lcd-body-history')?.textContent.includes('批量添加客户标签：LaiBatchAcceptance2026')`),true);
  await wait(220);
  const operationFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-operation-history.png'),Buffer.from(operationFrame.data,'base64'));
  const operationHeader=await evaluate(`(() => {
    const article=document.querySelector('.lcd-operation-record');
    const button=article.querySelector('[data-action="toggle-operation"]');
    return {width:button.getBoundingClientRect().width,articleWidth:article.getBoundingClientRect().width,
      height:button.getBoundingClientRect().height,containsTime:!!button.querySelector('time'),
      containsDescription:!!button.querySelector('.lcd-operation-description')};
  })()`);
  assert.ok(Math.abs(operationHeader.width-operationHeader.articleWidth)<1);
  assert.ok(operationHeader.height>=45);
  assert.equal(operationHeader.containsTime,true);
  assert.equal(operationHeader.containsDescription,true);
  await pointerClick('.lcd-operation-description');
  const operationExpanded=await evaluate(`(() => {
    const button=document.querySelector('[data-action="toggle-operation"]');
    const panel=document.getElementById(button.getAttribute('aria-controls'));
    const style=getComputedStyle(panel);
    const chevron=getComputedStyle(button.querySelector('.lcd-operation-chevron'));
    return {expanded:button.getAttribute('aria-expanded'),hidden:panel.getAttribute('aria-hidden'),
      detail:panel.textContent.includes('批量添加客户标签：LaiBatchAcceptance2026'),
      transition:style.transitionDuration,panelHeight:panel.getBoundingClientRect().height,
      innerHeight:panel.querySelector('.lcd-operation-detail-inner').scrollHeight,
      chevronScaleX:new DOMMatrixReadOnly(chevron.transform).a,
      placeholder:!!document.querySelector('#overlay-root .feature-dialog')};
  })()`);
  assert.equal(operationExpanded.expanded,'true');
  assert.equal(operationExpanded.hidden,'false');
  assert.equal(operationExpanded.detail,true);
  assert.equal(operationExpanded.placeholder,false);
  assert.equal(operationExpanded.transition,'0s');
  assert.ok(operationExpanded.panelHeight>=operationExpanded.innerHeight-1,'Operation detail must be fully open on the first frame');
  assert.ok(operationExpanded.chevronScaleX<-.95,'Operation chevron must face its final direction on the first frame');
  const operationDetailStyle=await evaluate(`(() => {
    const style=getComputedStyle(document.querySelector('.lcd-operation-detail dl'));
    return {background:style.backgroundColor,borderRadius:style.borderRadius,padding:style.padding,
      borderColor:style.borderTopColor};
  })()`);
  assert.deepEqual(operationDetailStyle,{background:'rgb(250, 250, 250)',borderRadius:'8px',padding:'16px',borderColor:'rgb(240, 240, 240)'});
  await wait(180);
  const operationExpandedFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-operation-expanded.png'),Buffer.from(operationExpandedFrame.data,'base64'));
  await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:720,deviceScaleFactor:1,mobile:false});
  const compactOperation=await evaluate(`(() => {
    const header=document.querySelector('.lcd-operation-head').getBoundingClientRect();
    const detail=document.querySelector('.lcd-operation-detail dl');
    const card=detail.getBoundingClientRect();
    return {headerWithinViewport:header.left>=0&&header.right<=innerWidth,
      cardWithinViewport:card.left>=0&&card.right<=innerWidth,
      headerHeight:header.height,cardWidth:card.width,
      singleColumn:getComputedStyle(detail).gridTemplateColumns.split(' ').length===1};
  })()`);
  assert.equal(compactOperation.headerWithinViewport,true);
  assert.equal(compactOperation.cardWithinViewport,true);
  assert.ok(compactOperation.headerHeight>=45);
  assert.equal(compactOperation.singleColumn,true);
  const compactOperationFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-operation-expanded-1100.png'),Buffer.from(compactOperationFrame.data,'base64'));
  await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:1022,deviceScaleFactor:1,mobile:false});
  const keyboardOperation=await evaluate(`(() => {
    const button=document.querySelector('[data-action="toggle-operation"]');
    button.click();
    const panel=document.getElementById(button.getAttribute('aria-controls'));
    return {expanded:button.getAttribute('aria-expanded'),hidden:panel.getAttribute('aria-hidden'),
      transition:getComputedStyle(panel).transitionDuration,
      panelHeight:panel.getBoundingClientRect().height,
      chevronScaleX:new DOMMatrixReadOnly(getComputedStyle(button.querySelector('.lcd-operation-chevron')).transform).a};
  })()`);
  assert.deepEqual(keyboardOperation,{expanded:'false',hidden:'true',transition:'0s',panelHeight:0,chevronScaleX:1});
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await pointerClick('[data-action="toggle-operation"]');
  const reducedOperation=await evaluate(`(() => {
    const button=document.querySelector('[data-action="toggle-operation"]');
    const panel=document.getElementById(button.getAttribute('aria-controls'));
    return {expanded:button.getAttribute('aria-expanded'),transition:getComputedStyle(panel).transitionDuration};
  })()`);
  assert.equal(reducedOperation.expanded,'true');
  assert.ok(Number.parseFloat(reducedOperation.transition)<.001,'Reduced-motion operation detail must still open immediately');
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await evaluate(`document.querySelector('[data-tab="activity"]').click()`);
  assert.equal(await evaluate(`document.querySelector('.lcd-body-activity')?.textContent.includes('批量添加客户标签：LaiBatchAcceptance2026')`),false);
  await wait(220);
  const activityFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-activity-after-operation.png'),Buffer.from(activityFrame.data,'base64'));
  await evaluate(`document.querySelector('[data-action="list"]').click()`);
  await waitFor(async () => evaluate(`document.querySelectorAll('.customer-table [data-select]').length >= 3`), 'return to batch tag list');
  for (const name of batchNames.slice(0,2)) {
    await evaluate(`[...document.querySelectorAll('.customer-table [data-select]')].find(input=>input.dataset.select===${JSON.stringify(name)}).click()`);
  }
  await evaluate(`document.querySelector('[data-action="batch-tags"]').click()`);
  assert.equal(await evaluate(`document.querySelector('#overlay-root .overlay').classList.contains('modal-motion')`),false);
  const removalMode = await evaluate(`(() => {
    const form=document.querySelector('#batch-tags-form');
    form.elements.namedItem('mode').value='remove';
    form.elements.namedItem('tags').value='LaiBatchAcceptance2026';
    const mode=form.querySelector('[name="mode"]:checked')?.value;
    form.requestSubmit();
    return mode;
  })()`);
  assert.equal(removalMode,'remove');
  await waitFor(async () => evaluate(`!document.querySelector('#batch-tags-form') && !document.querySelector('.replica-batch')`), 'batch tags removed');
  const removedBatch = await evaluate(`(() => ${JSON.stringify(batchNames)}.map(name => {
    const index=[...document.querySelectorAll('.customer-table thead th')].findIndex(th=>th.textContent.includes('客户标签'));
    const row=[...document.querySelectorAll('.customer-table tbody tr')].find(tr=>tr.querySelector('[data-select]')?.dataset.select===name);
    return Boolean(row?.cells[index]?.textContent.includes('LaiBatchAcceptance2026'));
  }))()`);
  assert.deepEqual(removedBatch,[false,false,false]);

  await evaluate(`document.querySelector('[data-action="manage-segments"]').click()`);
  await evaluate(`document.querySelector('.drawer [data-action="new-manual"]').click()`);
  assert.equal(await evaluate(`Boolean(document.querySelector('#segment-form'))`),true);
  await evaluate(`(() => {
    const form=document.querySelector('#segment-form');
    form.elements.name.value='Lai Group Acceptance';
    form.requestSubmit();
  })()`);
  await waitFor(async () => evaluate(`!document.querySelector('#segment-form') && Boolean(document.querySelector('[data-group^="segment:"]'))`), 'saved manual group');
  const groupId = await evaluate(`[...document.querySelectorAll('[data-group^="segment:"]')].find(button=>button.textContent.includes('Lai Group Acceptance'))?.dataset.group`);
  assert.ok(groupId?.startsWith('segment:'));
  await evaluate(`document.querySelector('[data-group="all"]').click()`);
  await evaluate(`[...document.querySelectorAll('.company-link')].find(link=>link.dataset.open===${JSON.stringify(batchNames[0])}).click()`);
  await waitFor(async () => evaluate(`Boolean(document.querySelector('.lcd-root [data-action="edit"]'))`), 'group customer detail');
  await evaluate(`document.querySelector('.lcd-root [data-action="edit"]').click()`);
  assert.equal(await evaluate(`Boolean(document.querySelector('#customer-form [name="previewGroup"] option[value="Lai Group Acceptance"]'))`),true);
  await evaluate(`(() => {
    const form=document.querySelector('#customer-form');
    form.elements.namedItem('previewGroup').value='Lai Group Acceptance';
    form.requestSubmit(document.querySelector('button[form="customer-form"][value="save"]'));
  })()`);
  await waitFor(async () => evaluate(`!document.querySelector('#customer-form') && document.querySelector('.lcd-summary-fields')?.textContent.includes('Lai Group Acceptance')`), 'saved customer manual group');
  await evaluate(`document.querySelector('[data-action="list"]').click()`);
  await waitFor(async () => evaluate(`Boolean(document.querySelector('[data-group="all"]'))`), 'group list');
  await evaluate(`document.querySelector(${JSON.stringify(`[data-group="${groupId}"]`)}).click()`);
  const groupMatches = await evaluate(`[...document.querySelectorAll('.customer-table [data-select]')].map(input=>input.dataset.select)`);
  assert.deepEqual(groupMatches,[batchNames[0]]);
  const groupFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-manual-group-from-editor.png'),Buffer.from(groupFrame.data,'base64'));
  await cdp.call('Page.reload',{ignoreCache:true});
  await waitFor(async () => evaluate(`Boolean(document.querySelector('[data-group="all"]'))`), 'reloaded manual group list');
  if (!await evaluate(`Boolean(document.querySelector(${JSON.stringify(`[data-group="${groupId}"]`)}))`))
    await evaluate(`document.querySelector('[data-expand="manual"]').click()`);
  await evaluate(`document.querySelector(${JSON.stringify(`[data-group="${groupId}"]`)}).click()`);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.customer-table [data-select]')].map(input=>input.dataset.select)`),[batchNames[0]]);
  await evaluate(`(() => {
    const field=document.querySelector('#search-field');
    field.value='name';
    field.dispatchEvent(new Event('change',{bubbles:true}));
    const input=document.querySelector('#search');
    input.value='LAI_GROUP_NO_MATCH';
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  })()`);
  assert.equal(await evaluate(`document.querySelector('.active-filters span')?.textContent.trim()`),'1 个筛选条件');
  assert.equal(await evaluate(`document.querySelectorAll('.customer-table [data-select]').length`),0);
  await evaluate(`document.querySelector('[data-action="reset-all"]').click()`);
  const groupClearState=await evaluate(`({
    activeGroup:document.querySelector('.group-row.active')?.dataset.group,
    heading:document.querySelector('.list-heading strong')?.textContent.trim(),
    names:[...document.querySelectorAll('.customer-table [data-select]')].map(input=>input.dataset.select),
    filterCount:document.querySelector('.active-filters span')?.textContent.trim()||null
  })`);
  assert.deepEqual(groupClearState,{activeGroup:groupId,heading:'Lai Group Acceptance',names:[batchNames[0]],filterCount:null});
  await evaluate(`document.querySelector('[data-group="all"]').click()`);
  const defaultTypeNames=await evaluate(`[...document.querySelectorAll('.company-link')].slice(0,2).map(button=>button.textContent.trim())`);
  assert.equal(defaultTypeNames.length,2);
  await evaluate(`document.querySelector('.company-link').click()`);
  await evaluate(`document.querySelector('[data-tab="activity"]').click()`);
  await evaluate(`document.querySelector('[data-action="activity-advanced-filter"]').click()`);
  await evaluate(`(() => {
    const form=document.querySelector('#activity-advanced-form');
    const group=form.querySelector('[data-activity-type-group="followup"]');
    group.checked=true; group.dispatchEvent(new Event('change',{bubbles:true}));
    form.elements.rememberTypes.checked=true;
    form.requestSubmit();
  })()`);
  await waitFor(async()=>evaluate(`(async()=>{
    const payload=await(await fetch('/api/data',{cache:'no-store'})).json();
    return payload.data.laiSettings?.activityTypeDefaults?.enabled===true;
  })()`),'saved activity type preference');
  await evaluate(`document.querySelector('[data-action="list"]').click()`);
  await evaluate(`(() => {
    const other=[...document.querySelectorAll('.company-link')].find(button=>button.textContent.trim()===${JSON.stringify(defaultTypeNames[1])});
    other?.click();
  })()`);
  assert.equal(await evaluate(`document.querySelector('.lcd-identity-text h2')?.firstChild?.textContent.trim()`),defaultTypeNames[1]);
  await evaluate(`document.querySelector('[data-tab="activity"]').click()`);
  const rememberedActivityTypes=await evaluate(`(() => ({
    active:document.querySelector('[data-action="activity-advanced-filter"]')?.classList.contains('lcd-filter-active'),
    draft:document.querySelector('#followup-text')?.value || '',
  }))()`);
  assert.deepEqual(rememberedActivityTypes,{active:true,draft:''});

  const documentCustomer=await evaluate(`document.querySelector('.lcd-identity-text h2')?.firstChild?.textContent.trim()`);
  assert.ok(documentCustomer);
  await evaluate(`(async () => {
    const snapshot=await (await fetch('/api/data',{cache:'no-store'})).json();
    snapshot.data.orders.push({id:'lai-document-acceptance',num:'LAI-DOC-1',client:${JSON.stringify(documentCustomer)},
      amount:0,attachments:[{name:'Résumé acceptance.pdf'},{fileName:'Invoice acceptance.png'},
        ...Array.from({length:23},(_,i)=>({name:'Document '+String(i+1).padStart(2,'0')+'.pdf'}))]});
    const other=Object.keys(snapshot.data.customers).find(name=>name!==${JSON.stringify(documentCustomer)});
    snapshot.data.orders.push({id:'lai-document-other',num:'LAI-DOC-2',client:other,
      amount:0,attachments:[{name:'Resume from another customer.pdf'}]});
    const response=await fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({state:{app:'laicai-lai',version:'1.4.2',data:snapshot.data},baseRevision:snapshot.revision})});
    if(!response.ok) throw Error('isolated document fixture save failed');
  })()`);
  await cdp.call('Page.navigate',{url:`${base}/trade-order-system.html?token=${encodeURIComponent(token)}#customers`});
  await waitFor(async()=>evaluate(`Boolean(document.querySelector('.company-link'))`),'document test customer list');
  await evaluate(`[...document.querySelectorAll('.company-link')].find(button=>button.dataset.open===${JSON.stringify(documentCustomer)}).click()`);
  await waitFor(async()=>evaluate(`Boolean(document.querySelector('[data-tab="documents"]'))`),'document tab');
  await evaluate(`document.querySelector('[data-tab="documents"]').scrollIntoView({block:'center',behavior:'instant'})`);
  await pointerClick('[data-tab="documents"]');
  const documentAll=await evaluate(`(() => ({
    count:document.querySelectorAll('#document-results tbody tr').length,
    text:document.querySelector('#document-results')?.textContent,
    search:document.querySelector('#document-search-input')?.value,
  }))()`);
  assert.equal(documentAll.count,20);
  assert.match(documentAll.text,/Résumé acceptance\.pdf/);
  assert.match(documentAll.text,/Invoice acceptance\.png/);
  assert.doesNotMatch(documentAll.text,/Resume from another customer/);
  assert.match(documentAll.text,/共 25 条/);
  const documentFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-documents-all.png'),Buffer.from(documentFrame.data,'base64'));
  const documentSearch=await evaluate(`(() => {
    const input=document.querySelector('#document-search-input');
    input.value='resume';input.dispatchEvent(new Event('input',{bubbles:true}));
    return {focused:document.activeElement?.id,value:input.value,
      count:document.querySelectorAll('#document-results tbody tr').length,
      text:document.querySelector('#document-results')?.textContent};
  })()`);
  assert.equal(documentSearch.count,1);
  assert.match(documentSearch.text,/Résumé acceptance\.pdf/);
  assert.doesNotMatch(documentSearch.text,/Invoice acceptance\.png/);
  assert.match(documentSearch.text,/共 1 条/);
  await pointerClick('[data-action="document-search"]');
  const documentPointerMotion=await evaluate(`(() => ({
    animation:getComputedStyle(document.querySelector('#document-results')).animationName,
    focused:document.activeElement?.id,
  }))()`);
  assert.deepEqual(documentPointerMotion,{animation:'lai-detail-filter-enter',focused:'document-search-input'});
  const documentSearchFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-documents-search.png'),Buffer.from(documentSearchFrame.data,'base64'));
  await evaluate(`(() => {
    const input=document.querySelector('#document-search-input');
    input.value='__lai_no_match__';input.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  const documentEmpty=await evaluate(`(() => ({
    empty:document.querySelector('#document-results')?.textContent.includes('未找到文档'),
    count:document.querySelectorAll('#document-results tbody tr').length,
    total:document.querySelector('#document-results .lcd-pagination')?.textContent.includes('共 0 条'),
  }))()`);
  assert.deepEqual(documentEmpty,{empty:true,count:0,total:true});
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await pointerClick('[data-action="document-search"]');
  const documentReducedMotion=await evaluate(`(() => ({
    animation:getComputedStyle(document.querySelector('#document-results')).animationName,
    duration:getComputedStyle(document.querySelector('#document-results')).animationDuration,
  }))()`);
  assert.deepEqual(documentReducedMotion,{animation:'lai-detail-fade-in',duration:'0.08s'});
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await evaluate(`(() => {
    const input=document.querySelector('#document-search-input');
    input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await evaluate(`document.querySelector('[data-action="document-next"]').scrollIntoView({block:'center',behavior:'instant'})`);
  await pointerClick('[data-action="document-next"]');
  const documentPageTwo=await evaluate(`(() => ({
    rows:document.querySelectorAll('#document-results tbody tr').length,
    page:document.querySelector('#document-results [aria-label^="第 "]')?.textContent,
    first:document.querySelector('#document-results tbody tr')?.textContent,
    nextDisabled:document.querySelector('[data-action="document-next"]')?.disabled,
  }))()`);
  assert.equal(documentPageTwo.rows,5);
  assert.equal(documentPageTwo.page,'2');
  assert.match(documentPageTwo.first,/Document 19\.pdf/);
  assert.equal(documentPageTwo.nextDisabled,true);
  const documentSelection=await evaluate(`(() => {
    document.querySelector('#document-results [data-document-select]').click();
    return {selected:document.querySelector('#document-results .lcd-doc-selected')?.textContent,
      checked:document.querySelector('#document-results [data-document-select]')?.checked,
      partial:document.querySelector('#document-results [data-document-select-all]')?.indeterminate,
      placeholder:!!document.querySelector('#overlay-root .feature-dialog')};
  })()`);
  assert.equal(documentSelection.checked,true);
  assert.equal(documentSelection.partial,true);
  assert.match(documentSelection.selected,/已选 1 条/);
  assert.equal(documentSelection.placeholder,false);
  const documentSelectionAfterTab=await evaluate(`(() => {
    document.querySelector('[data-tab="info"]').click();
    document.querySelector('[data-tab="documents"]').click();
    return {selected:document.querySelector('#document-results .lcd-doc-selected')?.textContent,
      partial:document.querySelector('#document-results [data-document-select-all]')?.indeterminate,
      page:document.querySelector('#document-results [aria-label^="第 "]')?.textContent};
  })()`);
  assert.match(documentSelectionAfterTab.selected,/已选 1 条/);
  assert.equal(documentSelectionAfterTab.partial,true);
  assert.equal(documentSelectionAfterTab.page,'2');
  await evaluate(`document.querySelector('[data-action="document-prev"]').scrollIntoView({block:'center',behavior:'instant'})`);
  await pointerClick('[data-action="document-prev"]');
  assert.match(await evaluate(`document.querySelector('#document-results .lcd-doc-selected')?.textContent`),/已选 1 条/);
  await evaluate(`document.querySelector('[data-document-select-all]').click()`);
  const documentSelectAll=await evaluate(`(() => ({
    selected:document.querySelector('#document-results .lcd-doc-selected')?.textContent,
    checked:document.querySelectorAll('#document-results [data-document-select]:checked').length,
    placeholder:!!document.querySelector('#overlay-root .feature-dialog'),
  }))()`);
  assert.match(documentSelectAll.selected,/已选 21 条/);
  assert.equal(documentSelectAll.checked,20);
  assert.equal(documentSelectAll.placeholder,false);
  await evaluate(`document.querySelector('[data-action="document-clear-selection"]').scrollIntoView({block:'center',behavior:'instant'})`);
  await pointerClick('[data-action="document-clear-selection"]');
  assert.equal(await evaluate(`document.querySelectorAll('#document-results [data-document-select]:checked').length`),0);
  await evaluate(`document.querySelector('[data-action="document-page-size"]').scrollIntoView({block:'center',behavior:'instant'})`);
  await wait(80);
  await pointerClick('[data-action="document-page-size"]');
  const documentSizeMenu=await evaluate(`(() => ({
    open:!!document.querySelector('.document-size-menu'),
    expanded:document.querySelector('[data-action="document-page-size"]')?.getAttribute('aria-expanded'),
    animation:getComputedStyle(document.querySelector('.document-size-menu')).animationName,
    duration:getComputedStyle(document.querySelector('.document-size-menu')).animationDuration,
    above:document.querySelector('.document-size-menu').getBoundingClientRect().bottom <
      document.querySelector('[data-action="document-page-size"]').getBoundingClientRect().top,
  }))()`);
  assert.deepEqual(documentSizeMenu,{open:true,expanded:'true',animation:'lai-document-size-in',duration:'0.2s',above:true});
  const sizeMenuFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-documents-page-size.png'),Buffer.from(sizeMenuFrame.data,'base64'));
  await pointerClick('[data-document-size="50"]');
  const documentPageSizeResult=await evaluate(`(() => ({
    rows:document.querySelectorAll('#document-results tbody tr').length,
    label:document.querySelector('[data-action="document-page-size"]')?.textContent,
    page:document.querySelector('#document-results [aria-label^="第 "]')?.textContent,
    menuClosed:!document.querySelector('.document-size-menu') || (document.querySelector('.document-size-menu').inert && document.querySelector('.document-size-menu').getAttribute('aria-hidden')==='true'),
  }))()`);
  assert.deepEqual(documentPageSizeResult,{rows:25,label:'50 条/页 ⌄',page:'1',menuClosed:true});
  await waitFor(() => evaluate(`!document.querySelector('.document-size-menu')`),'document size exit removed');
  await wait(80);
  await evaluate(`document.querySelector('[data-action="document-page-size"]').click()`);
  const keyboardDocumentMenu=await evaluate(`(() => ({
    animation:getComputedStyle(document.querySelector('.document-size-menu')).animationName,
    focused:document.activeElement?.dataset.documentSize,
  }))()`);
  assert.deepEqual(keyboardDocumentMenu,{animation:'none',focused:'10'});
  await evaluate(`document.querySelector('[data-document-size="20"]').click()`);
  await wait(80);
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await pointerClick('[data-action="document-page-size"]');
  const reducedDocumentMenu=await evaluate(`(() => ({
    animation:getComputedStyle(document.querySelector('.document-size-menu')).animationName,
    duration:getComputedStyle(document.querySelector('.document-size-menu')).animationDuration,
  }))()`);
  assert.deepEqual(reducedDocumentMenu,{animation:'lai-tag-popover-fade',duration:'0.08s'});
  await cdp.call('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  assert.equal(await evaluate(`!document.querySelector('.document-size-menu') && document.activeElement?.dataset.action==='document-page-size'`),true);
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  const namelessCustomer='Lai Nameless Contact Acceptance';
  await evaluate(`(async () => {
    const snapshot=await (await fetch('/api/data',{cache:'no-store'})).json();
    snapshot.data.customers[${JSON.stringify(namelessCustomer)}]={country:'美国',email:'nameless@example.test',phone:'12345',
      note:'Customer preference',permanentNote:'Every order: plain packaging',contactNote:'Ask for Maya',
      paymentMethod:'PayPal',paymentEmail:'billing@example.test',currency:'EUR',repurchaseCycle:60,
      contactPaymentMethod:'Cash',updated:new Date().toISOString()};
    const response=await fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({state:{app:'laicai-lai',version:'1.4.2',data:snapshot.data},baseRevision:snapshot.revision})});
    if(!response.ok) throw Error('isolated nameless contact fixture save failed');
  })()`);
  await cdp.call('Page.navigate',{url:`${base}/trade-order-system.html?token=${encodeURIComponent(token)}#customers`});
  await waitFor(async()=>evaluate(`Boolean(document.querySelector('.customer-table .company-link'))`),'nameless customer list');
  await evaluate(`(() => {
    const field=document.querySelector('#search-field');
    field.value='name';
    field.dispatchEvent(new Event('change',{bubbles:true}));
    const input=document.querySelector('#search');
    input.value=${JSON.stringify(namelessCustomer)};
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  })()`);
  const namelessList=await evaluate(`(() => ({
    rows:document.querySelectorAll('.customer-table tbody tr').length,
    name:document.querySelector('.customer-table .company-link')?.textContent.trim(),
    contact:document.querySelector('.customer-table tbody tr')?.textContent.includes('nameless@example.test'),
  }))()`);
  assert.deepEqual(namelessList,{rows:1,name:namelessCustomer,contact:true});
  await pointerClick('.customer-table .company-link');
  await waitFor(async()=>evaluate(`Boolean(document.querySelector('.lcd-contact-title strong'))`),'nameless contact detail');
  const namelessDetail=await evaluate(`(() => ({
    count:document.querySelector('.lcd-contacts h3')?.textContent.includes('联系人(1)'),
    title:document.querySelector('.lcd-contact-title strong')?.textContent.trim(),
    email:document.querySelector('.lcd-contact')?.textContent.includes('nameless@example.test'),
    phone:document.querySelector('.lcd-contact')?.textContent.includes('12345'),
    contactNote:document.querySelector('.lcd-contact')?.textContent.includes('Ask for Maya'),
    customerNoteAbsent:!document.querySelector('.lcd-contact')?.textContent.includes('Customer preference'),
    permanentNoteAbsent:!document.querySelector('.lcd-contact')?.textContent.includes('Every order: plain packaging'),
    contactPayment:document.querySelector('.lcd-contact')?.textContent.includes('Cash'),
    customerPaymentAbsent:!document.querySelector('.lcd-contact')?.textContent.includes('PayPal'),
    paymentEmailAbsent:!document.querySelector('.lcd-contact')?.textContent.includes('billing@example.test'),
    action:document.querySelector('[data-contact-more="0"]')?.getAttribute('aria-label'),
  }))()`);
  assert.deepEqual(namelessDetail,{count:true,title:'—',email:true,phone:true,contactNote:true,
    customerNoteAbsent:true,permanentNoteAbsent:true,contactPayment:true,customerPaymentAbsent:true,
    paymentEmailAbsent:true,action:'未命名联系人的更多操作'});
  await evaluate(`document.querySelector('.lcd-contact').scrollIntoView({block:'center',behavior:'instant'})`);
  const namelessFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-nameless-contact.png'),Buffer.from(namelessFrame.data,'base64'));
  const separatedNotes=await evaluate(`(() => {
    const rows=[...document.querySelectorAll('.lcd-body-info .lcd-field')];
    const value=(name)=>rows.find(row=>row.querySelector('dt')?.textContent===name)?.querySelector('dd')?.textContent;
    return {customer:value('客户备注'),permanent:value('客户永久备注')};
  })()`);
  assert.deepEqual(separatedNotes,{customer:'Customer preference',permanent:'Every order: plain packaging'});
  const separatedPayment=await evaluate(`(() => {
    const rows=[...document.querySelectorAll('.lcd-body-info .lcd-field')];
    const value=(name)=>rows.find(row=>row.querySelector('dt')?.textContent===name)?.querySelector('dd')?.textContent;
    return {method:value('客户付款方式'),email:value('付款邮箱'),currency:value('默认币种'),cycle:value('复购周期')};
  })()`);
  assert.deepEqual(separatedPayment,{method:'PayPal',email:'billing@example.test',currency:'EUR',cycle:'60 天'});
  await evaluate(`(() => {
    const label=[...document.querySelectorAll('.lcd-body-info h3')].find(item=>item.textContent.includes('交易偏好'));
    label?.scrollIntoView({block:'center',behavior:'instant'});
  })()`);
  const paymentFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-payment-separated.png'),Buffer.from(paymentFrame.data,'base64'));
  await evaluate(`(() => {
    const label=[...document.querySelectorAll('.lcd-body-info h3')].find(item=>item.textContent.includes('客户备注'));
    label?.scrollIntoView({block:'center',behavior:'instant'});
  })()`);
  const notesFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-notes-separated.png'),Buffer.from(notesFrame.data,'base64'));
  await evaluate(`document.querySelector('.lcd-pagebar [data-action="edit"]').click()`);
  const noteEditor=await evaluate(`(() => ({
    customer:document.querySelector('#customer-form [name="note"]')?.value,
    permanent:document.querySelector('#customer-form [name="permanentNote"]')?.value,
    contact:document.querySelector('#customer-form [name="contactNote"]')?.value,
    customerPayment:document.querySelector('#customer-form [name="paymentMethod"]')?.value,
    paymentEmail:document.querySelector('#customer-form [name="paymentEmail"]')?.value,
    currency:document.querySelector('#customer-form [name="currency"]')?.value,
    cycle:document.querySelector('#customer-form [name="repurchaseCycle"]')?.value,
    contactPayment:document.querySelector('#customer-form [name="contactPaymentMethod"]')?.value,
  }))()`);
  assert.deepEqual(noteEditor,{customer:'Customer preference',permanent:'Every order: plain packaging',contact:'Ask for Maya',
    customerPayment:'PayPal',paymentEmail:'billing@example.test',currency:'EUR',cycle:'60',contactPayment:'Cash'});
  await evaluate(`(() => {
    document.querySelector('#customer-form .ce-company-extra').open=true;
    document.querySelector('#customer-form [name="paymentEmail"]').scrollIntoView({block:'center',behavior:'instant'});
  })()`);
  const paymentEditorFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-payment-editor.png'),Buffer.from(paymentEditorFrame.data,'base64'));
  await evaluate(`(() => {
    const form=document.querySelector('#customer-form');
    const field=form.querySelector('[name="contactNote"]');
    field.value='Ask for Nina';
    field.dispatchEvent(new Event('input',{bubbles:true}));
    form.querySelector('[name="contactPaymentMethod"]').value='PayPal';
    form.requestSubmit(document.querySelector('[name="saveMode"][value="save"]'));
  })()`);
  await waitFor(async()=>evaluate(`(async () => {
    const snapshot=await (await fetch('/api/data',{cache:'no-store'})).json();
    return snapshot.data.customers[${JSON.stringify(namelessCustomer)}]?.contactNote==='Ask for Nina';
  })()`),'separate contact note save');
  const savedNotes=await evaluate(`(async () => {
    const snapshot=await (await fetch('/api/data',{cache:'no-store'})).json();
    const customer=snapshot.data.customers[${JSON.stringify(namelessCustomer)}];
    return {customer:customer.note,permanent:customer.permanentNote,contact:customer.contactNote,
      customerPayment:customer.paymentMethod,paymentEmail:customer.paymentEmail,currency:customer.currency,
      cycle:customer.repurchaseCycle,contactPayment:customer.contactPaymentMethod};
  })()`);
  assert.deepEqual(savedNotes,{customer:'Customer preference',permanent:'Every order: plain packaging',contact:'Ask for Nina',
    customerPayment:'PayPal',paymentEmail:'billing@example.test',currency:'EUR',cycle:60,contactPayment:'PayPal'});
  const duplicateProbe='Lai Duplicate Probe';
  const emailFilterProbe='Lai Email Filter Probe';
  await evaluate(`(async () => {
    const snapshot=await (await fetch('/api/data',{cache:'no-store'})).json();
    const original=snapshot.data.customers[${JSON.stringify(customerName)}];
    if(!original?.additionalPhones?.some(item=>item.phone==='555 0122'))throw Error('saved additional phone fixture missing');
    snapshot.data.customers[${JSON.stringify(duplicateProbe)}]={phone:'+44 555 0122',country:'英国'};
    snapshot.data.customers[${JSON.stringify(emailFilterProbe)}]={email:'primary-filter@example.test',
      extraContacts:[{id:'second',contact:'Maya',email:'secondary-filter@example.test'}],country:'美国',
      alibabaIdentity:'Lai Buyer Probe',customerStars:5,previewFollowed:true};
    const response=await fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({state:{app:'laicai-lai',version:'1.4.2',data:snapshot.data},baseRevision:snapshot.revision})});
    if(!response.ok)throw Error('isolated duplicate probe save failed');
  })()`);
  await cdp.call('Page.navigate',{url:`${base}/trade-order-system.html?token=${encodeURIComponent(token)}#customers`});
  await waitFor(async()=>evaluate(`Boolean(document.querySelector('[data-lai-screen="duplicates"]'))`),'customer duplicate navigation');
  await evaluate(`document.querySelector('[data-lai-screen="duplicates"]').click()`);
  const duplicateContactMethod=await evaluate(`(() => ({
    matched:[...document.querySelectorAll('.duplicate-card')].some(card=>
      card.textContent.includes('445550122') && card.textContent.includes(${JSON.stringify(customerName)}) && card.textContent.includes(${JSON.stringify(duplicateProbe)})),
    stillPresent:document.querySelectorAll('.duplicate-card [data-open]').length>=2,
  }))()`);
  assert.deepEqual(duplicateContactMethod,{matched:true,stillPresent:true});
  const duplicateFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-duplicate-additional-phone.png'),Buffer.from(duplicateFrame.data,'base64'));
  await cdp.call('Page.navigate',{url:`${base}/trade-order-system.html?token=${encodeURIComponent(token)}#customers`});
  await waitFor(async()=>evaluate(`Boolean(document.querySelector('#search-field'))`),'email search navigation');
  const emailSearchFixture=await evaluate(`(async () => {
    const snapshot=await (await fetch('/api/data',{cache:'no-store'})).json();
    const profile=snapshot.data.customers[${JSON.stringify(emailFilterProbe)}];
    return {exists:Boolean(profile),secondaryEmail:profile?.extraContacts?.some(contact=>contact.email==='secondary-filter@example.test'),bucket:profile?.laiBucket||'active'};
  })()`);
  assert.deepEqual(emailSearchFixture,{exists:true,secondaryEmail:true,bucket:'active'});
  await evaluate(`(() => {
    const field=document.querySelector('#search-field');
    field.value='email';
    field.dispatchEvent(new Event('change',{bubbles:true}));
    const input=document.querySelector('#search');
    input.value='secondary-filter@example.test';
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  })()`);
  const additionalContactEmailSearch=await evaluate(`(() => ({
    count:document.querySelectorAll('.customer-table tbody tr').length,
    name:document.querySelector('.customer-table .company-link')?.textContent.trim(),
    field:document.querySelector('#search-field')?.value,
  }))()`);
  assert.deepEqual(additionalContactEmailSearch,{count:1,name:emailFilterProbe,field:'email'});
  const emailSearchFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-search-additional-contact-email.png'),Buffer.from(emailSearchFrame.data,'base64'));
  await cdp.call('Page.navigate',{url:`${base}/trade-order-system.html?token=${encodeURIComponent(token)}#customers`});
  await waitFor(async()=>evaluate(`Boolean(document.querySelector('[data-action="filter"]'))`),'additional email filter navigation');
  await evaluate(`(() => {
    document.querySelector('[data-action="filter"]').click();
    const form=document.querySelector('#filter-form');
    form.querySelector('[name="email"]').value='secondary-filter@example.test';
    form.requestSubmit(document.querySelector('button[form="filter-form"][type="submit"]'));
  })()`);
  await waitFor(async()=>evaluate(`!document.querySelector('#filter-form')`),'additional email filter submission');
  const additionalContactEmailFilter=await evaluate(`[...document.querySelectorAll('.customer-table .company-link')].map(link=>link.textContent.trim())`);
  assert.deepEqual(additionalContactEmailFilter,[emailFilterProbe]);
  const emailFilterSummary=await evaluate(`document.querySelector('.active-filters span')?.textContent.trim()`);
  assert.equal(emailFilterSummary,'1 个筛选条件');
  await evaluate(`(() => {
    document.querySelector('[data-action="filter"]').click();
    document.querySelector('[data-action="filter-segment"]').click();
  })()`);
  await waitFor(async()=>evaluate(`Boolean(document.querySelector('#segment-form'))`),'additional email segment generation');
  const additionalContactEmailSegment=await evaluate(`({
    field:document.querySelector('#segment-form [data-rule="0"] [data-rule-prop="field"]')?.value,
    value:document.querySelector('#segment-form [data-rule="0"] [data-rule-prop="value"]')?.value,
    preview:document.querySelector('#match-preview')?.textContent
  })`);
  assert.deepEqual(additionalContactEmailSegment,{field:'email',value:'secondary-filter@example.test',
    preview:'当前匹配 1 个客户 · 保存后随资料变化自动更新'});
  const emailSegmentFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-segment-additional-contact-email.png'),Buffer.from(emailSegmentFrame.data,'base64'));
  await cdp.call('Page.navigate',{url:`${base}/trade-order-system.html?token=${encodeURIComponent(token)}#customers`});
  await waitFor(async()=>evaluate(`Boolean(document.querySelector('[data-action="filter"]'))`),'identity filter navigation');
  await evaluate(`(() => {
    document.querySelector('[data-action="filter"]').click();
    const form=document.querySelector('#filter-form');
    form.querySelector('[name="alibabaIdentity"]').value='Lai Buyer Probe';
    form.querySelector('[name="customerStars"]').value='5';
    form.querySelector('[name="followed"][value="true"]').checked=true;
    form.requestSubmit(document.querySelector('button[form="filter-form"][type="submit"]'));
  })()`);
  await waitFor(async()=>evaluate(`!document.querySelector('#filter-form')`),'identity filter submission');
  const profileConditionFilter=await evaluate(`[...document.querySelectorAll('.customer-table .company-link')].map(link=>link.textContent.trim())`);
  assert.deepEqual(profileConditionFilter,[emailFilterProbe]);
  const profileFilterSummary=await evaluate(`document.querySelector('.active-filters span')?.textContent.trim()`);
  assert.equal(profileFilterSummary,'3 个筛选条件');
  await evaluate(`(() => {
    document.querySelector('[data-action="filter"]').click();
    document.querySelector('[data-action="filter-segment"]').click();
  })()`);
  await waitFor(async()=>evaluate(`Boolean(document.querySelector('#segment-form'))`),'profile condition segment generation');
  const profileConditionSegment=await evaluate(`({
    fields:[...document.querySelectorAll('#segment-form [data-rule-prop="field"]')].map(select=>select.value),
    followedValue:document.querySelector('#segment-form [data-rule="2"] [data-rule-prop="value"]')?.value,
    followedControl:document.querySelector('#segment-form [data-rule="2"] [data-rule-prop="value"]')?.tagName,
    preview:document.querySelector('#match-preview')?.textContent
  })`);
  assert.deepEqual(profileConditionSegment,{fields:['alibabaIdentity','customerStars','followed'],followedValue:'true',
    followedControl:'SELECT',preview:'当前匹配 1 个客户 · 保存后随资料变化自动更新'});
  const profileSegmentFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-segment-profile-conditions.png'),Buffer.from(profileSegmentFrame.data,'base64'));
  const updateTimeProbe='Lai Update Time Probe';
  await evaluate(`(async () => {
    const snapshot=await (await fetch('/api/data',{cache:'no-store'})).json();
    snapshot.data.customers[${JSON.stringify(updateTimeProbe)}]={country:'美国'};
    snapshot.data.orders.push({id:'lai-update-time-probe-order',client:${JSON.stringify(updateTimeProbe)},
      amount:10,paidAmount:0,currency:'USD',stage:'done',createdAt:'2026-09-20T12:00:00Z'});
    snapshot.data.previewTable={...snapshot.data.previewTable,order:['name','updated'],frozen:['name']};
    const response=await fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({state:{app:'laicai-lai',version:'1.4.2',data:snapshot.data},baseRevision:snapshot.revision})});
    if(!response.ok)throw Error('isolated update-time fixture save failed');
  })()`);
  await cdp.call('Page.navigate',{url:`${base}/trade-order-system.html?token=${encodeURIComponent(token)}#customers`});
  await waitFor(async()=>evaluate(`Boolean(document.querySelector('#search-field'))`),'profile update field navigation');
  await evaluate(`(() => {
    const field=document.querySelector('#search-field');
    field.value='name';
    field.dispatchEvent(new Event('change',{bubbles:true}));
    const input=document.querySelector('#search');
    input.value=${JSON.stringify(updateTimeProbe)};
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  })()`);
  const profileUpdateCell=await evaluate(`(() => {
    const headings=[...document.querySelectorAll('.customer-table thead th')].map(cell=>cell.textContent.trim());
    const index=headings.findIndex(label=>label.includes('资料更新时间'));
    const cell=document.querySelectorAll('.customer-table tbody tr')[0]?.querySelectorAll('td')[index];
    return {count:document.querySelectorAll('.customer-table tbody tr').length,
      name:document.querySelector('.customer-table .company-link')?.textContent.trim(),
      heading:index>=0,display:cell?.textContent.trim(),title:cell?.getAttribute('title')};
  })()`);
  assert.deepEqual(profileUpdateCell,{count:1,name:updateTimeProbe,heading:true,display:'—',title:''});
  const profileUpdateFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-profile-update-empty.png'),Buffer.from(profileUpdateFrame.data,'base64'));
  const tagBothProbe='Lai Tag Both Probe';
  const tagFirstProbe='Lai Tag First Probe';
  const tagSecondProbe='Lai Tag Second Probe';
  await evaluate(`(async () => {
    const snapshot=await (await fetch('/api/data',{cache:'no-store'})).json();
    snapshot.data.customers[${JSON.stringify(tagBothProbe)}]={country:'美国',tags:['LaiTagA','LaiTagB']};
    snapshot.data.customers[${JSON.stringify(tagFirstProbe)}]={country:'美国',tags:['LaiTagA']};
    snapshot.data.customers[${JSON.stringify(tagSecondProbe)}]={country:'美国',tags:['LaiTagB']};
    snapshot.data.previewTable={...snapshot.data.previewTable,order:['name','tags','country'],frozen:['name']};
    const response=await fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({state:{app:'laicai-lai',version:'1.4.2',data:snapshot.data},baseRevision:snapshot.revision})});
    if(!response.ok)throw Error('isolated tag-mode fixture save failed');
  })()`);
  await cdp.call('Page.navigate',{url:`${base}/trade-order-system.html?token=${encodeURIComponent(token)}#customers`});
  await waitFor(async()=>evaluate(`Boolean(document.querySelector('[data-action="filter"]'))`),'tag filter navigation');
  await evaluate(`(() => {
    document.querySelector('[data-action="filter"]').click();
    const form=document.querySelector('#filter-form');
    form.querySelector('[name="tag"]').value='LaiTagA, LaiTagB';
    form.querySelector('[name="tagMode"][value="包含全部"]').checked=true;
    form.requestSubmit(document.querySelector('button[form="filter-form"][type="submit"]'));
  })()`);
  await waitFor(async()=>evaluate(`!document.querySelector('#filter-form')`),'all-tags filter submission');
  const allTagResult=await evaluate(`[...document.querySelectorAll('.customer-table .company-link')].map(link=>link.textContent.trim())`);
  assert.deepEqual(allTagResult,[tagBothProbe]);
  const allTagFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-tags-all-filter.png'),Buffer.from(allTagFrame.data,'base64'));
  await evaluate(`(() => {
    document.querySelector('[data-action="filter"]').click();
    document.querySelector('[data-action="filter-segment"]').click();
  })()`);
  await waitFor(async()=>evaluate(`Boolean(document.querySelector('#segment-form'))`),'all-tags segment generation');
  const allTagSegment=await evaluate(`({
    op:document.querySelector('#segment-form [data-rule="0"] [data-rule-prop="op"]')?.value,
    value:document.querySelector('#segment-form [data-rule="0"] [data-rule-prop="value"]')?.value,
    preview:document.querySelector('#match-preview')?.textContent
  })`);
  assert.deepEqual(allTagSegment,{op:'containsAll',value:'LaiTagA, LaiTagB',preview:'当前匹配 1 个客户 · 保存后随资料变化自动更新'});
  const allTagSegmentFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-tags-all-segment.png'),Buffer.from(allTagSegmentFrame.data,'base64'));
  await evaluate(`document.querySelector('[data-action="close-modal"]').click()`);
  await evaluate(`(() => {
    document.querySelector('[data-action="filter"]').click();
    const form=document.querySelector('#filter-form');
    form.querySelector('[name="tagMode"][value="包含任一"]').checked=true;
    form.requestSubmit(document.querySelector('button[form="filter-form"][type="submit"]'));
  })()`);
  await waitFor(async()=>evaluate(`!document.querySelector('#filter-form')`),'any-tags filter submission');
  const anyTagResult=await evaluate(`[...document.querySelectorAll('.customer-table .company-link')].map(link=>link.textContent.trim())`);
  assert.deepEqual(anyTagResult,[tagBothProbe,tagFirstProbe,tagSecondProbe]);
  await evaluate(`(() => {
    document.querySelector('[data-action="filter"]').click();
    document.querySelector('[data-action="filter-segment"]').click();
  })()`);
  await waitFor(async()=>evaluate(`Boolean(document.querySelector('#segment-form'))`),'any-tags segment generation');
  const anyTagSegment=await evaluate(`({
    op:document.querySelector('#segment-form [data-rule="0"] [data-rule-prop="op"]')?.value,
    preview:document.querySelector('#match-preview')?.textContent
  })`);
  assert.deepEqual(anyTagSegment,{op:'containsAny',preview:'当前匹配 3 个客户 · 保存后随资料变化自动更新'});
  const splitGroupProbe='Lai Split Group Probe';
  const wholeGroupProbe='Lai Whole Group Probe';
  await evaluate(`(async () => {
    const snapshot=await (await fetch('/api/data',{cache:'no-store'})).json();
    snapshot.data.customers[${JSON.stringify(splitGroupProbe)}]={country:'美国'};
    snapshot.data.customers[${JSON.stringify(wholeGroupProbe)}]={country:'美国'};
    snapshot.data.previewSegments=[...(snapshot.data.previewSegments||[]),
      {id:'lai-east-probe',name:'Lai East',kind:'manual',members:[${JSON.stringify(splitGroupProbe)}],archived:false},
      {id:'lai-vip-probe',name:'Lai VIP',kind:'manual',members:[${JSON.stringify(splitGroupProbe)}],archived:false},
      {id:'lai-whole-probe',name:'Lai East Lai VIP',kind:'manual',members:[${JSON.stringify(wholeGroupProbe)}],archived:false}];
    const response=await fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({state:{app:'laicai-lai',version:'1.4.2',data:snapshot.data},baseRevision:snapshot.revision})});
    if(!response.ok)throw Error('isolated group boundary fixture save failed');
  })()`);
  await cdp.call('Page.navigate',{url:`${base}/trade-order-system.html?token=${encodeURIComponent(token)}#customers`});
  await waitFor(async()=>evaluate(`Boolean(document.querySelector('[data-action="filter"]'))`),'group boundary filter navigation');
  await evaluate(`(() => {
    document.querySelector('[data-action="filter"]').click();
    const form=document.querySelector('#filter-form');
    form.querySelector('[name="customerGroup"]').value='st L';
    form.requestSubmit(document.querySelector('button[form="filter-form"][type="submit"]'));
  })()`);
  await waitFor(async()=>evaluate(`!document.querySelector('#filter-form')`),'group boundary filter submission');
  const groupBoundaryFilter=await evaluate(`[...document.querySelectorAll('.customer-table .company-link')].map(link=>link.textContent.trim())`);
  assert.deepEqual(groupBoundaryFilter,[wholeGroupProbe]);
  const groupFilterSummary=await evaluate(`document.querySelector('.active-filters span')?.textContent.trim()`);
  assert.equal(groupFilterSummary,'1 个筛选条件');
  await evaluate(`(() => {
    document.querySelector('[data-action="filter"]').click();
    document.querySelector('[data-action="filter-segment"]').click();
  })()`);
  await waitFor(async()=>evaluate(`Boolean(document.querySelector('#segment-form'))`),'group boundary segment generation');
  const groupBoundarySegment=await evaluate(`({
    field:document.querySelector('#segment-form [data-rule="0"] [data-rule-prop="field"]')?.value,
    preview:document.querySelector('#match-preview')?.textContent
  })`);
  assert.deepEqual(groupBoundarySegment,{field:'group',preview:'当前匹配 1 个客户 · 保存后随资料变化自动更新'});
  const groupBoundaryFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-segment-group-boundary.png'),Buffer.from(groupBoundaryFrame.data,'base64'));
  await evaluate(`document.querySelector('#segment-form [name="name"]').value='Draft Group'`);
  await pointerClick('[data-action="add-rule"]');
  await wait(40);
  const pointerRuleEntry=await evaluate(`(() => {
    const row=document.querySelector('#segment-form [data-rule="1"]');
    const active=document.activeElement;
    return {rows:document.querySelectorAll('#segment-form .rule-row').length,
      entering:row?.classList.contains('rule-row-enter'),
      animation:getComputedStyle(row).animationName,
      focused:active?.closest('[data-rule]')?.dataset.rule,
      prop:active?.dataset.ruleProp,
      draft:document.querySelector('#segment-form [name="name"]')?.value,
      firstValue:document.querySelector('#segment-form [data-rule="0"] [data-rule-prop="value"]')?.value};
  })()`);
  assert.deepEqual(pointerRuleEntry,{rows:2,entering:false,animation:'none',focused:'1',prop:'value',draft:'Draft Group',firstValue:'st L'});
  const ruleEntryFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-segment-rule-enter.png'),Buffer.from(ruleEntryFrame.data,'base64'));
  await evaluate(`document.querySelector('[data-action="add-rule"]').click()`);
  const keyboardRuleEntry=await evaluate(`(() => {
    const row=document.querySelector('#segment-form [data-rule="2"]');
    return {entering:row?.classList.contains('rule-row-enter'),animation:getComputedStyle(row).animationName,
      focused:document.activeElement?.closest('[data-rule]')?.dataset.rule};
  })()`);
  assert.deepEqual(keyboardRuleEntry,{entering:false,animation:'none',focused:'2'});
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await pointerClick('[data-action="add-rule"]');
  const reducedRuleEntry=await evaluate(`(() => {
    const row=document.querySelector('#segment-form [data-rule="3"]');
    return {animation:getComputedStyle(row).animationName};
  })()`);
  assert.deepEqual(reducedRuleEntry,{animation:'none'});
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await pointerClick('[data-remove-rule="3"]');
  const pointerRuleExit=await evaluate(`(() => {
    const row=document.querySelector('#segment-form [data-rule="3"]');
    return {present:Boolean(row),exiting:Boolean(row?.classList.contains('rule-row-exit')),
      animation:row?getComputedStyle(row).animationName:''};
  })()`);
  assert.deepEqual(pointerRuleExit,{present:false,exiting:false,animation:''});
  const ruleExitFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-segment-rule-exit.png'),Buffer.from(ruleExitFrame.data,'base64'));
  await waitFor(async()=>evaluate(`document.querySelectorAll('#segment-form .rule-row').length===3`),'pointer rule removal');
  const pointerRuleAfterExit=await evaluate(`({focused:document.activeElement?.closest('[data-rule]')?.dataset.rule,
    draft:document.querySelector('#segment-form [name="name"]')?.value,
    firstValue:document.querySelector('#segment-form [data-rule="0"] [data-rule-prop="value"]')?.value})`);
  assert.deepEqual(pointerRuleAfterExit,{focused:'2',draft:'Draft Group',firstValue:'st L'});
  await evaluate(`document.querySelector('[data-remove-rule="2"]').click()`);
  const keyboardRuleExit=await evaluate(`({rows:document.querySelectorAll('#segment-form .rule-row').length,
    focused:document.activeElement?.closest('[data-rule]')?.dataset.rule,
    animation:document.querySelector('#segment-form .rule-row')?getComputedStyle(document.querySelector('#segment-form .rule-row')).animationName:''})`);
  assert.deepEqual(keyboardRuleExit,{rows:2,focused:'1',animation:'none'});
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await pointerClick('[data-remove-rule="1"]');
  const reducedRuleExit=await evaluate(`({rows:document.querySelectorAll('#segment-form .rule-row').length,
    focused:document.activeElement?.closest('[data-rule]')?.dataset.rule})`);
  assert.deepEqual(reducedRuleExit,{rows:1,focused:'0'});
  await waitFor(async()=>evaluate(`document.querySelectorAll('#segment-form .rule-row').length===1`),'reduced rule removal');
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await pointerClick('[data-action="add-rule"]');
  await pointerClick('[data-remove-rule="1"]');
  await evaluate(`document.querySelector('#overlay-root [data-action="close-modal"]').click()`);
  await wait(240);
  const interruptedRuleExit=await evaluate(`({overlay:Boolean(document.querySelector('#overlay-root .overlay')),
    segmentForm:Boolean(document.querySelector('#segment-form'))})`);
  assert.deepEqual(interruptedRuleExit,{overlay:false,segmentForm:false});
  const booleanFalseProbe='Lai Boolean False Probe';
  const booleanTrueProbe='Lai Boolean True Probe';
  await evaluate(`(async () => {
    const snapshot=await (await fetch('/api/data',{cache:'no-store'})).json();
    snapshot.data.customers[${JSON.stringify(booleanFalseProbe)}]={country:'美国',previewFollowed:false};
    snapshot.data.customers[${JSON.stringify(booleanTrueProbe)}]={country:'美国',previewFollowed:true};
    snapshot.data.previewTable={...snapshot.data.previewTable,order:['name','followed','group'],frozen:['name']};
    const response=await fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({state:{app:'laicai-lai',version:'1.4.2',data:snapshot.data},baseRevision:snapshot.revision})});
    if(!response.ok)throw Error('isolated boolean display fixture save failed');
  })()`);
  await cdp.call('Page.navigate',{url:`${base}/trade-order-system.html?token=${encodeURIComponent(token)}#customers`});
  await waitFor(async()=>evaluate(`Boolean(document.querySelector('#search-field'))`),'boolean display navigation');
  await evaluate(`(() => {
    const field=document.querySelector('#search-field');
    field.value='name';
    field.dispatchEvent(new Event('change',{bubbles:true}));
    const input=document.querySelector('#search');
    input.value='Lai Boolean';
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  })()`);
  const booleanDisplay=await evaluate(`[...document.querySelectorAll('.customer-table tbody tr')].map(row=>{
    const cells=row.querySelectorAll('td');
    return {name:row.querySelector('.company-link')?.textContent.trim(),followed:cells[2]?.textContent.trim(),
      followedTitle:cells[2]?.getAttribute('title'),group:cells[3]?.textContent.trim(),groupTitle:cells[3]?.getAttribute('title')};
  }).sort((a,b)=>a.name.localeCompare(b.name))`);
  assert.deepEqual(booleanDisplay,[
    {name:booleanFalseProbe,followed:'否',followedTitle:'否',group:'—',groupTitle:''},
    {name:booleanTrueProbe,followed:'是',followedTitle:'是',group:'—',groupTitle:''},
  ]);
  const booleanFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-followed-and-empty-group.png'),Buffer.from(booleanFrame.data,'base64'));
  await cdp.call('Page.navigate',{url:`${base}/trade-order-system.html?token=${encodeURIComponent(token)}#customers`});
  await waitFor(async()=>evaluate(`Boolean(document.querySelector('[data-action="filter"]'))`),'advanced filter summary navigation');
  await evaluate(`(() => {
    document.querySelector('[data-action="filter"]').click();
    document.querySelector('[data-filter-mode="advanced"]').click();
    document.querySelector('#filter-form [data-advanced-prop="value"]').value=${JSON.stringify(emailFilterProbe)};
    document.querySelector('#filter-form').requestSubmit(document.querySelector('button[form="filter-form"][type="submit"]'));
  })()`);
  await waitFor(async()=>evaluate(`!document.querySelector('#filter-form')`),'advanced filter summary submission');
  const advancedFilterSummary=await evaluate(`({
    summary:document.querySelector('.active-filters span')?.textContent.trim(),
    names:[...document.querySelectorAll('.customer-table .company-link')].map(link=>link.textContent.trim())
  })`);
  assert.deepEqual(advancedFilterSummary,{summary:'1 个筛选条件',names:[emailFilterProbe]});
  const advancedSummaryFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-active-advanced-filter.png'),Buffer.from(advancedSummaryFrame.data,'base64'));
  await evaluate(`document.querySelector('[data-action="reset-all"]').click()`);
  const advancedFilterCleared=await evaluate(`({summary:document.querySelector('.active-filters span')?.textContent.trim()||null,
    rows:document.querySelectorAll('.customer-table tbody tr').length})`);
  assert.equal(advancedFilterCleared.summary,null);
  assert.ok(advancedFilterCleared.rows>1,JSON.stringify(advancedFilterCleared));
  const ownerMine=await evaluate(`document.querySelector('#customer-owner option:not([value=""])')?.value`);
  assert.ok(ownerMine);
  const otherOwnerProbe='Lai Other Owner Probe';
  await evaluate(`(async () => {
    const snapshot=await (await fetch('/api/data',{cache:'no-store'})).json();
    snapshot.data.customers[${JSON.stringify(otherOwnerProbe)}]={owner:'Other Owner',country:'US'};
    snapshot.data.laiSettings={...(snapshot.data.laiSettings||{}),defaultOwner:${JSON.stringify(ownerMine)}};
    const response=await fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({state:{app:'laicai-lai',version:'1.4.2',data:snapshot.data},baseRevision:snapshot.revision})});
    if(!response.ok)throw Error('isolated owner fixture save failed');
  })()`);
  await cdp.call('Page.navigate',{url:`${base}/trade-order-system.html?token=${encodeURIComponent(token)}#customers`});
  await waitFor(async()=>evaluate(`Boolean(document.querySelector('[data-team="mine"]'))`),'owner scope navigation');
  await evaluate(`document.querySelector('[data-team="mine"]').click()`);
  const mineScope=await evaluate(`({mine:document.querySelector('[data-team="mine"]')?.classList.contains('active'),
    owner:document.querySelector('#customer-owner')?.value,
    count:Number(document.querySelector('.list-heading span')?.textContent.match(/\\d+/)?.[0]),
    otherVisible:[...document.querySelectorAll('.customer-table [data-select]')].some(input=>input.dataset.select===${JSON.stringify(otherOwnerProbe)})})`);
  assert.equal(mineScope.mine,true);
  assert.equal(mineScope.owner,ownerMine);
  assert.equal(mineScope.otherVisible,false);
  await evaluate(`document.querySelector('[data-action="reset-all"]').click()`);
  const clearedOwnerScope=await evaluate(`({team:document.querySelector('[data-team="team"]')?.classList.contains('active'),
    mine:document.querySelector('[data-team="mine"]')?.classList.contains('active'),
    owner:document.querySelector('#customer-owner')?.value,
    count:Number(document.querySelector('.list-heading span')?.textContent.match(/\\d+/)?.[0])})`);
  assert.equal(clearedOwnerScope.team,true);
  assert.equal(clearedOwnerScope.mine,false);
  assert.equal(clearedOwnerScope.owner,'');
  assert.ok(clearedOwnerScope.count>mineScope.count,JSON.stringify({mineScope,clearedOwnerScope}));
  await evaluate(`document.querySelector('[data-team="mine"]').click()`);
  await evaluate(`(() => {
    const select=document.querySelector('#customer-owner');
    select.value='Other Owner';
    select.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  const manualOwnerScope=await evaluate(`({team:document.querySelector('[data-team="team"]')?.classList.contains('active'),
    mine:document.querySelector('[data-team="mine"]')?.classList.contains('active'),
    owner:document.querySelector('#customer-owner')?.value,
    names:[...document.querySelectorAll('.customer-table [data-select]')].map(input=>input.dataset.select)})`);
  assert.deepEqual(manualOwnerScope,{team:true,mine:false,owner:'Other Owner',names:[otherOwnerProbe]});
  const ownerScopeFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-owner-scope.png'),Buffer.from(ownerScopeFrame.data,'base64'));
  await evaluate(`document.querySelector('.customer-table [data-select]').click()`);
  assert.equal(await evaluate(`document.querySelector('.replica-batch b')?.textContent`),'1');
  await evaluate(`document.querySelector('[data-team="mine"]').click()`);
  const selectionAfterMine=await evaluate(`({selected:document.querySelector('.replica-batch b')?.textContent||null,
    owner:document.querySelector('#customer-owner')?.value,
    excluded:[...document.querySelectorAll('.customer-table [data-select]')].some(input=>input.dataset.select===${JSON.stringify(otherOwnerProbe)})})`);
  assert.deepEqual(selectionAfterMine,{selected:null,owner:ownerMine,excluded:false});
  await evaluate(`document.querySelector('.customer-table [data-select]').click()`);
  await evaluate(`(() => {
    const select=document.querySelector('#customer-owner');
    select.value='Other Owner';
    select.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  const selectionAfterOwner=await evaluate(`({selected:document.querySelector('.replica-batch b')?.textContent||null,
    names:[...document.querySelectorAll('.customer-table [data-select]')].map(input=>input.dataset.select)})`);
  assert.deepEqual(selectionAfterOwner,{selected:null,names:[otherOwnerProbe]});
  await evaluate(`document.querySelector('.customer-table [data-select]').click()`);
  await evaluate(`document.querySelector('[data-action="clear-selection"]').click()`);
  assert.equal(await evaluate(`document.querySelector('#customer-owner')?.value`),'Other Owner');
  await evaluate(`document.querySelector('[data-action="reset-all"]').click()`);
  const selectionAfterClear=await evaluate(`({selected:document.querySelector('.replica-batch b')?.textContent||null,
    owner:document.querySelector('#customer-owner')?.value})`);
  assert.deepEqual(selectionAfterClear,{selected:null,owner:''});
  await evaluate(`document.querySelector('.customer-table [data-select]').click()`);
  await evaluate(`document.querySelector('[data-action="next"]').click()`);
  const crossPageSelection=await evaluate(`({selected:document.querySelector('.replica-batch b')?.textContent,
    page:document.querySelector('.pages .current')?.textContent.trim()})`);
  assert.deepEqual(crossPageSelection,{selected:'1',page:'2'});
  await evaluate(`document.querySelector('[data-action="clear-selection"]').click()`);
  const sortTen='Lai Sort Probe Ten',sortTwo='Lai Sort Probe Two',sortEmpty='Lai Sort Probe Empty';
  await evaluate(`(async () => {
    const snapshot=await (await fetch('/api/data',{cache:'no-store'})).json();
    snapshot.data.customers[${JSON.stringify(sortTen)}]={country:'US',source:'Zeta',opportunityCount:10,nextFollow:'2026-10-01',owner:'Owner Ten'};
    snapshot.data.customers[${JSON.stringify(sortTwo)}]={country:'CN',source:'Alpha',opportunityCount:2,level:'B级翡翠客户',nextFollow:'2026-10-02',owner:'Owner Two'};
    snapshot.data.customers[${JSON.stringify(sortEmpty)}]={country:'DE',source:'',level:'自动判断'};
    snapshot.data.orders.push({id:'sort-level-1',client:${JSON.stringify(sortTen)},amount:600,currency:'USD',createdAt:'2026-09-01'});
    snapshot.data.orders.push({id:'sort-level-2',client:${JSON.stringify(sortTen)},amount:300,currency:'USD',createdAt:'2026-09-02'});
    snapshot.data.previewTable={...(snapshot.data.previewTable||{}),order:['name','country','source','opportunityCount','level'],frozen:['name']};
    const response=await fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({state:{app:'laicai-lai',version:'1.4.2',data:snapshot.data},baseRevision:snapshot.revision})});
    if(!response.ok)throw Error('isolated sort fixture save failed');
  })()`);
  await cdp.call('Page.navigate',{url:`${base}/trade-order-system.html?token=${encodeURIComponent(token)}#customers`});
  await waitFor(async()=>evaluate(`Boolean(document.querySelector('#search-field'))`),'column sorting navigation');
  await evaluate(`(() => {
    const field=document.querySelector('#search-field');
    field.value='name';
    field.dispatchEvent(new Event('change',{bubbles:true}));
    const input=document.querySelector('#search');
    input.value='Lai Sort Probe';
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  })()`);
  assert.equal(await evaluate(`document.querySelectorAll('.customer-table [data-select]').length`),3);
  await evaluate(`document.querySelector('[data-sort-field="opportunityCount"]').click()`);
  const ascendingAmountSort=await evaluate(`({names:[...document.querySelectorAll('.customer-table [data-select]')].map(input=>input.dataset.select),
    direction:document.querySelector('[data-sort-field="opportunityCount"]')?.closest('th')?.getAttribute('aria-sort')})`);
  assert.deepEqual(ascendingAmountSort,{names:[sortTwo,sortTen,sortEmpty],direction:'ascending'});
  await evaluate(`document.querySelector('[data-sort-field="opportunityCount"]').click()`);
  const descendingAmountSort=await evaluate(`({names:[...document.querySelectorAll('.customer-table [data-select]')].map(input=>input.dataset.select),
    direction:document.querySelector('[data-sort-field="opportunityCount"]')?.closest('th')?.getAttribute('aria-sort')})`);
  assert.deepEqual(descendingAmountSort,{names:[sortTen,sortTwo,sortEmpty],direction:'descending'});
  await evaluate(`document.querySelector('[data-sort-field="source"]').click()`);
  const ascendingSourceSort=await evaluate(`({names:[...document.querySelectorAll('.customer-table [data-select]')].map(input=>input.dataset.select),
    direction:document.querySelector('[data-sort-field="source"]')?.closest('th')?.getAttribute('aria-sort')})`);
  assert.deepEqual(ascendingSourceSort,{names:[sortTwo,sortTen,sortEmpty],direction:'ascending'});
  await evaluate(`document.querySelector('[data-sort-field="country"]').click()`);
  const localizedCountrySort=await evaluate(`({names:[...document.querySelectorAll('.customer-table [data-select]')].map(input=>input.dataset.select),
    direction:document.querySelector('[data-sort-field="country"]')?.closest('th')?.getAttribute('aria-sort')})`);
  assert.deepEqual(localizedCountrySort,{names:[sortEmpty,sortTen,sortTwo],direction:'ascending'});
  const sortFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-column-sort.png'),Buffer.from(sortFrame.data,'base64'));
  const levelCells=await evaluate(`Object.fromEntries([...document.querySelectorAll('.customer-table tbody tr')].map(tr=>[
    tr.querySelector('[data-select]')?.dataset.select,
    {grade:tr.querySelector('td[title$="客户"]')?.textContent.trim(),badge:tr.querySelector('.level-icon')?.getAttribute('aria-label')}
  ]))`);
  assert.deepEqual(levelCells[sortTen],{grade:'E级白银客户',badge:'客户等级：E级白银客户'});
  assert.deepEqual(levelCells[sortTwo],{grade:'B级翡翠客户',badge:'客户等级：B级翡翠客户'});
  assert.deepEqual(levelCells[sortEmpty],{grade:'F级青铜客户',badge:'客户等级：F级青铜客户'});
  await evaluate(`[...document.querySelectorAll('.customer-table .company-link')].find(link=>link.textContent.trim()===${JSON.stringify(sortTen)}).click()`);
  await evaluate(`(() => {document.querySelector('[data-action="summary-fields"]').click();
    const form=document.querySelector('#summary-fields-form');
    form.querySelectorAll('[name="summaryField"]').forEach(input=>{input.checked=input.value==='level'});
    form.requestSubmit();})()`);
  await waitFor(async()=>evaluate(`document.querySelectorAll('.lcd-summary-fields dt').length===1`),'grade summary selected');
  const detailLevelCells={};
  for(const [name,expected] of [[sortTen,'E级白银客户'],[sortTwo,'B级翡翠客户'],[sortEmpty,'F级青铜客户']]){
    if(name!==sortTen){
      await evaluate(`document.querySelector('.lcd-return').click()`);
      await evaluate(`[...document.querySelectorAll('.customer-table .company-link')].find(link=>link.textContent.trim()===${JSON.stringify(name)}).click()`);
    }
    const shown=await evaluate(`({label:document.querySelector('.lcd-summary-fields dt')?.textContent,
      value:document.querySelector('.lcd-summary-fields dd')?.textContent})`);
    assert.deepEqual(shown,{label:'客户等级:',value:expected});
    detailLevelCells[name]=shown.value;
  }
  const levelDetailFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-detail-effective-grade.png'),Buffer.from(levelDetailFrame.data,'base64'));
  await evaluate(`(() => {document.querySelector('[data-action="summary-fields"]').click();
    document.querySelector('#reset-summary-fields').click();
    document.querySelector('#summary-fields-form').requestSubmit();})()`);
  await waitFor(async()=>evaluate(`document.querySelectorAll('.lcd-summary-fields dt').length===7`),'grade summary restored');
  await evaluate(`document.querySelector('.lcd-return').click()`);
  await evaluate(`document.querySelector('[data-sort-field="level"]').click()`);
  const ascendingLevelSort=await evaluate(`({names:[...document.querySelectorAll('.customer-table [data-select]')].map(input=>input.dataset.select),
    direction:document.querySelector('[data-sort-field="level"]')?.closest('th')?.getAttribute('aria-sort')})`);
  assert.deepEqual(ascendingLevelSort,{names:[sortTwo,sortTen,sortEmpty],direction:'ascending'});
  const levelFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-level-field.png'),Buffer.from(levelFrame.data,'base64'));
  await evaluate(`(() => {const button=document.querySelector('[data-expand="won"]');
    if(button.getAttribute('aria-expanded')==='true')button.click();
    button.scrollIntoView({block:'center',behavior:'instant'});})()`);
  await pointerClick('[data-expand="won"]');
  const branchMouseOpen=await evaluate(`(() => {const button=document.querySelector('[data-expand="won"]');
    const panel=document.querySelector('#group-branch-won');window.__laiBranchPanel=panel;
    return {expanded:button.getAttribute('aria-expanded'),controls:button.getAttribute('aria-controls'),
      hidden:panel.getAttribute('aria-hidden'),inert:panel.inert,motion:panel.classList.contains('branch-motion'),
      duration:getComputedStyle(panel).transitionDuration,child:panel.querySelector('[data-group="won"] span')?.textContent.trim()};})()`);
  assert.deepEqual(branchMouseOpen,{expanded:'true',controls:'group-branch-won',hidden:'false',inert:false,
    motion:true,duration:'0s',child:'成交客户'});
  await wait(350);
  const branchFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-branch-expanded.png'),Buffer.from(branchFrame.data,'base64'));
  await pointerClick('[data-expand="won"]');
  await pointerClick('[data-expand="won"]');
  const branchRapid=await evaluate(`(() => {const panel=document.querySelector('#group-branch-won');
    return {sameNode:panel===window.__laiBranchPanel,expanded:document.querySelector('[data-expand="won"]').getAttribute('aria-expanded'),
      motion:panel.classList.contains('branch-motion'),inert:panel.inert};})()`);
  assert.deepEqual(branchRapid,{sameNode:true,expanded:'true',motion:true,inert:false});
  await evaluate(`(() => {const button=document.querySelector('[data-expand="won"]');button.focus();button.click();})()`);
  const branchKeyboard=await evaluate(`(() => {const panel=document.querySelector('#group-branch-won');
    return {expanded:document.querySelector('[data-expand="won"]').getAttribute('aria-expanded'),
      motion:panel.classList.contains('branch-motion'),hidden:panel.getAttribute('aria-hidden'),inert:panel.inert,
      duration:getComputedStyle(panel).transitionDuration};})()`);
  assert.deepEqual(branchKeyboard,{expanded:'false',motion:false,hidden:'true',inert:true,duration:'0s'});
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await pointerClick('[data-expand="won"]');
  const branchReduced=await evaluate(`(() => {const panel=document.querySelector('#group-branch-won');
    const style=getComputedStyle(panel);return {expanded:document.querySelector('[data-expand="won"]').getAttribute('aria-expanded'),
      property:style.transitionProperty,animations:panel.getAnimations().length};})()`);
  assert.deepEqual(branchReduced,{expanded:'true',property:'none',animations:0});
  await cdp.call('Emulation.setEmulatedMedia',{features:[]});
  await evaluate(`document.querySelector('[data-expand="won"]').click()`);
  await pointerClick('[data-action="collapse-groups"]');
  const groupCollapseMotion=await evaluate(`({collapsed:document.querySelector('.panel')?.classList.contains('groups-collapsed'),
    label:document.querySelector('[data-action="collapse-groups"]')?.getAttribute('aria-label'),
    expanded:document.querySelector('[data-action="collapse-groups"]')?.getAttribute('aria-expanded'),
    duration:getComputedStyle(document.querySelector('.groups')).transitionDuration})`);
  assert.deepEqual(groupCollapseMotion,{collapsed:true,label:'展开客群',expanded:'false',duration:'0.3s'});
  await wait(350);
  const collapsedFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-groups-collapsed.png'),Buffer.from(collapsedFrame.data,'base64'));
  await evaluate(`document.querySelector('[data-sort-field="source"]').click()`);
  const groupCollapseAfterRender=await evaluate(`({collapsed:document.querySelector('.panel')?.classList.contains('groups-collapsed'),
    label:document.querySelector('[data-action="collapse-groups"]')?.getAttribute('aria-label')})`);
  assert.deepEqual(groupCollapseAfterRender,{collapsed:true,label:'展开客群'});
  await evaluate(`(() => {
    const button=document.querySelector('[data-action="collapse-groups"]');
    button.focus();button.click();
  })()`);
  const keyboardGroupExpand=await evaluate(`({collapsed:document.querySelector('.panel')?.classList.contains('groups-collapsed'),
    motion:document.querySelector('.panel')?.classList.contains('groups-motion'),
    label:document.querySelector('[data-action="collapse-groups"]')?.getAttribute('aria-label')})`);
  assert.deepEqual(keyboardGroupExpand,{collapsed:false,motion:false,label:'收起客群'});
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await pointerClick('[data-action="collapse-groups"]');
  const reducedGroupCollapse=await evaluate(`({collapsed:document.querySelector('.panel')?.classList.contains('groups-collapsed'),
    duration:getComputedStyle(document.querySelector('.groups')).transitionDuration})`);
  assert.deepEqual(reducedGroupCollapse,{collapsed:true,duration:'0s'});
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await wait(230);
  const firstRapidGroupPoint = await evaluate(`(() => {
    const button=document.querySelector('[data-action="collapse-groups"]');
    const rect=button.getBoundingClientRect();
    return {x:rect.left+rect.width/2,y:rect.top+rect.height/2,rect:rect.toJSON()};
  })()`);
  await pointerClick('[data-action="collapse-groups"]');
  const firstRapidGroupState = await evaluate(`({collapsed:document.querySelector('.panel')?.classList.contains('groups-collapsed'),
    label:document.querySelector('[data-action="collapse-groups"]')?.getAttribute('aria-label')})`);
  await wait(90);
  const secondRapidGroupPoint = await evaluate(`(() => {
    const button=document.querySelector('[data-action="collapse-groups"]');
    const rect=button.getBoundingClientRect();
    return {x:rect.left+rect.width/2,y:rect.top+rect.height/2,rect:rect.toJSON()};
  })()`);
  await pointerClick('[data-action="collapse-groups"]');
  await wait(130);
  const interruptedGroupMotion=await evaluate(`({collapsed:document.querySelector('.panel')?.classList.contains('groups-collapsed'),
    motion:document.querySelector('.panel')?.classList.contains('groups-motion'),
    rect:document.querySelector('[data-action="collapse-groups"]')?.getBoundingClientRect().toJSON()})`);
  if (!interruptedGroupMotion.collapsed || !interruptedGroupMotion.motion)
    console.log(JSON.stringify({rapidGroupDiagnostic:{firstRapidGroupPoint,firstRapidGroupState,
      secondRapidGroupPoint,interruptedGroupMotion}}));
  assert.equal(interruptedGroupMotion.collapsed,true);
  assert.equal(interruptedGroupMotion.motion,true);
  await wait(210);
  const settledGroupMotion=await evaluate(`({collapsed:document.querySelector('.panel')?.classList.contains('groups-collapsed'),
    motion:document.querySelector('.panel')?.classList.contains('groups-motion')})`);
  assert.deepEqual(settledGroupMotion,{collapsed:true,motion:false});
  for (let iteration = 0; iteration < 12; iteration += 1) {
    await pointerClick('[data-action="collapse-groups"]');
    const afterExpand = await evaluate(`document.querySelector('.panel')?.classList.contains('groups-collapsed')`);
    await wait(90);
    await pointerClick('[data-action="collapse-groups"]');
    const afterCollapse = await evaluate(`document.querySelector('.panel')?.classList.contains('groups-collapsed')`);
    if (afterExpand || !afterCollapse)
      throw new Error(`Rapid group toggle iteration ${iteration + 1}: ${JSON.stringify({afterExpand,afterCollapse})}`);
    await wait(340);
  }
  await evaluate(`[...document.querySelectorAll('.customer-table [data-select]')].find(input=>input.dataset.select===${JSON.stringify(sortTwo)}).click()`);
  await pointerClick('[data-action="batch-followup"]');
  await wait(250);
  const singleFollowupFromList=await evaluate(`({listVisible:Boolean(document.querySelector('.customer-table')),
    dialogOpen:Boolean(document.querySelector('#batch-followup-form')),
    title:document.querySelector('#overlay-root [role="dialog"]')?.getAttribute('aria-label'),
    centered:(()=>{const r=document.querySelector('#overlay-root [role="dialog"]')?.getBoundingClientRect();
      return r ? Math.abs(r.left+r.width/2-innerWidth/2)<2&&Math.abs(r.top+r.height/2-innerHeight/2)<2 : false})(),
    width:document.querySelector('#overlay-root [role="dialog"]')?.getBoundingClientRect().width,
    editorFocused:document.activeElement?.id==='batch-followup-text'})`);
  assert.deepEqual(singleFollowupFromList,{listVisible:true,dialogOpen:true,title:'写跟进',centered:true,width:500,editorFocused:true});
  const singleFollowupFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-single-followup-dialog.png'),Buffer.from(singleFollowupFrame.data,'base64'));
  await pointerClick('#overlay-root [data-action="close-modal"]');
  await waitFor(async()=>evaluate(`!document.querySelector('#overlay-root .overlay')`),'single followup close');
  assert.equal(await evaluate(`document.querySelector('.replica-batch b')?.textContent`),'1');
  await evaluate(`[...document.querySelectorAll('.customer-table [data-select]')].find(input=>input.dataset.select===${JSON.stringify(sortTen)}).click()`);
  await pointerClick('[data-action="batch-followup"]');
  await wait(250);
  const batchFollowupDialogState=await evaluate(`({title:document.querySelector('#overlay-root [role="dialog"]')?.getAttribute('aria-label'),
    toolbarCount:document.querySelector('.replica-batch b')?.textContent,
    countInDialog:Boolean(document.querySelector('.batch-followup-form .batch-tags-count')),
    centered:(()=>{const r=document.querySelector('#overlay-root [role="dialog"]')?.getBoundingClientRect();
      return r ? Math.abs(r.left+r.width/2-innerWidth/2)<2&&Math.abs(r.top+r.height/2-innerHeight/2)<2 : false})(),
    motion:document.querySelector('#overlay-root .overlay')?.classList.contains('modal-motion'),
    width:document.querySelector('#overlay-root .drawer')?.getBoundingClientRect().width,
    height:document.querySelector('#overlay-root .drawer')?.getBoundingClientRect().height,
    editorFocused:document.activeElement?.id==='batch-followup-text',
    saveLabel:document.querySelector('#overlay-root button[type="submit"]')?.textContent,
    date:document.querySelector('#batch-followup-date')?.value})`);
  assert.deepEqual(batchFollowupDialogState,{title:'批量写跟进',toolbarCount:'2',countInDialog:false,
    centered:true,motion:true,width:500,height:538,editorFocused:true,saveLabel:'确定',date:''});
  const batchFollowupFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-batch-followup-dialog.png'),Buffer.from(batchFollowupFrame.data,'base64'));
  await evaluate(`document.querySelector('#overlay-root [data-action="close-modal"]').click()`);
  assert.equal(await evaluate(`document.querySelector('.replica-batch b')?.textContent`),'2');
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await pointerClick('[data-action="batch-followup"]');
  const reducedBatchFollowup=await evaluate(`(() => {
    const dialog=document.querySelector('#overlay-root .drawer');
    const rect=dialog.getBoundingClientRect();
    return {centered:Math.abs(rect.left+rect.width/2-innerWidth/2)<2&&Math.abs(rect.top+rect.height/2-innerHeight/2)<2,
      duration:getComputedStyle(dialog).transitionDuration};
  })()`);
  assert.deepEqual(reducedBatchFollowup,{centered:true,duration:'0.08s'});
  await pointerClick('#overlay-root [data-action="close-modal"]');
  await waitFor(async()=>evaluate(`!document.querySelector('#batch-followup-form')`),'reduced batch followup close');
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await evaluate(`document.querySelector('[data-action="batch-followup"]').click()`);
  const keyboardBatchFollowup=await evaluate(`({open:Boolean(document.querySelector('#batch-followup-form')),
    motion:document.querySelector('#overlay-root .overlay')?.classList.contains('modal-motion')})`);
  assert.deepEqual(keyboardBatchFollowup,{open:true,motion:false});
  await evaluate(`(() => {
    const form=document.querySelector('#batch-followup-form');
    form.elements.namedItem('text').value='Lai batch followup acceptance';
    form.requestSubmit();
  })()`);
  await waitFor(async()=>evaluate(`!document.querySelector('#batch-followup-form')&&!document.querySelector('.replica-batch')`),'batch followup saved');
  const batchFollowupSaved=await evaluate(`(async () => {
    const data=(await (await fetch('/api/data',{cache:'no-store'})).json()).data;
    return ${JSON.stringify([sortTwo,sortTen,sortEmpty])}.map(name=>({name,
      text:data.customers[name]?.history?.[0]?.text||'',
      type:data.customers[name]?.history?.[0]?.type||'',
      due:data.customers[name]?.nextFollow||''}));
  })()`);
  assert.deepEqual(batchFollowupSaved,[
    {name:sortTwo,text:'Lai batch followup acceptance',type:'followup',due:'2026-10-02'},
    {name:sortTen,text:'Lai batch followup acceptance',type:'followup',due:'2026-10-01'},
    {name:sortEmpty,text:'',type:'',due:''},
  ]);
  await evaluate(`[...document.querySelectorAll('.customer-table [data-select]')].find(input=>input.dataset.select===${JSON.stringify(sortTwo)}).click()`);
  await pointerClick('[data-action="batch-followup"]');
  await evaluate(`(() => {
    const form=document.querySelector('#batch-followup-form');
    form.elements.namedItem('text').value='Lai single followup acceptance';
    form.elements.namedItem('nextFollow').value='2026-10-02';
    form.requestSubmit();
  })()`);
  await waitFor(async()=>evaluate(`!document.querySelector('#batch-followup-form')&&!document.querySelector('.replica-batch')`),'single followup saved');
  const singleFollowupSaved=await evaluate(`(async () => {
    const data=(await (await fetch('/api/data',{cache:'no-store'})).json()).data;
    return ${JSON.stringify([sortTwo,sortTen])}.map(name=>({name,
      text:data.customers[name]?.history?.[0]?.text||'',
      type:data.customers[name]?.history?.[0]?.type||'',
      due:data.customers[name]?.nextFollow||''}));
  })()`);
  assert.deepEqual(singleFollowupSaved,[
    {name:sortTwo,text:'Lai single followup acceptance',type:'followup',due:'2026-10-02'},
    {name:sortTen,text:'Lai batch followup acceptance',type:'followup',due:'2026-10-01'},
  ]);
  for (const name of [sortTwo,sortTen])
    await evaluate(`[...document.querySelectorAll('.customer-table [data-select]')].find(input=>input.dataset.select===${JSON.stringify(name)}).click()`);
  await pointerClick('[data-action="batch-more"]');
  await pointerClick('[data-action="batch-assign-owner"]');
  const ownerDrawer=await evaluate(`({open:Boolean(document.querySelector('#batch-owner-form')),
    motion:document.querySelector('#overlay-root .overlay')?.classList.contains('modal-motion'),
    width:document.querySelector('#overlay-root .drawer')?.getBoundingClientRect().width,
    count:document.querySelector('.batch-owner-form .batch-tags-count')?.textContent})`);
  assert.equal(ownerDrawer.open,true);
  assert.equal(ownerDrawer.motion,true);
  assert.ok(ownerDrawer.width>=340&&ownerDrawer.width<=420);
  assert.equal(ownerDrawer.count,'将操作应用到 2 位客户');
  await waitFor(async()=>evaluate(`!document.querySelector('#toast')?.classList.contains('show')`),'previous save toast to clear');
  await wait(220);
  const ownerFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-batch-owner-drawer.png'),Buffer.from(ownerFrame.data,'base64'));
  await evaluate(`(() => {
    const form=document.querySelector('#batch-owner-form');
    form.elements.namedItem('owner').value='Lai Owner Acceptance';
    form.requestSubmit();
  })()`);
  await waitFor(async()=>evaluate(`!document.querySelector('#batch-owner-form')&&!document.querySelector('.replica-batch')`),'owner assignment saved');
  const assignedOwners=await evaluate(`(async()=>{
    const data=(await(await fetch('/api/data',{cache:'no-store'})).json()).data;
    return ${JSON.stringify([sortTwo,sortTen,sortEmpty])}.map(name=>({name,
      owner:data.customers[name]?.owner||'',previous:data.customers[name]?.previousOwner||'',
      time:data.customers[name]?.ownerUpdatedAt||'',updated:data.customers[name]?.updated||'',
      operation:data.customers[name]?.history?.[0]?.type||''}));
  })()`);
  assert.deepEqual(assignedOwners.map(({name,owner,previous,operation})=>({name,owner,previous,operation})),[
    {name:sortTwo,owner:'Lai Owner Acceptance',previous:'Owner Two',operation:'operation'},
    {name:sortTen,owner:'Lai Owner Acceptance',previous:'Owner Ten',operation:'operation'},
    {name:sortEmpty,owner:'',previous:'',operation:''},
  ]);
  assert.ok(assignedOwners[0].time&&assignedOwners[0].time===assignedOwners[0].updated);
  assert.ok(assignedOwners[1].time&&assignedOwners[1].time===assignedOwners[1].updated);
  await evaluate(`[...document.querySelectorAll('.customer-table [data-select]')].find(input=>input.dataset.select===${JSON.stringify(sortTwo)}).click()`);
  await evaluate(`document.querySelector('[data-action="batch-more"]').click()`);
  await evaluate(`document.querySelector('[data-action="batch-clear-owner"]').click()`);
  const clearOwnerDrawer=await evaluate(`({open:Boolean(document.querySelector('#batch-owner-form')),
    motion:document.querySelector('#overlay-root .overlay')?.classList.contains('modal-motion'),
    text:document.querySelector('#batch-owner-form')?.textContent.includes('仅清空所选客户的跟进人')})`);
  assert.deepEqual(clearOwnerDrawer,{open:true,motion:false,text:true});
  await evaluate(`document.querySelector('#batch-owner-form').requestSubmit()`);
  await waitFor(async()=>evaluate(`!document.querySelector('#batch-owner-form')&&!document.querySelector('.replica-batch')`),'owner removal saved');
  const clearedOwner=await evaluate(`(async()=>{
    const data=(await(await fetch('/api/data',{cache:'no-store'})).json()).data;
    return {owner:data.customers[${JSON.stringify(sortTwo)}]?.owner,
      previous:data.customers[${JSON.stringify(sortTwo)}]?.previousOwner,
      untouched:data.customers[${JSON.stringify(sortTen)}]?.owner};
  })()`);
  assert.deepEqual(clearedOwner,{owner:'',previous:'Lai Owner Acceptance',untouched:'Lai Owner Acceptance'});
  for (const name of [sortTwo,sortTen])
    await evaluate(`[...document.querySelectorAll('.customer-table [data-select]')].find(input=>input.dataset.select===${JSON.stringify(name)}).click()`);
  await pointerClick('[data-action="batch-edit-field"]');
  const fieldDrawer=await evaluate(`({open:Boolean(document.querySelector('#batch-field-form')),
    motion:document.querySelector('#overlay-root .overlay')?.classList.contains('modal-motion'),
    width:document.querySelector('#overlay-root .drawer')?.getBoundingClientRect().width,
    count:document.querySelector('.batch-field-form .batch-tags-count')?.textContent,
    options:[...document.querySelectorAll('#batch-field-name option')].map(option=>option.value)})`);
  assert.equal(fieldDrawer.open,true);
  assert.equal(fieldDrawer.motion,true);
  assert.ok(fieldDrawer.width>=340&&fieldDrawer.width<=420);
  assert.equal(fieldDrawer.count,'将字段应用到 2 位客户');
  assert.ok(fieldDrawer.options.includes('source'));
  assert.ok(!fieldDrawer.options.includes('owner'));
  await wait(220);
  const fieldFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-batch-field-drawer.png'),Buffer.from(fieldFrame.data,'base64'));
  await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:720,deviceScaleFactor:1,mobile:false});
  const compactFieldDrawer=await evaluate(`(() => {
    const rect=document.querySelector('#overlay-root .drawer').getBoundingClientRect();
    return {right:rect.right,width:rect.width,bottom:rect.bottom,
      footerVisible:document.querySelector('#overlay-root .drawer-footer').getBoundingClientRect().bottom<=720};
  })()`);
  assert.ok(Math.abs(compactFieldDrawer.right-1100)<1);
  assert.ok(compactFieldDrawer.width>=340&&compactFieldDrawer.width<=420);
  assert.equal(compactFieldDrawer.bottom,720);
  assert.equal(compactFieldDrawer.footerVisible,true);
  const compactFieldFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-batch-field-drawer-1100.png'),Buffer.from(compactFieldFrame.data,'base64'));
  await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:1022,deviceScaleFactor:1,mobile:false});
  await evaluate(`(() => {
    const form=document.querySelector('#batch-field-form');
    form.elements.namedItem('field').value='source';
    form.elements.namedItem('field').dispatchEvent(new Event('change',{bubbles:true}));
    form.elements.namedItem('value').value='Lai Batch Source';
    form.requestSubmit();
  })()`);
  await waitFor(async()=>evaluate(`!document.querySelector('#batch-field-form')&&!document.querySelector('.replica-batch')`),'batch field saved');
  const savedBatchField=await evaluate(`(async()=>{
    const data=(await(await fetch('/api/data',{cache:'no-store'})).json()).data;
    return ${JSON.stringify([sortTwo,sortTen,sortEmpty])}.map(name=>({name,
      source:data.customers[name]?.source||'',
      history:data.customers[name]?.history?.[0]?.type||''}));
  })()`);
  assert.deepEqual(savedBatchField,[
    {name:sortTwo,source:'Lai Batch Source',history:'operation'},
    {name:sortTen,source:'Lai Batch Source',history:'operation'},
    {name:sortEmpty,source:'',history:''},
  ]);
  await evaluate(`[...document.querySelectorAll('.customer-table [data-select]')].find(input=>input.dataset.select===${JSON.stringify(sortTwo)}).click()`);
  await evaluate(`document.querySelector('[data-action="batch-edit-field"]').click()`);
  const keyboardFieldDrawer=await evaluate(`({open:Boolean(document.querySelector('#batch-field-form')),
    motion:document.querySelector('#overlay-root .overlay')?.classList.contains('modal-motion')})`);
  assert.deepEqual(keyboardFieldDrawer,{open:true,motion:false});
  await evaluate(`(() => {
    const form=document.querySelector('#batch-field-form');
    form.elements.namedItem('field').value='source';
    form.elements.namedItem('clear').checked=true;
    form.elements.namedItem('clear').dispatchEvent(new Event('change',{bubbles:true}));
    if (!form.elements.namedItem('value').disabled) throw Error('clear did not disable value');
    form.requestSubmit();
  })()`);
  await waitFor(async()=>evaluate(`!document.querySelector('#batch-field-form')&&!document.querySelector('.replica-batch')`),'batch field clear saved');
  const clearedBatchField=await evaluate(`(async()=>{
    const data=(await(await fetch('/api/data',{cache:'no-store'})).json()).data;
    return {cleared:data.customers[${JSON.stringify(sortTwo)}]?.source,
      untouched:data.customers[${JSON.stringify(sortTen)}]?.source};
  })()`);
  assert.deepEqual(clearedBatchField,{cleared:'',untouched:'Lai Batch Source'});
  await evaluate(`[...document.querySelectorAll('.customer-table .company-link')].find(link=>link.dataset.open===${JSON.stringify(sortTen)}).click()`);
  await waitFor(async()=>evaluate(`Boolean(document.querySelector('.lcd-root [data-tab="info"]'))`),'assigned owner detail');
  await evaluate(`document.querySelector('[data-tab="info"]').click()`);
  const ownerDetail=await evaluate(`(() => {
    const values=Object.fromEntries([...document.querySelectorAll('.lcd-body-info .lcd-field')].map(field=>[
      field.querySelector('dt')?.textContent,field.querySelector('dd')?.textContent]));
    return {owner:document.querySelector('.lcd-owner span')?.textContent,
      previous:values['原跟进人'],time:values['跟进人更新时间'],source:values['客户来源']};
  })()`);
  assert.equal(ownerDetail.owner,'Lai Owner Acceptance');
  assert.equal(ownerDetail.previous,'Owner Ten');
  assert.notEqual(ownerDetail.time,'—');
  assert.equal(ownerDetail.source,'Lai Batch Source');
  const scheduleBefore=await evaluate(`(async()=>{
    const data=(await(await fetch('/api/data',{cache:'no-store'})).json()).data;
    return {date:data.customers[${JSON.stringify(sortTen)}]?.nextFollow||'',
      lastFollowup:data.customers[${JSON.stringify(sortTen)}]?.lastFollowup||''};
  })()`);
  await pointerClick('[data-action="schedule-edit"]');
  await wait(45);
  const scheduleDrawer=await evaluate(`(() => {
    const drawer=document.querySelector('#overlay-root .drawer');
    const overlay=document.querySelector('#overlay-root .overlay');
    return {open:!!document.querySelector('#customer-schedule-form'),
      motion:overlay?.classList.contains('modal-motion'),
      width:Math.round(drawer?.getBoundingClientRect().width||0),
      date:document.querySelector('#customer-schedule-date')?.value};
  })()`);
  assert.deepEqual(scheduleDrawer,{open:true,motion:true,width:380,date:scheduleBefore.date.slice(0,10)});
  await wait(3100);
  const scheduleFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-schedule-drawer.png'),Buffer.from(scheduleFrame.data,'base64'));
  await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:720,deviceScaleFactor:1,mobile:false});
  const compactScheduleDrawer=await evaluate(`(() => {
    const drawer=document.querySelector('#overlay-root .drawer').getBoundingClientRect();
    const save=document.querySelector('[form="customer-schedule-form"][type="submit"]').getBoundingClientRect();
    return {width:Math.round(drawer.width),right:Math.round(drawer.right),
      saveRight:Math.round(save.right),saveBottom:Math.round(save.bottom)};
  })()`);
  assert.equal(compactScheduleDrawer.width,380);
  assert.equal(compactScheduleDrawer.right,1100);
  assert.ok(compactScheduleDrawer.saveRight<=1100&&compactScheduleDrawer.saveBottom<=720);
  const compactScheduleFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-schedule-drawer-1100.png'),Buffer.from(compactScheduleFrame.data,'base64'));
  await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:1022,deviceScaleFactor:1,mobile:false});
  await evaluate(`(() => {
    const form=document.querySelector('#customer-schedule-form');
    form.elements.date.value='2030-11-05';
    form.requestSubmit();
  })()`);
  await waitFor(async()=>evaluate(`!document.querySelector('#customer-schedule-form')&&document.querySelector('.lcd-schedule-entry')?.textContent.includes('2030-11-05')`),'customer schedule saved');
  const scheduledCustomer=await evaluate(`(async()=>{
    const data=(await(await fetch('/api/data',{cache:'no-store'})).json()).data;
    const profile=data.customers[${JSON.stringify(sortTen)}];
    return {date:profile.nextFollow,lastFollowup:profile.lastFollowup||'',
      operation:profile.history?.[0]?.type,
      detail:document.querySelector('.lcd-schedule-entry')?.textContent.includes('2030-11-05')};
  })()`);
  assert.deepEqual(scheduledCustomer,{date:'2030-11-05',lastFollowup:scheduleBefore.lastFollowup,
    operation:'operation',detail:true});
  await pointerClick('[data-action="schedule-view"]');
  await waitFor(async()=>evaluate(`document.querySelector('#biz-month')?.value==='2030-11'`),'scheduled month in calendar');
  const scheduleCalendar=await evaluate(`(() => ({
    month:document.querySelector('#biz-month')?.value,
    selected:!!document.querySelector('[data-biz-day="2030-11-05"].selected'),
    agenda:[...document.querySelectorAll('.calendar-agenda [data-biz-customer]')]
      .map(item=>({customer:item.dataset.bizCustomer,date:item.querySelector('time')?.textContent})),
  }))()`);
  assert.equal(scheduleCalendar.month,'2030-11');
  assert.equal(scheduleCalendar.selected,true);
  assert.ok(scheduleCalendar.agenda.some(item=>item.customer===sortTen&&item.date==='2030-11-05'));
  const calendarFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-schedule-calendar.png'),Buffer.from(calendarFrame.data,'base64'));
  await evaluate(`[...document.querySelectorAll('.calendar-agenda [data-biz-customer]')].find(item=>item.dataset.bizCustomer===${JSON.stringify(sortTen)}).click()`);
  await waitFor(async()=>evaluate(`Boolean(document.querySelector('.lcd-root [data-action="schedule-edit"]'))`),'customer return from calendar');
  await evaluate(`document.querySelector('[data-action="schedule-edit"]').click()`);
  const keyboardScheduleDrawer=await evaluate(`({open:!!document.querySelector('#customer-schedule-form'),
    motion:document.querySelector('#overlay-root .overlay')?.classList.contains('modal-motion'),
    date:document.querySelector('#customer-schedule-date')?.value})`);
  assert.deepEqual(keyboardScheduleDrawer,{open:true,motion:false,date:'2030-11-05'});
  await evaluate(`document.querySelector('#customer-schedule-form').requestSubmit()`);
  const unchangedSchedule=await evaluate(`({error:document.querySelector('#workspace-error')?.textContent,
    drawerOpen:!!document.querySelector('#customer-schedule-form')})`);
  assert.deepEqual(unchangedSchedule,{error:'跟进日程无需更新',drawerOpen:true});
  await evaluate(`document.querySelector('#clear-customer-schedule').click()`);
  await waitFor(async()=>evaluate(`!document.querySelector('#customer-schedule-form')&&!document.querySelector('.lcd-schedule-entry')`),'customer schedule cleared');
  const clearedSchedule=await evaluate(`(async()=>{
    const data=(await(await fetch('/api/data',{cache:'no-store'})).json()).data;
    return {date:data.customers[${JSON.stringify(sortTen)}]?.nextFollow,
      count:document.querySelector('.lcd-schedule .lcd-section-head')?.textContent,
      operation:data.customers[${JSON.stringify(sortTen)}]?.history?.[0]?.type};
  })()`);
  assert.deepEqual(clearedSchedule,{date:'',count:'⌄计划日程 （0）添加',operation:'operation'});
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await pointerClick('[data-action="schedule-edit"]');
  await wait(45);
  const reducedScheduleDrawer=await evaluate(`(() => {
    const drawer=document.querySelector('#overlay-root .drawer');
    return {open:!!drawer,transition:getComputedStyle(drawer).transitionDuration,
      transform:getComputedStyle(drawer).transform};
  })()`);
  assert.deepEqual(reducedScheduleDrawer,{open:true,transition:'0.08s',transform:'none'});
  await evaluate(`document.querySelector('[data-action="close-modal"]').click()`);
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await evaluate(`document.querySelector('.lcd-body [data-action="company-display-settings"]').click()`);
  const companyDisplayDrawer=await evaluate(`(() => {
    const drawer=document.querySelector('.drawer.company-display');
    return {width:Math.round(drawer.getBoundingClientRect().width),
      common:[...drawer.querySelectorAll('[data-company-list="common"] [data-company-field-id]')].map(row=>row.dataset.companyFieldId),
      other:[...drawer.querySelectorAll('[data-company-list="other"] [data-company-field-id]')].map(row=>row.dataset.companyFieldId)};
  })()`);
  assert.equal(companyDisplayDrawer.width,400);
  assert.equal(companyDisplayDrawer.common.length,10);
  assert.equal(companyDisplayDrawer.other.length,6);
  assert.deepEqual(companyDisplayDrawer.common.slice(0,4),['website','name','country','source']);
  const companyDisplayFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-company-display-drawer.png'),Buffer.from(companyDisplayFrame.data,'base64'));
  await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:720,deviceScaleFactor:1,mobile:false});
  const compactCompanyDrawer=await evaluate(`(() => {
    const drawer=document.querySelector('.drawer.company-display').getBoundingClientRect();
    const footer=document.querySelector('.company-display .drawer-footer').getBoundingClientRect();
    return {width:Math.round(drawer.width),right:Math.round(drawer.right),footerBottom:Math.round(footer.bottom)};
  })()`);
  assert.deepEqual(compactCompanyDrawer,{width:400,right:1100,footerBottom:720});
  const compactCompanyFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-company-display-drawer-1100.png'),Buffer.from(compactCompanyFrame.data,'base64'));
  await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:1022,deviceScaleFactor:1,mobile:false});
  await evaluate(`document.querySelector('[data-company-field-id="website"]').focus()`);
  await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
  await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
  const keyboardCompanyReorder=await evaluate(`({first:[...document.querySelectorAll('[data-company-list="common"] [data-company-field-id]')].slice(0,2).map(row=>row.dataset.companyFieldId),
    motion:[...document.querySelectorAll('.company-display-row')].some(row=>row.getAnimations().some(animation=>animation.playState==='running'&&animation.effect?.getKeyframes().some(frame=>frame.transform)))})`);
  assert.deepEqual(keyboardCompanyReorder,{first:['name','website'],motion:false});
  await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowUp',code:'ArrowUp',windowsVirtualKeyCode:38});
  await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowUp',code:'ArrowUp',windowsVirtualKeyCode:38});
  await pointerClick('.company-display [data-company-field-id="tags"] [data-company-move]');
  const companyReorderMotion=await evaluate(`[...document.querySelectorAll('.company-display-row')].some(row=>row.getAnimations().some(animation=>animation.playState==='running'&&animation.effect?.getKeyframes().some(frame=>frame.transform)))`);
  assert.equal(companyReorderMotion,true,'pointer field move should bridge the changed row positions');
  await wait(220);
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await pointerClick('.company-display [data-company-field-id="tags"] [data-company-move]');
  const reducedCompanyReorder=await evaluate(`[...document.querySelectorAll('.company-display-row')].some(row=>row.getAnimations().some(animation=>animation.playState==='running'&&animation.effect?.getKeyframes().some(frame=>frame.transform)))`);
  assert.equal(reducedCompanyReorder,false);
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await evaluate(`document.querySelector('[data-company-field-id="tags"] [data-company-move]').click()`);
  await evaluate(`document.querySelector('[data-action="save-company-display"]').click()`);
  await waitFor(async()=>evaluate(`!document.querySelector('.drawer.company-display')`),'company display save');
  const companyDisplaySaved=await evaluate(`(async()=>{
    const snapshot=await(await fetch('/api/data',{cache:'no-store'})).json();
    const body=document.querySelector('.lcd-body-info');
    const common=body.querySelectorAll('.lcd-info-fields')[0].textContent;
    const other=body.querySelectorAll('.lcd-info-fields')[1].textContent;
    return {commonHasTags:common.includes('客户标签'),otherHasTags:other.includes('客户标签'),
      saved:snapshot.data.previewCompanyDisplayLayout?.other?.includes('tags')};
  })()`);
  assert.deepEqual(companyDisplaySaved,{commonHasTags:false,otherHasTags:false,saved:true});
  await evaluate(`document.querySelector('.lcd-pagebar [data-action="edit"]').click()`);
  const editorGroup=await evaluate(`({common:[...document.querySelectorAll('#customer-form [data-company-common] [data-company-field]')].map(el=>el.dataset.companyField),
    other:[...document.querySelectorAll('#customer-form [data-company-other] [data-company-field]')].map(el=>el.dataset.companyField)})`);
  assert.equal(editorGroup.common.includes('tags'),false);
  assert.equal(editorGroup.other.includes('tags'),true);
  await evaluate(`(() => {const input=document.querySelector('#customer-form [name="website"]'); input.value='https://unsaved.example.test'; input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await evaluate(`document.querySelector('#customer-form [data-action="company-display-settings"]').click()`);
  assert.equal(await evaluate(`Boolean(document.querySelector('.drawer.company-display'))`),true);
  await evaluate(`document.querySelector('.drawer.company-display [data-action="close-modal"]').click()`);
  const editorDraftRestored=await evaluate(`({value:document.querySelector('#customer-form [name="website"]')?.value,
    modal:document.querySelector('#overlay-root .drawer')?.getAttribute('aria-label')})`);
  assert.deepEqual(editorDraftRestored,{value:'https://unsaved.example.test',modal:'编辑客户'});
  await evaluate(`document.querySelector('#customer-form [data-action="company-display-settings"]').click()`);
  await evaluate(`document.querySelector('[data-company-field-id="website"] [data-company-move]').click()`);
  await evaluate(`document.querySelector('[data-action="save-company-display"]').click()`);
  await waitFor(async()=>evaluate(`Boolean(document.querySelector('#customer-form [data-company-other] [data-company-field="website"]'))`),'editor company display save');
  const editorDraftAfterSave=await evaluate(`({value:document.querySelector('#customer-form [name="website"]')?.value,
    common:!!document.querySelector('#customer-form [data-company-common] [data-company-field="website"]'),
    other:!!document.querySelector('#customer-form [data-company-other] [data-company-field="website"]')})`);
  assert.deepEqual(editorDraftAfterSave,{value:'https://unsaved.example.test',common:false,other:true});
  const companyEditorFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-company-display-editor.png'),Buffer.from(companyEditorFrame.data,'base64'));
  await evaluate(`document.querySelector('#overlay-root [data-action="close-modal"]').click()`);
  const editorFollowOriginal=await evaluate(`(async()=>Boolean((await(await fetch('/api/data',{cache:'no-store'})).json()).data.customers[${JSON.stringify(sortTen)}]?.previewFollowed))()`);
  await evaluate(`document.querySelector('.lcd-pagebar [data-action="edit"]').click()`);
  assert.equal(await evaluate(`document.querySelector('.drawer.customer-editor [data-action="editor-follow"]')?.getAttribute('aria-pressed')`),String(editorFollowOriginal));
  await evaluate(`document.querySelector('#customer-form [name="website"]').value='https://unsaved-follow.example.test'`);
  await pointerClick('.drawer.customer-editor [data-action="editor-follow"]');
  const editorFollowDraft=await evaluate(`(async()=>({pressed:document.querySelector('.drawer.customer-editor [data-action="editor-follow"]')?.getAttribute('aria-pressed'),
    field:document.querySelector('#customer-form [name="previewFollowed"]')?.value,
    website:document.querySelector('#customer-form [name="website"]')?.value,
    stored:Boolean((await(await fetch('/api/data',{cache:'no-store'})).json()).data.customers[${JSON.stringify(sortTen)}]?.previewFollowed)}))()`);
  assert.deepEqual(editorFollowDraft,{pressed:String(!editorFollowOriginal),field:String(!editorFollowOriginal),website:'https://unsaved-follow.example.test',stored:editorFollowOriginal});
  const editorFollowFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-editor-follow-draft.png'),Buffer.from(editorFollowFrame.data,'base64'));
  await evaluate(`document.querySelector('.drawer.customer-editor [data-action="close-modal"]').click()`);
  await evaluate(`document.querySelector('.lcd-pagebar [data-action="edit"]').click()`);
  const editorFollowCancelled=await evaluate(`({pressed:document.querySelector('.drawer.customer-editor [data-action="editor-follow"]')?.getAttribute('aria-pressed'),
    website:document.querySelector('#customer-form [name="website"]')?.value})`);
  assert.equal(editorFollowCancelled.pressed,String(editorFollowOriginal));
  assert.notEqual(editorFollowCancelled.website,'https://unsaved-follow.example.test');
  await evaluate(`document.querySelector('.drawer.customer-editor [data-action="editor-follow"]').click()`);
  await evaluate(`document.querySelector('#customer-form').requestSubmit(document.querySelector('#customer-form [name="saveMode"][value="save"]')||document.querySelector('.drawer.customer-editor [form="customer-form"][value="save"]'))`);
  await waitFor(async()=>evaluate(`!document.querySelector('#customer-form')`),'editor follow save');
  const editorFollowSaved=await evaluate(`(async()=>({stored:Boolean((await(await fetch('/api/data',{cache:'no-store'})).json()).data.customers[${JSON.stringify(sortTen)}]?.previewFollowed),
    detail:document.querySelector('.lcd-follow')?.classList.contains('on')}))()`);
  assert.deepEqual(editorFollowSaved,{stored:!editorFollowOriginal,detail:!editorFollowOriginal});
  const customerCodeBefore=await evaluate(`(async()=>String((await(await fetch('/api/data',{cache:'no-store'})).json()).data.customers[${JSON.stringify(sortTen)}]?.customerCode||''))()`);
  await evaluate(`document.querySelector('.lcd-pagebar [data-action="edit"]').click()`);
  await evaluate(`document.querySelector('#customer-form [data-editor-action="edit-customer-code"]').scrollIntoView({block:'center',behavior:'instant'})`);
  await pointerClick('#customer-form [data-editor-action="edit-customer-code"]');
  const pointerCodeEditor=await evaluate(`({open:!document.querySelector('#customer-form [name="customerCode"]').hidden,
    motion:getComputedStyle(document.querySelector('#customer-form [name="customerCode"]')).animationName,
    otherDraft:document.querySelector('#customer-form [name="website"]').value})`);
  assert.equal(pointerCodeEditor.open,true);
  assert.equal(pointerCodeEditor.motion,'none');
  const activeCodeEditorFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-code-active.png'),Buffer.from(activeCodeEditorFrame.data,'base64'));
  await evaluate(`(() => {const input=document.querySelector('#customer-form [name="customerCode"]'); input.value='Discarded Code'; input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));})()`);
  const escapedCode=await evaluate(`({value:document.querySelector('#customer-form [name="customerCode"]').value,
    editing:!document.querySelector('#customer-form [name="customerCode"]').hidden,
    display:document.querySelector('#customer-form [data-customer-code-display]').textContent})`);
  assert.deepEqual(escapedCode,{value:'Discarded Code',editing:true,display:customerCodeBefore||'*****'});
  await evaluate(`document.querySelector('#customer-form [name="name"]').focus()`);
  assert.equal(await evaluate(`document.querySelector('#customer-form [data-customer-code-display]').textContent`),'Discarded Code');
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await pointerClick('#customer-form [data-editor-action="edit-customer-code"]');
  const reducedCodeMotion=await evaluate(`[...document.querySelector('#customer-form [name="customerCode"]').getAnimations()].some(animation=>animation.effect?.getKeyframes().some(frame=>frame.transform))`);
  assert.equal(reducedCodeMotion,false);
  await evaluate(`(() => {document.querySelector('#customer-form [name="customerCode"]').value='Temporary Draft'; document.querySelector('#customer-form [name="name"]').focus();})()`);
  assert.equal(await evaluate(`document.querySelector('#customer-form [data-customer-code-display]').textContent`),'Temporary Draft');
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await evaluate(`document.querySelector('#customer-form [data-editor-action="edit-customer-code"]').click()`);
  assert.equal(await evaluate(`document.querySelector('#customer-form [name="customerCode"]').classList.contains('ce-number-enter')`),false);
  await evaluate(`(() => {const form=document.querySelector('#customer-form'); form.elements.customerCode.value='Tab Draft'; form.elements.name.focus();})()`);
  const tabCodeDraft=await evaluate(`({hidden:document.querySelector('#customer-form [name="customerCode"]').hidden,
    display:document.querySelector('#customer-form [data-customer-code-display]').textContent})`);
  assert.deepEqual(tabCodeDraft,{hidden:true,display:'Tab Draft'});
  await evaluate(`document.querySelector('#customer-form [data-editor-action="edit-customer-code"]').click()`);
  await evaluate(`(() => {const input=document.querySelector('#customer-form [name="customerCode"]'); input.value='LAI-CODE-74'; input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
  const codeDraft=await evaluate(`(async()=>({value:document.querySelector('#customer-form [name="customerCode"]').value,
    editing:!document.querySelector('#customer-form [name="customerCode"]').hidden,
    display:document.querySelector('#customer-form [data-customer-code-display]').textContent,
    stored:String((await(await fetch('/api/data',{cache:'no-store'})).json()).data.customers[${JSON.stringify(sortTen)}]?.customerCode||'')}))()`);
  assert.deepEqual(codeDraft,{value:'LAI-CODE-74',editing:true,display:'Tab Draft',stored:customerCodeBefore});
  await evaluate(`document.querySelector('#customer-form [name="name"]').focus()`);
  assert.equal(await evaluate(`document.querySelector('#customer-form [data-customer-code-display]').textContent`),'LAI-CODE-74');
  const codeEditorFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-code-draft.png'),Buffer.from(codeEditorFrame.data,'base64'));
  await evaluate(`document.querySelector('.drawer.customer-editor [data-action="close-modal"]').click()`);
  await evaluate(`document.querySelector('.lcd-pagebar [data-action="edit"]').click()`);
  const cancelledCode=await evaluate(`document.querySelector('#customer-form [name="customerCode"]').value`);
  assert.equal(cancelledCode,customerCodeBefore);
  await evaluate(`document.querySelector('#customer-form [data-editor-action="edit-customer-code"]').click()`);
  await evaluate(`(() => {const form=document.querySelector('#customer-form');form.elements.customerCode.value='LAI-CODE-74';form.elements.name.focus();})()`);
  await evaluate(`document.querySelector('#customer-form').requestSubmit(document.querySelector('.drawer.customer-editor [form="customer-form"][value="save"]'))`);
  await waitFor(async()=>evaluate(`!document.querySelector('#customer-form')`),'customer code saved');
  const savedCode=await evaluate(`(async()=>({stored:(await(await fetch('/api/data',{cache:'no-store'})).json()).data.customers[${JSON.stringify(sortTen)}]?.customerCode,
    detail:document.querySelector('.lcd-body-info')?.textContent.includes('LAI-CODE-74')}))()`);
  assert.deepEqual(savedCode,{stored:'LAI-CODE-74',detail:true});
  await evaluate(`document.querySelector('.top-actions [data-action="new"]').click()`);
  await evaluate(`document.querySelector('#customer-form .ce-company-extra > summary').scrollIntoView({block:'center',behavior:'instant'})`);
  await pointerClick('#customer-form .ce-company-extra > summary');
  const companyExtraOpen=await evaluate(`(() => {const section=document.querySelector('#customer-form .ce-company-extra');
    const content=section.querySelector('.ce-extra-content'),css=getComputedStyle(content);
    return {open:section.open,animated:content.getAnimations().length,opacity:css.opacity,transform:css.transform};})()`);
  assert.deepEqual(companyExtraOpen,{open:true,animated:0,opacity:'1',transform:'none'});
  await wait(190);
  const extraFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-company-extra-open.png'),Buffer.from(extraFrame.data,'base64'));
  await evaluate(`document.querySelector('#customer-form .ce-company-extra .ce-collapse').scrollIntoView({block:'center',behavior:'instant'})`);
  await pointerClick('#customer-form .ce-company-extra .ce-collapse');
  const companyExtraClosing=await evaluate(`(() => {const section=document.querySelector('#customer-form .ce-company-extra');
    return {open:section.open,animated:section.querySelector('.ce-extra-content').getAnimations().length,focusedSummary:document.activeElement===section.querySelector('summary')};})()`);
  assert.deepEqual(companyExtraClosing,{open:false,animated:0,focusedSummary:true});
  await waitFor(async()=>evaluate(`!document.querySelector('#customer-form .ce-company-extra').open`),'company optional fields close');
  await evaluate(`document.querySelector('#customer-form .ce-company-extra > summary').click()`);
  const keyboardExtraOpen=await evaluate(`({open:document.querySelector('#customer-form .ce-company-extra').open,
    animated:document.querySelector('#customer-form .ce-company-extra .ce-extra-content').getAnimations().length})`);
  assert.deepEqual(keyboardExtraOpen,{open:true,animated:0});
  await evaluate(`document.querySelector('#customer-form .ce-company-extra .ce-collapse').click()`);
  assert.equal(await evaluate(`document.querySelector('#customer-form .ce-company-extra').open`),false);
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await evaluate(`document.querySelector('#customer-form .ce-contact-extra > summary').scrollIntoView({block:'center',behavior:'instant'})`);
  await pointerClick('#customer-form .ce-contact-extra > summary');
  const reducedExtraOpen=await evaluate(`(() => {const section=document.querySelector('#customer-form .ce-contact-extra');
    const content=section.querySelector('.ce-extra-content'),css=getComputedStyle(content);
    return {open:section.open,animated:content.getAnimations().length,opacity:css.opacity,transform:css.transform};})()`);
  assert.deepEqual(reducedExtraOpen,{open:true,animated:0,opacity:'1',transform:'none'});
  await evaluate(`document.querySelector('#customer-form .ce-contact-extra .ce-collapse').click()`);
  assert.equal(await evaluate(`document.querySelector('#customer-form .ce-contact-extra').open`),false);
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  const newRequiredFields=await evaluate(`(() => {const form=document.querySelector('#customer-form');
    return Object.fromEntries(['name','country','source','contact','email','phone'].map(name=>[name,form.elements[name].required]));})()`);
  assert.deepEqual(newRequiredFields,{name:true,country:true,source:true,contact:true,email:true,phone:true});
  const newValidation=await evaluate(`(() => {const form=document.querySelector('#customer-form');
    form.elements.name.value='Lai Follow Draft Probe'; form.elements.country.value='US';
    const sourceMissing=!form.checkValidity()&&form.elements.source.validity.valueMissing;
    form.elements.source.value='Acceptance'; form.elements.contact.value='Probe'; form.elements.email.value='probe@example.test';
    const phoneMissing=!form.checkValidity()&&form.elements.phone.validity.valueMissing;
    form.elements.phone.value='+1 555 0123';
    return {sourceMissing,phoneMissing,complete:form.checkValidity()};})()`);
  assert.deepEqual(newValidation,{sourceMissing:true,phoneMissing:true,complete:true});
  await evaluate(`document.querySelector('#customer-form [data-editor-action="add-contact"]').click()`);
  const addedContactRequired=await evaluate(`(() => {const form=document.querySelector('#customer-form');
    return {required:['contactExtra','emailExtra','phoneExtra'].every(name=>form.elements[name].required),invalid:!form.checkValidity()};})()`);
  assert.deepEqual(addedContactRequired,{required:true,invalid:true});
  await evaluate(`(() => {const form=document.querySelector('#customer-form'); form.elements.contactExtra.value='Extra Probe';
    form.elements.emailExtra.value='extra@example.test'; form.elements.phoneExtra.value='+1 555 0456';})()`);
  assert.equal(await evaluate(`document.querySelector('#customer-form').checkValidity()`),true);
  await evaluate(`document.querySelector('.drawer.customer-editor [data-action="editor-follow"]').click()`);
  assert.equal(await evaluate(`document.querySelector('#customer-form [name="previewFollowed"]')?.value`),'true');
  await evaluate(`document.querySelector('#customer-form').requestSubmit(document.querySelector('.drawer.customer-editor [form="customer-form"][value="save"]'))`);
  await waitFor(async()=>evaluate(`!document.querySelector('#customer-form')`),'new followed customer save');
  const newEditorFollowSaved=await evaluate(`(async()=>{const customer=(await(await fetch('/api/data',{cache:'no-store'})).json()).data.customers['Lai Follow Draft Probe'];
    return {stored:customer?.previewFollowed,list:!!document.querySelector('.customer-table'),
      phone:customer?.phone,extra:customer?.extraContacts?.[0]?.email};})()`);
  assert.deepEqual(newEditorFollowSaved,{stored:true,list:true,phone:'+1 555 0123',extra:'extra@example.test'});
  await evaluate(`(async()=>{
    const snapshot=await(await fetch('/api/data',{cache:'no-store'})).json();
    for(let index=1;index<=140;index++) snapshot.data.customers['Lai Pagination Probe '+String(index).padStart(3,'0')]={country:'US',source:'Acceptance',owner:'Kris'};
    const response=await fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({state:{app:'laicai-lai',version:'1.4.2',data:snapshot.data},baseRevision:snapshot.revision})});
    if(!response.ok)throw Error('isolated pagination fixture save failed');
  })()`);
  await cdp.call('Page.navigate',{url:`${base}/trade-order-system.html?token=${encodeURIComponent(token)}#customers`});
  await waitFor(async()=>evaluate(`Number(document.querySelector('#page-jump')?.max)>=7`),'multi-page customer fixture');
  await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:720,deviceScaleFactor:1,mobile:false});
  const listScrollBefore=await evaluate(`(() => {const groups=document.querySelector('.group-scroll'),table=document.querySelector('.table-wrap');
    groups.scrollTop=Math.min(420,groups.scrollHeight-groups.clientHeight);
    table.scrollLeft=Math.min(400,table.scrollWidth-table.clientWidth);
    table.scrollTop=Math.min(160,table.scrollHeight-table.clientHeight);
    return {group:groups.scrollTop,horizontal:table.scrollLeft,vertical:table.scrollTop,
      groupMax:groups.scrollHeight-groups.clientHeight,horizontalMax:table.scrollWidth-table.clientWidth,
      collapsed:document.querySelector('.replica-panel').classList.contains('groups-collapsed')};})()`);
  assert.ok(listScrollBefore.group>0&&listScrollBefore.horizontal>0&&listScrollBefore.vertical>0,
    `list must have all scrollable regions: ${JSON.stringify(listScrollBefore)}`);
  await evaluate(`document.querySelector('.customer-table [data-select]').click()`);
  const listScrollAfterSelection=await evaluate(`({group:document.querySelector('.group-scroll').scrollTop,
    horizontal:document.querySelector('.table-wrap').scrollLeft,vertical:document.querySelector('.table-wrap').scrollTop})`);
  assert.deepEqual(listScrollAfterSelection,{group:listScrollBefore.group,horizontal:listScrollBefore.horizontal,
    vertical:listScrollBefore.vertical},'selecting a customer must retain list scroll positions');
  await evaluate(`document.querySelector('.customer-table [data-select]').click()`);
  await evaluate(`document.querySelector('.customer-table .company-link').click()`);
  assert.equal(await evaluate(`Boolean(document.querySelector('.lcd-root'))`),true);
  await evaluate(`document.querySelector('.lcd-return').click()`);
  const listScrollAfterReturn=await evaluate(`({group:document.querySelector('.group-scroll').scrollTop,
    horizontal:document.querySelector('.table-wrap').scrollLeft,vertical:document.querySelector('.table-wrap').scrollTop})`);
  assert.deepEqual(listScrollAfterReturn,{group:listScrollBefore.group,horizontal:listScrollBefore.horizontal,
    vertical:listScrollBefore.vertical},'returning from customer detail must retain list scroll positions');
  const scrollRetainedFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-list-scroll-retained.png'),Buffer.from(scrollRetainedFrame.data,'base64'));
  await evaluate(`document.querySelector('[data-action="next"]').click()`);
  const listScrollAfterPage=await evaluate(`({group:document.querySelector('.group-scroll').scrollTop,
    horizontal:document.querySelector('.table-wrap').scrollLeft,vertical:document.querySelector('.table-wrap').scrollTop})`);
  assert.deepEqual(listScrollAfterPage,{group:listScrollBefore.group,horizontal:listScrollBefore.horizontal,
    vertical:0},'changing pages must reset row height while retaining the customer context');
  await evaluate(`document.querySelector('[data-action="prev"]').click()`);
  await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:1022,deviceScaleFactor:1,mobile:false});
  const firstPagination=await evaluate(`({total:Number(document.querySelector('#page-jump').max),
    buttons:[...document.querySelectorAll('.pages [data-page]')].map(button=>Number(button.dataset.page)),
    current:document.querySelector('.pages [aria-current="page"]')?.textContent.trim()})`);
  assert.deepEqual(firstPagination.buttons,[1,2,3,firstPagination.total]);
  assert.equal(firstPagination.current,'1');
  await evaluate(`(() => {const input=document.querySelector('#page-jump'); input.value='4'; input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const middlePagination=await evaluate(`({buttons:[...document.querySelectorAll('.pages [data-page]')].map(button=>Number(button.dataset.page)),
    current:document.querySelector('.pages [aria-current="page"]')?.textContent.trim()})`);
  assert.ok(middlePagination.buttons.includes(4));
  assert.equal(middlePagination.current,'4');
  await cdp.call('Emulation.setDeviceMetricsOverride',{width:1024,height:768,deviceScaleFactor:1,mobile:false});
  const compactPagination=await evaluate(`(() => {const footer=document.querySelector('.pagination'); const current=footer.querySelector('[aria-current="page"]');
    const rect=footer.getBoundingClientRect(),active=current.getBoundingClientRect();
    const brand=document.querySelector('.brand').getBoundingClientRect();
    const search=document.querySelector('.global-search').getBoundingClientRect();
    const actions=document.querySelector('.top-actions').getBoundingClientRect();
    return {fits:footer.scrollWidth<=footer.clientWidth,currentVisible:active.left>=rect.left&&active.right<=rect.right,
      headerClear:search.left-brand.right>=8&&actions.left-search.right>=8};})()`);
  assert.deepEqual(compactPagination,{fits:true,currentVisible:true,headerClear:true});
  const compactPaginationFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-pagination-1024.png'),Buffer.from(compactPaginationFrame.data,'base64'));
  await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:1022,deviceScaleFactor:1,mobile:false});
  await evaluate(`document.querySelector('[data-action="next"]').click()`);
  assert.equal(await evaluate(`document.querySelector('.pages [aria-current="page"]')?.textContent.trim()`),'5');
  await evaluate(`document.querySelector('.pages [data-page="'+document.querySelector('#page-jump').max+'"]').click()`);
  const lastPagination=await evaluate(`({current:document.querySelector('.pages [aria-current="page"]')?.textContent.trim(),
    nextDisabled:document.querySelector('[data-action="next"]')?.disabled,
    buttons:[...document.querySelectorAll('.pages [data-page]')].map(button=>Number(button.dataset.page))})`);
  assert.equal(lastPagination.current,String(firstPagination.total));
  assert.equal(lastPagination.nextDisabled,true);
  assert.ok(lastPagination.buttons.includes(firstPagination.total-1));
  const paginationFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-pagination-last.png'),Buffer.from(paginationFrame.data,'base64'));
  const segmentFieldProbe='Lai Segment Field Probe';
  await evaluate(`(async()=>{
    const snapshot=await(await fetch('/api/data',{cache:'no-store'})).json();
    snapshot.data.customers[${JSON.stringify(segmentFieldProbe)}]={country:'LaiIsolatedRegion',previewGroup:'Legacy Field Group',segments:['Imported']};
    snapshot.data.previewSegments=[...(snapshot.data.previewSegments||[]),
      {id:'lai-segment-field-manual',name:'Local Manual',kind:'manual',members:[${JSON.stringify(segmentFieldProbe)}]},
      {id:'lai-segment-field-rule',name:'Local Rule',kind:'rules',match:'all',rules:[{field:'country',op:'eq',value:'LaiIsolatedRegion'}]},
      {id:'lai-segment-field-archived',name:'Archived Segment',kind:'manual',members:[${JSON.stringify(segmentFieldProbe)}],archived:true}];
    snapshot.data.previewTable={...(snapshot.data.previewTable||{}),order:['name','group','segments'],frozen:['name']};
    const response=await fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({state:{app:'laicai-lai',version:'1.4.2',data:snapshot.data},baseRevision:snapshot.revision})});
    if(!response.ok)throw Error('isolated customer segment field fixture save failed');
  })()`);
  await cdp.call('Page.navigate',{url:`${base}/trade-order-system.html?token=${encodeURIComponent(token)}#customers`});
  await waitFor(async()=>evaluate(`Boolean(document.querySelector('#search-field'))`),'segment field navigation');
  await evaluate(`(() => {const field=document.querySelector('#search-field');field.value='name';field.dispatchEvent(new Event('change',{bubbles:true}));
    const input=document.querySelector('#search');input.value=${JSON.stringify(segmentFieldProbe)};
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
  const listSegmentField=await evaluate(`(() => {const heads=[...document.querySelectorAll('.customer-table thead th')];
    const index=field=>heads.findIndex(cell=>cell.querySelector('[data-sort-field="'+field+'"]'));
    const cells=document.querySelector('.customer-table tbody tr')?.cells;
    return {name:document.querySelector('.customer-table .company-link')?.textContent.trim(),
      group:cells?.[index('group')]?.textContent.trim(),segments:cells?.[index('segments')]?.textContent.trim()};})()`);
  assert.equal(listSegmentField.name,segmentFieldProbe);
  assert.equal(listSegmentField.group,'Legacy Field Group、Local Manual');
  assert.equal(listSegmentField.segments,'Imported、Local Manual、Local Rule');
  await evaluate(`document.querySelector('.customer-table .company-link').click()`);
  const detailSegmentField=await evaluate(`(async()=>{const field=[...document.querySelectorAll('.lcd-body-info .lcd-field')]
    .find(item=>item.querySelector('dt')?.textContent==='客群');
    const snapshot=await(await fetch('/api/data',{cache:'no-store'})).json();
    return {display:field?.querySelector('dd')?.textContent,stored:snapshot.data.customers[${JSON.stringify(segmentFieldProbe)}]?.segments};})()`);
  assert.deepEqual(detailSegmentField,{display:listSegmentField.segments,stored:['Imported']});
  await evaluate(`([...document.querySelectorAll('.lcd-body-info .lcd-field')]
    .find(item=>item.querySelector('dt')?.textContent==='客群'))?.scrollIntoView({block:'center',behavior:'instant'})`);
  const segmentFieldFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-segment-field.png'),Buffer.from(segmentFieldFrame.data,'base64'));
  const countryBuyer='Lai Country Buyer Probe';
  const countryProspect='Lai Country Prospect Probe';
  const prospectOnly='Lai Prospect Only Region Probe';
  await evaluate(`(async()=>{
    const snapshot=await(await fetch('/api/data',{cache:'no-store'})).json();
    snapshot.data.customers[${JSON.stringify(countryBuyer)}]={country:'LaiCountryRegion'};
    snapshot.data.customers[${JSON.stringify(countryProspect)}]={country:'LaiCountryRegion'};
    snapshot.data.customers[${JSON.stringify(prospectOnly)}]={country:'LaiProspectRegion'};
    snapshot.data.orders.push({id:'lai-country-buyer-order',client:${JSON.stringify(countryBuyer)},amount:25,currency:'USD',stage:'done',createdAt:'2026-09-01'});
    const response=await fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({state:{app:'laicai-lai',version:'1.4.2',data:snapshot.data},baseRevision:snapshot.revision})});
    if(!response.ok)throw Error('isolated country branch fixture save failed');
  })()`);
  await cdp.call('Page.navigate',{url:`${base}/trade-order-system.html?token=${encodeURIComponent(token)}#customers`});
  await waitFor(async()=>evaluate(`Boolean(document.querySelector('[data-expand="countries"]'))`),'country branch navigation');
  await evaluate(`if(document.querySelector('[data-expand="countries"]').getAttribute('aria-expanded')==='false')document.querySelector('[data-expand="countries"]').click()`);
  const countryBranch=await evaluate(`(() => ({
    buyerCount:document.querySelector('[data-group="country:LaiCountryRegion"] small')?.textContent,
    prospectOnlyVisible:Boolean(document.querySelector('[data-group="country:LaiProspectRegion"]')),
    prospectOnlyQuickOption:Boolean(document.querySelector('#country-values option[value="LaiProspectRegion"]'))
  }))()`);
  assert.deepEqual(countryBranch,{buyerCount:'1',prospectOnlyVisible:false,prospectOnlyQuickOption:true});
  await evaluate(`document.querySelector('[data-group="country:LaiCountryRegion"]').click()`);
  const countrySelection=await evaluate(`({heading:document.querySelector('.list-heading strong')?.textContent.trim(),
    count:document.querySelector('.list-heading span')?.textContent.trim(),
    names:[...document.querySelectorAll('.customer-table .company-link')].map(item=>item.textContent.trim())})`);
  assert.deepEqual(countrySelection,{heading:'LaiCountryRegion',count:'1 个客户',names:[countryBuyer]});
  const countryFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-country-completed-group.png'),Buffer.from(countryFrame.data,'base64'));
  await evaluate(`document.querySelector('[data-group="all"]').click()`);
  await evaluate(`if(document.querySelector('[data-expand="countries"]').getAttribute('aria-expanded')==='false')document.querySelector('[data-expand="countries"]').click()`);
  const countryAliasGroup=await evaluate(`(async()=>{
    const snapshot=await(await fetch('/api/data',{cache:'no-store'})).json();
    const rows=window.PreviewModel.buildCustomers(snapshot.data);
    const label='🇺🇸 美国';
    const expected=rows.filter(row=>window.LaiModules.bucket(snapshot.data.customers[row.name])==='active'
      &&row.orderCount>0&&window.LaiCustomerFields.countryLabel(row.country)===label).length;
    const buttons=[...document.querySelectorAll('[data-group="country:🇺🇸 美国"]')];
    return {expected,buttonCount:buttons.length,displayed:buttons[0]?.querySelector('small')?.textContent,
      rawUsButton:Boolean(document.querySelector('[data-group="country:US"]')),
      rawChineseButton:Boolean(document.querySelector('[data-group="country:美国"]'))};
  })()`);
  assert.ok(countryAliasGroup.expected>1);
  assert.deepEqual(countryAliasGroup,{expected:countryAliasGroup.expected,buttonCount:1,displayed:String(countryAliasGroup.expected),rawUsButton:false,rawChineseButton:false});
  await evaluate(`document.querySelector('[data-group="country:🇺🇸 美国"]').click()`);
  const countryAliasSelection=await evaluate(`document.querySelector('.list-heading span')?.textContent.trim()`);
  assert.equal(countryAliasSelection,`${countryAliasGroup.expected} 个客户`);
  const opportunityProbe='Lai Opportunity Count Probe';
  await evaluate(`(async()=>{
    const snapshot=await(await fetch('/api/data',{cache:'no-store'})).json();
    snapshot.data.customers[${JSON.stringify(opportunityProbe)}]={country:'US',activeOpportunityCount:3,opportunityCount:5};
    snapshot.data.orders.push({id:'lai-opportunity-count-order',client:${JSON.stringify(opportunityProbe)},amount:9000,currency:'USD',stage:'done',createdAt:'2026-09-01'});
    const response=await fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({state:{app:'laicai-lai',version:'1.4.2',data:snapshot.data},baseRevision:snapshot.revision})});
    if(!response.ok)throw Error('isolated opportunity count fixture save failed');
  })()`);
  await cdp.call('Page.navigate',{url:`${base}/trade-order-system.html?token=${encodeURIComponent(token)}#customers`});
  await waitFor(async()=>evaluate(`Boolean(document.querySelector('#search-field'))`),'opportunity count navigation');
  await evaluate(`(() => {const field=document.querySelector('#search-field');field.value='name';field.dispatchEvent(new Event('change',{bubbles:true}));
    const input=document.querySelector('#search');input.value=${JSON.stringify(opportunityProbe)};
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
  assert.equal(await evaluate(`document.querySelector('.company-link')?.textContent.trim()`),opportunityProbe);
  await evaluate(`document.querySelector('.company-link').click()`);
  const opportunityHeader=await evaluate(`({heading:document.querySelector('.lcd-opportunity .lcd-section-head h3')?.textContent.trim(),
    hasOrderAmount:document.querySelector('.lcd-opportunity')?.textContent.includes('9000')})`);
  assert.deepEqual(opportunityHeader,{heading:'⌄进行中的商机 （3）',hasOrderAmount:false});
  const opportunityFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-opportunity-count.png'),Buffer.from(opportunityFrame.data,'base64'));
  await evaluate(`document.querySelector('[data-tab="trade"]').click()`);
  const opportunityMetric=await evaluate(`([...document.querySelectorAll('.lcd-metrics > div')]
    .find(item=>item.querySelector('span')?.textContent.includes('进行中的商机数'))) ?.querySelector('strong')?.textContent`);
  assert.equal(opportunityMetric,'3');
  const emptyOpportunityProbe='Lai Empty Opportunity Probe';
  await evaluate(`(async()=>{
    const snapshot=await(await fetch('/api/data',{cache:'no-store'})).json();
    snapshot.data.customers[${JSON.stringify(emptyOpportunityProbe)}]={country:'US',activeOpportunityCount:0};
    const response=await fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({state:{app:'laicai-lai',version:'1.4.2',data:snapshot.data},baseRevision:snapshot.revision})});
    if(!response.ok)throw Error('isolated zero opportunity fixture save failed');
  })()`);
  await cdp.call('Page.navigate',{url:`${base}/trade-order-system.html?token=${encodeURIComponent(token)}#customers`});
  await waitFor(async()=>evaluate(`Boolean(document.querySelector('#search-field'))`),'zero opportunity navigation');
  await evaluate(`(() => {const field=document.querySelector('#search-field');field.value='name';field.dispatchEvent(new Event('change',{bubbles:true}));
    const input=document.querySelector('#search');input.value=${JSON.stringify(emptyOpportunityProbe)};
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
  assert.equal(await evaluate(`document.querySelector('.company-link')?.textContent.trim()`),emptyOpportunityProbe);
  await evaluate(`document.querySelector('.company-link').click()`);
  const emptyOpportunityState=await evaluate(`(()=>{const card=document.querySelector('.lcd-opportunity');return {
    heading:card?.querySelector('.lcd-section-head h3')?.textContent.trim(),
    height:card?.getBoundingClientRect().height,
    hasPlaceholderRow:Boolean(card?.querySelector('.lcd-opportunity-row, .lcd-phases')),
    hasAddButton:Boolean(card?.querySelector('[data-feature="添加商机"]')),
  }})()`);
  assert.deepEqual(emptyOpportunityState,{heading:'⌄进行中的商机 （0）',height:48,hasPlaceholderRow:false,hasAddButton:true});
  const emptyOpportunityFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-opportunity-empty.png'),Buffer.from(emptyOpportunityFrame.data,'base64'));
  const recycledProbe='Lai Recycled State Probe';
  await evaluate(`(async()=>{
    const snapshot=await(await fetch('/api/data',{cache:'no-store'})).json();
    snapshot.data.customers[${JSON.stringify(recycledProbe)}]={country:'US',contact:'Original',laiBucket:'trash',history:[]};
    const response=await fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({state:{app:'laicai-lai',version:'1.4.2',data:snapshot.data},baseRevision:snapshot.revision})});
    if(!response.ok)throw Error('isolated recycled customer fixture save failed');
  })()`);
  await cdp.call('Page.navigate',{url:`${base}/trade-order-system.html?token=${encodeURIComponent(token)}#customers`});
  await waitFor(async()=>evaluate(`Boolean(document.querySelector('[data-lai-screen="customer-settings"]'))`),'customer settings navigation');
  await evaluate(`document.querySelector('[data-lai-screen="customer-settings"]').click()`);
  await waitFor(async()=>evaluate(`Boolean(document.querySelector('[data-lai-screen="trash"]'))`),'recycle bin navigation');
  await evaluate(`document.querySelector('[data-lai-screen="trash"]').click()`);
  await waitFor(async()=>evaluate(`Boolean([...document.querySelectorAll('.module-page .company-link')].find(item=>item.textContent.trim()===${JSON.stringify(recycledProbe)}))`),'recycled customer row');
  await evaluate(`([...document.querySelectorAll('.module-page .company-link')].find(item=>item.textContent.trim()===${JSON.stringify(recycledProbe)})).click()`);
  const recycledIdentity=await evaluate(`document.querySelector('.lcd-person span')?.textContent.trim()`);
  assert.equal(recycledIdentity,'回收站');
  const recycledFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-recycled-identity.png'),Buffer.from(recycledFrame.data,'base64'));
  const recycledBefore=await evaluate(`(async()=>{const snapshot=await(await fetch('/api/data',{cache:'no-store'})).json();
    return {revision:snapshot.revision,profile:snapshot.data.customers[${JSON.stringify(recycledProbe)}]};})()`);
  await evaluate(`document.querySelector('[data-action="edit"]').click()`);
  const recycledEdit=await evaluate(`({toast:document.querySelector('#toast')?.textContent,
    drawer:Boolean(document.querySelector('#customer-form'))})`);
  assert.deepEqual(recycledEdit,{toast:'请先恢复回收站客户',drawer:false});
  await evaluate(`document.querySelector('[data-follow]').click()`);
  const recycledFollow=await evaluate(`({toast:document.querySelector('#toast')?.textContent,
    followed:document.querySelector('[data-follow]')?.classList.contains('on')})`);
  assert.deepEqual(recycledFollow,{toast:'请先恢复回收站客户',followed:false});
  await evaluate(`document.querySelector('[data-action="customer-tags"]').click()`);
  const recycledTags=await evaluate(`({toast:document.querySelector('#toast')?.textContent,
    editor:Boolean(document.querySelector('#customer-tags-form'))})`);
  assert.deepEqual(recycledTags,{toast:'请先恢复回收站客户',editor:false});
  const recycledAfter=await evaluate(`(async()=>{const snapshot=await(await fetch('/api/data',{cache:'no-store'})).json();
    return {revision:snapshot.revision,profile:snapshot.data.customers[${JSON.stringify(recycledProbe)}]};})()`);
  assert.deepEqual(recycledAfter,recycledBefore,'blocked recycled actions must not save data');
  await evaluate(`document.querySelector('[data-action="customer-actions"]').click()`);
  await evaluate(`document.querySelector('[data-customer-transition="restore"]').click()`);
  await waitFor(async()=>evaluate(`(async()=>{const snapshot=await(await fetch('/api/data',{cache:'no-store'})).json();
    return snapshot.data.customers[${JSON.stringify(recycledProbe)}]?.laiBucket==='active';})()`),'recycled customer restore');
  const recycledRestored=await evaluate(`(async()=>{const snapshot=await(await fetch('/api/data',{cache:'no-store'})).json();
    return {bucket:snapshot.data.customers[${JSON.stringify(recycledProbe)}]?.laiBucket,
      contact:snapshot.data.customers[${JSON.stringify(recycledProbe)}]?.contact};})()`);
  assert.deepEqual(recycledRestored,{bucket:'active',contact:'Original'});
  await cdp.call('Page.navigate',{url:`${base}/trade-order-system.html?token=${encodeURIComponent(token)}#customers`});
  await waitFor(async()=>evaluate(`Boolean(document.querySelector('#search-field'))`),'info accordion navigation');
  await evaluate(`(() => {const field=document.querySelector('#search-field');field.value='name';field.dispatchEvent(new Event('change',{bubbles:true}));
    const input=document.querySelector('#search');input.value=${JSON.stringify(segmentFieldProbe)};
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
  await evaluate(`document.querySelector('.company-link').click()`);
  const infoGroupBefore=await evaluate(`(() => {const section=document.querySelector('[data-info-section="company-other"]');
    const panel=section.querySelector('.lcd-info-panel');
    return {expanded:section.querySelector('button').getAttribute('aria-expanded'),
      height:panel.getBoundingClientRect().height,hidden:panel.inert};})()`);
  assert.equal(infoGroupBefore.expanded,'true');
  assert.ok(infoGroupBefore.height>50);
  await evaluate(`document.querySelector('[data-info-section="company-other"]').scrollIntoView({block:'center',behavior:'instant'})`);
  await pointerClick('[data-info-id="company-other"]');
  const infoGroupClosing=await evaluate(`(() => {const section=document.querySelector('[data-info-section="company-other"]');
    const panel=section.querySelector('.lcd-info-panel');
    return {collapsed:section.dataset.collapsed,expanded:section.querySelector('button').getAttribute('aria-expanded'),
      hidden:panel.inert,transition:getComputedStyle(panel).transitionDuration};})()`);
  assert.deepEqual(infoGroupClosing,{collapsed:'true',expanded:'false',hidden:true,transition:'0s'});
  await wait(220);
  const infoGroupClosed=await evaluate(`document.querySelector('[data-info-section="company-other"] .lcd-info-panel').getBoundingClientRect().height`);
  assert.equal(infoGroupClosed,0);
  const infoGroupFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-info-group-collapsed.png'),Buffer.from(infoGroupFrame.data,'base64'));
  await pointerClick('[data-info-id="company-other"]');
  const infoGroupOpening=await evaluate(`document.querySelector('[data-info-section="company-other"]').dataset.collapsed`);
  assert.equal(infoGroupOpening,'false');
  await wait(220);
  const infoGroupReopened=await evaluate(`document.querySelector('[data-info-section="company-other"] .lcd-info-panel').getBoundingClientRect().height`);
  assert.ok(infoGroupReopened>50);
  await pointerClick('[data-info-id="company-other"]');
  await wait(40);
  await pointerClick('[data-info-id="company-other"]');
  await wait(220);
  const infoGroupRapid=await evaluate(`(() => {const section=document.querySelector('[data-info-section="company-other"]');
    return {collapsed:section.dataset.collapsed,expanded:section.querySelector('button').getAttribute('aria-expanded'),
      height:section.querySelector('.lcd-info-panel').getBoundingClientRect().height};})()`);
  assert.equal(infoGroupRapid.collapsed,'false');
  assert.equal(infoGroupRapid.expanded,'true');
  assert.ok(infoGroupRapid.height>50);
  await evaluate(`document.querySelector('[data-info-id="followup"]').click()`);
  const infoGroupKeyboard=await evaluate(`(() => {const section=document.querySelector('[data-info-section="followup"]');
    return {collapsed:section.dataset.collapsed,motion:section.classList.contains('lcd-info-motion'),
      hidden:section.querySelector('.lcd-info-panel').inert};})()`);
  assert.deepEqual(infoGroupKeyboard,{collapsed:'true',motion:false,hidden:true});
  await evaluate(`document.querySelector('[data-tab="trade"]').click()`);
  await evaluate(`document.querySelector('[data-tab="info"]').click()`);
  const infoGroupRetained=await evaluate(`document.querySelector('[data-info-section="followup"]').dataset.collapsed`);
  assert.equal(infoGroupRetained,'true');
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await evaluate(`document.querySelector('[data-info-section="followup"]').scrollIntoView({block:'center',behavior:'instant'})`);
  await pointerClick('[data-info-id="followup"]');
  const infoGroupReduced=await evaluate(`(() => {const section=document.querySelector('[data-info-section="followup"]');
    const panel=section.querySelector('.lcd-info-panel');
    return {collapsed:section.dataset.collapsed,grid:getComputedStyle(panel).gridTemplateRows,
      transition:getComputedStyle(panel).transitionDuration,animated:panel.getAnimations().length};})()`);
  assert.equal(infoGroupReduced.collapsed,'false');
  assert.ok(Number.parseFloat(infoGroupReduced.transition)<0.001);
  assert.equal(infoGroupReduced.animated,0);
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await evaluate(`document.querySelector('.lcd-return').click()`);
  await evaluate(`(() => {const input=document.querySelector('#search');input.value=${JSON.stringify(opportunityProbe)};
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
  await evaluate(`document.querySelector('.company-link').click()`);
  const infoGroupNewCustomer=await evaluate(`([...document.querySelectorAll('[data-info-section]')]
    .map(section=>({id:section.dataset.infoSection,expanded:section.querySelector('button').getAttribute('aria-expanded')})))`);
  assert.ok(infoGroupNewCustomer.every(section=>section.expanded==='true'));
  await evaluate(`document.querySelector('.lcd-return').click()`);
  await evaluate(`(() => {const input=document.querySelector('#search');input.value=${JSON.stringify(recycledProbe)};
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
  await evaluate(`document.querySelector('.company-link').click()`);
  const detailCardsBefore=await evaluate(`Object.fromEntries(['analysis','contacts'].map(id=>{
    const card=document.querySelector('[data-detail-card="'+id+'"]'),panel=card.querySelector('.lcd-card-panel');
    return [id,{expanded:card.querySelector('[data-action="toggle-detail-card"]').getAttribute('aria-expanded'),
      height:panel.getBoundingClientRect().height}];}))`);
  assert.equal(detailCardsBefore.analysis.expanded,'true');
  assert.equal(detailCardsBefore.contacts.expanded,'true');
  assert.ok(detailCardsBefore.analysis.height>100&&detailCardsBefore.contacts.height>100);
  await pointerClick('[data-card-id="analysis"]');
  const analysisClosing=await evaluate(`(() => {const card=document.querySelector('[data-detail-card="analysis"]');
    const panel=card.querySelector('.lcd-card-panel');
    return {collapsed:card.dataset.collapsed,expanded:card.querySelector('.lcd-card-toggle').getAttribute('aria-expanded'),
      hidden:panel.inert,transition:getComputedStyle(panel).transitionDuration};})()`);
  assert.deepEqual(analysisClosing,{collapsed:'true',expanded:'false',hidden:true,transition:'0s'});
  await wait(220);
  const analysisClosed=await evaluate(`document.querySelector('#lcd-card-panel-analysis').getBoundingClientRect().height`);
  assert.equal(analysisClosed,0);
  await pointerClick('[data-card-id="contacts"]');
  await wait(220);
  const contactsClosed=await evaluate(`(() => {const card=document.querySelector('[data-detail-card="contacts"]');
    return {expanded:card.querySelector('.lcd-card-toggle').getAttribute('aria-expanded'),
      hidden:card.querySelector('.lcd-card-panel').inert,
      height:card.querySelector('.lcd-card-panel').getBoundingClientRect().height};})()`);
  assert.deepEqual(contactsClosed,{expanded:'false',hidden:true,height:0});
  const detailCardsFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-left-cards-collapsed.png'),Buffer.from(detailCardsFrame.data,'base64'));
  await pointerClick('[data-card-id="analysis"]');
  await pointerClick('[data-card-id="contacts"]');
  await wait(220);
  const detailCardsReopened=await evaluate(`Object.fromEntries(['analysis','contacts'].map(id=>{
    const panel=document.querySelector('#lcd-card-panel-'+id);
    return [id,{height:panel.getBoundingClientRect().height,hidden:panel.inert}];}))`);
  assert.ok(detailCardsReopened.analysis.height>100&&detailCardsReopened.contacts.height>100);
  assert.equal(detailCardsReopened.analysis.hidden,false);
  assert.equal(detailCardsReopened.contacts.hidden,false);
  await evaluate(`document.querySelector('[data-card-id="contacts"]').click()`);
  const contactsKeyboard=await evaluate(`(() => {const card=document.querySelector('[data-detail-card="contacts"]');
    return {collapsed:card.dataset.collapsed,motion:card.classList.contains('lcd-card-motion')};})()`);
  assert.deepEqual(contactsKeyboard,{collapsed:'true',motion:false});
  await pointerClick('[data-action="contact-search"]');
  const contactsSearchFromClosed=await evaluate(`(() => {const card=document.querySelector('[data-detail-card="contacts"]');
    return {collapsed:card.dataset.collapsed,searchVisible:!document.querySelector('.lcd-contact-search-row').hidden,
      focused:document.activeElement?.id==='contact-search-input'};})()`);
  assert.deepEqual(contactsSearchFromClosed,{collapsed:'false',searchVisible:true,focused:true});
  await contactSearchKey('Escape');
  await evaluate(`document.querySelector('[data-card-id="contacts"]').click()`);
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await pointerClick('[data-card-id="contacts"]');
  const contactsReduced=await evaluate(`(() => {const card=document.querySelector('[data-detail-card="contacts"]');
    const panel=card.querySelector('.lcd-card-panel');
    return {collapsed:card.dataset.collapsed,transition:getComputedStyle(panel).transitionDuration,animated:panel.getAnimations().length};})()`);
  assert.equal(contactsReduced.collapsed,'false');
  assert.ok(Number.parseFloat(contactsReduced.transition)<0.001);
  assert.equal(contactsReduced.animated,0);
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  const unknownGrade='Lai FX Grade Unknown', manualFxGrade='Lai FX Grade Manual';
  await evaluate(`(async () => {
    const snapshot=await(await fetch('/api/data',{cache:'no-store'})).json();
    snapshot.data.customers[${JSON.stringify(unknownGrade)}]={country:'DE',level:'自动判断'};
    snapshot.data.customers[${JSON.stringify(manualFxGrade)}]={country:'DE',level:'B级翡翠客户'};
    snapshot.data.orders.push({id:'fx-grade-unknown',client:${JSON.stringify(unknownGrade)},amount:1200,currency:'EUR',createdAt:'2026-09-01'});
    snapshot.data.orders.push({id:'fx-grade-manual',client:${JSON.stringify(manualFxGrade)},amount:1200,currency:'EUR',createdAt:'2026-09-01'});
    snapshot.data.previewTable={...(snapshot.data.previewTable||{}),order:['name','level','total'],frozen:['name']};
    const response=await fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({state:{app:'laicai-lai',version:'1.4.2',data:snapshot.data},baseRevision:snapshot.revision})});
    if(!response.ok)throw Error('isolated exchange-grade fixture save failed');
  })()`);
  await cdp.call('Page.navigate',{url:`${base}/trade-order-system.html?token=${encodeURIComponent(token)}#customers`});
  await waitFor(async()=>evaluate(`Boolean(document.querySelector('#search-field'))`),'exchange grade navigation');
  await evaluate(`(() => {const field=document.querySelector('#search-field');field.value='name';field.dispatchEvent(new Event('change',{bubbles:true}));
    const input=document.querySelector('#search');input.value='Lai FX Grade';input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
  const exchangeGrades=await evaluate(`Object.fromEntries([...document.querySelectorAll('.customer-table tbody tr')].map(tr=>[
    tr.querySelector('[data-select]')?.dataset.select,
    {badge:tr.querySelector('.level-icon')?.getAttribute('aria-label')||null,
      level:tr.querySelectorAll('td')[2]?.textContent.trim(),amount:tr.querySelectorAll('td')[3]?.textContent.trim()}
  ]))`);
  assert.deepEqual(exchangeGrades[unknownGrade],{badge:null,level:'—',amount:'—'});
  assert.deepEqual(exchangeGrades[manualFxGrade],{badge:'客户等级：B级翡翠客户',level:'B级翡翠客户',amount:'—'});
  const exchangeFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-unconverted-grade.png'),Buffer.from(exchangeFrame.data,'base64'));
  await evaluate(`[...document.querySelectorAll('.customer-table .company-link')].find(link=>link.textContent.trim()===${JSON.stringify(unknownGrade)}).click()`);
  await evaluate(`(() => {document.querySelector('[data-action="summary-fields"]').click();
    const form=document.querySelector('#summary-fields-form');form.querySelectorAll('[name="summaryField"]').forEach(input=>{input.checked=input.value==='level'});
    form.requestSubmit();})()`);
  await waitFor(async()=>evaluate(`document.querySelectorAll('.lcd-summary-fields dt').length===1`),'exchange grade summary selected');
  const exchangeDetailGrade=await evaluate(`document.querySelector('.lcd-summary-fields dd')?.textContent.trim()`);
  assert.equal(exchangeDetailGrade,'—');
  const clearFieldsCustomer='Lai Contact Mapping Probe';
  await evaluate(`(async()=>{
    const snapshot=await(await fetch('/api/data',{cache:'no-store'})).json();
    snapshot.data.customers[${JSON.stringify(clearFieldsCustomer)}]={country:'US',source:'Acceptance',
      contact:'Main',contacts:['Main','Other'],email:'main@example.test',emails:['main@example.test','other@example.test'],
      phone:'111',phones:['111','222'],address:'Main address',addresses:['Main address','Other address'],
      extraContacts:[{id:'other',contact:'Other',email:'other@example.test',phone:'222',address:'Other address'}],
      mainProducts:'Legacy lashes',cardPaper:'Legacy card','定制盒':'Legacy box'};
    const response=await fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({state:{app:'laicai-lai',version:'1.4.2',data:snapshot.data},baseRevision:snapshot.revision})});
    if(!response.ok)throw Error('isolated contact mapping fixture save failed');
  })()`);
  await cdp.call('Page.navigate',{url:`${base}/trade-order-system.html?token=${encodeURIComponent(token)}#customers`});
  await waitFor(async()=>evaluate(`Boolean(document.querySelector('#search-field'))`),'contact mapping navigation');
  await evaluate(`(() => {const field=document.querySelector('#search-field');field.value='name';field.dispatchEvent(new Event('change',{bubbles:true}));
    const input=document.querySelector('#search');input.value=${JSON.stringify(clearFieldsCustomer)};
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
  await evaluate(`document.querySelector('.customer-table .company-link').click()`);
  const legacyCompanyDetail=await evaluate(`document.querySelector('[data-info-section="company-other"] .lcd-info-fields')?.textContent`);
  assert.ok(legacyCompanyDetail.includes('Legacy lashes')&&legacyCompanyDetail.includes('Legacy card')&&legacyCompanyDetail.includes('Legacy box'));
  await evaluate(`document.querySelector('.lcd-pagebar [data-action="edit"]').click()`);
  const legacyCompanyEditor=await evaluate(`(() => {const form=document.querySelector('#customer-form');
    return {products:form.elements.companyProducts.value,card:form.elements.cardStock.value,box:form.elements.customBox.value};})()`);
  assert.deepEqual(legacyCompanyEditor,{products:'Legacy lashes',card:'Legacy card',box:'Legacy box'});
  await evaluate(`(() => {const form=document.querySelector('#customer-form');
    for(const field of ['contact','email','phone','address','companyProducts','cardStock','customBox'])form.elements[field].value='';
    form.requestSubmit(document.querySelector('.drawer.customer-editor [form="customer-form"][value="save"]'));})()`);
  await waitFor(async()=>evaluate(`!document.querySelector('#customer-form')`),'contact field clearing saved');
  const clearedContactFields=await evaluate(`(async()=>{
    const profile=(await(await fetch('/api/data',{cache:'no-store'})).json()).data.customers[${JSON.stringify(clearFieldsCustomer)}];
    const other=document.querySelector('[data-info-section="company-other"] .lcd-info-fields')?.textContent||'';
    return {primary:[profile.contact,profile.email,profile.phone,profile.address],
      second:[profile.contacts[1],profile.emails[1],profile.phones[1],profile.addresses[1]],
      firstSlots:[profile.contacts[0],profile.emails[0],profile.phones[0],profile.addresses[0]],
      optional:[profile.companyProducts,profile.cardStock,profile.customBox],
      detailCleared:!other.includes('Legacy'),secondContact:document.querySelectorAll('.lcd-contact')[1]?.textContent.includes('other@example.test')};
  })()`);
  assert.deepEqual(clearedContactFields,{primary:['','','',''],second:['Other','other@example.test','222','Other address'],
    firstSlots:['','','',''],optional:['','',''],detailCleared:true,secondContact:true});
  const clearedContactFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-cleared-contact-fields.png'),Buffer.from(clearedContactFrame.data,'base64'));
  const scheduleA='Lai Batch Schedule Probe A',scheduleB='Lai Batch Schedule Probe B';
  await evaluate(`(async()=>{
    const snapshot=await(await fetch('/api/data',{cache:'no-store'})).json();
    snapshot.data.customers[${JSON.stringify(scheduleA)}]={country:'US',source:'Acceptance',nextFollow:'2030-10-01'};
    snapshot.data.customers[${JSON.stringify(scheduleB)}]={country:'US',source:'Acceptance',nextFollow:'2030-11-01'};
    const response=await fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({state:{app:'laicai-lai',version:'1.4.2',data:snapshot.data},baseRevision:snapshot.revision})});
    if(!response.ok)throw Error('isolated batch schedule fixture save failed');
  })()`);
  await cdp.call('Page.navigate',{url:`${base}/trade-order-system.html?token=${encodeURIComponent(token)}#customers`});
  await waitFor(async()=>evaluate(`Boolean(document.querySelector('#search-field'))`),'batch schedule navigation');
  await evaluate(`(() => {const field=document.querySelector('#search-field');field.value='name';field.dispatchEvent(new Event('change',{bubbles:true}));
    const input=document.querySelector('#search');input.value='Lai Batch Schedule Probe';
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
  assert.equal(await evaluate(`document.querySelectorAll('.customer-table [data-select]').length`),2);
  await evaluate(`document.querySelector('.customer-table [data-select="${scheduleA}"]').click()`);
  await evaluate(`document.querySelector('.customer-table [data-select="${scheduleB}"]').click()`);
  await pointerClick('[data-action="batch-schedule"]');
  const batchScheduleDrawer=await evaluate(`({open:!!document.querySelector('#batch-schedule-form'),
    count:document.querySelector('.batch-schedule-form .batch-tags-count')?.textContent.trim(),
    motion:document.querySelector('#overlay-root .overlay')?.classList.contains('modal-motion')})`);
  assert.deepEqual(batchScheduleDrawer,{open:true,count:'为 2 位客户安排下次跟进',motion:true});
  await wait(340);
  const settledBatchSchedule=await evaluate(`(() => {const rect=document.querySelector('#overlay-root .drawer').getBoundingClientRect();
    return {left:rect.left,right:rect.right,width:rect.width};})()`);
  assert.ok(settledBatchSchedule.width>=340&&settledBatchSchedule.width<=420);
  assert.ok(settledBatchSchedule.left>=0&&settledBatchSchedule.right<=1756,JSON.stringify(settledBatchSchedule));
  const batchScheduleFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-batch-schedule-drawer.png'),Buffer.from(batchScheduleFrame.data,'base64'));
  await evaluate(`document.querySelector('.drawer [data-action="close-modal"]').click()`);
  const batchScheduleCancelled=await evaluate(`(async()=>{
    const data=(await(await fetch('/api/data',{cache:'no-store'})).json()).data;
    return {selected:document.querySelector('.replica-batch b')?.textContent,
      dates:[${JSON.stringify(scheduleA)},${JSON.stringify(scheduleB)}].map(name=>data.customers[name]?.nextFollow)};
  })()`);
  assert.deepEqual(batchScheduleCancelled,{selected:'2',dates:['2030-10-01','2030-11-01']});
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await pointerClick('[data-action="batch-schedule"]');
  const reducedBatchSchedule=await evaluate(`(() => {const style=getComputedStyle(document.querySelector('#overlay-root .drawer'));
    return {transform:style.transform,duration:style.transitionDuration};})()`);
  assert.deepEqual(reducedBatchSchedule,{transform:'none',duration:'0.08s'});
  await pointerClick('#overlay-root [data-action="close-modal"]');
  await waitFor(async()=>evaluate(`!document.querySelector('#batch-schedule-form')`),'reduced batch schedule close');
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await evaluate(`document.querySelector('[data-action="batch-schedule"]').click()`);
  const batchScheduleKeyboard=await evaluate(`({open:!!document.querySelector('#batch-schedule-form'),
    motion:document.querySelector('#overlay-root .overlay')?.classList.contains('modal-motion')})`);
  assert.deepEqual(batchScheduleKeyboard,{open:true,motion:false});
  await evaluate(`(() => {const form=document.querySelector('#batch-schedule-form');form.elements.date.value='2030-12-15';form.requestSubmit();})()`);
  await waitFor(async()=>evaluate(`!document.querySelector('#batch-schedule-form')&&!document.querySelector('.replica-batch')`),'batch schedule saved');
  const batchScheduleSaved=await evaluate(`(async()=>{
    const data=(await(await fetch('/api/data',{cache:'no-store'})).json()).data;
    return [${JSON.stringify(scheduleA)},${JSON.stringify(scheduleB)}].map(name=>({
      date:data.customers[name]?.nextFollow,operation:data.customers[name]?.history?.[0]?.type,
      completed:data.customers[name]?.lastFollowup||null}));
  })()`);
  assert.deepEqual(batchScheduleSaved,[{date:'2030-12-15',operation:'operation',completed:null},{date:'2030-12-15',operation:'operation',completed:null}]);
  await evaluate(`(() => {const owner=document.querySelector('#customer-owner');owner.value='Kris';
    owner.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  assert.equal(await evaluate(`[...document.querySelectorAll('.customer-table [data-select]')].some(input=>input.dataset.select===${JSON.stringify(scheduleA)})`),false);
  await evaluate(`document.querySelector('[data-lai-route="calendar"]').click()`);
  await waitFor(async()=>evaluate(`!document.querySelector('#customer-owner')`),'global search from calendar');
  await evaluate(`document.querySelector('[data-action="global-search-scope"]').click()`);
  const keyboardScope=await evaluate(`({focus:document.activeElement?.dataset.globalCategory,
    animation:getComputedStyle(document.querySelector('.global-search-scope-menu')).animationName})`);
  assert.deepEqual(keyboardScope,{focus:'客户',animation:'none'});
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  assert.equal(await evaluate(`document.activeElement===document.querySelector('[data-action="global-search-scope"]')`),true);
  await pointerClick('[data-action="global-search-scope"]');
  const pointerScope=await evaluate(`(() => {const box=document.querySelector('.global-search-scope-menu'),style=getComputedStyle(box);
    return {animation:style.animationName,origin:style.transformOrigin,duration:style.transitionDuration};})()`);
  assert.deepEqual(pointerScope,{animation:'none',origin:'0px 0px',duration:'0.3s, 0.3s'});
  await pointerClick('[data-action="global-search-scope"]');
  assert.equal(await evaluate(`document.querySelector('.global-search-scope-menu').inert`),true);
  await waitFor(async()=>evaluate(`!document.querySelector('.global-search-scope-menu')`),'source search menu closing');
  assert.deepEqual(await evaluate(`({open:!!document.querySelector('.global-search-scope-menu'),expanded:document.querySelector('[data-action="global-search-scope"]').getAttribute('aria-expanded')})`),{open:false,expanded:'false'});
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await pointerClick('[data-action="global-search-scope"]');
  const reducedScope=await evaluate(`({animation:getComputedStyle(document.querySelector('.global-search-scope-menu')).animationName,
    active:document.querySelector('.global-search-scope-menu').getAnimations().length})`);
  assert.deepEqual(reducedScope,{animation:'none',active:0});
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await pointerClick('[data-action="global-search-scope"]');
  const globalScopeMenu=await evaluate(`({categories:[...document.querySelectorAll('.global-search-scope-menu [data-global-category]')].map(el=>el.textContent.trim()),
    fields:[...document.querySelectorAll('.global-search-scope-menu [data-global-field]')].map(el=>el.textContent.trim())})`);
  assert.deepEqual(globalScopeMenu.categories,['邮件','客户','线索','商机','成员','日程']);
  assert.deepEqual(globalScopeMenu.fields,['全部','客户名称/简称','公司备注','简称','客户编号','邮箱','联系人名称','主页','联系电话','社交账号']);
  await waitFor(async()=>evaluate(`!document.querySelector('.global-search-scope-menu')?.getAnimations().some(animation=>animation.playState==='running')`),'settled global search scope menu');
  const globalScopeFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-global-search-scope.png'),Buffer.from(globalScopeFrame.data,'base64'));
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  assert.deepEqual(await evaluate(`({open:!!document.querySelector('.global-search-scope-menu'),expanded:document.querySelector('[data-action="global-search-scope"]').getAttribute('aria-expanded')})`),{open:false,expanded:'false'});
  await evaluate(`document.querySelector('[data-action="global-search-scope"]').click()`);
  await evaluate(`document.querySelector('[data-global-field="nameOrShort"]').click()`);
  await evaluate(`(() => {const form=document.querySelector('#global-search-form');form.elements.query.value=${JSON.stringify(scheduleA)};
    form.requestSubmit();})()`);
  await waitFor(async()=>evaluate(`Boolean(document.querySelector('#customer-owner'))`),'global customer search result');
  const globalCustomerSearch=await evaluate(`({names:[...document.querySelectorAll('.customer-table [data-select]')].map(input=>input.dataset.select),
    field:document.querySelector('#search-field')?.value,owner:document.querySelector('#customer-owner')?.value,
    query:document.querySelector('#search')?.value,scope:document.querySelector('[data-action="global-search-scope"]')?.textContent.trim(),
    globalQuery:document.querySelector('#global-search-form [name="query"]')?.value,
    team:document.querySelector('[data-team="team"]')?.classList.contains('active')})`);
  assert.deepEqual(globalCustomerSearch,{names:[scheduleA],field:'name',owner:'',query:'',scope:'客户名称/简称 ⌄',globalQuery:scheduleA,team:true});
  const globalSearchFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-global-search.png'),Buffer.from(globalSearchFrame.data,'base64'));
  await evaluate(`document.querySelector('[data-action="global-search-scope"]').click()`);
  await evaluate(`document.querySelector('[data-global-field="customerCode"]').click()`);
  await evaluate(`document.querySelector('#global-search-form').requestSubmit()`);
  await waitFor(async()=>evaluate(`document.querySelector('.customer-table [data-select]')===null`),'customer code excludes name-only result');
  assert.equal(await evaluate(`document.querySelector('[data-action="global-search-scope"]')?.textContent.trim()`),'客户编号 ⌄');
  const globalCodeEmpty=await evaluate(`({message:document.querySelector('.global-search-empty > span')?.textContent,
    actions:[...document.querySelectorAll('.global-search-empty-actions button')].map(button=>button.textContent.trim()),
    quickFolder:!!document.querySelector('.table-wrap .empty-box')})`);
  assert.deepEqual(globalCodeEmpty,{message:'Hi~ 马上添加客户，体验先进的客户管理系统吧',actions:['新建客户','导入客户'],quickFolder:false});
  const globalCodeEmptyFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-global-code-empty.png'),Buffer.from(globalCodeEmptyFrame.data,'base64'));
  assert.equal(await evaluate(`!!document.querySelector('.global-search-empty [data-action="import-customers"]')`),true);
  await evaluate(`document.querySelector('.global-search-empty [data-action="import-customers"]').click()`);
  assert.equal(await evaluate(`document.querySelector('.drawer.customer-import')?.getAttribute('aria-label')`),'导入客户');
  const importStartFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-import-upload.png'),Buffer.from(importStartFrame.data,'base64'));
  await evaluate(`(() => {const input=document.querySelector('#customer-import-file');const transfer=new DataTransfer();
    transfer.items.add(new File(['公司名称,国家地区,邮箱,客户标签\\nImport Smoke,法国,smoke@example.test,VIP'], 'smoke.csv',{type:'text/csv'}));
    input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitFor(async()=>evaluate(`document.querySelector('[data-import-file-ready]')?.textContent.includes('1 行')`),'import file parsed');
  await pointerClick('[data-action="import-next"]');
  assert.equal(await evaluate(`document.querySelector('.import-step-active')?.textContent.trim()`),'2 匹配字段');
  assert.deepEqual(await evaluate(`(() => {const body=document.querySelector('.import-step-body');
    return {motion:body.classList.contains('import-step-motion'),duration:getComputedStyle(body).animationDuration};})()`),
    {motion:true,duration:'0.16s'});
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await pointerClick('[data-action="import-back"]');
  assert.deepEqual(await evaluate(`(() => {const body=document.querySelector('.import-step-body');
    return {step:document.querySelector('.import-step-active')?.textContent.trim(),
      name:getComputedStyle(body).animationName,duration:getComputedStyle(body).animationDuration};})()`),
    {step:'1 上传文件',name:'lai-import-step-fade',duration:'0.08s'});
  await pointerClick('[data-action="import-next"]');
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  const importMappingFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-import-mapping.png'),Buffer.from(importMappingFrame.data,'base64'));
  await evaluate(`(() => {const select=document.querySelector('[data-import-column="0"]');select.focus();
    select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  assert.equal(await evaluate(`document.activeElement?.dataset.importColumn`),'0');
  await evaluate(`document.querySelector('[data-action="import-next"]').click()`);
  assert.equal(await evaluate(`document.querySelector('[data-import-preview]')?.textContent.includes('Import Smoke')`),true);
  assert.equal(await evaluate(`document.querySelector('.import-step-body').classList.contains('import-step-motion')`),false);
  assert.equal(await evaluate(`(async()=>{const data=(await(await fetch('/api/data',{cache:'no-store'})).json()).data;
    return Boolean(data.customers['Import Smoke']);})()`),false);
  await evaluate(`document.querySelector('[data-action="import-save"]').click()`);
  await waitFor(async()=>evaluate(`document.querySelector('[data-import-result]')?.textContent.includes('成功新建 1')`),'import saved');
  const importedCustomer=await evaluate(`(async()=>{const data=(await(await fetch('/api/data',{cache:'no-store'})).json()).data;
    return {country:data.customers['Import Smoke']?.country,email:data.customers['Import Smoke']?.email,
      tags:data.customers['Import Smoke']?.tags};})()`);
  assert.deepEqual(importedCustomer,{country:'法国',email:'smoke@example.test',tags:['VIP']});
  assert.equal(await evaluate(`document.querySelector('.customer-import .import-records-link')?.textContent.trim()`),'导入记录');
  const importResultFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-import-result.png'),Buffer.from(importResultFrame.data,'base64'));
  await evaluate(`document.querySelector('.drawer.customer-import [data-action="close-modal"]').click()`);
  await evaluate(`document.querySelector('.global-search-empty [data-action="import-customers"]').click()`);
  await evaluate(`(() => {const input=document.querySelector('#customer-import-file');const transfer=new DataTransfer();
    transfer.items.add(new File(['公司名称,邮箱\\nImport Smoke,smoke@example.test'], 'duplicate.csv',{type:'text/csv'}));
    input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitFor(async()=>evaluate(`document.querySelector('[data-import-file-ready]')?.textContent.includes('1 行')`),'duplicate import file parsed');
  await evaluate(`document.querySelector('[data-action="import-next"]').click()`);
  await evaluate(`document.querySelector('[data-action="import-next"]').click()`);
  await evaluate(`document.querySelector('[data-action="import-save"]').click()`);
  await waitFor(async()=>evaluate(`document.querySelector('[data-import-result]')?.textContent.includes('跳过 1')`),'duplicate import saved');
  assert.equal(await evaluate(`document.querySelector('.import-issue-list')?.textContent.includes('同名客户已存在')`),true);
  assert.equal(await evaluate(`!!document.querySelector('[data-action="import-failure-log"]')`),true);
  assert.deepEqual(await evaluate(`(async()=>{const data=(await(await fetch('/api/data',{cache:'no-store'})).json()).data;
    const log=await(await fetch('/api/import-log?id='+encodeURIComponent(data.laiImportHistory[0].id))).json();
    return {records:data.laiImportHistory?.length,skipped:data.laiImportHistory?.[0]?.result.skipped,
      reason:log.issues?.[0]?.reason};})()`),
    {records:2,skipped:1,reason:'同名客户已存在'});
  const importDownloadDir=path.join(temporary,'import-downloads');
  fs.mkdirSync(importDownloadDir);
  await cdp.call('Page.setDownloadBehavior',{behavior:'allow',downloadPath:importDownloadDir});
  await evaluate(`document.querySelector('.import-issue-head [data-action="import-failure-log"]').click()`);
  const failureLog=path.join(importDownloadDir,'来财客户导入失败日志.csv');
  await waitFor(async()=>fs.existsSync(failureLog),'import failure log download');
  assert.equal(fs.readFileSync(failureLog,'utf8').includes('同名客户已存在'),true);
  await waitFor(async()=>evaluate(`!document.querySelector('#toast')?.classList.contains('show')`),'import toast clear');
  const importSkippedFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-import-skipped.png'),Buffer.from(importSkippedFrame.data,'base64'));
  await evaluate(`document.querySelector('.import-records-link').click()`);
  assert.equal(await evaluate(`document.querySelector('.drawer.customer-import-records')?.getAttribute('aria-label')`),'客户导入记录');
  assert.deepEqual(await evaluate(`({count:document.querySelectorAll('.import-records-table tbody tr').length,
    skipped:document.querySelector('.import-records-table tbody tr')?.textContent.includes('导入失败：1'),
    log:!!document.querySelector('.import-records-table [data-action="import-failure-log"]')})`),
    {count:2,skipped:true,log:true});
  const importRecordsFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-import-records.png'),Buffer.from(importRecordsFrame.data,'base64'));
  const historyDownloadDir=path.join(temporary,'history-downloads');
  fs.mkdirSync(historyDownloadDir);
  await cdp.call('Page.setDownloadBehavior',{behavior:'allow',downloadPath:historyDownloadDir});
  await evaluate(`document.querySelector('.import-records-table [data-action="import-failure-log"]').click()`);
  const historicalLog=path.join(historyDownloadDir,'来财客户导入失败日志.csv');
  await waitFor(async()=>fs.existsSync(historicalLog),'historical failure log download');
  assert.equal(fs.readFileSync(historicalLog,'utf8').includes('同名客户已存在'),true);
  await evaluate(`document.querySelector('.drawer.customer-import-records [data-action="close-modal"]').click()`);
  await evaluate(`document.querySelector('.global-search-empty [data-action="new"]').click()`);
  assert.equal(await evaluate(`!!document.querySelector('.drawer.customer-editor #customer-form')`),true);
  await evaluate(`document.querySelector('.drawer.customer-editor [data-action="close-modal"]').click()`);
  assert.equal(await evaluate(`(async()=>{const snapshot=await(await fetch('/api/data',{cache:'no-store'})).json();
    const extra=Array.from({length:20},(_,i)=>({id:crypto.randomUUID(),time:new Date().toISOString(),
      fileName:'history-'+i+'.csv',destination:'active',expected:0,result:{created:0,updated:0,skipped:0}}));
    const response=await fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({state:{app:'laicai-lai',version:'1.4.2',data:{...snapshot.data,
        laiImportHistory:[...snapshot.data.laiImportHistory,...extra]}},baseRevision:snapshot.revision})});
    return response.ok;})()`),true);
  await cdp.call('Page.reload');
  await waitFor(async()=>evaluate(`!!document.querySelector('[data-action="create-menu"]')`),'customer list reload');
  await evaluate(`document.querySelector('[data-action="create-menu"]').click()`);
  await evaluate(`document.querySelector('[data-action="import-customers"]').click()`);
  await evaluate(`document.querySelector('.import-records-link').click()`);
  assert.deepEqual(await evaluate(`({rows:document.querySelectorAll('.import-records-table tbody tr').length,
    pages:document.querySelector('.import-record-pages > div')?.textContent.trim()})`),
    {rows:20,pages:'‹1 / 2›'});
  await evaluate(`document.querySelector('[data-page-delta="1"]').click()`);
  assert.equal(await evaluate(`document.querySelectorAll('.import-records-table tbody tr').length`),2);
  assert.equal(await evaluate(`document.querySelector('.import-record-pages > div')?.textContent.trim()`),'‹2 / 2›');
  assert.equal(await evaluate(`window.XLSX?.version`),'0.20.3');
  await evaluate(`document.querySelector('.customer-import-records [data-action="close-modal"]').click()`);
  for(const [bookType,extension,name,phone] of [['xlsx','xlsx','Excel XLSX Smoke','0012345'],['biff8','xls','Excel XLS Smoke','0012346']]) {
    await evaluate(`document.querySelector('[data-action="create-menu"]').click()`);
    await evaluate(`document.querySelector('[data-action="import-customers"]').click()`);
    await evaluate(`(() => {const workbook=XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([
        ['公司名称','国家地区','联系电话'],[${JSON.stringify(name)},'法国',${JSON.stringify(phone)}]]),'客户');
      const bytes=XLSX.write(workbook,{type:'array',bookType:${JSON.stringify(bookType)}});
      const input=document.querySelector('#customer-import-file'),transfer=new DataTransfer();
      transfer.items.add(new File([bytes],${JSON.stringify('sample.'+extension)}));
      input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await waitFor(async()=>evaluate(`document.querySelector('[data-import-file-ready]')?.textContent.includes('1 行')`),bookType+' file parsed');
    await evaluate(`document.querySelector('[data-action="import-next"]').click()`);
    assert.equal(await evaluate(`document.querySelector('[data-import-column="0"]')?.value`),'name');
    await evaluate(`document.querySelector('[data-action="import-next"]').click()`);
    assert.equal(await evaluate(`document.querySelector('[data-import-preview]')?.textContent.includes(${JSON.stringify(name)})`),true);
    await evaluate(`document.querySelector('[data-action="import-save"]').click()`);
    await waitFor(async()=>evaluate(`document.querySelector('[data-import-result]')?.textContent.includes('成功新建 1')`),bookType+' import saved');
    assert.equal(await evaluate(`(async()=>{const data=(await(await fetch('/api/data',{cache:'no-store'})).json()).data;
      return data.customers[${JSON.stringify(name)}]?.phone;})()`),phone);
    await evaluate(`document.querySelector('.customer-import [data-action="close-modal"]').click()`);
  }
  await evaluate(`document.querySelector('[data-action="create-menu"]').click()`);
  await evaluate(`document.querySelector('[data-action="import-customers"]').click()`);
  await evaluate(`(() => {const book=XLSX.utils.book_new(),headers=LaiCustomerImport.templateHeaders;
    const row=(name,email,position,gender)=>headers.map(header=>({
      '公司名称':'Template Group Smoke','联系人昵称':name,'联系人邮箱':email,
      '公司简称':'TGS','国家地区':'法国','标签':'重点;展会','座机':'001-888',
      '详细地址':'Paris','公司备注':'Blue box','联系人电话':name==='Ana'?'0012347':'0012348',
      'Facebook':name==='Ana'?'https://facebook.test/ana':'',
      'LinkedIn':name==='Ben'?'https://linkedin.test/ben':'',
      '职位':position,'性别':gender,'联系人备注':name+' note',
    })[header]||'');
    XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([headers,row('Ana','ana@template.test','Buyer','女'),
      row('Ben','ben@template.test','Manager','男')]),'客户');
    const input=document.querySelector('#customer-import-file'),transfer=new DataTransfer();
    transfer.items.add(new File([XLSX.write(book,{type:'array',bookType:'xlsx'})],'official-shape.xlsx'));
    input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitFor(async()=>evaluate(`document.querySelector('[data-import-file-ready]')?.textContent.includes('2 行')`),'official-shape template parsed');
  await evaluate(`document.querySelector('[data-action="import-next"]').click()`);
  assert.deepEqual(await evaluate(`['1','2','3','15','17','18','19','20'].map(index=>document.querySelector('[data-import-column="'+index+'"]')?.value)`),
    ['contact','email','shortName','facebook','linkedin','contactTitle','contactGender','contactNote']);
  await evaluate(`document.querySelector('[data-action="import-next"]').click()`);
  assert.equal(await evaluate(`document.querySelectorAll('[data-import-preview] tbody tr').length`),2);
  await evaluate(`document.querySelector('[data-action="import-save"]').click()`);
  await waitFor(async()=>evaluate(`document.querySelector('[data-import-result]')?.textContent.includes('新增联系人 1')`),'two contacts imported');
  assert.deepEqual(await evaluate(`(async()=>{const data=(await(await fetch('/api/data',{cache:'no-store'})).json()).data;
    const customer=data.customers['Template Group Smoke'];return {shortName:customer?.shortName,
      tags:customer?.tags,contacts:customer?.contacts,emails:customer?.emails,
      companyRemark:customer?.companyRemark,secondTitle:customer?.extraContacts?.[0]?.contactTitle};})()`),{
    shortName:'TGS',tags:['重点','展会'],contacts:['Ana','Ben'],
    emails:['ana@template.test','ben@template.test'],companyRemark:'Blue box',secondTitle:'Manager',
  });
  await evaluate(`document.querySelector('.customer-import [data-action="close-modal"]').click()`);
  await evaluate(`document.querySelector('[data-action="create-menu"]').click()`);
  await evaluate(`document.querySelector('[data-action="import-customers"]').click()`);
  const templateDownloadDir=path.join(temporary,'template-downloads');
  fs.mkdirSync(templateDownloadDir);
  await cdp.call('Page.setDownloadBehavior',{behavior:'allow',downloadPath:templateDownloadDir});
  await evaluate(`document.querySelector('[data-action="import-template"]').click()`);
  const templateFile=path.join(templateDownloadDir,'来财客户导入模板.xlsx');
  await waitFor(async()=>fs.existsSync(templateFile),'XLSX template download');
  assert.equal(fs.readFileSync(templateFile).subarray(0,2).toString(),'PK');
  const templateBook=XLSX.read(fs.readFileSync(templateFile),{type:'buffer'});
  assert.deepEqual(XLSX.utils.sheet_to_json(templateBook.Sheets[templateBook.SheetNames[0]],
    {header:1,raw:false})[0],[
    '公司名称','联系人昵称','联系人邮箱','公司简称','国家地区','标签','客户阶段',
    '客户来源','公司网址','座机','详细地址','公司备注','客户编号','公海分组',
    '联系人电话','Facebook','Twitter','LinkedIn','职位','性别','联系人备注',
  ]);
  assert.equal(await evaluate(`document.querySelector('.import-dropzone')?.textContent.includes('粘贴')`),true);
  await evaluate(`(() => {const input=document.querySelector('.import-dropzone');input.focus();
    const transfer=new DataTransfer();transfer.items.add(new File(['公司名称,联系人昵称,联系人邮箱\\nPaste Test,Ana,ana@paste.test'], 'pasted.csv',{type:'text/csv'}));
    input.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:transfer}));})()`);
  await waitFor(async()=>evaluate(`document.querySelector('[data-import-file-ready]')?.textContent.includes('pasted.csv')`),'pasted customer file parsed');
  const blankContactCustomer='Lai Blank Contact Slot Acceptance';
  await evaluate(`(async()=>{
    const snapshot=await(await fetch('/api/data',{cache:'no-store'})).json();
    snapshot.data.customers[${JSON.stringify(blankContactCustomer)}]={contact:'Stale name',contacts:[''],
      email:'stale@example.test',emails:[''],phone:'999',phones:[''],address:'Stale address',addresses:['']};
    const response=await fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({state:{app:'laicai-lai',version:'1.4.2',data:snapshot.data},baseRevision:snapshot.revision})});
    if(!response.ok)throw Error('isolated blank contact fixture save failed');
  })()`);
  await cdp.call('Page.navigate',{url:`${base}/trade-order-system.html?token=${encodeURIComponent(token)}#customers`});
  await waitFor(async()=>evaluate(`Boolean(document.querySelector('.customer-table .company-link'))`),'blank contact customer list');
  await evaluate(`(()=>{const field=document.querySelector('#search-field');field.value='name';field.dispatchEvent(new Event('change',{bubbles:true}));
    const input=document.querySelector('#search');input.value=${JSON.stringify(blankContactCustomer)};
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
  await waitFor(async()=>evaluate(`document.querySelector('.customer-table .company-link')?.textContent.trim()===${JSON.stringify(blankContactCustomer)}`),'blank contact customer filtered');
  await pointerClick('.customer-table .company-link');
  await waitFor(async()=>evaluate(`document.querySelector('#contact-count-label')?.textContent.trim()==='联系人(0)'`),'blank contact detail');
  const blankContactDetail=await evaluate(`(()=>({count:document.querySelector('#contact-count-label')?.textContent.trim(),
    cards:document.querySelectorAll('.lcd-contact').length,
    empty:document.querySelector('.lcd-contacts .lcd-empty')?.textContent.trim(),
    stale:document.querySelector('.lcd-contacts')?.textContent.includes('stale@example.test')}))()`);
  assert.deepEqual(blankContactDetail,{count:'联系人(0)',cards:0,empty:'暂无联系人',stale:false});
  const blankContactFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-blank-contact.png'),Buffer.from(blankContactFrame.data,'base64'));
  await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:720,deviceScaleFactor:1,mobile:false});
  const blankContactCompact=await evaluate(`(()=>{const card=document.querySelector('.lcd-contacts');const rect=card?.getBoundingClientRect();
    return {width:innerWidth,count:document.querySelector('#contact-count-label')?.textContent.trim(),
      cards:document.querySelectorAll('.lcd-contact').length,withinViewport:!!rect&&rect.left>=0&&rect.right<=innerWidth};})()`);
  assert.deepEqual(blankContactCompact,{width:1100,count:'联系人(0)',cards:0,withinViewport:true});
  const blankContactCompactFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-blank-contact-1100.png'),Buffer.from(blankContactCompactFrame.data,'base64'));
  await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:1022,deviceScaleFactor:1,mobile:false});
  const alignedContactCustomer='Lai Aligned Contact Methods Acceptance';
  await evaluate(`(async()=>{
    const snapshot=await(await fetch('/api/data',{cache:'no-store'})).json();
    snapshot.data.customers[${JSON.stringify(alignedContactCustomer)}]={contacts:[''],emails:['','second@example.test'],
      phones:['','222'],addresses:['','Berlin']};
    const response=await fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({state:{app:'laicai-lai',version:'1.4.2',data:snapshot.data},baseRevision:snapshot.revision})});
    if(!response.ok)throw Error('isolated aligned contact fixture save failed');
  })()`);
  await cdp.call('Page.navigate',{url:`${base}/trade-order-system.html?token=${encodeURIComponent(token)}#customers`});
  await waitFor(async()=>evaluate(`Boolean(document.querySelector('.customer-table .company-link'))`),'aligned contact customer list');
  await evaluate(`(()=>{const field=document.querySelector('#search-field');field.value='name';field.dispatchEvent(new Event('change',{bubbles:true}));
    const input=document.querySelector('#search');input.value=${JSON.stringify(alignedContactCustomer)};
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
  await waitFor(async()=>evaluate(`document.querySelector('.customer-table .company-link')?.textContent.trim()===${JSON.stringify(alignedContactCustomer)}`),'aligned contact customer filtered');
  await pointerClick('.customer-table .company-link');
  await waitFor(async()=>evaluate(`document.querySelector('#contact-count-label')?.textContent.trim()==='联系人(2)'`),'aligned contact detail');
  const alignedContactDetail=await evaluate(`(()=>{const cards=[...document.querySelectorAll('.lcd-contact')];
    return {count:document.querySelector('#contact-count-label')?.textContent.trim(),cards:cards.length,
      mainClean:!cards[0]?.textContent.includes('second@example.test')&&!cards[0]?.textContent.includes('Berlin'),
      secondIndex:cards[1]?.dataset.contactIndex,
      secondEmail:cards[1]?.textContent.includes('second@example.test'),
      secondPhone:cards[1]?.textContent.includes('222'),secondAddress:cards[1]?.textContent.includes('Berlin')};})()`);
  assert.deepEqual(alignedContactDetail,{count:'联系人(2)',cards:2,mainClean:true,secondIndex:'1',
    secondEmail:true,secondPhone:true,secondAddress:true});
  await evaluate(`document.querySelector('.lcd-contact[data-contact-index="1"]').scrollIntoView({block:'center',behavior:'instant'})`);
  const alignedDetailFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-aligned-secondary-contact.png'),Buffer.from(alignedDetailFrame.data,'base64'));
  await evaluate(`document.querySelector('[data-contact-more="1"]').click()`);
  await waitFor(async()=>evaluate(`Boolean(document.querySelector('.contact-menu [data-edit-contact="1"]'))`),'aligned contact edit menu');
  await evaluate(`document.querySelector('.contact-menu [data-edit-contact="1"]').click()`);
  await waitFor(async()=>evaluate(`Boolean(document.querySelector('#customer-form [data-contact-card="1"]'))`),'aligned contact editor');
  const alignedContactEditor=await evaluate(`(()=>{const card=document.querySelector('#customer-form [data-contact-card="1"]');
    return {id:card?.querySelector('[name="contactIdExtra"]')?.value,
      email:card?.querySelector('[name="emailExtra"]')?.value,
      phone:card?.querySelector('[name="phoneExtra"]')?.value,
      address:card?.querySelector('[name="addressExtra"]')?.value};})()`);
  assert.deepEqual(alignedContactEditor,{id:'legacy-1',email:'second@example.test',phone:'222',address:'Berlin'});
  await evaluate(`document.querySelector('#customer-form [data-contact-card="1"] .ce-contact-extra summary').click()`);
  assert.equal(await evaluate(`document.querySelector('#customer-form [data-contact-card="1"] .ce-contact-extra').open`),true);
  await evaluate(`document.querySelector('#customer-form [data-contact-card="1"] [name="addressExtra"]').scrollIntoView({block:'center',behavior:'instant'})`);
  const alignedEditorFrame=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'customer-aligned-secondary-editor.png'),Buffer.from(alignedEditorFrame.data,'base64'));
  await evaluate(`document.querySelector('.drawer.customer-editor [data-action="close-modal"]').click()`);
  cdp.close();

  const report = {
    checkedAt: new Date().toISOString(),
    result: "pass",
    checks: {
      blankContactDetail,
      blankContactCompact,
      alignedContactDetail,
      alignedContactEditor,
      quickFilterDefault,
      quickFilterAfterReload,
      quickFieldEntry,
      quickFieldMenu,
      quickFieldExit,
      quickFieldReopen,
      filterCloseClick,
      quickSearchEmpty,
      quickSearchLayout,
      quickSearchEmptyCenter,
      compactQuickSearch,
      quickSearchClearedDraft,
      quickSearchRestored,
      pointerPress: pressed,
      heldPress,
      listExit,
      detailEnter: detail,
      detailGeometry,
      summaryFieldsDrawer,
      compactSummaryDrawer,
      savedSummaryFields,
      summaryValidation,
      resetSummaryFields,
      keyboardSummaryDrawer,
      reducedSummaryDrawer,
      tabEnter: tab,
      keyboardTab,
      reducedTabIndicator,
      filteredHistory,
      activityFilterMotion,
      reducedActivityFilter,
      addContact,
      contactEntry,
      reducedContactEntry,
      savedContactFieldsVisible: true,
      pointerSearchExit,
      interruptedSearchExit,
      reducedSearchExit,
      activitySearchEntry,
      activitySearchMatched,
      activityDetailExpanded,
      keyboardActivityDetail,
      reducedActivityDetail,
      activitySearchEmpty,
      activityRefreshLoading,
      activityRefreshResult,
      activitySearchClosing,
      oldActivityGroup,
      activityGroupEntry,
      keyboardActivityGroup,
      reducedActivityGroup,
      activitySortMenu,
      activitySortOldest,
      keyboardSortMenu,
      keyboardSortResult,
      reducedSortMenu,
      reducedSortResult,
      activityAdvancedMenu,
      advancedInvalidRange,
      advancedTypeTree,
      activityAdvancedResult,
      keyboardAdvancedMenu,
      reducedAdvancedMenu,
      keyboardActivitySearch,
      reducedActivitySearch,
      followupDetail,
      followupList,
      detailExit: exit,
      listReturned: true,
      keyboardOpen,
      keyboardReturn,
      drawerOpen,
      keyboardDrawer,
      reducedDrawer,
      centeredDialog,
      centeredPosition,
      customerActionsEntry,
      poolInfoFields,
      poolReturn,
      pointerPoolReturn,
      rowEditCancel,
      tagPopover,
      tagList,
      keyboardTag,
      tagEscape,
      reducedTag,
      batchDrawer,
      batchList,
      batchActivityPreserved: true,
      batchOperationHistorySeparated: true,
      persistedBatch,
      removedBatch,
      manualGroupFromEditorPersisted: true,
      groupClearState,
      rememberedActivityTypes,
      operationHeader,
      operationExpanded,
      operationDetailStyle,
      compactOperation,
      keyboardOperation,
      reducedOperation,
      documentAll:{count:documentAll.count,search:documentAll.search},
      documentSearch:{count:documentSearch.count,focused:documentSearch.focused},
      documentPointerMotion,
      documentEmpty,
      documentReducedMotion,
      documentPageTwo,
      documentSelection,
      documentSelectionAfterTab,
      documentSelectAll,
      documentSizeMenu,
      documentPageSizeResult,
      keyboardDocumentMenu,
      reducedDocumentMenu,
      namelessList,
      namelessDetail,
      separatedNotes,
      separatedPayment,
      noteEditor,
      savedNotes,
      duplicateContactMethod,
      additionalContactEmailSearch,
      additionalContactEmailFilter,
      emailFilterSummary,
      additionalContactEmailSegment,
      profileConditionFilter,
      profileFilterSummary,
      profileConditionSegment,
      profileUpdateCell,
      allTagResult,
      allTagSegment,
      anyTagResult,
      anyTagSegment,
      groupBoundaryFilter,
      groupFilterSummary,
      groupBoundarySegment,
      advancedFilterSummary,
      advancedFilterCleared,
      mineScope,
      clearedOwnerScope,
      manualOwnerScope,
      selectionAfterMine,
      selectionAfterOwner,
      selectionAfterClear,
      crossPageSelection,
      ascendingAmountSort,
      descendingAmountSort,
      ascendingSourceSort,
      localizedCountrySort,
      levelCells,
      detailLevelCells,
      ascendingLevelSort,
      branchMouseOpen,
      branchRapid,
      branchKeyboard,
      branchReduced,
      groupCollapseMotion,
      groupCollapseAfterRender,
      keyboardGroupExpand,
      reducedGroupCollapse,
      interruptedGroupMotion,
      settledGroupMotion,
      batchFollowupDialogState,
      keyboardBatchFollowup,
      reducedBatchFollowup,
      batchFollowupSaved,
      ownerDrawer,
      assignedOwners,
      clearOwnerDrawer,
      clearedOwner,
      ownerDetail,
      scheduleDrawer,
      compactScheduleDrawer,
      scheduledCustomer,
      scheduleCalendar,
      keyboardScheduleDrawer,
      unchangedSchedule,
      clearedSchedule,
      reducedScheduleDrawer,
      fieldDrawer,
      compactFieldDrawer,
      savedBatchField,
      keyboardFieldDrawer,
      clearedBatchField,
      pointerRuleEntry,
      keyboardRuleEntry,
      reducedRuleEntry,
      pointerRuleExit,
      pointerRuleAfterExit,
      keyboardRuleExit,
      reducedRuleExit,
      interruptedRuleExit,
      booleanDisplay,
      companyDisplayDrawer,
      compactCompanyDrawer,
      keyboardCompanyReorder,
      companyDisplaySaved,
      companyReorderMotion,
      reducedCompanyReorder,
      editorGroup,
      editorDraftRestored,
      editorDraftAfterSave,
      editorFollowOriginal,
      editorFollowDraft,
      editorFollowCancelled,
      editorFollowSaved,
      newEditorFollowSaved,
      listScrollBefore,
      listScrollAfterSelection,
      listScrollAfterReturn,
      listScrollAfterPage,
      firstPagination,
      middlePagination,
      compactPagination,
      lastPagination,
      listSegmentField,
      detailSegmentField,
      countryBranch,
      countrySelection,
      countryAliasGroup,
      countryAliasSelection,
      opportunityHeader,
      opportunityMetric,
      emptyOpportunityState,
      recycledIdentity,
      recycledEdit,
      recycledFollow,
      recycledTags,
      recycledRestored,
      infoGroupBefore,
      infoGroupClosing,
      infoGroupClosed,
      infoGroupOpening,
      infoGroupReopened,
      infoGroupRapid,
      infoGroupKeyboard,
      infoGroupRetained,
      infoGroupReduced,
      infoGroupNewCustomer,
      detailCardsBefore,
      analysisClosing,
      analysisClosed,
      contactsClosed,
      detailCardsReopened,
      contactsKeyboard,
      contactsSearchFromClosed,
      contactsReduced,
      exchangeGrades,
      exchangeDetailGrade,
      legacyCompanyEditor,
      clearedContactFields,
      batchScheduleDrawer,
      settledBatchSchedule,
      batchScheduleCancelled,
      reducedBatchSchedule,
      batchScheduleKeyboard,
      batchScheduleSaved,
      globalCustomerSearch,
      pointerCodeEditor,
      reducedCodeMotion,
      escapedCode,
      tabCodeDraft,
      codeDraft,
      cancelledCode,
      savedCode,
      newRequiredFields,
      companyExtraOpen,
      companyExtraClosing,
      keyboardExtraOpen,
      reducedExtraOpen,
      newValidation,
      addedContactRequired,
    },
  };
  fs.writeFileSync(
    path.join(evidence, "motion-acceptance.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(
    "PASS: customer navigation, contacts, drawers, batch tags add/remove and persistence, reduced motion, focus restoration",
  );
} finally {
  for (const child of children.reverse()) await stop(child);
  fs.rmSync(temporary, { recursive: true, force: true });
}
