import { iniciarAdaptiveEngine } from './adaptive.js';
import { obterClima as consultarClima, buscarCidades } from './clima.js';
import { iniciarCeu } from './ceu.js';
import { AuroraAnalise } from './analise.js';
import { gerarCorrecoes, descreverCorrecoes, aplicarNoPreview, limparPreview } from './correcoes.js';
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
  importacao:'url',
  modoAnalise:'layout',
  analiseBase:null,
  planoCorrecao:null,
  diferencas:null
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
  estado.cssCorrecao=''; estado.fraturas=[]; estado.historico=[]; estado.analiseBase=null; estado.planoCorrecao=null; estado.diferencas=null;
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

function problemasDoModo(r){
  if(!r)return [];
  if(estado.modoAnalise==='acessibilidade')return r.problemas.filter(p=>p.grupo==='acessibilidade');
  if(estado.modoAnalise==='desempenho')return r.problemas.filter(p=>p.grupo==='desempenho');
  if(estado.modoAnalise==='responsividade'){
    const base=r.problemas.filter(p=>p.grupo==='responsividade');
    const fraturas=estado.fraturas.map(f=>({
      tipo:'fratura',
      grupo:'responsividade',
      titulo:`Breakpoint natural em ${f.largura}px`,
      detalhe:`${f.antes} → ${f.depois} problema(s) responsivo(s)`,
      seletor:'',
      severidade:'aviso',
      rect:null
    }));
    return [...fraturas,...base];
  }
  return r.problemas.filter(p=>p.grupo==='responsividade'||!p.grupo);
}

function tituloDoModo(r,problemas){
  const criticos=problemas.filter(p=>p.severidade==='critico').length;
  const avisos=problemas.length-criticos;
  const mapa={
    layout:['Layout','estrutura atual da viewport'],
    responsividade:['Responsividade',estado.fraturas.length?`${estado.fraturas.length} breakpoint(s) natural(is) localizado(s)`:'varra de 280 a 3440 px para localizar as fraturas'],
    acessibilidade:['Acessibilidade','interação, rótulos, imagens e hierarquia semântica'],
    desempenho:['Desempenho','peso estrutural, imagens, animações e composição']
  };
  const [nome,descricao]=mapa[estado.modoAnalise];
  return {
    titulo:criticos?`${nome} com problemas críticos`:avisos?`${nome} com pontos de atenção`:`${nome} estável`,
    subtitulo:problemas.length?`${problemas.length} ocorrência(s) · ${descricao}`:descricao,
    criticos,
    avisos
  };
}

function renderizarMetricasDesempenho(r,lista){
  const m=r.metricas||{};
  const itens=[
    ['Elementos visíveis',String(r.elementos)],
    ['Recursos carregados',String(m.recursos??0)],
    ['Imagens',String(m.imagens??0)],
    ['Animações ativas',String(m.animacoes??0)],
    ['Efeitos de composição',String(m.efeitosPesados??0)]
  ];
  if(m.navegacao){
    itens.push(['DOM pronto',m.navegacao.dom+' ms']);
    itens.push(['Carga',m.navegacao.carga+' ms']);
  }
  for(const [titulo,detalhe] of itens){
    const item=document.createElement('div');
    item.className='metrica-modo';
    item.innerHTML='<b></b><span></span>';
    item.querySelector('b').textContent=titulo;
    item.querySelector('span').textContent=detalhe;
    lista.appendChild(item);
  }
}

function renderizarAnalise(r,marcar=true){
  estado.analise=r;
  estado.historico.push({largura:r.largura,altura:r.altura,integridade:r.integridade,problemas:r.problemas.length,modo:estado.modoAnalise,quando:r.quando});
  if(estado.historico.length>100)estado.historico.shift();

  $('#integridade').textContent=`${r.integridade}%`;
  $('#anel-integridade').style.setProperty('--valor',r.integridade);
  $('#qtd-elementos').textContent=r.elementos;
  $('#qtd-erros').textContent=r.criticos;
  $('#qtd-avisos').textContent=r.avisos;
  $('#qtd-ocultos').textContent=r.ocultos;
  $('#anel-integridade').style.borderColor=r.criticos?'var(--erro)':r.avisos?'var(--aviso)':'var(--sucesso)';

  const saude=$('.saude-texto');
  if(saude){
    saude.querySelector('span').textContent=r.criticos?'Há fraturas no layout':r.avisos?'Layout estável com atenção':'Layout estável';
    saude.querySelector('small').textContent=`${r.elementos} elementos analisados · ${r.criticos} críticos · ${r.avisos} avisos`;
  }
  const metricas=$('.medidor dl');
  if(metricas)metricas.hidden=false;

  const problemas=problemasDoModo(r);
  const resumo=tituloDoModo(r,problemas);
  $('#contador-pontos').textContent=problemas.length;

  const titulo=$('#titulo-layout');
  const sub=$('#subtitulo-layout');
  const bolinha=$('#estado-layout');
  bolinha.className='estado '+(resumo.criticos?'erro':resumo.avisos?'aviso':'ok');
  titulo.textContent=resumo.titulo;
  sub.textContent=resumo.subtitulo;

  const lista=$('#lista-problemas');
  lista.replaceChildren();
  $('#bloco-problemas')?.classList.toggle('tem-dados',problemas.length>0||estado.modoAnalise==='desempenho');

  if(estado.modoAnalise==='desempenho')renderizarMetricasDesempenho(r,lista);

  if(!problemas.length&&estado.modoAnalise!=='desempenho'){
    const p=document.createElement('p');
    p.className='sem-dados';
    p.textContent=estado.modoAnalise==='responsividade'&&!estado.fraturas.length?'Nenhuma fratura conhecida ainda. Execute a varredura para testar toda a faixa.':'Nenhum problema encontrado neste modo.';
    lista.appendChild(p);
  }

  for(const prob of problemas.slice(0,22)){
    const b=document.createElement(prob.seletor?'button':'div');
    b.className=`problema ${prob.severidade==='critico'?'critico':''}`;
    b.innerHTML='<i></i><div><b></b><small></small></div><span>›</span>';
    b.querySelector('b').textContent=prob.titulo;
    b.querySelector('small').textContent=prob.detalhe;
    if(prob.seletor)b.addEventListener('click',()=>focarProblema(prob));
    else b.querySelector('span').textContent='·';
    lista.appendChild(b);
  }

  if(marcar)desenharMarcacoes(problemas);

  if($('#auto-ajustes').checked){
    if(!estado.cssCorrecao){
      estado.planoCorrecao=descreverCorrecoes(r.problemas,{largura:estado.largura,fraturas:estado.fraturas});
      estado.cssCorrecao=estado.planoCorrecao.css;
    }
    aplicarNoPreview(preview,estado.cssCorrecao);
  }
}

function selecionarModoAnalise(modo,{executar=true}={}){
  estado.modoAnalise=modo;
  $$('[data-modo-analise]').forEach(b=>b.classList.toggle('ativo',b.dataset.modoAnalise===modo));

  const correspondencia={
    layout:'analise',
    responsividade:'comportamento',
    acessibilidade:'acessibilidade',
    desempenho:'desempenho'
  };
  $$('.rail-item[data-secao]').forEach(b=>b.classList.toggle('ativo',b.dataset.secao===correspondencia[modo]));

  if(!estado.projeto){
    const nomes={layout:'Layout',responsividade:'Responsividade',acessibilidade:'Acessibilidade',desempenho:'Desempenho'};
    $('#titulo-layout').textContent=nomes[modo];
    $('#subtitulo-layout').textContent='abra um projeto para iniciar esta análise';
    return;
  }

  if(modo==='responsividade'&&executar){
    varreduraCompleta();
    return;
  }

  if(executar)executarAnalise(true);
  else if(estado.analise)renderizarAnalise(estado.analise,true);
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

function escaparHtml(texto){
  return String(texto??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

function mostrarDiferencas(validacao,plano){
  const dialog=$('#dialog-diferencas');
  if(!dialog||!plano)return;

  const antes=validacao?.antes||{problemas:estado.analiseBase?.problemas?.length??estado.analise?.problemas?.length??0,criticos:estado.analiseBase?.criticos??estado.analise?.criticos??0};
  const depois=validacao?.depois||{problemas:estado.analise?.problemas?.length??0,criticos:estado.analise?.criticos??0};

  $('#diff-antes').textContent=antes.problemas??'—';
  $('#diff-depois').textContent=depois.problemas??'—';
  $('#diff-criticos-antes').textContent=antes.criticos??'—';
  $('#diff-criticos-depois').textContent=depois.criticos??'—';

  const lista=$('#lista-diferencas');
  lista.replaceChildren();

  if(!plano.itens.length){
    const vazio=document.createElement('p');
    vazio.className='sem-dados';
    vazio.textContent='Nenhuma alteração de código foi necessária para esta versão.';
    lista.appendChild(vazio);
  }

  for(const item of plano.itens){
    const artigo=document.createElement('article');
    artigo.className='item-diferenca';
    artigo.innerHTML=`
      <header>
        <span>${escaparHtml(item.tipo)}</span>
        <b>${escaparHtml(item.seletor||'regra global')}</b>
        <small>${escaparHtml(item.titulo||'correção')}</small>
      </header>
      <div class="corpo-diff">
        <div class="lado antes"><span>Antes / problema</span><pre></pre></div>
        <div class="lado depois"><span>Depois / aplicado</span><pre></pre></div>
      </div>
      <footer>${escaparHtml(item.explicacao||'')}</footer>
    `;
    artigo.querySelector('.antes pre').textContent=(item.antes||[]).map(x=>'- '+x).join('\n');
    artigo.querySelector('.depois pre').textContent=(item.depois||[]).map(x=>'+ '+x).join('\n');
    lista.appendChild(artigo);
  }

  $('#codigo-diferencas').textContent=estado.cssCorrecao||plano.css||'';
  estado.diferencas={validacao,plano,css:estado.cssCorrecao||plano.css||''};

  $$('[data-aba-diff]').forEach(b=>b.classList.toggle('ativa',b.dataset.abaDiff==='resumo'));
  $$('[data-painel-diff]').forEach(p=>p.classList.toggle('ativo',p.dataset.painelDiff==='resumo'));

  if(!dialog.open)dialog.showModal();
}

async function gerarVersao(){
  if(!estado.projeto)return;
  const btn=$('#gerar-versao');btn.disabled=true;status('gerando nova versão','original preservado');
  try{
    const analiseAntes=estado.analiseBase||estado.analise||analisador.analisarAtual();
    const fraturasAntes=[...estado.fraturas];
    const plano=estado.planoCorrecao||descreverCorrecoes(analiseAntes.problemas,{largura:estado.largura,fraturas:fraturasAntes});
    if($('#auto-ajustes').checked&&!estado.cssCorrecao)estado.cssCorrecao=plano.css;

    const validacao=await validarCorrecoesCompleto();
    if(!validacao.aceita) throw new Error(`Correção rejeitada: ${validacao.antes.criticos} → ${validacao.depois.criticos} rupturas críticas.`);

    await persistirCorrecoes();

    const projetoRelatorio={id:estado.projeto.id,nome:estado.projeto.nome,entrada:estado.projeto.entrada,quantidadeArquivos:estado.projeto.quantidadeArquivos};
    const diferencas={
      breakpoint:plano.breakpoint,
      breakpointEstrutural:plano.breakpointEstrutural,
      itens:plano.itens,
      css:$('#auto-ajustes').checked?estado.cssCorrecao:'',
      validacao
    };
    const relatorio={
      projeto:projetoRelatorio,
      analiseAntes,
      analiseDepois:estado.analise,
      fraturas:estado.fraturas,
      historico:estado.historico,
      correcoesAtivas:$('#auto-ajustes').checked,
      validacao,
      diferencas,
      geradoEm:new Date().toISOString()
    };

    if(estado.projeto.local){
      await exportarProjetoLocal(estado.projeto,$('#auto-ajustes').checked?estado.cssCorrecao:'',relatorio);
    }else{
      await fetch(`/api/projetos/${estado.projeto.id}/relatorio`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dados:relatorio})});
      const link=document.createElement('a');link.href=`/api/projetos/${estado.projeto.id}/exportar`;link.download='';document.body.appendChild(link);link.click();link.remove();
    }

    mostrarDiferencas(validacao,plano);
    toast('Nova versão gerada','compare as alterações antes de usar o ZIP');
  }catch(e){toast('Não consegui exportar',e.message);}
  finally{btn.disabled=false;status('', '', false);}
}

function aplicarAutoAjustes(){
  if(!estado.projeto)return;
  if($('#auto-ajustes').checked){
    const antes=analisador.analisarAtual();
    estado.analiseBase=antes;
    estado.planoCorrecao=descreverCorrecoes(antes.problemas,{largura:estado.largura,fraturas:estado.fraturas});
    estado.cssCorrecao=estado.planoCorrecao.css;
    aplicarNoPreview(preview,estado.cssCorrecao);
    setTimeout(()=>{
      const depois=analisador.analisarAtual();
      if(depois.problemas.length>antes.problemas.length){
        limparPreview(preview);estado.cssCorrecao='';$('#auto-ajustes').checked=false;renderizarAnalise(antes,true);toast('Correção revertida','ela criou novos problemas');
      }else{renderizarAnalise(depois,true);toast('Ajustes aplicados',`${Math.max(0,antes.problemas.length-depois.problemas.length)} problema(s) removido(s)`);}
    },120);
  }else{limparPreview(preview);estado.cssCorrecao='';estado.analiseBase=null;estado.planoCorrecao=null;setTimeout(()=>executarAnalise(true),80);}
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
  $('#executar-varredura').addEventListener('click',()=>{
    selecionarModoAnalise('responsividade',{executar:false});
    varreduraCompleta();
  });
  $('#auto-ajustes').addEventListener('change',aplicarAutoAjustes);
  $('#gerar-versao').addEventListener('click',gerarVersao);
  $('#fechar-diferencas')?.addEventListener('click',()=>$('#dialog-diferencas').close());
  $('[data-aba-diff]').forEach(b=>b.addEventListener('click',()=>{
    $('[data-aba-diff]').forEach(x=>x.classList.toggle('ativa',x===b));
    $('[data-painel-diff]').forEach(p=>p.classList.toggle('ativo',p.dataset.painelDiff===b.dataset.abaDiff));
  }));
  $('#copiar-css')?.addEventListener('click',async()=>{
    const css=$('#codigo-diferencas')?.textContent||'';
    try{await navigator.clipboard.writeText(css);toast('CSS copiado','aurora-correcoes.css');}
    catch{toast('Não consegui copiar','selecione o código manualmente');}
  });
  $('#modo-foco').addEventListener('click',()=>document.body.classList.toggle('modo-foco'));
  addEventListener('keydown',e=>{if(e.key==='F2'){e.preventDefault();document.body.classList.toggle('modo-foco');}});

  $$('[data-modo-analise]').forEach(b=>b.addEventListener('click',()=>selecionarModoAnalise(b.dataset.modoAnalise)));

  $$('.velocidade').forEach(b=>b.addEventListener('click',()=>{
    $$('.velocidade').forEach(x=>x.classList.remove('ativa'));
    b.classList.add('ativa');
    ceuEngine?.definirVelocidade(b.dataset.speed);
  }));

  $('#toggle-ceu').addEventListener('click',()=>{ceuEngine?.alternar();document.body.classList.toggle('ceu-suave');});
  $('#detalhes-ceu').addEventListener('click',()=>$('#dialog-localizacao').showModal());

  $$('.rail-item[data-secao]').forEach(b=>b.addEventListener('click',()=>{
    const s=b.dataset.secao;
    if(s==='analise')selecionarModoAnalise('layout');
    if(s==='comportamento')selecionarModoAnalise('responsividade');
    if(s==='acessibilidade')selecionarModoAnalise('acessibilidade');
    if(s==='desempenho')selecionarModoAnalise('desempenho');
    if(s==='ajustes'){
      $$('.rail-item').forEach(x=>x.classList.remove('ativo'));
      b.classList.add('ativo');
      if(!$('#auto-ajustes').checked){$('#auto-ajustes').checked=true;aplicarAutoAjustes();}
    }
    if(s==='elementos'){
      $$('.rail-item').forEach(x=>x.classList.remove('ativo'));
      b.classList.add('ativo');
      executarAnalise(true);
      toast('Elementos do projeto',estado.analise?`${estado.analise.elementos} elementos visíveis`:'abra um projeto primeiro');
    }
    if(s==='exportar')gerarVersao();
    $('#inspetor').classList.add('aberto');
  }));

  $$('.etapa').forEach(b=>b.addEventListener('click',()=>{
    $$('.etapa').forEach(x=>x.classList.remove('ativa'));
    b.classList.add('ativa');
    const p=b.dataset.painel;
    if(p==='analise')selecionarModoAnalise('layout');
    if(p==='ajustes'){$('#auto-ajustes').checked=true;aplicarAutoAjustes();}
    if(p==='exportar')gerarVersao();
    if(p==='historico')toast('Histórico da sessão',`${estado.historico.length} análises registradas`);
  }));
}


configurarImportacao();configurarLocalizacao();configurarViewport();configurarNavegacao();
atualizarLocalCabecalho();
$('#gerar-versao').disabled=true;
setTimeout(()=>aplicarViewport(1200,800,true),120);
