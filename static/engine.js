/* Browser-only tracker. Personal data never leaves this browser. */
(() => {
  'use strict';
  const KEY = 'qiuzhao:records:v1';
  let vocabulary;
  const ready = fetch('./terms.json').then(response => {
    if (!response.ok) throw Error('岗位词库加载失败，请刷新页面');
    return response.json();
  }).then(async value => { vocabulary = value; await applyWelcome(); });

  async function applyWelcome() {
    const encoded = new URLSearchParams(location.hash.slice(1)).get('welcome');
    if (!encoded) return;
    // Fragments are not sent in HTTP requests. Remove the personal payload
    // from the address bar before loading it; never publish it as a site asset.
    history.replaceState(null, '', location.pathname + location.search);
    try {
      if (encoded.length > 40000) throw Error();
      const packed = Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
      const stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'));
      const reader = stream.getReader();
      let bytes = new Uint8Array(0);
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        if (bytes.length + value.length > 50000) { await reader.cancel(); throw Error(); }
        const next = new Uint8Array(bytes.length + value.length);
        next.set(bytes); next.set(value, bytes.length); bytes = next;
      }
      const welcome = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
      if (welcome.version !== 1 || typeof welcome.profile !== 'string' || !welcome.profile.trim() || welcome.profile.length > 12000) throw Error();
      const data = read();
      if (data.profile.trim()) {
        window.TrackerWelcomeMessage = '已保留你在当前浏览器保存的画像，未覆盖已有内容';
        return;
      }
      data.profile = welcome.profile;
      write(data);
      window.TrackerWelcomeMessage = '已自动填入你的简历与作品集画像，可以直接添加岗位';
    } catch (error) {
      window.TrackerWelcomeMessage = '专属入口未能读取，请使用新版浏览器或联系我重新生成入口';
    }
  }

  function read() {
    let value;
    try { value = JSON.parse(localStorage.getItem(KEY) || '{"version":1,"jobs":[],"profile":""}'); }
    catch { throw Error('浏览器记录无法读取，请保留现有数据并从备份恢复'); }
    if (!value || value.version !== 1 || !Array.isArray(value.jobs) || typeof value.profile !== 'string') {
      throw Error('浏览器数据格式异常，请从备份恢复');
    }
    return value;
  }
  function write(value) {
    try { localStorage.setItem(KEY, JSON.stringify(value)); }
    catch { throw Error('浏览器存储空间不足或被禁用。请先备份，使用普通浏览模式重试'); }
  }
  function contains(text, term) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = /^[\x00-\x7f]+$/.test(term) ? `(?<![a-zA-Z0-9_+#])${escaped}(?![a-zA-Z0-9_+#])` : escaped;
    return new RegExp(pattern, 'i').test(text);
  }
  function keywords(text) {
    const found = vocabulary.terms.filter(word => contains(text, word));
    for (const [term, aliases] of Object.entries(vocabulary.aliases)) {
      if (aliases.some(alias => contains(text, alias)) && !found.includes(term)) found.push(term);
    }
    return found;
  }
  function match(requirements, profile) {
    const required = keywords(requirements), available = new Set(keywords(profile));
    const matched = required.filter(term => available.has(term));
    const missing = required.filter(term => !available.has(term));
    const evidence = {};
    for (const term of matched) {
      const aliases = vocabulary.aliases[term] || [term];
      const line = profile.split('\n').find(line => aliases.some(alias => contains(line, alias)));
      if (line) evidence[term] = line.slice(0, 220);
    }
    return { score: required.length && profile.trim() ? Math.round(100 * matched.length / required.length) : null, matched, missing, evidence };
  }
  function cleanJob(value) {
    if (!value || typeof value !== 'object') throw Error('岗位记录格式无效');
    const job = {};
    for (const field of ['title', 'company', 'url', 'requirements', 'applied_at', 'status', 'notes']) {
      if (value[field] != null && typeof value[field] !== 'string') throw Error('岗位字段必须是文本');
      job[field] = (value[field] || '').trim();
    }
    if (!job.title || job.title.length > 160) throw Error('岗位名称必填，最长 160 字');
    if (job.requirements.length > 12000 || job.notes.length > 5000 || job.company.length > 120 || job.url.length > 2000) throw Error('岗位信息过长，请精简后保存');
    if (!vocabulary.statuses.includes(job.status)) throw Error('投递进度无效');
    if (job.url) {
      try { const url = new URL(job.url); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error(); }
      catch { throw Error('岗位链接须为有效的 http / https 网页'); }
    }
    if (job.applied_at && (!/^\d{4}-\d{2}-\d{2}$/.test(job.applied_at) || Number.isNaN(Date.parse(job.applied_at)) || new Date(job.applied_at).toISOString().slice(0,10) !== job.applied_at)) throw Error('投递日期无效');
    job.id = value.id ? String(value.id) : crypto.randomUUID();
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(job.id)) throw Error('岗位记录编号无效');
    job.keywords = keywords(job.requirements);
    return job;
  }
  function parse({text, url}) {
    if (!text.trim()) throw Error('免费网页版请先打开岗位链接，复制岗位正文到下方，再点击解析');
    if (text.length > 30000) throw Error('岗位正文过长，请只保留岗位职责与要求');
    const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
    if (text.trim().length < 20) throw Error('请粘贴完整岗位正文，第一行填写岗位名称');
    const start = lines.findIndex(line => /任职要求|岗位要求|职位要求|任职资格|Qualifications|Requirements/i.test(line));
    let requirements = (start < 0 ? lines : lines.slice(start)).join('\n');
    if (start >= 0) requirements = requirements.split(/福利待遇|薪酬福利|申请方式|公司介绍|About us|Benefits/i)[0];
    return {title: lines[0].slice(0,160), company: '', url: url.trim(), requirements: requirements.slice(0,12000), keywords: keywords(requirements), warning:'已提取岗位要求与关键词。请核对岗位名称、公司和投递日期。'};
  }
  function download(bytes, type, name) {
    const url = URL.createObjectURL(new Blob([bytes], {type}));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = name; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  async function api(path, input = {}) {
    await ready;
    const data = read();
    if (path === '/api/state') return {...data, statuses: vocabulary.statuses, jobs: data.jobs.map(job => ({...job, keywords: keywords(job.requirements), ...match(job.requirements, data.profile)}))};
    if (path === '/api/parse') return parse(input);
    if (path === '/api/profile') {
      if (typeof input.profile !== 'string' || input.profile.length > 12000) throw Error('个人画像最长 12000 字');
      data.profile = input.profile; write(data); return {ok: true};
    }
    if (path === '/api/save') {
      const job = cleanJob(input), index = data.jobs.findIndex(item => String(item.id) === job.id);
      if (index < 0) data.jobs.unshift(job); else data.jobs[index] = job;
      write(data); return {ok:true};
    }
    if (path === '/api/delete') {
      data.jobs = data.jobs.filter(job => String(job.id) !== String(input.id)); write(data); return {ok:true};
    }
    throw Error('操作不存在');
  }
  async function backup() {
    await ready;
    const data = read();
    download(JSON.stringify({...data, exported_at: new Date().toISOString()}, null, 2), 'application/json', '我的秋招数据备份.json');
  }
  async function restore(file) {
    await ready;
    if (!file || file.size > 5_000_000) throw Error('请选择小于 5 MB 的 JSON 备份');
    let data;
    try { data = JSON.parse(await file.text()); } catch { throw Error('文件不是有效的 JSON 备份'); }
    if (data.version !== 1 || !Array.isArray(data.jobs) || data.jobs.length > 5000 || typeof data.profile !== 'string' || data.profile.length > 12000) throw Error('备份格式无效');
    const jobs = data.jobs.map(cleanJob);
    if (new Set(jobs.map(job => job.id)).size !== jobs.length) throw Error('备份存在重复记录编号');
    if (!confirm(`将用备份中的 ${jobs.length} 条记录和个人画像替换当前浏览器数据。请先备份当前数据。是否继续？`)) return false;
    write({version:1, profile:data.profile, jobs});
    return true;
  }
  async function exportExcel() {
    if (!window.ExcelJS) throw Error('Excel 导出组件加载失败，请刷新页面');
    const data = await api('/api/state');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = '秋招手账';
    const sheet = workbook.addWorksheet('秋招进度', {views:[{state:'frozen',ySplit:1}]});
    const headers = ['岗位名称','公司','岗位链接','岗位要求关键词','投递时间','关键词匹配度','已匹配关键词','材料暂未体现','投递进度','备注','岗位要求原文','匹配证据'];
    sheet.addRow(headers);
    for (const job of data.jobs) {
      sheet.addRow([job.title, job.company, job.url, job.keywords.join('、'),job.applied_at,job.score === null ? '待分析' : `${job.score}%`,job.matched.join('、'),job.missing.join('、'),job.status,job.notes,job.requirements,Object.entries(job.evidence).map(([term,line])=>`${term}：${line}`).join('\n')]);
    }
    const widths = [28,22,40,42,18,18,32,32,16,36,65,65];
    sheet.columns.forEach((column,index)=>{column.width=widths[index]; column.alignment={vertical:'top',wrapText:true};});
    sheet.getRow(1).eachCell(cell=>{cell.font={bold:true,color:{argb:'FFFFFFFF'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF176B5B'}};});
    sheet.autoFilter={from:'A1',to:`L${Math.max(2,data.jobs.length+1)}`};
    sheet.dataValidations.add('I2:I10000',{type:'list',allowBlank:true,formulae:[`"${vocabulary.statuses.join(',')}"`],showErrorMessage:true,error:'请选择列表中的投递进度'});
    const instructions = workbook.addWorksheet('使用说明');
    for (const line of ['秋招记录表','在网页中粘贴岗位正文，核对后保存。','匹配度为岗位要求关键词在个人材料中的覆盖率，不代表录取概率。','请人工核对毕业时间、学历、城市、年限等硬性条件。','投递进度支持下拉选择；日期请按真实投递时间填写。','Excel 是导出快照，不会自动同步回网页。请用 JSON 备份恢复网页数据。','个人画像和记录仅保存在当前浏览器，清除网站数据会丢失记录。']) instructions.addRow([line]);
    instructions.getColumn(1).width = 110;
    if (data.profile) {
      const profile = workbook.addWorksheet('个人画像与证据');
      profile.addRow(['用户提供的个人材料证据，请核对并持续更新']);
      data.profile.split('\n').forEach(line=>profile.addRow([line]));
      profile.getColumn(1).width=110;
    }
    download(await workbook.xlsx.writeBuffer(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '秋招进度.xlsx');
  }
  window.Tracker = {api,backup,restore,exportExcel};
})();
