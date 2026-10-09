const $=id=>document.getElementById(id);
let state={jobs:[],statuses:[]};
const fields=['title','company','url','requirements','applied_at','status','notes'];
$('settings-open').onclick=()=>$('settings').showModal();
$('settings-close').onclick=()=>$('settings').close();
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(message){$('toast').textContent=message;$('toast').style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').style.display='none',6000)}
async function api(path,data){return window.Tracker.api(path,data)}
async function reload(initial=false){state=await api('/api/state');if(initial){$('profile').value=state.profile;$('status').innerHTML=state.statuses.map(s=>`<option>${esc(s)}</option>`).join('');$('filter').innerHTML='<option value="">全部进度</option>'+state.statuses.map(s=>`<option>${esc(s)}</option>`).join('')}render()}
function jobCard(job){
  const id=esc(job.id);
  return `<article class="job">
    <div class="job-head">
      <div class="job-field job-title"><span class="job-field-label">职位名称</span><h3>${esc(job.title)}</h3></div>
      <div class="job-field"><span class="job-field-label">公司</span><div class="job-value job-company">${esc(job.company||'待补充')}</div></div>
      <div class="job-field" title="岗位要求关键词覆盖率，不代表录取概率"><span class="job-field-label">匹配度</span><div class="score">${job.score===null?'—':job.score+'%'}</div></div>
      <div class="job-field"><span class="job-field-label">投递日期</span><div class="job-value job-date">${esc(job.applied_at||'尚未记录')}</div></div>
    </div>
    <div class="job-secondary">
      <div class="chips">${job.keywords.map(term=>`<span class="chip">${esc(term)}</span>`).join('')||'<span class="keyword-empty">未识别关键词</span>'}</div>
      <div class="job-meta">
        <select data-status="${id}" aria-label="投递进度">${state.statuses.map(status=>`<option ${status===job.status?'selected':''}>${esc(status)}</option>`).join('')}</select>
        ${/^https?:\/\//i.test(job.url)?`<a href="${esc(job.url)}" target="_blank" rel="noopener noreferrer">原文 ↗</a>`:''}
        <button class="text-button" data-detail="${id}">详情</button>
        <button class="text-button" data-edit="${id}">编辑</button>
        <button class="text-button" data-delete="${id}">删除</button>
      </div>
    </div>
  </article>`;
}
function render(){
  const jobs=state.jobs;
  $('total').textContent=jobs.length;
  $('active').textContent=jobs.filter(job=>!['待投递','已拒绝','已撤回'].includes(job.status)).length;
  $('interview').textContent=jobs.filter(job=>['一面','二面','终面'].includes(job.status)).length;
  $('offers').textContent=jobs.filter(job=>job.status==='Offer').length;
  const search=$('search').value.toLowerCase(),filter=$('filter').value;
  const visible=jobs.filter(job=>(!filter||job.status===filter)&&`${job.title} ${job.company} ${job.keywords.join(' ')}`.toLowerCase().includes(search));
  $('jobs').innerHTML=visible.length?visible.map(jobCard).join(''):`<div class="empty"><b>${jobs.length?'暂无符合条件的岗位':'下一站，从一个机会开始。'}</b>在顶部粘贴岗位正文，建立你的第一条秋招记录。<br>也可以先导出带进度下拉框的空白 Excel 模板。</div>`;
}
function showDetails(job){
  $('job-details-title').textContent=job.title;
  $('job-details-content').innerHTML=`<p class="muted">匹配度为岗位关键词覆盖率，不代表录取概率。</p><section class="detail-section"><h3>关键词匹配</h3><p>已体现：${esc(job.matched.join('、')||'暂无')}</p><p>材料暂未体现：${esc(job.missing.join('、')||'无 / 待核对')}</p>${job.score===null?'<p class="muted">请填写画像和岗位要求后分析。</p>':''}</section><section class="detail-section"><h3>简历 / 作品集证据</h3>${Object.entries(job.evidence||{}).map(([term,evidence])=>`<p><b>${esc(term)}</b>：${esc(evidence)}</p>`).join('')||'<p class="muted">暂无对应证据。</p>'}</section>${job.notes?`<section class="detail-section"><h3>备注</h3><p>${esc(job.notes)}</p></section>`:''}`;
  $('job-details').showModal();
}
$('job-details-close').onclick=()=>$('job-details').close();

function edit(job={}){$('job-id').value=job.id||'';fields.forEach(f=>$(f).value=job[f]||(f==='status'?'待投递':''));$('parse-warning').textContent=job.warning||'请按实际情况核对岗位要求、投递日期与进度。';$('editor-title').textContent=job.id?'编辑岗位':'核对岗位信息';$('editor').showModal()}
$('parse').onclick=async()=>{const button=$('parse');button.disabled=true;button.textContent='正在读取与解析…';try{const job=await api('/api/parse',{url:$('source-url').value,text:$('source-text').value});edit(job)}catch(error){toast(error.message)}finally{button.disabled=false;button.textContent='解析岗位 →'}};
$('manual').onclick=()=>edit({url:$('source-url').value,requirements:$('source-text').value});$('close').onclick=()=>$('editor').close();
$('job-form').onsubmit=async event=>{event.preventDefault();try{const data=Object.fromEntries(fields.map(f=>[f,$(f).value]));data.id=$('job-id').value;await api('/api/save',data);$('editor').close();await reload();toast('岗位已保存')}catch(error){toast(error.message)}};
$('save-profile').onclick=async()=>{try{await api('/api/profile',{profile:$('profile').value});await reload();toast('画像已保存，匹配度已更新')}catch(error){toast(error.message)}};
$('search').oninput=render;$('filter').onchange=render;
$('jobs').onclick=async event=>{const id=event.target.dataset.edit||event.target.dataset.delete||event.target.dataset.detail;if(!id)return;const job=state.jobs.find(j=>String(j.id)===String(id));if(event.target.dataset.edit)return edit(job);if(event.target.dataset.detail)return showDetails(job);if(confirm(`删除「${job.title}」这条记录？`)){try{await api('/api/delete',{id:job.id});await reload()}catch(error){toast(error.message)}}};
$('jobs').onchange=async event=>{if(!event.target.dataset.status)return;const job=state.jobs.find(j=>String(j.id)===String(event.target.dataset.status));try{await api('/api/save',{...job,status:event.target.value});await reload();toast('投递进度已更新')}catch(error){toast(error.message);render()}};
$('export-excel').onclick=async()=>{const button=$('export-excel');button.disabled=true;try{await Tracker.exportExcel();toast('Excel 已导出')}catch(error){toast(error.message)}finally{button.disabled=false}};
$('backup').onclick=async()=>{try{await Tracker.backup();toast('备份已下载，请私密保存')}catch(error){toast(error.message)}};
$('restore').onchange=async event=>{try{if(await Tracker.restore(event.target.files[0])){await reload(true);toast('画像与投递记录已恢复')}}catch(error){toast(error.message)}finally{event.target.value=''}};
window.addEventListener('storage',event=>{if(event.key==='qiuzhao:records:v1')reload(true).catch(error=>toast(error.message))});
window.addEventListener('tracker-welcome',()=>reload(true).then(()=>{if(window.TrackerWelcomeMessage)toast(window.TrackerWelcomeMessage)}).catch(error=>toast(error.message)));
reload(true).then(()=>{if(window.TrackerWelcomeMessage)toast(window.TrackerWelcomeMessage)}).catch(error=>toast(error.message));
