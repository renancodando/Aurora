const CODIGOS = new Map([
  [0, 'céu limpo'], [1, 'quase limpo'], [2, 'parcialmente nublado'], [3, 'nublado'],
  [45, 'neblina'], [48, 'neblina'], [51, 'garoa leve'], [53, 'garoa'], [55, 'garoa forte'],
  [61, 'chuva leve'], [63, 'chuva'], [65, 'chuva forte'], [71, 'neve leve'], [73, 'neve'],
  [80, 'pancadas leves'], [81, 'pancadas'], [82, 'pancadas fortes'], [95, 'trovoadas'], [96, 'trovoadas'], [99, 'trovoadas fortes']
]);

export async function obterClima(latitude, longitude) {
  const campos = [
    'cloud_cover','cloud_cover_low','cloud_cover_mid','cloud_cover_high',
    'wind_speed_10m','wind_direction_10m','visibility','precipitation','weather_code'
  ].join(',');
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', latitude);
  url.searchParams.set('longitude', longitude);
  url.searchParams.set('current', campos);
  url.searchParams.set('timezone', 'auto');
  const resposta = await fetch(url, { cache: 'no-store' });
  if (!resposta.ok) throw new Error('Não consegui atualizar o clima.');
  const dados = await resposta.json();
  const c = dados.current || {};
  return {
    nuvens: Number(c.cloud_cover ?? 20),
    baixas: Number(c.cloud_cover_low ?? c.cloud_cover ?? 20),
    medias: Number(c.cloud_cover_mid ?? c.cloud_cover ?? 20),
    altas: Number(c.cloud_cover_high ?? c.cloud_cover ?? 20),
    vento: Number(c.wind_speed_10m ?? 5),
    direcao: Number(c.wind_direction_10m ?? 90),
    visibilidade: Number(c.visibility ?? 20000),
    precipitacao: Number(c.precipitation ?? 0),
    codigo: Number(c.weather_code ?? 0),
    descricao: CODIGOS.get(Number(c.weather_code ?? 0)) || 'condição atual',
    timezone: dados.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
  };
}

export async function buscarCidades(termo) {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', termo);
  url.searchParams.set('count', '7');
  url.searchParams.set('language', 'pt');
  url.searchParams.set('format', 'json');
  const resposta = await fetch(url);
  if (!resposta.ok) throw new Error('Busca indisponível.');
  const dados = await resposta.json();
  return (dados.results || []).map(item => ({
    nome: item.name,
    estado: item.admin1 || '',
    pais: item.country || '',
    latitude: item.latitude,
    longitude: item.longitude,
    elevacao: item.elevation || 0,
    timezone: item.timezone || 'auto'
  }));
}
