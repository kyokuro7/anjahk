(()=>{'use strict';
// ---- Penghalang inspeksi (deterrent; keamanan sebenarnya ada di server)
const wipe=()=>{document.body.innerHTML='<p style="padding:2rem;font:16px system-ui">Akses inspeksi diblokir.</p>'};
document.addEventListener('contextmenu',e=>e.preventDefault());
document.addEventListener('keydown',e=>{const k=e.key.toLowerCase();if(e.key==='F12'||(e.ctrlKey&&e.shiftKey&&'ijc'.includes(k))||(e.ctrlKey&&'us'.includes(k))||(e.metaKey&&e.altKey&&'iju'.includes(k)))e.preventDefault()});
document.addEventListener('dragstart',e=>e.preventDefault());
let hit=0;setInterval(()=>{const t=performance.now();(function(){debugger})();if(performance.now()-t>120||(outerWidth-innerWidth>200&&innerWidth>700)||(outerHeight-innerHeight>260&&innerHeight>500)){if(++hit>1)wipe()}else hit=0},1000);
// ---- util
const $=s=>document.querySelector(s),esc=s=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const api=async(u,o={})=>{const r=await fetch('/api'+u,{credentials:'same-origin',headers:{'Content-Type':'application/json'},...o,body:o.body&&typeof o.body!=='string'?JSON.stringify(o.body):o.body});
  if(r.status===401&&u!=='/login'){showLogin();throw 0}const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'Gagal');return j};
const md=s=>esc(s).replace(/```(\w*)\n([\s\S]*?)```/g,'<pre><code>$2</code></pre>').replace(/`([^`\n]+)`/g,'<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g,'<b>$1</b>');
let me,cur,busy=false;
const showLogin=()=>{$('#app').hidden=true;$('#login').hidden=false};
$('#lf').onsubmit=async e=>{e.preventDefault();try{await api('/login',{method:'POST',body:{username:$('#lu').value,password:$('#lp').value}});$('#lp').value='';boot()}catch(x){$('#le').textContent=x.message}};
$('#out').onclick=async()=>{await api('/logout',{method:'POST'}).catch(()=>{});showLogin()};
async function boot(){try{me=await api('/me')}catch{return showLogin()}
  $('#login').hidden=true;$('#app').hidden=false;$('#adm').hidden=me.role!=='admin';
  $('#model').innerHTML=(await api('/models')).map(m=>`<option>${esc(m)}</option>`).join('');await loadPersonas();await loadConvs()}
const loadPersonas=async()=>{const v=$('#persona').value;$('#persona').innerHTML=(await api('/personas')).map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');if(v)$('#persona').value=v};
async function loadConvs(){const l=await api('/convs');$('#convs').innerHTML=l.map(c=>`<li data-id="${c.id}" class="${c.id===cur?'on':''}"><b>${esc(c.title)}</b><i data-d="${c.id}">×</i></li>`).join('');
  if(!cur&&l[0])open(l[0].id);else if(!l.length)newConv()}
$('#convs').onclick=async e=>{const d=e.target.dataset.d;if(d){await api('/convs/'+d,{method:'DELETE'});if(cur===d)cur=null;return loadConvs()}const li=e.target.closest('li');if(li)open(li.dataset.id)};
const newConv=async()=>{cur=(await api('/convs',{method:'POST'})).id;await open(cur);loadConvs()};$('#new').onclick=newConv;
async function open(id){cur=id;$('#chat').innerHTML='';(await api('/convs/'+id)).forEach(m=>add(m.role,m.content));loadFiles();document.querySelectorAll('#convs li').forEach(l=>l.classList.toggle('on',l.dataset.id===id))}
const add=(r,t)=>{const d=document.createElement('div');d.className='m '+r;d.innerHTML=md(t);$('#chat').append(d);$('#chat').scrollTop=1e9;return d};
async function loadFiles(){const f=await api(`/convs/${cur}/files`);$('#files').innerHTML=f.map(n=>`<li><a href="/api/convs/${cur}/files/${encodeURI(n)}" download>${esc(n)}</a></li>`).join('')||'<li style="color:var(--mu)">Belum ada file</li>';
  $('#zip').hidden=!f.length;$('#zip').href=`/api/convs/${cur}/zip`}
$('#fi').onchange=async e=>{const fd=new FormData();[...e.target.files].forEach(f=>fd.append('files',f));await fetch(`/api/convs/${cur}/upload`,{method:'POST',body:fd,credentials:'same-origin'});e.target.value='';loadFiles();add('t','Terlampir: file tersedia di workspace.')};
$('#in').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('#cf').requestSubmit()}});
$('#cf').onsubmit=async e=>{e.preventDefault();const message=$('#in').value.trim();if(!message||busy)return;busy=true;$('#in').value='';add('user',message);
  const r=await fetch('/api/chat',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({convId:cur,message,personaId:$('#persona').value,model:$('#model').value})});
  if(!r.ok){add('assistant','Gagal mengirim.');busy=false;return}
  const rd=r.body.getReader(),dc=new TextDecoder();let buf='';
  while(true){const{value,done}=await rd.read();if(done)break;buf+=dc.decode(value,{stream:true});const parts=buf.split('\n\n');buf=parts.pop();
    for(const p of parts){if(!p.startsWith('data: '))continue;const ev=JSON.parse(p.slice(6));
      if(ev.type==='text')add('assistant',ev.text);else if(ev.type==='tool')add('t',({web_search:'Mencari',fetch_url:'Membaca',write_file:'Menulis',read_file:'Membuka',create_zip:'Membuat zip',list_files:'Melihat file'}[ev.name]||ev.name)+' '+ev.arg);
      else if(ev.type==='files')loadFiles();else if(ev.type==='error')add('assistant','Error: '+ev.error)}}
  busy=false;loadConvs()};
// ---- Admin
const dlg=$('#dlg');$('#adm').onclick=()=>{dlg.showModal();tab('personas')};$('#cl').onclick=()=>{dlg.close();loadPersonas()};
dlg.querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>tab(b.dataset.t));
async function tab(t){const P=$('#panel');
  if(t==='pw'){P.innerHTML='<input id="np" type="password" placeholder="Password baru (min 8)"><button id="sp">Ganti password</button><p id="pm"></p>';
    $('#sp').onclick=async()=>{try{await api('/admin/password',{method:'POST',body:{password:$('#np').value}});$('#pm').textContent='Tersimpan'}catch(e){$('#pm').textContent=e.message}};return}
  const f=t==='personas'?[['name','Nama'],['prompt','Instruksi / kepribadian AI']]:[['name','Nama skill'],['description','Deskripsi'],['instructions','Instruksi skill']];
  const rows=await api('/'+t);
  P.innerHTML=rows.map(r=>`<div class="row" data-id="${r.id}">${f.map(([k,l])=>k==='name'||k==='description'?`<input data-k="${k}" placeholder="${l}" value="${esc(r[k]||'')}">`:`<textarea data-k="${k}" placeholder="${l}">${esc(r[k]||'')}</textarea>`).join('')}<div>${t==='skills'?`<label><input type="checkbox" data-k="enabled" ${r.enabled?'checked':''} style="width:auto"> Aktif</label>`:''}<button data-s>Simpan</button><button class="del" data-x>Hapus</button></div></div>`).join('')+'<button id="add">Tambah baru</button>';
  P.onclick=async e=>{const row=e.target.closest('.row');
    if(e.target.id==='add'){await api('/'+t,{method:'POST',body:{name:'Baru',description:'',prompt:'',instructions:'',enabled:1}});return tab(t)}
    if(!row)return;const id=row.dataset.id;
    if(e.target.dataset.x!==undefined){await api(`/${t}/${id}`,{method:'DELETE'});return tab(t)}
    if(e.target.dataset.s!==undefined){const b={};row.querySelectorAll('[data-k]').forEach(i=>b[i.dataset.k]=i.type==='checkbox'?(i.checked?1:0):i.value);await api(`/${t}/${id}`,{method:'PUT',body:b});e.target.textContent='Tersimpan';setTimeout(()=>e.target.textContent='Simpan',1200)}}}
boot()})();
