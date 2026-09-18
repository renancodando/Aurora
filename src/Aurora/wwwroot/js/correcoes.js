function bloco(seletor, regras){
  return `${seletor}{${regras.join('')}}`;
}

export function gerarCorrecoes(problemas){
  const mapa=new Map();
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
      adicionar(p.seletor,'overflow-wrap:anywhere !important;');
      adicionar(p.seletor,'text-wrap:pretty;');
    }
    if(p.tipo==='imagem'){
      adicionar(p.seletor,'max-inline-size:100% !important;');
      adicionar(p.seletor,'block-size:auto !important;');
      adicionar(p.seletor,'object-fit:cover;');
    }
    if(p.tipo==='toque'){
      adicionar(p.seletor,'min-inline-size:44px;');
      adicionar(p.seletor,'min-block-size:44px;');
    }
  }

  const linhas=['/* ajustes gerados pelo AURORA */',':where(img,video,canvas,svg){max-inline-size:100%;}',':where(*, *::before, *::after){box-sizing:border-box;}'];
  for(const [sel,regras] of mapa) linhas.push(bloco(sel,[...regras]));
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
