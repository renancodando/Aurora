const limitar=(n,min,max)=>Math.max(min,Math.min(max,n));

function classeLargura(w){
  if(w<420)return 'micro';
  if(w<620)return 'estreita';
  if(w<900)return 'compacta';
  if(w<1180)return 'media';
  if(w<1500)return 'ampla';
  return 'ultra';
}

function classeAltura(h){
  if(h<560)return 'muito-baixa';
  if(h<720)return 'baixa';
  if(h<900)return 'media';
  return 'alta';
}

function classeFormato(w,h){
  const r=h? w/h:1;
  if(r>1.95)return 'ultralargo';
  if(r>1.45)return 'largo';
  if(r<.72)return 'retrato-estreito';
  if(r<.95)return 'retrato';
  return 'normal';
}

function perfilPerformance(){
  const memoria=Number(navigator.deviceMemory||4);
  const nucleos=Number(navigator.hardwareConcurrency||4);
  const dpr=window.devicePixelRatio||1;
  if(memoria<=2||nucleos<=2||dpr>3)return 'eco';
  if(memoria>=8&&nucleos>=8&&dpr<=2)return 'alto';
  return 'equilibrado';
}

function larguraConteudo(el){
  if(!el)return 0;
  const cs=getComputedStyle(el);
  const margem=(parseFloat(cs.marginLeft)||0)+(parseFloat(cs.marginRight)||0);
  return Math.ceil(Math.max(el.scrollWidth,el.getBoundingClientRect().width)+margem);
}

function aplicarEstrutura(){
  const topo=document.querySelector('.topo');
  if(topo){
    const identidade=topo.querySelector('.identidade');
    const etapas=topo.querySelector('.etapas');
    const tempo=topo.querySelector('.tempo-local');
    const largura=topo.clientWidth;
    const necessario=larguraConteudo(identidade)+larguraConteudo(etapas)+larguraConteudo(tempo)+56;
    const linhaPrincipal=larguraConteudo(identidade)+larguraConteudo(tempo)+32;
    topo.dataset.arranjo=necessario<=largura?'linha':linhaPrincipal<=largura?'duas-linhas':'pilha';
  }

  const estacao=document.querySelector('.estacao');
  if(estacao){
    const largura=estacao.clientWidth;
    const rail=document.querySelector('.rail');
    const inspetor=document.querySelector('.inspetor');
    const itemRail=Math.max(0,...[...document.querySelectorAll('.rail-item')].map(x=>Math.min(188,Math.max(72,x.scrollWidth))));
    const railNatural=Math.max(72,Math.min(188,itemRail+12));
    const inspetorNatural=Math.max(276,Math.min(340,larguraConteudo(inspetor)||300));
    const centroMinimo=620;
    const folga=32;
    const tres=railNatural+inspetorNatural+centroMinimo+folga;
    const compacto=72+Math.min(inspetorNatural,300)+centroMinimo+24;
    estacao.dataset.arranjo=largura>=tres?'tres-colunas':largura>=compacto?'tres-colunas-compactas':'pilha';
  }

  const barra=document.querySelector('.barra-visualizacao');
  if(barra){
    const largura=barra.clientWidth;
    const filhos=[...barra.children];
    const necessario=filhos.reduce((s,x)=>s+Math.min(larguraConteudo(x),360),0)+Math.max(0,filhos.length-1)*10+40;
    barra.dataset.fluxo=necessario<=largura?'linha':'quebrado';
  }

  const projeto=document.querySelector('.barra-projeto');
  if(projeto){
    const largura=projeto.clientWidth;
    const necessario=[...projeto.children].reduce((s,x)=>s+Math.min(larguraConteudo(x),520),0)+30;
    projeto.dataset.fluxo=necessario<=largura?'linha':'quebrado';
  }
}

function aplicarContexto(el){
  const r=el.getBoundingClientRect();
  const w=Math.max(0,r.width);
  const h=Math.max(0,r.height);
  const ar=h?w/h:1;
  const densidade=limitar(w/1440,.72,1.12);
  const espaco=limitar(w*.012,8,20);
  const rail=limitar(w*.13,64,188);
  const inspector=limitar(w*.22,272,340);

  el.style.setProperty('--aw',w.toFixed(2)+'px');
  el.style.setProperty('--ah',h.toFixed(2)+'px');
  el.style.setProperty('--ar',ar.toFixed(4));
  el.style.setProperty('--densidade',densidade.toFixed(3));
  el.style.setProperty('--espaco-adaptativo',espaco.toFixed(1)+'px');
  el.style.setProperty('--rail-adaptativo',rail.toFixed(1)+'px');
  el.style.setProperty('--inspetor-adaptativo',inspector.toFixed(1)+'px');
  el.dataset.largura=classeLargura(w);
  el.dataset.altura=classeAltura(h);
  el.dataset.formato=classeFormato(w,h);
  aplicarEstrutura();
}

export function iniciarAdaptiveEngine(){
  const observados=new Set();
  let frame=0;

  const observar=el=>{
    if(!el||observados.has(el))return;
    observados.add(el);
    aplicarContexto(el);
    ro.observe(el);
  };

  const ro=new ResizeObserver(entries=>{
    cancelAnimationFrame(frame);
    frame=requestAnimationFrame(()=>{
      for(const entry of entries) aplicarContexto(entry.target);
    });
  });

  document.querySelectorAll('[data-adaptive],.topo,.estacao,.centro,.barra-projeto,.barra-visualizacao,.palco,.regua,.inspetor').forEach(observar);

  const mo=new MutationObserver(registros=>{
    for(const registro of registros){
      for(const node of registro.addedNodes){
        if(!(node instanceof Element))continue;
        if(node.matches?.('[data-adaptive]'))observar(node);
        node.querySelectorAll?.('[data-adaptive]').forEach(observar);
      }
    }
  });
  mo.observe(document.documentElement,{childList:true,subtree:true});

  const raiz=document.documentElement;
  const atualizarAmbiente=()=>{
    raiz.dataset.ponteiro=matchMedia('(hover:hover) and (pointer:fine)').matches?'preciso':'toque';
    raiz.dataset.movimento=matchMedia('(prefers-reduced-motion:reduce)').matches?'reduzido':'normal';
    raiz.dataset.contraste=matchMedia('(prefers-contrast:more)').matches?'alto':'normal';
    raiz.dataset.orientacao=innerWidth>=innerHeight?'paisagem':'retrato';
    raiz.dataset.performance=perfilPerformance();
    raiz.style.setProperty('--dpr',String(Math.min(devicePixelRatio||1,2)));
    raiz.style.setProperty('--vh-real',innerHeight+'px');
    raiz.style.setProperty('--vw-real',innerWidth+'px');
  };

  const consultas=[
    matchMedia('(hover:hover) and (pointer:fine)'),
    matchMedia('(prefers-reduced-motion:reduce)'),
    matchMedia('(prefers-contrast:more)')
  ];
  consultas.forEach(q=>q.addEventListener?.('change',atualizarAmbiente));
  addEventListener('resize',atualizarAmbiente,{passive:true});
  addEventListener('orientationchange',atualizarAmbiente,{passive:true});
  atualizarAmbiente();
  requestAnimationFrame(aplicarEstrutura);

  return ()=>{
    ro.disconnect();
    mo.disconnect();
    consultas.forEach(q=>q.removeEventListener?.('change',atualizarAmbiente));
    observados.clear();
  };
}
