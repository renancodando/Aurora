import { iniciarAdaptiveEngine } from './adaptive.js';
import { obterClima as consultarClima, buscarCidades } from './clima.js';
import { iniciarCeu } from './ceu.js';
import { AuroraAnalise } from './analise.js';
import { gerarCorrecoes, aplicarNoPreview, limparPreview } from './correcoes.js';
import { importarZipLocal, importarPastaLocal, importarGitHubLocal, importarUrlLocal, exportarProjetoLocal } from './importacao-local.js';

iniciarAdaptiveEngine();

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const limitar=(n,a,b)=>Math.max(a,Math.min(b,n));

const estado = {
  projeto:null,
  largura:1200,
  altura:800,
  zoom:1,
  analise:null,
  fraturas:[],
  cssCorrecao:'',
  historico:[],
  local:JSON.parse(localStorage.getItem('aurora-local') || 'null') || {nome:'Vitória, ES',latitude:-20.3155,longitude:-40.3128,elevacao:4,timezone:'America/Sao_Paulo'},
  clima:{nuvens:22,baixas:12,medias:18,altas:24,vento:7,direcao:95,descricao:'atualizando'},
  importacao:'url'
};

const preview=$('#preview');
const analisador=new AuroraAnalise(preview);
let ceuEngine=null;
let ultimoCeuUi=0;
let resizeInicio=null;

function status(texto,detalhe='',mostrar=true){
  const box=$('#status-flutuante');
  box.hidden=!mostrar;
  $('#status-texto').textContent=texto;
  $('#status-detalhe').textContent=detalhe;
}

function toast(texto,detalhe=''){
  status(texto,detalhe,true);
  clearTimeout(toast.timer);
  toast.timer=setTimeout(()=>status('', '', false),2600);
}

function atualizarLocalCabecalho(){
  $('#cidade-atual').textContent=estado.local.nome || 'Localização';
}

async function atualizarClima(){
  try{
    const clima=await consultarClima(estado.local.latitude,estado.local.longitude);
    estado.clima=clima;
    if(clima.timezone && clima.timezone!=='auto') estado.local.timezone=clima.timezone;
    $('#condicao-clima').textContent=clima.descricao;
    $('#status-ceu').textContent='céu ao vivo';
  }catch{
    $('#condicao-clima').textContent='última condição';
    $('#status-ceu').textContent='céu local';
  }
}

function formatarData(data,opcoes){
  try{return new Intl.DateTimeFormat('pt-BR',{timeZone:estado.local.timezone,...opcoes}).format(data);}catch{return new Intl.DateTimeFormat('pt-BR',opcoes).format(data);}
}

function atualizarCeuUi(info){
  const agora=performance.now();
  if(agora-ultimoCeuUi<450)return;
  ultimoCeuUi=agora;
  $('#hora-local').textContent=formatarData(info.data,{hour:'2-digit',minute:'2-digit'});
  $('#data-local').textContent=formatarData(info.data,{weekday:'short',day:'2-digit',month:'short'}).replace('.','');
  $('#nome-lua').textContent=info.ceu.lua.nome;
  $('#percentual-lua').textContent=`${Math.round(info.ceu.lua.iluminacao*100)}%`;
}

async function iniciarAmbiente(){
  atualizarLocalCabecalho();
  await atualizarClima();
  setInterval(atualizarClima,15*60*1000);
  ceuEngine=await iniciarCeu({obterLocal:()=>estado.local,obterClima:()=>estado.clima,aoAtualizar:atualizarCeuUi});
}
iniciarAmbiente();

function dimensoesDisponiveis(){
  const r=$('#palco').getBoundingClientRect();
  return {w:Math.max(160,r.width-24),h:Math.max(180,r.height-24)};
}

async function aplicarViewport(largura,altura, silencioso=false){
  estado.largura=limitar(Math.round(Number(largura)||1200),280,3440);
  estado.altura=limitar(Math.round(Number(altura)||800),320,2160);
  $('#controle-largura').value=estado.largura;
  $('#largura-manual').value=estado.largura;
  $('#altura-manual').value=estado.altura;
  const bolha=$('#bolha-largura');
  if(bolha){bolha.textContent=estado.largura;bolha.style.left=`${(estado.largura-280)/(3440-280)*100}%`;}
  const resolucao=$('#resolucao-display');
  if(resolucao) resolucao.textContent=`${estado.largura} × ${estado.altura}`;
  if($('#janela-preview').hidden) return;

  const disp=dimensoesDisponiveis();
  const fit=Math.min(1,disp.w/estado.largura,disp.h/estado.altura)*estado.zoom;
  const viewport=$('#viewport'), janela=$('#janela-preview');
  viewport.style.width=`${estado.largura}px`;
  viewport.style.height=`${estado.altura}px`;
  viewport.style.transform=`scale(${fit})`;
  viewport.style.transformOrigin='top left';
  janela.style.width=`${Math.max(1,estado.largura*fit)}px`;
  janela.style.height=`${Math.max(1,estado.altura*fit)}px`;
  preview.style.width=`${estado.largura}px`;
  preview.style.height=`${estado.altura}px`;
  if(!silencioso && estado.projeto){
    await esperar(70);
    executarAnalise(false);
  }
}

function esperar(ms){return new Promise(r=>setTimeout(r,ms));}

async function importar(endpoint, body, tipo='form'){
  const progresso=$('#progresso-importacao');
  progresso.hidden=false;
  try{
    const op={method:'POST',body};
    if(tipo==='json'){op.headers={'Content-Type':'application/json'};op.body=JSON.stringify(body);}
    const r=await fetch(endpoint,op);
    const dados=await r.json().catch(()=>({erro:'Resposta inválida.'}));
    if(!r.ok) throw new Error(dados.erro || 'Não consegui importar o projeto.');
    $('#dialog-importar').close();
    await carregarProjeto(dados);
  }catch(e){toast('Não consegui importar',e.message);}
  finally{progresso.hidden=true;}
}

async function carregarProjeto(manifesto){
  estado.projeto=manifesto;
  estado.cssCorrecao=''; estado.fraturas=[]; estado.historico=[];
  $('#campo-origem').value=`${manifesto.nome} · ${manifesto.entrada}`;
  $('#estado-vazio').hidden=true;
  $('#janela-preview').hidden=false;
  $('#gerar-versao').disabled=false;
  $('#auto-ajustes').checked=false;
  preview.src=`${manifesto.urlPreview}${manifesto.urlPreview.includes('?')?'&':'?'}aurora=${Date.now()}`;
  status('abrindo projeto',`${manifesto.quantidadeArquivos} arquivos`);
  await aplicarViewport(1200,800,true);
}

preview.addEventListener('load',async()=>{
  if(!estado.projeto)return;
  await esperar(180);
  await aplicarViewport(estado.largura,estado.altura,true);
  executarAnalise(true);
  status('', '', false);
});

function desenharMarcacoes(problemas){
  const camada=$('#camada-marcacoes'); camada.replaceChildren();
  for(const p of problemas.filter(p=>p.rect).slice(0,16)){
    const d=document.createElement('div'); d.className='marcacao'; d.dataset.label=p.titulo;
    Object.assign(d.style,{left:`${p.rect.x}px`,top:`${p.rect.y}px`,width:`${p.rect.width}px`,height:`${p.rect.height}px`});
    camada.appendChild(d);
  }
}

function renderizarAnalise(r,marcar=true){
  estado.analise=r; estado.historico.push({largura:r.largura,altura:r.altura,integridade:r.integridade,problemas:r.problemas.length,quando:r.quando});
  if(estado.historico.length>80)estado.historico.shift();
  $('#integridade').textContent=`${r.integridade}%`;
  $('#anel-integridade').style.setProperty('--valor',r.integridade);
  $('#qtd-elementos').textContent=r.elementos;
  $('#qtd-erros').textContent=r.criticos;
  $('#qtd-avisos').textContent=r.avisos;
  $('#qtd-ocultos').textContent=r.ocultos;
  $('#contador-pontos').textContent=r.problemas.length;
  $('#anel-integridade').style.borderColor=r.criticos?'var(--erro)':r.avisos?'var(--aviso)':'var(--sucesso)';
  const saude=$('.saude-texto');
  if(saude){saude.querySelector('span').textContent=r.criticos?'Há fraturas no layout':r.avisos?'Layout estável com atenção':'Layout estável';saude.querySelector('small').textContent=`${r.elementos} elementos analisados · ${r.criticos} críticos · ${r.avisos} avisos`;}
  const metricas=$('.medidor dl'); if(metricas) metricas.hidden=false;
  const titulo=$('#titulo-layout'), sub=$('#subtitulo-layout'), bolinha=$('#estado-layout');
  bolinha.className='estado '+(r.criticos?'erro':r.avisos?'aviso':'ok');
  titulo.textContent=r.criticos?'Layout com fraturas':r.avisos?'Layout estável com atenção':'Layout estável';
  sub.textContent=r.criticos?`${r.criticos} problema${r.criticos>1?'s':''} crítico${r.criticos>1?'s':''}`:r.avisos?`${r.avisos} ajuste${r.avisos>1?'s':''} recomendado${r.avisos>1?'s':''}`:'nenhum problema crítico';

  const lista=$('#lista-problemas'); lista.replaceChildren();
  if(!r.problemas.length){const p=document.createElement('p');p.className='sem-dados';p.textContent='Nenhuma fratura nessa largura.';lista.appendChild(p);}
  for(const prob of r.problemas.slice(0,18)){
    const b=document.createElement('button'); b.className=`problema ${prob.severidade==='critico'?'critico':''}`;
    b.innerHTML=`<i></i><div><b></b><small></small></div><span>›</span>`;
    b.querySelector('b').textContent=prob.titulo; b.querySelector('small').textContent=prob.detalhe;
    b.addEventListener('click',()=>focarProblema(prob)); lista.appendChild(b);
  }
  if(marcar)desenharMarcacoes(r.problemas);

  if($('#auto-ajustes').checked){
    estado.cssCorrecao=gerarCorrecoes(r.problemas,{largura:estado.largura,fraturas:estado.fraturas});
    aplicarNoPreview(preview,estado.cssCorrecao);
  }
}

function executarAnalise(marcar=true){
  if(!estado.projeto)return;
  try{renderizarAnalise(analisador.analisarAtual({marcar}),marcar);}catch(e){toast('Análise indisponível',e.message);}
}

function focarProblema(prob){
  try{
    const el=preview.contentDocument.querySelector(prob.seletor);
    el?.scrollIntoView({block:'center',inline:'center',behavior:'smooth'});
    setTimeout(()=>{const r=analisador.analisarAtual();renderizarAnalise(r,true);},320);
  }catch{}
  $('#inspetor').classList.add('aberto');
}

async function varreduraCompleta(){
  if(!estado.projeto)return toast('Abra um projeto primeiro');
  const botao=$('#executar-varredura'); botao.disabled=true;
  status('varredura completa','começando em 280 px');
  try{
    const resultado=await analisador.varrer({
      definirViewport:aplicarViewport,
      larguraAtual:estado.largura,
      alturaAtual:estado.altura,
      progresso:(p,w)=>status('varredura completa',`${Math.round(p*100)}% · ${w}px`)
    });
    estado.fraturas=resultado.fraturas;
    renderizarFraturas();
    renderizarAnalise(resultado.atual,true);
    toast('Varredura concluída',`${resultado.fraturas.length} limites naturais encontrados`);
  }catch(e){toast('A varredura parou',e.message);}
  finally{botao.disabled=false;status('', '', false);}
}

function renderizarFraturas(){
  const box=$('#marcas-fratura');box.replaceChildren();
  for(const f of estado.fraturas){
    const d=document.createElement('i');d.className='fratura';d.style.left=`${(f.largura-280)/(3440-280)*100}%`;d.title=`Mudança em ${f.largura}px`;
    box.appendChild(d);
  }
}

async function persistirCorrecoes(){
  if(!estado.projeto||estado.projeto.local)return;
  const css=$('#auto-ajustes').checked?estado.cssCorrecao:'';
  const resumo={largura:estado.largura,altura:estado.altura,problemasAntes:estado.analise?.problemas?.length||0,fraturas:estado.fraturas};
  const r=await fetch(`/api/projetos/${estado.projeto.id}/correcoes`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({css,resumo})});
  if(!r.ok) throw new Error((await r.json()).erro || 'Não consegui salvar as correções.');
}

async function validarCorrecoesCompleto(){
  if(!$('#auto-ajustes').checked || !estado.cssCorrecao) return {aceita:true};
  const largura=estado.largura,altura=estado.altura;
  status('validando correções','comparando a linha responsiva inteira');
  limparPreview(preview);
  const base=await analisador.varrer({definirViewport:aplicarViewport,larguraAtual:largura,alturaAtual:altura});
  aplicarNoPreview(preview,estado.cssCorrecao);
  const corrigido=await analisador.varrer({definirViewport:aplicarViewport,larguraAtual:largura,alturaAtual:altura});
  const somar=resultado=>resultado.estados.reduce((acc,x)=>({problemas:acc.problemas+x.problemas,criticos:acc.criticos+x.criticos}),{problemas:0,criticos:0});
  const antes=somar(base),depois=somar(corrigido);
  const aceita=depois.criticos<antes.criticos || (depois.criticos===antes.criticos && depois.problemas<=antes.problemas);
  if(!aceita){
    limparPreview(preview);estado.cssCorrecao='';$('#auto-ajustes').checked=false;
    await aplicarViewport(largura,altura,true);executarAnalise(true);
    return {aceita:false,antes,depois};
  }
  estado.fraturas=corrigido.fraturas;renderizarFraturas();
  await aplicarViewport(largura,altura,true);executarAnalise(true);
  return {aceita:true,antes,depois};
}

async function gerarVersao(){
  if(!estado.projeto)return;
  const btn=$('#gerar-versao');btn.disabled=true;status('gerando nova versão','original preservado');
  try{
    const validacao=await validarCorrecoesCompleto();
    if(!validacao.aceita) throw new Error(`Correção rejeitada: ${validacao.antes.criticos} → ${validacao.depois.criticos} rupturas críticas.`);
    await persistirCorrecoes();
    const projetoRelatorio={id:estado.projeto.id,nome:estado.projeto.nome,entrada:estado.projeto.entrada,quantidadeArquivos:estado.projeto.quantidadeArquivos};
    const relatorio={projeto:projetoRelatorio,analise:estado.analise,fraturas:estado.fraturas,historico:estado.historico,correcoesAtivas:$('#auto-ajustes').checked,validacao,geradoEm:new Date().toISOString()};
    if(estado.projeto.local){
      await exportarProjetoLocal(estado.projeto,$('#auto-ajustes').checked?estado.cssCorrecao:'',relatorio);
    }else{
      await fetch(`/api/projetos/${estado.projeto.id}/relatorio`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dados:relatorio})});
      const link=document.createElement('a');link.href=`/api/projetos/${estado.projeto.id}/exportar`;link.download='';document.body.appendChild(link);link.click();link.remove();
    }
    toast('Nova versão gerada','ZIP + relatório, sem alterar o original');
  }catch(e){toast('Não consegui exportar',e.message);}
  finally{btn.disabled=false;status('', '', false);}
}

function aplicarAutoAjustes(){
  if(!estado.projeto)return;
  if($('#auto-ajustes').checked){
    const antes=analisador.analisarAtual();
    const css=gerarCorrecoes(antes.problemas,{largura:estado.largura,fraturas:estado.fraturas});estado.cssCorrecao=css;aplicarNoPreview(preview,css);
    setTimeout(()=>{
      const depois=analisador.analisarAtual();
      if(depois.problemas.length>antes.problemas.length){
        limparPreview(preview);estado.cssCorrecao='';$('#auto-ajustes').checked=false;renderizarAnalise(antes,true);toast('Correção revertida','ela criou novos problemas');
      }else{renderizarAnalise(depois,true);toast('Ajustes aplicados',`${Math.max(0,antes.problemas.length-depois.problemas.length)} problema(s) removido(s)`);}
    },120);
  }else{limparPreview(preview);estado.cssCorrecao='';setTimeout(()=>executarAnalise(true),80);}
}

function configurarImportacao(){
  const dialog=$('#dialog-importar');
  const abrir=()=>dialog.showModal();
  $('#abrir-importacao').addEventListener('click',abrir);

  const abrirProjetoLocal=async(acao,detalhe)=>{
    status(detalhe,'preparando o workspace local');
    try{
      const manifesto=await acao();
      if(dialog.open)dialog.close();
      await carregarProjeto(manifesto);
    }catch(e){toast('Não consegui importar',e.message);}
    finally{status('', '', false);}
  };

  const importarZip=e=>{
    const arq=e.target.files?.[0];
    if(!arq)return;
    abrirProjetoLocal(()=>importarZipLocal(arq),'abrindo ZIP');
    e.target.value='';
  };

  const importarPasta=e=>{
    const arquivos=[...e.target.files];
    if(!arquivos.length)return;
    abrirProjetoLocal(()=>importarPastaLocal(arquivos),'abrindo pasta');
    e.target.value='';
  };

  $('#input-zip')?.addEventListener('change',importarZip);
  $('#input-zip-dialog')?.addEventListener('change',importarZip);
  $('#input-pasta')?.addEventListener('change',importarPasta);
  $('#input-pasta-dialog')?.addEventListener('change',importarPasta);

  const area=$('.moldura-viewport');
  area?.addEventListener('dragover',e=>{e.preventDefault();area.classList.add('arrastando');});
  area?.addEventListener('dragleave',()=>area.classList.remove('arrastando'));
  area?.addEventListener('drop',e=>{
    e.preventDefault();area.classList.remove('arrastando');
    const arquivo=[...e.dataTransfer.files].find(x=>x.name.toLowerCase().endsWith('.zip'));
    if(!arquivo)return toast('Arraste um ZIP','pastas podem ser abertas pelo botão Pasta');
    abrirProjetoLocal(()=>importarZipLocal(arquivo),'abrindo ZIP');
  });

  $$('[data-importacao]').forEach(b=>b.addEventListener('click',()=>{
    estado.importacao=b.dataset.importacao;
    if(!dialog.open)dialog.showModal();
    $('#importacao-texto').hidden=false;
    $('#valor-importacao').placeholder=estado.importacao==='github'?'https://github.com/usuario/repositorio':'https://seusite.com';
    setTimeout(()=>$('#valor-importacao').focus(),30);
  }));

  $('#confirmar-importacao').addEventListener('click',async()=>{
    const valor=$('#valor-importacao').value.trim();
    if(!valor)return;
    const acao=estado.importacao==='github'?()=>importarGitHubLocal(valor):()=>importarUrlLocal(valor);
    try{
      await abrirProjetoLocal(acao,estado.importacao==='github'?'abrindo GitHub':'abrindo URL');
    }catch{}
  });
}

function configurarLocalizacao(){
  const dialog=$('#dialog-localizacao');
  $('#abrir-localizacao').addEventListener('click',()=>dialog.showModal());
  $('#usar-localizacao').addEventListener('click',()=>{
    if(!navigator.geolocation)return toast('Localização indisponível');
    navigator.geolocation.getCurrentPosition(async p=>{
      estado.local={nome:'Minha localização',latitude:p.coords.latitude,longitude:p.coords.longitude,elevacao:p.coords.altitude||0,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone};
      localStorage.setItem('aurora-local',JSON.stringify(estado.local));atualizarLocalCabecalho();await atualizarClima();dialog.close();
    },()=>toast('Não consegui acessar sua localização','você pode escolher uma cidade manualmente'),{enableHighAccuracy:false,timeout:10000,maximumAge:600000});
  });
  const buscar=async()=>{
    const q=$('#busca-cidade').value.trim();if(q.length<2)return;
    const box=$('#resultados-cidade');box.innerHTML='<p class="sem-dados">buscando...</p>';
    try{
      const cidades=await buscarCidades(q);box.replaceChildren();
      for(const c of cidades){const b=document.createElement('button');b.type='button';b.className='resultado-cidade';b.textContent=[c.nome,c.estado,c.pais].filter(Boolean).join(', ');b.addEventListener('click',async()=>{estado.local={...c,nome:[c.nome,c.estado].filter(Boolean).join(', ')};localStorage.setItem('aurora-local',JSON.stringify(estado.local));atualizarLocalCabecalho();await atualizarClima();dialog.close();});box.appendChild(b);}
    }catch(e){box.innerHTML=`<p class="sem-dados">${e.message}</p>`;}
  };
  $('#buscar-cidade').addEventListener('click',buscar);$('#busca-cidade').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();buscar();}});
}

function configurarViewport(){
  $('#controle-largura').addEventListener('input',e=>aplicarViewport(e.target.value,estado.altura));
  $('#largura-manual').addEventListener('change',e=>aplicarViewport(e.target.value,estado.altura));
  $('#altura-manual').addEventListener('change',e=>aplicarViewport(estado.largura,e.target.value));
  $('#zoom-preview').addEventListener('change',e=>{estado.zoom=Number(e.target.value);aplicarViewport(estado.largura,estado.altura,true);});
  $$('[data-device]').forEach(b=>b.addEventListener('click',()=>{
    $$('[data-device]').forEach(x=>x.classList.remove('ativo'));b.classList.add('ativo');
    const d=b.dataset.device;const mapa={desktop:[1200,800],tablet:[768,1024],mobile:[390,844]};aplicarViewport(...mapa[d]);
  }));
  $('#recarregar-preview').addEventListener('click',()=>{if(preview.src)preview.src=preview.src.split('#')[0];});
  $('#tela-cheia').addEventListener('click',()=>{const el=$('#centro')||$('.centro');if(!document.fullscreenElement)el?.requestFullscreen?.();else document.exitFullscreen?.();});
  addEventListener('resize',()=>aplicarViewport(estado.largura,estado.altura,true),{passive:true});

  $$('.alca-resize').forEach(alca=>{
    alca.addEventListener('pointerdown',e=>{if(!estado.projeto)return;alca.setPointerCapture(e.pointerId);resizeInicio={x:e.clientX,y:e.clientY,w:estado.largura,h:estado.altura,tipo:alca.dataset.resize};});
    alca.addEventListener('pointermove',e=>{if(!resizeInicio)return;const disp=dimensoesDisponiveis();const fit=Math.min(1,disp.w/resizeInicio.w,disp.h/resizeInicio.h)*estado.zoom;const dx=(e.clientX-resizeInicio.x)/Math.max(.15,fit),dy=(e.clientY-resizeInicio.y)/Math.max(.15,fit);aplicarViewport(resizeInicio.tipo.includes('x')?resizeInicio.w+dx:estado.largura,resizeInicio.tipo.includes('y')?resizeInicio.h+dy:estado.altura,true);});
    alca.addEventListener('pointerup',()=>{resizeInicio=null;executarAnalise(true);});
  });
}

function configurarNavegacao(){
  $('#executar-varredura').addEventListener('click',varreduraCompleta);
  $('#auto-ajustes').addEventListener('change',aplicarAutoAjustes);
  $('#gerar-versao').addEventListener('click',gerarVersao);
  $('#modo-foco').addEventListener('click',()=>document.body.classList.toggle('modo-foco'));
  addEventListener('keydown',e=>{if(e.key==='F2'){e.preventDefault();document.body.classList.toggle('modo-foco');}});
  $$('.velocidade').forEach(b=>b.addEventListener('click',()=>{$$('.velocidade').forEach(x=>x.classList.remove('ativa'));b.classList.add('ativa');ceuEngine?.definirVelocidade(b.dataset.speed);}));
  $('#toggle-ceu').addEventListener('click',()=>{ceuEngine?.alternar();document.body.classList.toggle('ceu-suave');});
  $('#detalhes-ceu').addEventListener('click',()=>$('#dialog-localizacao').showModal());
  $$('.rail-item[data-secao]').forEach(b=>b.addEventListener('click',()=>{
    $$('.rail-item').forEach(x=>x.classList.remove('ativo'));b.classList.add('ativo');
    const s=b.dataset.secao;
    if(s==='analise')executarAnalise(true);
    if(s==='comportamento')varreduraCompleta();
    if(s==='ajustes'){if(!$('#auto-ajustes').checked){$('#auto-ajustes').checked=true;aplicarAutoAjustes();}}
    if(s==='acessibilidade' && estado.analise){const filtrados={...estado.analise,problemas:estado.analise.problemas.filter(p=>['toque','texto'].includes(p.tipo))};renderizarAnalise({...filtrados,criticos:filtrados.problemas.filter(p=>p.severidade==='critico').length,avisos:filtrados.problemas.filter(p=>p.severidade!=='critico').length},true);}
    if(s==='desempenho')mostrarDesempenho();
    if(s==='exportar')gerarVersao();
    $('#inspetor').classList.add('aberto');
  }));
  $$('.etapa').forEach(b=>b.addEventListener('click',()=>{$$('.etapa').forEach(x=>x.classList.remove('ativa'));b.classList.add('ativa');const p=b.dataset.painel;if(p==='analise')executarAnalise(true);if(p==='ajustes'){$('#auto-ajustes').checked=true;aplicarAutoAjustes();}if(p==='exportar')gerarVersao();if(p==='historico')toast('Histórico da sessão',`${estado.historico.length} análises registradas`);}));
}

function mostrarDesempenho(){
  if(!estado.projeto)return;
  try{
    const nav=preview.contentWindow.performance.getEntriesByType('navigation')[0];
    const detalhe=nav?`DOM ${Math.round(nav.domContentLoadedEventEnd)} ms · carga ${Math.round(nav.loadEventEnd)} ms`:'métricas ainda carregando';
    toast('Desempenho do preview',detalhe);
  }catch{toast('Desempenho','não consegui ler as métricas desta página');}
}

configurarImportacao();configurarLocalizacao();configurarViewport();configurarNavegacao();
atualizarLocalCabecalho();
$('#gerar-versao').disabled=true;
setTimeout(()=>aplicarViewport(1200,800,true),120);
