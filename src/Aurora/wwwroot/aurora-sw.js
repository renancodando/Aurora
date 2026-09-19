const CACHE='aurora-projetos-v2';
const BASE_PATH=new URL(self.registration.scope).pathname;
const PREFIXO=BASE_PATH+'__aurora__/';

self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));

function projetoDoReferrer(referrer){
  try{
    const u=new URL(referrer);
    if(!u.pathname.startsWith(PREFIXO))return null;
    const resto=u.pathname.slice(PREFIXO.length);
    return resto.split('/')[0]||null;
  }catch{return null}
}

self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;

  if(url.pathname.startsWith(PREFIXO)){
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE);
      const limpa=new URL(url);
      limpa.search='';
      return await cache.match(limpa.toString())||new Response('Arquivo não encontrado',{status:404});
    })());
    return;
  }

  const projeto=projetoDoReferrer(event.request.referrer);
  if(!projeto)return;

  if(!url.pathname.startsWith(BASE_PATH))return;

  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    const relativo=url.pathname.slice(BASE_PATH.length).replace(/^\/+/, '');
    const virtual=new URL('__aurora__/'+projeto+'/'+relativo,self.registration.scope);
    const resposta=await cache.match(virtual.toString());
    return resposta||fetch(event.request);
  })());
});
