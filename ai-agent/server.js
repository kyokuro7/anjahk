'use strict';
const express=require('express'),helmet=require('helmet'),rate=require('express-rate-limit'),cookie=require('cookie-parser'),multer=require('multer'),archiver=require('archiver'),Database=require('better-sqlite3'),crypto=require('crypto'),fs=require('fs'),path=require('path'),dns=require('dns').promises,net=require('net');
const {PORT=3000,AI_BASE_URL,AI_API_KEY}=process.env;
const DATA=path.join(__dirname,'data'),WS=path.join(DATA,'workspaces');
fs.mkdirSync(WS,{recursive:true});
const db=new Database(path.join(DATA,'app.db'));db.pragma('journal_mode=WAL');
db.exec(`create table if not exists users(id integer primary key,username text unique,hash text,role text);
create table if not exists sessions(token text primary key,user_id int,exp int);
create table if not exists personas(id integer primary key,name text,prompt text);
create table if not exists skills(id integer primary key,name text unique,description text,instructions text,enabled int default 1);
create table if not exists convs(id text primary key,user_id int,title text,created int);
create table if not exists msgs(id integer primary key,conv_id text,json text);`);
// ---- password (scrypt, terenkripsi satu arah)
const hash=p=>{const s=crypto.randomBytes(16);return s.toString('hex')+':'+crypto.scryptSync(p,s,64).toString('hex')};
const verify=(p,h)=>{const[s,k]=h.split(':');const d=crypto.scryptSync(p,Buffer.from(s,'hex'),64);return crypto.timingSafeEqual(d,Buffer.from(k,'hex'))};
if(!db.prepare('select 1 from users').get()&&process.env.ADMIN_USER&&process.env.ADMIN_PASS)
  db.prepare('insert into users(username,hash,role) values(?,?,?)').run(process.env.ADMIN_USER,hash(process.env.ADMIN_PASS),'admin');
if(!db.prepare('select 1 from personas').get())db.prepare('insert into personas(name,prompt) values(?,?)').run('Programmer Handal','Kamu adalah AI agent senior yang menulis kode rapi, aman, dan lengkap. Jawab dalam bahasa pengguna.');
console.log('DB:',path.join(DATA,'app.db'),'| jumlah user:',db.prepare('select count(*) c from users').get().c);
// ---- app
const app=express();app.disable('x-powered-by');app.set('trust proxy',1);
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'"],imgSrc:["'self'","data:"],connectSrc:["'self'"],objectSrc:["'none'"],frameAncestors:["'none'"]}}}));
app.use(cookie(),express.json({limit:'2mb'}));
app.use('/api',rate({windowMs:60000,limit:120}));
app.use(express.static(path.join(__dirname,'public'),{dotfiles:'deny',index:'index.html',etag:false,setHeaders:r=>r.setHeader('Cache-Control','no-store')}));
const auth=(req,res,next)=>{const t=req.cookies.sid;const r=t&&db.prepare('select u.id,u.username,u.role,s.exp from sessions s join users u on u.id=s.user_id where s.token=?').get(t);
  if(!r||r.exp<Date.now())return res.status(401).json({error:'Belum login'});req.user=r;next()};
const admin=(req,res,next)=>req.user.role==='admin'?next():res.status(403).json({error:'Hanya admin'});
app.post('/api/login',rate({windowMs:900000,limit:10,message:{error:'Terlalu banyak percobaan'}}),(req,res)=>{
  const{username='',password=''}=req.body||{};const pw=String(password).trim();const u=db.prepare('select * from users where lower(username)=lower(?)').get(String(username).trim());
  if(!u||!verify(pw,u.hash)){console.log('Login gagal: user_ada='+!!u+' panjang_pw='+pw.length);return res.status(401).json({error:'Username atau password salah'})}
  const t=crypto.randomBytes(32).toString('hex');db.prepare('insert into sessions values(?,?,?)').run(t,u.id,Date.now()+864e5*7);
  res.cookie('sid',t,{httpOnly:true,sameSite:'lax',secure:req.secure,maxAge:864e5*7});res.json({ok:1})});
app.post('/api/logout',auth,(req,res)=>{db.prepare('delete from sessions where token=?').run(req.cookies.sid);res.clearCookie('sid');res.json({ok:1})});
app.get('/api/me',auth,(req,res)=>res.json({username:req.user.username,role:req.user.role}));
app.post('/api/admin/password',auth,admin,(req,res)=>{const p=String(req.body.password||'');if(p.length<8)return res.status(400).json({error:'Minimal 8 karakter'});
  db.prepare('update users set hash=? where id=?').run(hash(p),req.user.id);res.json({ok:1})});
// ---- CRUD personalisasi & skills
const crud=(tbl,cols)=>{const r=express.Router();r.use(auth);
  r.get('/',(q,s)=>s.json(db.prepare(`select * from ${tbl} order by id`).all()));
  r.post('/',admin,(q,s)=>{try{const i=db.prepare(`insert into ${tbl}(${cols}) values(${cols.split(',').map(()=>'?').join(',')})`).run(...cols.split(',').map(c=>q.body[c]??(c==='enabled'?1:'')));s.json({id:i.lastInsertRowid})}catch(e){s.status(400).json({error:e.message})}});
  r.put('/:id',admin,(q,s)=>{db.prepare(`update ${tbl} set ${cols.split(',').map(c=>c+'=?').join(',')} where id=?`).run(...cols.split(',').map(c=>q.body[c]??''),q.params.id);s.json({ok:1})});
  r.delete('/:id',admin,(q,s)=>{db.prepare(`delete from ${tbl} where id=?`).run(q.params.id);s.json({ok:1})});return r};
app.use('/api/personas',crud('personas','name,prompt'));
app.use('/api/skills',crud('skills','name,description,instructions,enabled'));
// ---- model
let cache;const models=async()=>{if(cache)return cache;const r=await fetch(AI_BASE_URL+'/models',{headers:{Authorization:'Bearer '+AI_API_KEY}});cache=((await r.json()).data||[]).map(m=>m.id);setTimeout(()=>cache=null,3e5);return cache};
app.get('/api/models',auth,async(q,s)=>{try{s.json(await models())}catch{s.json([])}});
// ---- percakapan & file
const own=(req,id)=>db.prepare('select * from convs where id=? and user_id=?').get(String(id),req.user.id);
const dirOf=id=>{const d=path.join(WS,id);fs.mkdirSync(d,{recursive:true});return d};
const safe=(id,name)=>{const d=dirOf(id),p=path.resolve(d,String(name).replace(/^[\\/]+/,''));if(!p.startsWith(d+path.sep))throw new Error('Path tidak valid');return p};
const walk=(d,b=d)=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name),b):[path.relative(b,path.join(d,e.name))]);
app.get('/api/convs',auth,(q,s)=>s.json(db.prepare('select id,title from convs where user_id=? order by created desc').all(q.user.id)));
app.post('/api/convs',auth,(q,s)=>{const id=crypto.randomUUID();db.prepare('insert into convs values(?,?,?,?)').run(id,q.user.id,'Percakapan baru',Date.now());s.json({id})});
app.delete('/api/convs/:id',auth,(q,s)=>{if(own(q,q.params.id)){db.prepare('delete from convs where id=?').run(q.params.id);db.prepare('delete from msgs where conv_id=?').run(q.params.id);fs.rmSync(path.join(WS,q.params.id),{recursive:true,force:true})}s.json({ok:1})});
app.get('/api/convs/:id',auth,(q,s)=>{if(!own(q,q.params.id))return s.status(404).end();
  s.json(db.prepare('select json from msgs where conv_id=? order by id').all(q.params.id).map(r=>JSON.parse(r.json)).filter(m=>(m.role==='user'||m.role==='assistant')&&m.content))});
app.get('/api/convs/:id/files',auth,(q,s)=>{if(!own(q,q.params.id))return s.status(404).end();s.json(walk(dirOf(q.params.id)).filter(f=>f!=='.'))});
app.get('/api/convs/:id/files/*',auth,(q,s)=>{if(!own(q,q.params.id))return s.status(404).end();try{s.download(safe(q.params.id,q.params[0]))}catch{s.status(404).end()}});
app.get('/api/convs/:id/zip',auth,(q,s)=>{if(!own(q,q.params.id))return s.status(404).end();s.attachment('hasil.zip');const z=archiver('zip');z.pipe(s);z.directory(dirOf(q.params.id),false);z.finalize()});
const up=multer({storage:multer.diskStorage({destination:(q,f,cb)=>cb(null,own(q,q.params.id)?dirOf(q.params.id):'/tmp'),filename:(q,f,cb)=>cb(null,path.basename(f.originalname))}),limits:{fileSize:50e6}});
app.post('/api/convs/:id/upload',auth,(q,s,n)=>own(q,q.params.id)?n():s.status(404).end(),up.array('files',10),(q,s)=>s.json({ok:1}));
// ---- tools agent
const priv=ip=>/^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1|f[cd])/i.test(ip);
const text=h=>h.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi,'').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#x27;|&#39;/g,"'").replace(/\s+/g,' ').trim();
const UA={'User-Agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36'};
async function fetchUrl(u,max=12000){const url=new URL(u);if(!/^https?:$/.test(url.protocol))throw new Error('Hanya http/https');
  const ips=net.isIP(url.hostname)?[{address:url.hostname}]:await dns.lookup(url.hostname,{all:true});if(ips.some(i=>priv(i.address)))throw new Error('Alamat internal diblokir');
  const r=await fetch(u,{headers:UA,signal:AbortSignal.timeout(15000),redirect:'follow'});const t=await r.text();return (r.headers.get('content-type')||'').includes('html')?text(t).slice(0,max):t.slice(0,max)}
async function search(query,n=8){const out=[];
  try{const r=await fetch('https://html.duckduckgo.com/html/?q='+encodeURIComponent(query),{headers:UA,signal:AbortSignal.timeout(15000)});const h=await r.text();
    const re=/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;let m;
    while((m=re.exec(h))&&out.length<n){let l=m[1];const q=l.match(/uddg=([^&]+)/);if(q)l=decodeURIComponent(q[1]);out.push({title:text(m[2]),url:l.startsWith('//')?'https:'+l:l,snippet:text(m[3])})}}catch{}
  try{const r=await fetch('https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=3&srsearch='+encodeURIComponent(query),{signal:AbortSignal.timeout(10000)});
    for(const x of (await r.json()).query.search)out.push({title:'Wikipedia: '+x.title,url:'https://en.wikipedia.org/wiki/'+encodeURIComponent(x.title.replace(/ /g,'_')),snippet:text(x.snippet)})}catch{}
  return out}
const TOOLS=[['web_search','Cari informasi di internet. Panggil berkali-kali dengan kata kunci berbeda untuk cakupan luas.',{query:'string'}],
['fetch_url','Baca isi halaman web (teks) dari URL.',{url:'string'}],
['write_file','Tulis/timpa file di workspace (boleh subfolder). Pengguna bisa mengunduhnya.',{path:'string',content:'string'}],
['read_file','Baca file di workspace (termasuk file unggahan pengguna).',{path:'string'}],
['list_files','Daftar semua file di workspace.',{}],
['create_zip','Buat file zip dari file-file workspace.',{name:'string',files:'array'}]]
 .map(([name,description,p])=>({type:'function',function:{name,description,parameters:{type:'object',properties:Object.fromEntries(Object.entries(p).map(([k,t])=>[k,t==='array'?{type:'array',items:{type:'string'}}:{type:t}])),required:Object.keys(p)}}}));
async function runTool(id,name,a){try{switch(name){
  case'web_search':return JSON.stringify(await search(a.query));
  case'fetch_url':return await fetchUrl(a.url);
  case'write_file':{const p=safe(id,a.path);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,a.content);return'Tersimpan: '+a.path}
  case'read_file':return fs.readFileSync(safe(id,a.path),'utf8').slice(0,30000);
  case'list_files':return JSON.stringify(walk(dirOf(id)));
  case'create_zip':{const out=safe(id,a.name.endsWith('.zip')?a.name:a.name+'.zip');await new Promise((ok,no)=>{const w=fs.createWriteStream(out),z=archiver('zip');w.on('close',ok);z.on('error',no);z.pipe(w);for(const f of a.files)z.file(safe(id,f),{name:f});z.finalize()});return'ZIP dibuat: '+path.basename(out)}
  default:return'Tool tidak dikenal'}}catch(e){return'ERROR: '+e.message}}
// ---- chat (SSE)
app.post('/api/chat',auth,async(req,res)=>{const{convId,message,personaId,model}=req.body||{};const c=own(req,convId);if(!c||!message)return res.status(400).json({error:'Bad request'});
  res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache','X-Accel-Buffering':'no'});const send=e=>res.write('data: '+JSON.stringify(e)+'\n\n');
  const save=m=>db.prepare('insert into msgs(conv_id,json) values(?,?)').run(convId,JSON.stringify(m));
  try{const persona=db.prepare('select prompt from personas where id=?').get(personaId)||db.prepare('select prompt from personas').get();
    const skills=db.prepare('select name,instructions from skills where enabled=1').all();
    const sys=`${persona?.prompt||''}\n\nKamu AI agent dengan tool. Untuk membuat kode/proyek, SELALU simpan dengan write_file lalu beri tahu pengguna file yang tersedia (mereka mengunduh dari panel Files; gunakan create_zip untuk banyak file). Untuk pertanyaan faktual/terkini, lakukan beberapa web_search dengan kata kunci berbeda dan baca beberapa halaman dengan fetch_url sebelum menjawab, sebutkan sumber URL.`+
      (skills.length?'\n\n# Skills aktif\n'+skills.map(s=>`## ${s.name}\n${s.instructions}`).join('\n\n'):'');
    const hist=db.prepare('select json from msgs where conv_id=? order by id').all(convId).map(r=>JSON.parse(r.json));
    const user={role:'user',content:String(message)};save(user);hist.push(user);
    if(c.title==='Percakapan baru')db.prepare('update convs set title=? where id=?').run(String(message).slice(0,40),convId);
    const mdl=model||process.env.MODEL||(await models())[0];
    for(let i=0;i<15;i++){
      const r=await fetch(AI_BASE_URL+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+AI_API_KEY},body:JSON.stringify({model:mdl,messages:[{role:'system',content:sys},...hist.slice(-60)],tools:TOOLS})});
      const j=await r.json();if(!r.ok)throw new Error(j.error?.message||'Error API '+r.status);
      const m=j.choices[0].message;const am={role:'assistant',content:m.content||'',...(m.tool_calls?.length?{tool_calls:m.tool_calls}:{})};save(am);hist.push(am);
      if(am.content)send({type:'text',text:am.content});
      if(!m.tool_calls?.length)break;
      for(const t of m.tool_calls){let a={};try{a=JSON.parse(t.function.arguments||'{}')}catch{}
        send({type:'tool',name:t.function.name,arg:a.query||a.url||a.path||a.name||''});
        const out=await runTool(convId,t.function.name,a);const tm={role:'tool',tool_call_id:t.id,content:String(out).slice(0,30000)};save(tm);hist.push(tm);
        if(['write_file','create_zip'].includes(t.function.name))send({type:'files'})}}
  }catch(e){send({type:'error',error:e.message})}
  send({type:'done'});res.end()});
app.listen(PORT,'127.0.0.1',()=>console.log('AI Agent berjalan di port '+PORT));
