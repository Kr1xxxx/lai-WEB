(function (root) {
  'use strict';
  const M = root?.PreviewModel || (typeof require === 'function' ? require('./model.js') : null);
  const fields = Object.freeze([
    ['name', '公司名称'], ['contact', '联系人昵称'], ['email', '联系人邮箱'],
    ['shortName', '公司简称'], ['country', '国家地区'], ['tags', '标签'],
    ['customerStage', '客户阶段'], ['source', '客户来源'], ['website', '公司网址'],
    ['landline', '座机'], ['companyAddress', '详细地址'], ['companyRemark', '公司备注'],
    ['customerCode', '客户编号'], ['poolGroup', '公海分组'], ['phone', '联系人电话'],
    ['facebook', 'Facebook'], ['twitter', 'Twitter'], ['linkedin', 'LinkedIn'],
    ['contactTitle', '职位'], ['contactGender', '性别'], ['contactNote', '联系人备注'],
    ['owner', '跟进人'], ['level', '客户等级'], ['note', '客户备注'],
  ].map(([id, label]) => Object.freeze({id, label})));
  const aliases = new Map([
    ['客户名称', 'name'], ['名称', 'name'], ['公司名称', 'name'],
    ['联系人', 'contact'], ['联系人名称', 'contact'], ['主要联系人', 'contact'],
    ['网址', 'website'], ['主页', 'website'], ['公司网址', 'website'],
    ['电话', 'phone'], ['手机号', 'phone'], ['联系电话', 'phone'],
    ['邮箱', 'email'], ['简称', 'shortName'], ['客户标签', 'tags'],
    ...fields.map(({id, label}) => [label, id]),
  ]);
  const templateHeaders = Object.freeze(fields.slice(0,21).map(field => field.label));
  const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  const tagged = value => [...new Set(String(value ?? '').split(/[,，;；]/).map(item => item.trim()).filter(Boolean))];
  const phoneKey = M.contactPhoneKey;
  const companyFields = new Set(['shortName','country','tags','customerStage','source','website','landline',
    'companyAddress','companyRemark','customerCode','poolGroup','owner','level','note']);

  function parseCsv(source) {
    const text = String(source ?? '').replace(/^\uFEFF/, '');
    if (new TextEncoder().encode(text).length > 5 * 1024 * 1024) throw new Error('文件不能超过 5 MB');
    const table = [], lineNumbers = [];
    let row = [], field = '', quoted = false, afterQuote = false, line = 1, rowStart = 1;
    const pushField = () => { row.push(field); field = ''; afterQuote = false; };
    const pushRow = () => {
      pushField();
      if (row.some(cell => cell.trim())) { table.push(row); lineNumbers.push(rowStart); }
      row = [];
      if (table.length > 10001) throw new Error('单次导入不能超过 10,000 行');
    };
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (char === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else { quoted = false; afterQuote = true; }
        } else if (char === '\r') {
          field += '\n'; if (text[i + 1] === '\n') i++; line++;
        } else { field += char; if (char === '\n') line++; }
      } else if (char === ',') pushField();
      else if (char === '\r' || char === '\n') {
        pushRow(); if (char === '\r' && text[i + 1] === '\n') i++;
        line++; rowStart = line;
      } else if (char === '"' && !field && !afterQuote) quoted = true;
      else if (afterQuote && /[ \t]/.test(char)) continue;
      else if (afterQuote || char === '"') throw new Error('CSV 引号格式无效');
      else if (char === '\0') throw new Error('CSV 文件包含无效字符');
      else field += char;
    }
    if (quoted) throw new Error('CSV 引号未闭合');
    if (field || row.length || afterQuote) pushRow();
    if (!table.length || !table[0].length || !table[0].some(cell => cell.trim())) throw new Error('CSV 缺少表头');
    const headers = table.shift().map(value => value.trim());
    lineNumbers.shift();
    if (headers.length > 100) throw new Error('CSV 列数过多');
    if (table.some(row => row.length !== headers.length)) throw new Error('CSV 行列数不一致');
    if (!table.length) throw new Error('CSV 没有客户数据');
    return {headers, rows:table, lineNumbers};
  }

  function parseExcel(source, parser = root?.XLSX) {
    const size = source?.byteLength;
    if (!Number.isInteger(size) || size <= 0) throw new Error('Excel 文件为空或无法读取');
    if (size > 5 * 1024 * 1024) throw new Error('文件不能超过 5 MB');
    if (!parser?.read || !parser?.utils?.sheet_to_json) throw new Error('Excel 解析组件未加载');
    let worksheet;
    try {
      const workbook = parser.read(source, {type:'array'});
      worksheet = workbook.Sheets[workbook.SheetNames[0]];
    } catch (_) { throw new Error('Excel 文件解析失败，请检查文件格式'); }
    if (!worksheet?.['!ref']) throw new Error('Excel 第一个工作表没有客户数据');
    let table;
    try { table = parser.utils.sheet_to_json(worksheet, {header:1,raw:false,defval:'',blankrows:true}); }
    catch (_) { throw new Error('Excel 工作表读取失败'); }
    const firstRow = parser.utils.decode_range(worksheet['!ref']).s.r + 1;
    const occupied = table.map((row,index) => ({
      row:(Array.isArray(row) ? row : []).map(value => String(value ?? '').trim()),
      line:firstRow + index,
    })).filter(item => item.row.some(Boolean));
    if (!occupied.length) throw new Error('Excel 缺少表头');
    const headerRow = occupied.shift().row;
    const width = headerRow.findLastIndex(Boolean) + 1;
    if (width > 100) throw new Error('Excel 列数过多');
    if (!occupied.length) throw new Error('Excel 没有客户数据');
    if (occupied.length > 10000) throw new Error('单次导入不能超过 10,000 行');
    const rows = occupied.map(item => {
      if (item.row.slice(width).some(Boolean)) throw new Error(`第 ${item.line} 行列数超过表头`);
      return Array.from({length:width},(_,column) => item.row[column] || '');
    });
    return {headers:headerRow.slice(0,width),rows,lineNumbers:occupied.map(item => item.line)};
  }

  function suggestMapping(headers) {
    const mapping = {}, used = new Set();
    headers.forEach((header, index) => {
      const field = aliases.get(String(header).trim());
      if (field && !used.has(field)) { mapping[field] = index; used.add(field); }
    });
    return mapping;
  }

  function mappedRecords(parsed, mapping) {
    if (!parsed || !Array.isArray(parsed.headers) || !Array.isArray(parsed.rows)) throw new Error('请先选择导入文件');
    if (!mapping || !Number.isInteger(mapping.name)) throw new Error('请把一列匹配到公司名称');
    const entries = Object.entries(mapping).filter(([, index]) => index !== '' && index !== null && index !== undefined);
    const valid = new Set(fields.map(field => field.id));
    const indexes = new Set();
    for (const [key, index] of entries) {
      if (!valid.has(key) || !Number.isInteger(index) || index < 0 || index >= parsed.headers.length || indexes.has(index))
        throw new Error('字段匹配无效或重复');
      indexes.add(index);
    }
    const seen = new Map();
    return parsed.rows.map((row, index) => {
      const line = parsed.lineNumbers?.[index] || index + 2;
      if (!Array.isArray(row) || row.length !== parsed.headers.length) throw new Error(`第 ${line} 行列数不一致`);
      const values = Object.fromEntries(entries.map(([key, column]) => [key, String(row[column] ?? '').trim()]));
      if (values.email) {
        values.email = M.emailInput(values.email);
        if (!M.validEmail(values.email)) throw new Error(`第 ${line} 行联系人邮箱格式无效`);
      }
      const name = values.name;
      if (!name || name.length > 200 || ['__proto__', 'constructor', 'prototype'].includes(name))
        throw new Error(`第 ${line} 行公司名称无效`);
      if (Object.values(values).some(value => value.length > 5000)) throw new Error(`第 ${line} 行字段内容过长`);
      const key = M.customerNameKey(name);
      const first = seen.get(key);
      if (first) for (const field of companyFields) {
        if (first[field] && values[field] && first[field] !== values[field])
          throw new Error(`第 ${line} 行${fields.find(item => item.id === field)?.label || field}与同公司前面的行不一致`);
        if (!first[field] && values[field]) first[field] = values[field];
      }
      else seen.set(key,{...values});
      return values;
    });
  }

  function applyImport(state, parsed, mapping, options = {}, time = new Date().toISOString()) {
    const destination = options.destination || 'active', duplicate = options.duplicate || 'skip';
    if (!['active', 'pool'].includes(destination) || !['skip', 'update'].includes(duplicate)) throw new Error('导入选项无效');
    const records = mappedRecords(parsed, mapping);
    const customers = {...(state.customers || {})};
    const known = new Map();
    for (const name of new Set([...Object.keys(customers), ...(state.orders || []).map(order => order.client).filter(Boolean)])) {
      const key = M.customerNameKey(name), names = known.get(key) || [];
      names.push(name);
      known.set(key, names);
    }
    const originallyKnown = new Set(known.keys()), processed = new Set();
    const emails = new Map(), phones = new Map();
    const contactValues = M.customerContactValues;
    const removeContact = (name, profile) => {
      const values = contactValues(profile);
      for (const value of values.email) {
        const key = normalize(value), names = emails.get(key);
        names?.delete(name);
        if (names && !names.size) emails.delete(key);
      }
      for (const value of values.phone) {
        const key = phoneKey(value), names = phones.get(key);
        names?.delete(name);
        if (names && !names.size) phones.delete(key);
      }
    };
    const addContact = (name, profile) => {
      const values = contactValues(profile);
      for (const value of values.email) if (normalize(value)) {
        const key = normalize(value), names = emails.get(key) || new Set(); names.add(name); emails.set(key, names);
      }
      for (const value of values.phone) if (phoneKey(value).length >= 7) {
        const key = phoneKey(value), names = phones.get(key) || new Set(); names.add(name); phones.set(key, names);
      }
    };
    for (const [name, profile] of Object.entries(customers)) addContact(name, profile);
    const result = {created:0, updated:0, skipped:0};
    const details = [];
    for (const [index, values] of records.entries()) {
      const key = M.customerNameKey(values.name), equivalentNames = known.get(key) || [];
      const existingName = equivalentNames[0];
      const name = existingName || values.name;
      const old = customers[name] || {};
      const otherEmail = normalize(values.email) && [...(emails.get(normalize(values.email)) || [])].some(owner => owner !== name);
      const otherPhone = phoneKey(values.phone).length >= 7 && [...(phones.get(phoneKey(values.phone)) || [])].some(owner => owner !== name);
      const reason = equivalentNames.length > 1 ? '存在多个等价客户名称，请先核对客户资料'
        : old.laiBucket === 'trash' ? '回收站客户不可更新'
        : originallyKnown.has(key) && duplicate === 'skip' ? '同名客户已存在'
        : otherEmail ? '邮箱与其他客户重复'
        : otherPhone ? '电话与其他客户重复' : '';
      if (reason) {
        result.skipped++;
        details.push({row:parsed.lineNumbers?.[index] || index + 2,name:values.name,status:'skipped',reason});
        continue;
      }
      const line = parsed.lineNumbers?.[index] || index + 2;
      const record = {...old, client:name, updated:time};
      if (!old.createdAt && !existingName) record.createdAt = time;
      for (const [key, value] of Object.entries(values)) {
        if (!companyFields.has(key) || key === 'tags' || !value) continue;
        record[key] = value;
      }
      if (values.tags) record.tags = tagged(values.tags);
      if (!existingName && destination === 'pool') record.laiBucket = 'pool';
      const contactKeys = ['contact','email','phone','contactNote','contactTitle','contactGender',
        'facebook','twitter','linkedin'];
      const hasContact = contactKeys.some(field => values[field]);
      let contactAdded = false;
      if (hasContact) {
        const count = Math.max(Array.isArray(old.extraContacts) ? old.extraContacts.length : 0,
          ...['contacts','emails','phones'].map(field => Math.max(0,(old[field]?.length || 0)-1)));
        const primary = Object.fromEntries(['contact','email','phone','contactNote','contactTitle',
          'contactGender','socialPlatform','socialAccount','additionalSocialAccounts'].map(field =>
          [field,old[field] ?? (field === 'contact' ? old.contacts?.[0] : field === 'email' ? old.emails?.[0]
            : field === 'phone' ? old.phones?.[0] : '')]));
        const contacts = [primary,...Array.from({length:count},(_,i) => ({
          ...(old.extraContacts?.[i] || {id:`legacy-${i+1}`}),
          contact:old.extraContacts?.[i]?.contact ?? old.contacts?.[i+1] ?? '',
          email:old.extraContacts?.[i]?.email ?? old.emails?.[i+1] ?? '',
          phone:old.extraContacts?.[i]?.phone ?? old.phones?.[i+1] ?? '',
        }))];
        const matches = entry => normalize(values.email) && normalize(entry.email) === normalize(values.email)
          || phoneKey(values.phone).length >= 7 && phoneKey(entry.phone) === phoneKey(values.phone)
          || values.contact && normalize(entry.contact) === normalize(values.contact)
            && (!values.email || !entry.email) && (!values.phone || !entry.phone);
        let target = contacts.findIndex(matches);
        const primaryOccupied = ['contact','email','phone','socialAccount'].some(field => contacts[0][field]);
        if (target < 0 && (!primaryOccupied || (!values.contact && !processed.has(key)))) target = 0;
        if (target >= 0 && processed.has(key) && duplicate === 'skip') {
          result.skipped++;
          details.push({row:line,name:values.name,status:'skipped',reason:'同一客户联系人重复'});
          continue;
        }
        if (target < 0) {
          target = contacts.length;
          contacts.push({id:`import-${time}-${line}-${target}`});
          contactAdded = true;
        }
        const entry = {...contacts[target]};
        for (const field of ['contact','email','phone','contactNote','contactTitle','contactGender'])
          if (values[field]) entry[field] = values[field];
        const social = [['facebook','Facebook'],['twitter','Twitter'],['linkedin','LinkedIn']]
          .filter(([field]) => values[field]).map(([field,platform]) => ({socialPlatform:platform,socialAccount:values[field]}));
        if (social.length) {
          const all = [
            ...(entry.socialPlatform && entry.socialAccount ? [{socialPlatform:entry.socialPlatform,socialAccount:entry.socialAccount}] : []),
            ...(Array.isArray(entry.additionalSocialAccounts) ? entry.additionalSocialAccounts : []),
          ];
          for (const item of social) {
            const found = all.findIndex(current => current.socialPlatform === item.socialPlatform);
            if (found >= 0) all[found] = {...all[found],...item};
            else all.push(item);
          }
          entry.socialPlatform = all[0].socialPlatform;
          entry.socialAccount = all[0].socialAccount;
          entry.additionalSocialAccounts = all.slice(1);
        }
        contacts[target] = entry;
        for (const field of ['contact','email','phone','contactNote','contactTitle','contactGender',
          'socialPlatform','socialAccount','additionalSocialAccounts'])
          if (Object.hasOwn(entry,field)) record[field] = entry[field];
        if (target !== 0) {
          for (const field of ['contact','email','phone','contactNote','contactTitle','contactGender',
            'socialPlatform','socialAccount','additionalSocialAccounts'])
            if (Object.hasOwn(primary,field)) record[field] = primary[field];
        }
        record.extraContacts = contacts.slice(1);
        for (const [single,multi] of [['contact','contacts'],['email','emails'],['phone','phones']])
          record[multi] = contacts.map(item => String(item[single] || ''));
      }
      const firstForCompany = !processed.has(key);
      const status = firstForCompany ? (originallyKnown.has(key) ? 'updated' : 'created')
        : contactAdded ? 'contact-added' : 'contact-updated';
      record.history = [{time, text:status === 'created' ? '导入客户档案'
        : status === 'contact-added' ? '导入新增联系人' : '导入更新客户资料', type:'operation'},
        ...(Array.isArray(old.history) ? old.history : [])];
      customers[name] = record;
      known.set(key, [name]);
      processed.add(key);
      removeContact(name, old);
      addContact(name, record);
      if (firstForCompany) result[status]++;
      if (contactAdded) result.contactsAdded = (result.contactsAdded || 0) + 1;
      details.push({row:line,name:values.name,status});
    }
    const fileName = String(options.fileName || '').trim();
    const record = fileName ? {
      id:String(options.recordId || `${time}-${fileName}`),
      time,fileName,destination,expected:records.length,result:{...result},
    } : null;
    const history = record ? [record, ...(Array.isArray(state.laiImportHistory) ? state.laiImportHistory : [])]
      : state.laiImportHistory;
    return {state:{...state, customers, ...(record ? {laiImportHistory:history} : {})}, result, details, record};
  }

  function failureLogCsv(issues) {
    const cell = value => {
      const raw = String(value ?? '');
      const safe = /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    return '\uFEFF行号,公司名称,跳过原因\r\n' + issues.map(item =>
      [item.row, item.name, item.reason].map(cell).join(',')).join('\r\n');
  }

  const api = {fields, templateHeaders, parseCsv, parseExcel, suggestMapping, mappedRecords, applyImport, failureLogCsv};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.LaiCustomerImport = api;
})(typeof window !== 'undefined' ? window : null);
