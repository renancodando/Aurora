const CACHE='aurora-projetos-v2';
const BASE_URL=new URL('./',location.href);
const BASE_PATH=BASE_URL.pathname;
const LIMITE_TOTAL=512*1024*1024;
const LIMITE_ARQUIVO=128*1024*1024;
const LIMITE_ARQUIVOS=25000;
const LIMITE_HTML=5*1024*1024;

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
  await navigator.serviceWorker.register(new URL('aurora-sw.js',BASE_URL).pathname,{scope:BASE_PATH});
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
  if(arquivos.length>LIMITE_ARQUIVOS)throw new Error('O projeto possui arquivos demais.');
  const total=arquivos.reduce((s,x)=>s+(x.blob?.size||0),0);
  if(total>LIMITE_TOTAL)throw new Error('O projeto ultrapassa o limite seguro de 512 MB.');
  if(arquivos.some(x=>(x.blob?.size||0)>LIMITE_ARQUIVO))throw new Error('O projeto contém um arquivo maior que 128 MB.');

  await garantirWorker();
  const caminhos=arquivos.map(x=>normalizar(x.path)).filter(Boolean);
  const {index,base}=baseDoIndex(caminhos);
  const id=idProjeto();
  await caches.delete(CACHE);
  const cache=await caches.open(CACHE);
  const publicados=[];

  for(const arq of arquivos){
    const original=normalizar(arq.path);
    if(!original||!original.startsWith(base))continue;
    const path=original.slice(base.length)||'index.html';
    const blob=arq.blob instanceof Blob?arq.blob:new Blob([arq.blob]);
    const resposta=new Response(blob,{headers:{'Content-Type':tipo(path),'Cache-Control':'no-store'}});
    const url=new URL('__aurora__/'+id+'/'+path,BASE_URL);
    await cache.put(url.toString(),resposta);
    publicados.push({path,blob});
  }

  if(!publicados.some(x=>/^index\.html?$/i.test(x.path)))throw new Error('O index.html não pôde ser preparado.');

  return {
    id,
    nome:nomeProjeto(nome),
    entrada,
    quantidadeArquivos:publicados.length,
    urlPreview:new URL('__aurora__/'+id+'/index.html',BASE_URL).pathname,
    local:true,
    arquivos:publicados
  };
}

export async function importarZipLocal(arquivo){
  if(!window.JSZip)throw new Error('O leitor de ZIP ainda não carregou.');
  if(arquivo.size>LIMITE_TOTAL)throw new Error('O ZIP ultrapassa o limite de 512 MB.');

  const zip=await window.JSZip.loadAsync(arquivo);
  const entradas=Object.entries(zip.files).filter(([path,item])=>!item.dir&&!path.startsWith('__MACOSX/'));
  if(entradas.length>LIMITE_ARQUIVOS)throw new Error('O ZIP possui arquivos demais.');

  let declarado=0;
  for(const [,item] of entradas){
    const tamanho=Number(item?._data?.uncompressedSize||0);
    if(tamanho>LIMITE_ARQUIVO)throw new Error('O ZIP contém um arquivo maior que 128 MB.');
    declarado+=tamanho;
    if(declarado>LIMITE_TOTAL)throw new Error('O conteúdo extraído ultrapassa 512 MB.');
  }

  const arquivos=[];
  let total=0;
  for(const [path,item] of entradas){
    const blob=await item.async('blob');
    total+=blob.size;
    if(blob.size>LIMITE_ARQUIVO||total>LIMITE_TOTAL)throw new Error('O conteúdo extraído ultrapassa o limite seguro.');
    arquivos.push({path,blob});
  }
  return publicar(arquivos,arquivo.name,'ZIP local');
}

export async function importarPastaLocal(lista){
  const arquivos=[...lista].filter(x=>x instanceof File);
  if(!arquivos.length)throw new Error('A pasta está vazia.');
  if(arquivos.length>LIMITE_ARQUIVOS)throw new Error('A pasta possui arquivos demais.');
  const total=arquivos.reduce((s,x)=>s+x.size,0);
  if(total>LIMITE_TOTAL)throw new Error('A pasta ultrapassa o limite de 512 MB.');
  if(arquivos.some(x=>x.size>LIMITE_ARQUIVO))throw new Error('A pasta contém um arquivo maior que 128 MB.');
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
  if(relatorio.diferencas){
    zip.file('aurora-diferencas.json',JSON.stringify(relatorio.diferencas,null,2));
    const linhas=['# Diferenças geradas pelo AURORA',''];
    for(const item of relatorio.diferencas.itens||[]){
      linhas.push('## '+(item.seletor||item.titulo||'Correção'));
      linhas.push('');
      linhas.push('Problema: '+(item.titulo||item.tipo||'ajuste responsivo'));
      linhas.push('');
      linhas.push('Antes:');
      for(const x of item.antes||[])linhas.push('- '+x);
      linhas.push('');
      linhas.push('Depois:');
      for(const x of item.depois||[])linhas.push('- '+x);
      linhas.push('');
      if(item.explicacao)linhas.push('Como foi corrigido: '+item.explicacao);
      linhas.push('');
    }
    zip.file('aurora-diferencas.md',linhas.join('\n'));
  }
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

  let html='';
  let finalUrl=destino.toString();

  try{
    const direta=await fetch(finalUrl,{mode:'cors',redirect:'follow'});
    if(!direta.ok)throw new Error();
    const tamanho=Number(direta.headers.get('content-length')||0);
    if(tamanho>LIMITE_HTML)throw new Error('Página grande demais.');
    html=await direta.text();
    if(new Blob([html]).size>LIMITE_HTML)throw new Error('Página grande demais.');
    finalUrl=direta.url||finalUrl;
  }catch{
    if(location.hostname.endsWith('github.io'))throw new Error('No GitHub Pages, a importação por URL depende do CORS do site. Use ZIP, Pasta, GitHub ou abra a versão da Vercel para URLs bloqueadas.');
    const proxy=await fetch(new URL('api/proxy-url?url='+encodeURIComponent(finalUrl),location.origin+'/'));
    const dados=await proxy.json().catch(()=>({}));
    if(!proxy.ok)throw new Error(dados.erro||'A página bloqueou a importação por URL.');
    html=dados.html||'';
    finalUrl=dados.finalUrl||finalUrl;
  }

  const base='<base href="'+finalUrl.replaceAll('"','&quot;')+'">';
  const preparado=/<head[^>]*>/i.test(html)?html.replace(/<head([^>]*)>/i,'<head$1>'+base):base+html;
  return publicar([{path:'index.html',blob:new Blob([preparado],{type:'text/html'})}],new URL(finalUrl).hostname,'URL');
}
