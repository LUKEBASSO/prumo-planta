const fs=require('fs');
let h=fs.readFileSync('src/index.html','utf8');
const rep=(k,f)=>{ h=h.replace('/*'+k+'*/',()=>fs.readFileSync(f,'utf8').replace(/<\/script/gi,'<\\/script')); };
// CSS do Leaflet sem as referências a imagens (não usamos os ícones padrão)
fs.writeFileSync('/tmp/leaflet.css',fs.readFileSync('node_modules/leaflet/dist/leaflet.css','utf8').replace(/url\([^)]*\)/g,'none'));
rep('LEAFLET_CSS','/tmp/leaflet.css'); rep('LEAFLET_JS','node_modules/leaflet/dist/leaflet.js'); rep('GEO_JS','src/geo.js'); rep('APP_JS','src/app.js');
fs.writeFileSync('dist/index.html',h);
const ver=Date.now();
fs.writeFileSync('dist/sw.js',`const C='prumo-planta-${ver}';
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(['./','index.html','manifest.webmanifest','icon-192.png','icon-512.png'])).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url); if(e.request.method!=='GET'||u.origin!==location.origin) return;
  e.respondWith(fetch(e.request).then(r=>{const cp=r.clone(); caches.open(C).then(c=>c.put(e.request,cp)); return r;}).catch(()=>caches.match(e.request).then(r=>r||caches.match('index.html'))));});
`);
fs.writeFileSync('dist/manifest.webmanifest',JSON.stringify({name:'Prumo Planta',short_name:'Prumo Planta',description:'Levantamento expedito de planta de layout',start_url:'./',scope:'./',display:'standalone',background_color:'#f6f8f7',theme_color:'#1f4d3a',lang:'pt-BR',icons:[{src:'icon-192.png',sizes:'192x192',type:'image/png'},{src:'icon-512.png',sizes:'512x512',type:'image/png',purpose:'any maskable'}]},null,1));
console.log('ok',(h.length/1024).toFixed(0)+' KB');
