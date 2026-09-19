const rad = Math.PI / 180;

function juliano(data) {
  return data.getTime() / 86400000 + 2440587.5;
}

function gmst(data) {
  const jd = juliano(data);
  const t = (jd - 2451545) / 36525;
  return ((280.46061837 + 360.98564736629 * (jd - 2451545) + .000387933 * t * t - t * t * t / 38710000) % 360 + 360) % 360;
}

export function equatorialParaHorizontal(raGraus, decGraus, data, latitude, longitude) {
  const lst = (gmst(data) + longitude + 360) % 360;
  let ha = (lst - raGraus + 540) % 360 - 180;
  const h = ha * rad;
  const d = decGraus * rad;
  const lat = latitude * rad;
  const senAlt = Math.sin(d) * Math.sin(lat) + Math.cos(d) * Math.cos(lat) * Math.cos(h);
  const alt = Math.asin(Math.max(-1, Math.min(1, senAlt)));
  const az = Math.atan2(-Math.sin(h), Math.tan(d) * Math.cos(lat) - Math.sin(lat) * Math.cos(h));
  return { altitude: alt / rad, azimute: ((az / rad) % 360 + 360) % 360 };
}

function fallbackLua(data) {
  const idade = (((juliano(data) - 2451550.1) % 29.53058867) + 29.53058867) % 29.53058867;
  const angulo = idade / 29.53058867 * 360;
  return { fase: angulo, iluminacao: (1 - Math.cos(angulo * rad)) / 2, altitude: 30, azimute: 245 };
}

function fallbackSol(data, latitude, longitude) {
  const dia = Math.floor((Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), data.getUTCDate()) - Date.UTC(data.getUTCFullYear(), 0, 0)) / 86400000);
  const hora = data.getUTCHours() + data.getUTCMinutes()/60;
  const g = 2*Math.PI/365 * (dia-1 + (hora-12)/24);
  const eqtime = 229.18*(.000075+.001868*Math.cos(g)-.032077*Math.sin(g)-.014615*Math.cos(2*g)-.040849*Math.sin(2*g));
  const decl = .006918-.399912*Math.cos(g)+.070257*Math.sin(g)-.006758*Math.cos(2*g)+.000907*Math.sin(2*g)-.002697*Math.cos(3*g)+.00148*Math.sin(3*g);
  const offset = eqtime + 4*longitude;
  const minutos = data.getUTCHours()*60 + data.getUTCMinutes() + data.getUTCSeconds()/60 + offset;
  const ha = ((minutos/4 - 180 + 540)%360-180)*rad;
  const lat = latitude*rad;
  const alt = Math.asin(Math.sin(lat)*Math.sin(decl)+Math.cos(lat)*Math.cos(decl)*Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(decl)*Math.cos(lat)-Math.sin(lat)*Math.cos(ha));
  return { altitude: alt/rad, azimute: ((az/rad)%360+360)%360 };
}

export function calcularCeu(data, local) {
  const A = window.Astronomy;
  if (!A) {
    const lua = fallbackLua(data);
    const sol = fallbackSol(data, local.latitude, local.longitude);
    return { sol, lua: { ...lua, nome: nomeFase(lua.fase) } };
  }

  try {
    const observador = new A.Observer(local.latitude, local.longitude, local.elevacao || 0);
    const eqSol = A.Equator(A.Body.Sun, data, observador, true, true);
    const hzSol = A.Horizon(data, observador, eqSol.ra, eqSol.dec, 'normal');
    const eqLua = A.Equator(A.Body.Moon, data, observador, true, true);
    const hzLua = A.Horizon(data, observador, eqLua.ra, eqLua.dec, 'normal');
    const fase = A.MoonPhase(data);
    return {
      sol: { altitude: hzSol.altitude, azimute: hzSol.azimuth },
      lua: {
        altitude: hzLua.altitude,
        azimute: hzLua.azimuth,
        fase,
        iluminacao: (1 - Math.cos(fase * rad)) / 2,
        nome: nomeFase(fase)
      }
    };
  } catch {
    const lua = fallbackLua(data);
    const sol = fallbackSol(data, local.latitude, local.longitude);
    return { sol, lua: { ...lua, nome: nomeFase(lua.fase) } };
  }
}

export function nomeFase(angulo) {
  const a = ((angulo % 360) + 360) % 360;
  if (a < 11.25 || a >= 348.75) return 'Lua nova';
  if (a < 78.75) return 'Lua crescente';
  if (a < 101.25) return 'Quarto crescente';
  if (a < 168.75) return 'Gibosa crescente';
  if (a < 191.25) return 'Lua cheia';
  if (a < 258.75) return 'Gibosa minguante';
  if (a < 281.25) return 'Quarto minguante';
  return 'Lua minguante';
}

export function parseRa(texto) {
  const m = /([\d.]+)h\s*([\d.]+)m\s*([\d.]+)s/.exec(texto || '');
  if (!m) return null;
  return (Number(m[1]) + Number(m[2])/60 + Number(m[3])/3600) * 15;
}

export function parseDec(texto) {
  const m = /([+-])([\d.]+)°\s*([\d.]+)′\s*([\d.]+)″/.exec(texto || '');
  if (!m) return null;
  const v = Number(m[2]) + Number(m[3])/60 + Number(m[4])/3600;
  return m[1] === '-' ? -v : v;
}
