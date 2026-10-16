// The /d1 page (local dev only): every table in the database, with tabs, a filter, sortable columns,
// refresh, and a read-only SQL box. It reads /d1?json=1 and /d1?sql=…; nothing on the page writes.
export const D1_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>D1 · verve</title>
<style>
:root{--bg:#f6f5f2;--panel:#fff;--ink:#1d1d1b;--mute:#6b6a65;--line:#e2e0da;--accent:#2f6b4f;--hl:#fff4c2;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--panel:#1f1f1d;--ink:#ecebe6;--mute:#9a9890;--line:#33322f;--accent:#7fc4a0;--hl:#4a4320;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
header{position:sticky;top:0;z-index:2;background:var(--bg);border-bottom:1px solid var(--line);padding:10px 16px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
h1{font-size:15px;margin:0 12px 0 0}
.tabs{display:flex;flex-wrap:wrap;gap:4px}
.tab{border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:6px;padding:4px 10px;cursor:pointer;font:inherit}
.tab.on{border-color:var(--accent);color:var(--accent);font-weight:600}
.tab small{color:var(--mute);margin-left:4px}
.tools{display:flex;gap:8px;align-items:center;margin-left:auto;flex-wrap:wrap}
input[type=search],textarea{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:6px;padding:5px 8px}
input[type=search]{width:220px}
button.act{font:inherit;border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:6px;padding:4px 10px;cursor:pointer}
button.act:hover,.tab:hover{border-color:var(--accent)}
label{color:var(--mute);display:flex;gap:4px;align-items:center}
main{padding:12px 16px 40px}
.meta{color:var(--mute);margin:0 0 8px}
.wrap{overflow:auto;border:1px solid var(--line);border-radius:8px;background:var(--panel);max-height:calc(100vh - 150px)}
table{border-collapse:collapse;width:max-content;min-width:100%;font:12px ui-monospace,SFMono-Regular,Menlo,monospace}
th,td{padding:5px 10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap;max-width:360px;overflow:hidden;text-overflow:ellipsis}
th{position:sticky;top:0;background:var(--panel);cursor:pointer;user-select:none;font-weight:600;box-shadow:0 1px 0 var(--line)}
th .dir{color:var(--accent)}
td.num{text-align:right}
td.null{color:var(--mute);font-style:italic}
tr:hover td{background:var(--hl)}
td.full{white-space:pre-wrap;max-width:none}
details{margin-top:16px}
summary{cursor:pointer;color:var(--mute)}
textarea{width:100%;min-height:70px;margin:8px 0}
.err{color:#c4504a;white-space:pre-wrap}
.empty{padding:24px;color:var(--mute);text-align:center}
</style></head><body>
<header>
  <h1>D1 · verve</h1>
  <div class="tabs" id="tabs"></div>
  <div class="tools">
    <input type="search" id="filter" placeholder="Filter rows…">
    <label><input type="checkbox" id="auto"> auto 3s</label>
    <button class="act" id="refresh">Refresh</button>
  </div>
</header>
<main>
  <p class="meta" id="meta"></p>
  <div class="wrap" id="grid"></div>
  <details id="sqlbox"><summary>Read-only SQL (SELECT / WITH / PRAGMA)</summary>
    <textarea id="sql" spellcheck="false">SELECT player_id, COUNT(*) AS hands, SUM(won) AS won, SUM(vpip) AS vpip FROM games GROUP BY player_id ORDER BY hands DESC</textarea>
    <button class="act" id="run">Run (Ctrl+Enter)</button>
  </details>
</main>
<script>
const $=id=>document.getElementById(id);
let data={},tab=null,sort={col:null,dir:1},query=null,timer=null;
try{tab=localStorage.getItem('d1.tab');}catch(e){}
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
async function load(){
  const r=await fetch('/d1?json=1',{cache:'no-store'});
  data=await r.json();
  if(!tab||!(tab in data))tab=Object.keys(data)[0]||null;
  if(!query)render();
  else renderTabs();
}
function renderTabs(){
  $('tabs').innerHTML=Object.keys(data).map(t=>'<button class="tab'+(t===tab&&!query?' on':'')+'" data-t="'+esc(t)+'">'+esc(t)+'<small>'+data[t].length+'</small></button>').join('');
}
function table(rows,label){
  const f=$('filter').value.trim().toLowerCase();
  let shown=f?rows.filter(r=>Object.values(r).some(v=>String(v??'').toLowerCase().includes(f))):rows.slice();
  const cols=rows.length?Object.keys(rows[0]):[];
  if(sort.col&&cols.includes(sort.col)){
    const c=sort.col,d=sort.dir;
    shown.sort((a,b)=>{const x=a[c],y=b[c];if(x==null)return 1;if(y==null)return -1;return (typeof x==='number'&&typeof y==='number'?x-y:String(x).localeCompare(String(y)))*d;});
  }
  $('meta').textContent=label+' · '+shown.length+(shown.length!==rows.length?' of '+rows.length:'')+' rows'+(cols.length?' · click a header to sort, a cell to expand':'');
  if(!rows.length){$('grid').innerHTML='<div class="empty">No rows.</div>';return;}
  const head='<tr>'+cols.map(c=>'<th data-c="'+esc(c)+'">'+esc(c)+(sort.col===c?' <span class="dir">'+(sort.dir>0?'▲':'▼')+'</span>':'')+'</th>').join('')+'</tr>';
  const body=shown.map(r=>'<tr>'+cols.map(c=>{const v=r[c];
    if(v==null)return '<td class="null">null</td>';
    const num=typeof v==='number';
    const txt=num&&/_at$/.test(c)&&v>1e12?v+' · '+new Date(v).toLocaleString():v;
    return '<td class="'+(num?'num':'')+'" title="'+esc(txt)+'">'+esc(txt)+'</td>';}).join('')+'</tr>').join('');
  $('grid').innerHTML='<table><thead>'+head+'</thead><tbody>'+body+'</tbody></table>';
}
function render(){renderTabs();if(tab)table(data[tab],tab);else{$('meta').textContent='No tables.';$('grid').innerHTML='';}}
async function runSql(){
  const q=$('sql').value.trim();if(!q)return;
  const r=await fetch('/d1?sql='+encodeURIComponent(q),{cache:'no-store'});
  const out=await r.json();
  if(out.error){$('meta').innerHTML='<span class="err">'+esc(out.error)+'</span>';return;}
  query={q,rows:out.rows};sort={col:null,dir:1};renderTabs();table(out.rows,'query');
}
$('tabs').onclick=e=>{const b=e.target.closest('.tab');if(!b)return;tab=b.dataset.t;query=null;sort={col:null,dir:1};try{localStorage.setItem('d1.tab',tab);}catch(err){}render();};
$('grid').onclick=e=>{
  const th=e.target.closest('th');
  if(th){const c=th.dataset.c;sort=sort.col===c?{col:c,dir:-sort.dir}:{col:c,dir:1};query?table(query.rows,'query'):render();return;}
  const td=e.target.closest('td');if(td)td.classList.toggle('full');
};
$('filter').oninput=()=>query?table(query.rows,'query'):render();
$('refresh').onclick=()=>query?runSql():load();
$('run').onclick=runSql;
$('sql').onkeydown=e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();runSql();}};
$('auto').onchange=e=>{clearInterval(timer);if(e.target.checked)timer=setInterval(()=>query?runSql():load(),3000);};
load().catch(e=>{$('meta').innerHTML='<span class="err">'+esc(e.message)+'</span>';});
</script></body></html>`;
