function bloco(seletor, regras){
  return `${seletor}{${regras.join('')}}`;
}

function limiteNatural(contexto){
  const atual=Number(contexto?.largura)||768;
  const fraturas=(contexto?.fraturas||[]).map(x=>Number(x.largura)).filter(Number.isFinite).sort((a,b)=>a-b);
  if(!fraturas.length)return Math.max(320,Math.min(1800,atual+24));
  return fraturas.reduce((melhor,x)=>Math.abs(x-atual)<Math.abs(melhor-atual)?x:melhor,fraturas[0]);
}

export function gerarCorrecoes(problemas,contexto={}){
  const mapa=new Map();
  const containers=new Map();
  const adicionar=(sel,regra)=>{
    if(!sel || sel==='html') return;
    if(!mapa.has(sel)) mapa.set(sel,new Set());
    mapa.get(sel).add(regra);
  };

  for(const p of problemas){
    if(p.tipo==='overflow' || p.tipo==='largura-fixa'){
      adicionar(p.seletor,'max-inline-size:100% !important;');
      adicionar(p.seletor,'min-inline-size:0 !important;');
      adicionar(p.seletor,'box-sizing:border-box !important;');
    }
    if(p.tipo==='texto'){
      adicionar(p.seletor,'max-block-size:none !important;');
      adicionar(p.seletor,'block-size:auto !important;');
      adicionar(p.seletor,'overflow-wrap:anywhere !important;');
      adicionar(p.seletor,'text-wrap:pretty;');
    }
    if(p.tipo==='imagem'){
      adicionar(p.seletor,'max-inline-size:100% !important;');
      adicionar(p.seletor,'block-size:auto !important;');
      adicionar(p.seletor,'object-fit:contain;');
    }
    if(p.tipo==='toque'){
      adicionar(p.seletor,'min-inline-size:44px;');
      adicionar(p.seletor,'min-block-size:44px;');
    }
    if(p.contexto?.parentSelector && p.contexto?.parentDisplay==='flex' && p.tipo==='overflow'){
      containers.set(p.contexto.parentSelector,{tipo:'flex',filho:p.seletor});
    }
    if(p.contexto?.parentSelector && p.contexto?.parentDisplay==='grid' && p.tipo==='overflow'){
      containers.set(p.contexto.parentSelector,{tipo:'grid',filho:p.seletor});
    }
  }

  const bp=limiteNatural(contexto);
  const linhas=['/* ajustes do AURORA */',':where(img,video,canvas,svg){max-inline-size:100%;block-size:auto;}'];
  const escopo=[];
  for(const [sel,regras] of mapa) escopo.push(bloco(sel,[...regras]));
  if(escopo.length)linhas.push(`@media (max-width:${Math.round(bp)}px){${escopo.join('')}}`);

  let indice=0;
  for(const [pai,dados] of containers){
    indice++;
    const nome=`aurora-c${indice}`;
    linhas.push(`${pai}{container-type:inline-size;container-name:${nome};}`);
    if(dados.tipo==='flex'){
      linhas.push(`@media (max-width:${Math.round(bp)}px){${pai}{flex-wrap:wrap;}}`);
      linhas.push(`@container ${nome} (max-width:${Math.round(bp)}px){${dados.filho}{min-inline-size:0;max-inline-size:100%;}}`);
    }
    if(dados.tipo==='grid'){
      linhas.push(`@media (max-width:${Math.round(bp)}px){${pai}{grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));}}`);
      linhas.push(`@container ${nome} (max-width:${Math.round(bp)}px){${dados.filho}{min-inline-size:0;}}`);
    }
  }

  return linhas.join('\n');
}

export function aplicarNoPreview(iframe,css){
  const doc=iframe.contentDocument;
  if(!doc) return;
  let style=doc.querySelector('#aurora-ajustes-preview');
  if(!style){ style=doc.createElement('style'); style.id='aurora-ajustes-preview'; doc.head?.appendChild(style); }
  style.textContent=css;
}

export function limparPreview(iframe){
  iframe.contentDocument?.querySelector('#aurora-ajustes-preview')?.remove();
}
