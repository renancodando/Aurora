const CACHE='aurora-projetos-v1';

const tipos={
  html:'text/html;charset=utf-8',htm:'text/html;charset=utf-8',css:'text/css;charset=utf-8',js:'text/javascript;charset=utf-8',mjs:'text/javascript;charset=utf-8',
  json:'application/json;charset=utf-8',svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',ico:'image/x-icon',
  woff:'font/woff',woff2:'font/woff2',ttf:'font/ttf',otf:'font/otf',mp3:'audio/mpeg',wav:'audio/wav',mp4:'video/mp4',webm:'video/webm',pdf:'application/pdf'
};

function normalizar(caminho){
  const partes=[];
  for(const p of String(caminho||'').replaceAll('\\','/').split('/')){
    if(!p||p==='.')continue;
    if(p==='..'){partes.pop();continue}
    partes.push(p);
  }
  return partes.join('/');
}

function tipo(caminho){
  const ext=caminho.split('.').pop().toLowerCase();
  return tipos[ext]||'application/octet-stream';
}

function nomeProjeto(nome){
  return String(nome||'projeto').replace(/\.zip$/i,'').replace(/[^a-zA-Z0-9À-ÿ._-]+/g,'-').replace(/^-+|-+$/g,'')||'projeto';
}

function idProjeto(){
  return 'p'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
}

async function garantirWorker(){
  if(!('serviceWorker'in navigator))throw new Error('Este navegador não permite o workspace local do AURORA.');
  await navigator.serviceWorker.register('/aurora-sw.js',{scope:'/'});
  await navigator.serviceWorker.ready;
  if(!navigator.serviceWorker.controller){
    await new Promise(resolve=>{
      const timer=setTimeout(resolve,1800);
      navigator.serviceWorker.addEventListener('controllerchange',()=>{clearTimeout(timer);resolve()},{once:true});
    });
  }
}

function baseDoIndex(caminhos){
  const indices=caminhos.filter(x=>/(^|\/)index\.html?$/i.test(x)).sort((a,b)=>a.split('/').length-b.split('/').length||a.length-b.length);
  if(!indices.length)throw new Error('Não encontrei um index.html no projeto.');
  const index=indices[0];
  const pos=index.lastIndexOf('/');
  return {index,base:pos>=0?index.slice(0,pos+1):''};
}

async function publicar(arquivos,nome,entrada){
  await garantirWorker();
  const caminhos=arquivos.map(x=>normalizar(x.path)).filter(Boolean);
  const {index,base}=baseDoIndex(caminhos);
  const id=idProjeto();
  const cache=await caches.open(CACHE);
  const publicados=[];

  for(const arq of arquivos){
    const original=normalizar(arq.path);
    if(!original||!original.startsWith(base))continue;
    const path=original.slice(base.length)||'index.html';
    const blob=arq.blob instanceof Blob?arq.blob:new Blob([arq.blob]);
    const resposta=new Response(blob,{headers:{'Content-Type':tipo(path),'Cache-Control':'no-store'}});
    const url=new URL('/__aurora__/'+id+'/'+path,location.origin);
    await cache.put(url.toString(),resposta);
    publicados.push({path,blob});
  }

  if(!publicados.some(x=>/^index\.html?$/i.test(x.path)))throw new Error('O index.html não pôde ser preparado.');

  return {
    id,
    nome:nomeProjeto(nome),
    entrada,
    quantidadeArquivos:publicados.length,
    urlPreview:'/__aurora__/'+id+'/index.html',
    local:true,
    arquivos:publicados
  };
}

export async function importarZipLocal(arquivo){
  if(!window.JSZip)throw new Error('O leitor de ZIP ainda não carregou.');
  const zip=await window.JSZip.loadAsync(arquivo);
  const arquivos=[];
  for(const [path,item] of Object.entries(zip.files)){
    if(item.dir||path.startsWith('__MACOSX/'))continue;
    arquivos.push({path,blob:await item.async('blob')});
  }
  return publicar(arquivos,arquivo.name,'ZIP local');
}

export async function importarPastaLocal(lista){
  const arquivos=[...lista].filter(x=>x instanceof File);
  if(!arquivos.length)throw new Error('A pasta está vazia.');
  const raiz=(arquivos[0].webkitRelativePath||'').split('/')[0]||'projeto';
  return publicar(arquivos.map(x=>({path:x.webkitRelativePath||x.name,blob:x})),raiz,'Pasta local');
}

export async function exportarProjetoLocal(projeto,css='',relatorio={}){
  if(!window.JSZip)throw new Error('O gerador de ZIP ainda não carregou.');
  const zip=new window.JSZip();

  for(const arq of projeto.arquivos||[]){
    if(/^index\.html?$/i.test(arq.path)&&css){
      let html=await arq.blob.text();
      const link='<link rel="stylesheet" href="aurora-correcoes.css">';
      html=/<\/head>/i.test(html)?html.replace(/<\/head>/i,link+'</head>'):link+html;
      zip.file(arq.path,html);
    }else{
      zip.file(arq.path,arq.blob);
    }
  }

  if(css)zip.file('aurora-correcoes.css',css);
  zip.file('aurora-relatorio.json',JSON.stringify(relatorio,null,2));
  const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=projeto.nome+'-AURORA.zip';document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),4000);
}


export async function importarGitHubLocal(url){
  const u=new URL(url);
  if(u.hostname!=='github.com')throw new Error('Use um link público do GitHub.');
  const partes=u.pathname.split('/').filter(Boolean);
  if(partes.length<2)throw new Error('Link do repositório incompleto.');
  const [owner,repoBruto]=partes;
  const repo=repoBruto.replace(/\.git$/i,'');
  const resposta=await fetch('https://api.github.com/repos/'+encodeURIComponent(owner)+'/'+encodeURIComponent(repo)+'/zipball',{
    headers:{Accept:'application/vnd.github+json'}
  });
  if(!resposta.ok)throw new Error('Não consegui baixar esse repositório público.');
  const blob=await resposta.blob();
  const arquivo=new File([blob],repo+'.zip',{type:'application/zip'});
  const projeto=await importarZipLocal(arquivo);
  projeto.nome=nomeProjeto(repo);
  projeto.entrada='GitHub público';
  return projeto;
}

export async function importarUrlLocal(url){
  const destino=new URL(url);
  if(!/^https?:$/.test(destino.protocol))throw new Error('Use uma URL http ou https.');
  const resposta=await fetch(destino.toString(),{mode:'cors',redirect:'follow'});
  if(!resposta.ok)throw new Error('Não consegui abrir essa URL.');
  const html=await resposta.text();
  const base='<base href="'+destino.toString().replaceAll('"','&quot;')+'">';
  const preparado=/<head[^>]*>/i.test(html)?html.replace(/<head([^>]*)>/i,'<head$1>'+base):base+html;
  return publicar([{path:'index.html',blob:new Blob([preparado],{type:'text/html'})}],destino.hostname,'URL');
}
