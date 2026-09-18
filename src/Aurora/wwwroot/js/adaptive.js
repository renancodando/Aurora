export function iniciarAdaptiveEngine() {
  const alvos = [...document.querySelectorAll('[data-adaptive]')];
  const aplicar = el => {
    const r = el.getBoundingClientRect();
    const proporcao = r.height ? r.width / r.height : 1;
    el.style.setProperty('--aw', `${r.width}px`);
    el.style.setProperty('--ah', `${r.height}px`);
    el.style.setProperty('--ar', proporcao.toFixed(3));
    el.dataset.largura = r.width < 560 ? 'estreita' : r.width < 900 ? 'compacta' : r.width < 1320 ? 'media' : 'ampla';
    el.dataset.altura = r.height < 620 ? 'baixa' : r.height < 820 ? 'media' : 'alta';
    el.dataset.formato = proporcao > 1.7 ? 'largo' : proporcao < .82 ? 'retrato' : 'normal';
  };

  const ro = new ResizeObserver(entries => entries.forEach(e => aplicar(e.target)));
  alvos.forEach(el => { aplicar(el); ro.observe(el); });

  document.documentElement.dataset.ponteiro = matchMedia('(hover: hover) and (pointer: fine)').matches ? 'preciso' : 'toque';
  document.documentElement.dataset.movimento = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduzido' : 'normal';

  return () => ro.disconnect();
}
