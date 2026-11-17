/* Prumo Planta — geometria (funções puras, testáveis fora do navegador) */
(function (root) {
  'use strict';
  const G = {};
  const RAD = Math.PI / 180;

  G.area = function (pts) { // área com sinal (positivo = anti-horário)
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return s / 2;
  };
  G.absArea = pts => Math.abs(G.area(pts));
  G.ccw = pts => (G.area(pts) < 0 ? pts.slice().reverse() : pts.slice());
  G.dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  G.perim = pts => pts.reduce((s, p, i) => s + G.dist(p, pts[(i + 1) % pts.length]), 0);
  G.rot = function (p, ang) {
    const c = Math.cos(ang), s = Math.sin(ang);
    return [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
  };
  G.bbox = function (pts) {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const p of pts) {
      if (p[0] < minx) minx = p[0]; if (p[0] > maxx) maxx = p[0];
      if (p[1] < miny) miny = p[1]; if (p[1] > maxy) maxy = p[1];
    }
    return { minx, miny, maxx, maxy, w: maxx - minx, h: maxy - miny };
  };
  G.centroid = function (pts) {
    const A = G.area(pts);
    if (Math.abs(A) < 1e-9) {
      const b = G.bbox(pts); return [(b.minx + b.maxx) / 2, (b.miny + b.maxy) / 2];
    }
    let cx = 0, cy = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const f = a[0] * b[1] - b[0] * a[1];
      cx += (a[0] + b[0]) * f; cy += (a[1] + b[1]) * f;
    }
    return [cx / (6 * A), cy / (6 * A)];
  };

  /* Direção dominante das paredes, em (-45°, 45°], ponderada pelo comprimento.
     Aceita um polígono ou uma lista de polígonos. */
  G.dominantAngle = function (polys) {
    if (polys.length && typeof polys[0][0] === 'number') polys = [polys];
    let sx = 0, sy = 0;
    for (const pts of polys) {
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const len = Math.hypot(dx, dy);
        if (len < 1e-9) continue;
        const t = Math.atan2(dy, dx) * 4;
        sx += len * Math.cos(t); sy += len * Math.sin(t);
      }
    }
    if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12) return 0;
    return Math.atan2(sy, sx) / 4;
  };

  /* Esquadreja um polígono: todas as paredes ficam paralelas ou perpendiculares
     à direção dominante. Devolve null se o polígono não for "quase ortogonal". */
  G.MIN_EDGE = 0.20;
  G.orthogonalize = function (pts, forceAng) {
    if (pts.length < 4) return null;
    const ang = forceAng != null ? forceAng : G.dominantAngle(pts);
    let r = pts.map(p => G.rot(p, -ang));
    const cls = q => q.map((p, i) => {
      const n = q[(i + 1) % q.length];
      return Math.abs(n[0] - p[0]) >= Math.abs(n[1] - p[1]) ? 'H' : 'V';
    });
    // remove vértices entre duas paredes de mesma direção (pontos quase colineares)
    let guard = 0;
    while (guard++ < 50) {
      const c = cls(r); let removed = false;
      for (let i = 0; i < r.length; i++) {
        const prev = (i - 1 + r.length) % r.length;
        if (c[prev] === c[i]) { r.splice(i, 1); removed = true; break; }
      }
      if (!removed) break;
      if (r.length < 4) return null;
    }
    let c = cls(r), n = r.length;
    if (n < 4 || n % 2) return null;
    let val = c.map((k, i) => {
      const a = r[i], b = r[(i + 1) % n];
      return k === 'H' ? (a[1] + b[1]) / 2 : (a[0] + b[0]) / 2;
    });
    // remove degraus/dentes menores que minEdge (ruído do AR): a parede curta some
    // e as duas paredes vizinhas, paralelas, viram uma só
    const minEdge = G.MIN_EDGE;
    for (let it = 0; it < 100 && n > 4; it++) {
      let best = -1, bl = minEdge;
      for (let i = 0; i < n; i++) {
        const L = Math.abs(val[(i + 1) % n] - val[(i - 1 + n) % n]);
        if (L < bl) { bl = L; best = i; }
      }
      if (best < 0) break;
      const ip = (best - 1 + n) % n, inx = (best + 1) % n;
      const lp = Math.abs(val[best] - val[(ip - 1 + n) % n]), ln = Math.abs(val[(inx + 1) % n] - val[best]);
      val[ip] = (val[ip] * lp + val[inx] * ln) / ((lp + ln) || 1);
      const rm = [best, inx].sort((a, b) => b - a);
      for (const k of rm) { val.splice(k, 1); c.splice(k, 1); }
      n = val.length;
    }
    if (n < 4) return null;
    r = new Array(n).fill(0);
    const out = r.map((p, i) => {
      const prev = (i - 1 + n) % n;
      return c[i] === 'H' ? [val[prev], val[i]] : [val[i], val[prev]];
    });
    return out.map(p => G.rot(p, ang));
  };

  /* Recuo de um polígono para dentro (dists > 0) ou para fora (dists < 0).
     dists: número único ou um valor por lado (lado i = vértice i -> i+1).
     O polígono deve estar em sentido anti-horário. */
  G.inset = function (pts, dists) {
    const n = pts.length;
    const d = i => (typeof dists === 'number' ? dists : (dists[i] != null ? dists[i] : 0));
    const lines = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len; // normal para dentro (anti-horário)
      lines.push({ p: [a[0] + nx * d(i), a[1] + ny * d(i)], v: [dx / len, dy / len] });
    }
    const out = [];
    for (let i = 0; i < n; i++) {
      const L1 = lines[(i - 1 + n) % n], L2 = lines[i];
      const cr = L1.v[0] * L2.v[1] - L1.v[1] * L2.v[0];
      if (Math.abs(cr) < 1e-9) { out.push(L2.p.slice()); continue; }
      const t = ((L2.p[0] - L1.p[0]) * L2.v[1] - (L2.p[1] - L1.p[1]) * L2.v[0]) / cr;
      out.push([L1.p[0] + L1.v[0] * t, L1.p[1] + L1.v[1] * t]);
    }
    return out;
  };

  /* Caixa orientada (retângulo envolvente alinhado à direção dominante). */
  G.obb = function (polys, ang) {
    if (polys.length && typeof polys[0][0] === 'number') polys = [polys];
    if (ang == null) ang = G.dominantAngle(polys);
    const all = [];
    for (const pts of polys) for (const p of pts) all.push(G.rot(p, -ang));
    const b = G.bbox(all);
    return { ang, minx: b.minx, miny: b.miny, w: b.w, h: b.h };
  };
  G.obbPoly = o => [[o.minx, o.miny], [o.minx + o.w, o.miny], [o.minx + o.w, o.miny + o.h], [o.minx, o.miny + o.h]].map(p => G.rot(p, o.ang));

  /* Ajuste proporcional: leva a caixa do croqui (src) para a caixa do contorno (dst).
     k = número de giros de 90°, mirror = espelhar. */
  G.fitScales = function (src, dst, k) {
    return (k % 2 === 0) ? { sx: dst.w / src.w, sy: dst.h / src.h } : { sx: dst.h / src.w, sy: dst.w / src.h };
  };
  G.autoK = function (src, dst) {
    const an = k => { const s = G.fitScales(src, dst, k); return Math.abs(Math.log(s.sx / s.sy)); };
    return an(0) <= an(1) ? 0 : 1;
  };
  G.fitMap = function (src, dst, k, mirror) {
    return function (p) {
      const q = G.rot(p, -src.ang);
      let u = (q[0] - src.minx) / src.w, v = (q[1] - src.miny) / src.h;
      if (mirror) u = 1 - u;
      for (let i = 0; i < (k % 4); i++) { const t = u; u = 1 - v; v = t; }
      return G.rot([dst.minx + u * dst.w, dst.miny + v * dst.h], dst.ang);
    };
  };

  /* ---- Geodésia (SIRGAS 2000 / GRS80) ---- */
  const A = 6378137, F = 1 / 298.257222101, E2 = F * (2 - F);
  G.localFrame = function (lat0, lng0) {
    const s = Math.sin(lat0 * RAD), w = Math.sqrt(1 - E2 * s * s);
    const N = A / w, M = A * (1 - E2) / (w * w * w);
    const kx = N * Math.cos(lat0 * RAD) * RAD, ky = M * RAD; // metros por grau
    return {
      lat0, lng0,
      toLocal: ll => [(ll[1] - lng0) * kx, (ll[0] - lat0) * ky],
      toLatLng: p => [lat0 + p[1] / ky, lng0 + p[0] / kx]
    };
  };
  G.utm = function (lat, lng) {
    const zone = Math.floor((lng + 180) / 6) + 1;
    const l0 = (zone * 6 - 183) * RAD, phi = lat * RAD, lam = lng * RAD;
    const ep2 = E2 / (1 - E2), s = Math.sin(phi), c = Math.cos(phi), t = Math.tan(phi);
    const N = A / Math.sqrt(1 - E2 * s * s), T = t * t, C = ep2 * c * c, a = (lam - l0) * c;
    const e4 = E2 * E2, e6 = e4 * E2;
    const M = A * ((1 - E2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi
      - (3 * E2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi)
      + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi)
      - (35 * e6 / 3072) * Math.sin(6 * phi));
    const k0 = 0.9996;
    const E = k0 * N * (a + (1 - T + C) * a ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * a ** 5 / 120) + 500000;
    let Nn = k0 * (M + N * t * (a * a / 2 + (5 - T + 9 * C + 4 * C * C) * a ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * a ** 6 / 720));
    if (lat < 0) Nn += 10000000;
    return { e: E, n: Nn, zone, hemi: lat < 0 ? 'S' : 'N' };
  };

  /* ---- Cômodos ---- */
  G.roomPts = function (r) {
    if (r.rect) return [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
    return r.pts;
  };

  /* ---- Cálculo completo da planta ----
     Entrada: projeto. Saída: contornos (cobertura, paredes, face interna),
     cômodos ajustados, áreas e relatório do ajuste. Tudo em metros, num plano local. */
  G.compute = function (P) {
    const N = v => (typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(',', '.')));
    const c = P.cont, esp = N(c.esp) || 0, beiral = N(c.beiral) || 0;
    const rooms = P.rooms.map(r => ({ id: r.id, nome: r.nome, src: G.ccw(G.roomPts(r)) })).filter(r => r.src.length >= 3);
    const out = { modo: c.modo, ok: false, georef: null, rooms: [], avisos: [], fit: null, beirais: [] };
    const srcPolys = rooms.map(r => r.src);
    const src = srcPolys.length ? G.obb(srcPolys) : null;
    let roof = null, walls = null, inner = null, frame = null;

    if (c.modo === 'satelite') {
      if (!c.fechado || !c.roof || c.roof.length < 3) { out.motivo = 'Marque o contorno do telhado na imagem de satélite.'; return out; }
      const lat0 = c.roof.reduce((s, p) => s + p[0], 0) / c.roof.length;
      const lng0 = c.roof.reduce((s, p) => s + p[1], 0) / c.roof.length;
      frame = G.localFrame(lat0, lng0);
      let loc = c.roof.map(frame.toLocal), dists = c.roof.map((_, i) => (c.beirais && c.beirais[i] != null ? N(c.beirais[i]) : beiral));
      if (G.area(loc) < 0) { // normaliza para anti-horário mantendo o beiral de cada lado
        const n = loc.length; loc = loc.slice().reverse();
        dists = dists.map((_, i) => dists[(2 * n - 2 - i) % n]);
        out.invertido = true;
      }
      roof = loc; out.beirais = dists;
      walls = G.inset(roof, dists);
      out.georef = { lat0, lng0 };
    } else if (c.modo === 'medidas') {
      const W = N(c.largura), L = N(c.comprimento);
      if (!(W > 0 && L > 0)) { out.motivo = 'Informe a largura e o comprimento externos do prédio.'; return out; }
      walls = [[0, 0], [W, 0], [W, L], [0, L]];
      roof = G.inset(walls, -beiral); out.beirais = [beiral, beiral, beiral, beiral];
    } else {
      if (!src) { out.motivo = 'Desenhe pelo menos um cômodo no croqui.'; return out; }
      inner = G.obbPoly(src);
      walls = G.inset(inner, -esp);
      roof = G.inset(walls, -beiral); out.beirais = [beiral, beiral, beiral, beiral];
    }
    if (!inner) inner = G.inset(walls, esp);
    if (G.area(walls) <= 0 || G.area(inner) <= 0) { out.motivo = 'O recuo do beiral ficou maior que o prédio. Revise os valores.'; return out; }

    if (rooms.length > 1) { // cômodos encostados? (grafo de vizinhança)
      const tol = esp + 0.30, bb = rooms.map(r => G.bbox(r.src)), vis = [0], seen = new Set([0]);
      while (vis.length) {
        const i = vis.pop();
        for (let j = 0; j < rooms.length; j++) if (!seen.has(j)) {
          const a = bb[i], b = bb[j];
          if (a.minx - tol <= b.maxx && b.minx - tol <= a.maxx && a.miny - tol <= b.maxy && b.miny - tol <= a.maxy) { seen.add(j); vis.push(j); }
        }
      }
      out.soltos = seen.size < rooms.length;
    }
    if (out.soltos && c.modo !== 'croqui') {
      out.avisos.push('Os cômodos estão soltos no croqui, sem encostar uns nos outros. Monte a casa na aba Croqui, arrastando os cômodos até se encaixarem. Até lá, a planta sai só com o contorno externo.');
    } else if (src && src.w > 0.01 && src.h > 0.01) {
      if (c.modo === 'croqui') {
        out.rooms = rooms.map(r => ({ id: r.id, nome: r.nome, pts: r.src }));
        out.fit = { sx: 1, sy: 1, k: 0 };
      } else {
        const dst = G.obb(inner);
        const k = (c.k == null) ? G.autoK(src, dst) : c.k;
        const f = G.fitMap(src, dst, k, !!c.m), s = G.fitScales(src, dst, k);
        out.rooms = rooms.map(r => ({ id: r.id, nome: r.nome, pts: G.ccw(r.src.map(f)) }));
        out.fit = { sx: s.sx, sy: s.sy, k };
        const dev = Math.max(Math.abs(s.sx - 1), Math.abs(s.sy - 1));
        if (dev > 0.10) out.avisos.push('O croqui precisou ser esticado/encolhido mais de 10% para encaixar no contorno. Confira as medidas, o beiral ou o giro do croqui.');
      }
      out.rooms.forEach(r => { r.area = G.absArea(r.pts); r.c = G.centroid(r.pts); });
    }
    const ang = G.dominantAngle(walls), o = G.obb(walls, ang);
    out.ang = o.w >= o.h ? ang : ang + Math.PI / 2; // lado maior na horizontal do desenho
    out.roof = roof; out.walls = walls; out.inner = inner; out.frame = frame;
    out.areas = {
      cobertura: G.absArea(roof), construida: G.absArea(walls), interna: G.absArea(inner),
      util: out.rooms.reduce((s, r) => s + r.area, 0)
    };
    if (out.areas.util > out.areas.interna * 1.02) out.avisos.push('A soma dos cômodos passa da área interna do prédio. Há cômodos sobrepostos no croqui.');
    out.ok = true;
    return out;
  };

  /* ---- Exportações ---- */
  const dxfTxt = s => String(s).replace(/[^\x20-\x7e]/g, ch => '\\U+' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'));
  G.dxf = function (C, P) {
    let conv, info;
    if (C.frame) {
      const z = G.utm(C.georef.lat0, C.georef.lng0);
      conv = p => { const ll = C.frame.toLatLng(p), u = G.utm(ll[0], ll[1]); return [u.e, u.n]; };
      info = 'SIRGAS 2000 / UTM ' + z.zone + z.hemi;
    } else { conv = p => p; info = 'Coordenadas locais (m)'; }
    const L = [];
    const w = (...a) => { for (let i = 0; i < a.length; i += 2) L.push(String(a[i]), String(a[i + 1])); };
    const layers = [['COBERTURA', 8], ['PAREDES_EXTERNAS', 7], ['FACE_INTERNA', 9], ['AMBIENTES', 5], ['TEXTOS', 3], ['COTAS', 1]];
    w(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1009', 9, '$INSUNITS', 70, 6, 0, 'ENDSEC');
    w(0, 'SECTION', 2, 'TABLES');
    w(0, 'TABLE', 2, 'LTYPE', 70, 1, 0, 'LTYPE', 2, 'CONTINUOUS', 70, 0, 3, 'Solid line', 72, 65, 73, 0, 40, 0.0, 0, 'ENDTAB');
    w(0, 'TABLE', 2, 'LAYER', 70, layers.length);
    for (const [n, col] of layers) w(0, 'LAYER', 2, n, 70, 0, 62, col, 6, 'CONTINUOUS');
    w(0, 'ENDTAB', 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES');
    const f = v => v.toFixed(3);
    const poly = (layer, pts) => {
      w(0, 'POLYLINE', 8, layer, 66, 1, 70, 1);
      for (const p of pts) { const q = conv(p); w(0, 'VERTEX', 8, layer, 10, f(q[0]), 20, f(q[1])); }
      w(0, 'SEQEND', 8, layer);
    };
    const text = (layer, p, h, s, rotDeg) => {
      const q = conv(p);
      w(0, 'TEXT', 8, layer, 10, f(q[0]), 20, f(q[1]), 40, f(h), 1, dxfTxt(s), 50, f(rotDeg || 0), 72, 1, 11, f(q[0]), 21, f(q[1]));
    };
    const size = Math.max(0.15, Math.min(0.6, Math.sqrt(C.areas.construida) / 40));
    const deg = C.ang * 180 / Math.PI;
    poly('COBERTURA', C.roof); poly('PAREDES_EXTERNAS', C.walls); poly('FACE_INTERNA', C.inner);
    for (const r of C.rooms) {
      poly('AMBIENTES', r.pts);
      const up = G.rot([0, size * 0.9], C.ang);
      text('TEXTOS', [r.c[0] + up[0], r.c[1] + up[1]], size, r.nome, deg);
      text('TEXTOS', [r.c[0] - up[0], r.c[1] - up[1]], size * 0.8, r.area.toFixed(2).replace('.', ',') + ' m2', deg);
    }
    const cw = G.centroid(C.walls);
    C.walls.forEach((a, i) => {
      const b = C.walls[(i + 1) % C.walls.length], len = G.dist(a, b);
      if (len < 0.05) return;
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      let nx = (b[1] - a[1]) / len, ny = -(b[0] - a[0]) / len; // para fora (anti-horário)
      let rot = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
      if (rot > 90 || rot <= -90) rot += 180;
      text('COTAS', [m[0] + nx * size * 1.6, m[1] + ny * size * 1.6], size * 0.8, len.toFixed(2).replace('.', ','), rot);
    });
    w(0, 'ENDSEC', 0, 'EOF');
    return { text: L.join('\r\n') + '\r\n', info };
  };

  const xml = s => String(s).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
  G.kml = function (C, P) {
    if (!C.frame) return null;
    const ring = pts => pts.concat([pts[0]]).map(p => { const ll = C.frame.toLatLng(p); return ll[1].toFixed(8) + ',' + ll[0].toFixed(8) + ',0'; }).join(' ');
    const pm = (name, style, pts, desc) => '<Placemark><name>' + xml(name) + '</name>' + (desc ? '<description>' + xml(desc) + '</description>' : '') +
      '<styleUrl>#' + style + '</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>' + ring(pts) + '</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>';
    const st = (id, line, fill, wd) => '<Style id="' + id + '"><LineStyle><color>' + line + '</color><width>' + wd + '</width></LineStyle><PolyStyle><color>' + fill + '</color></PolyStyle></Style>';
    const m2 = v => v.toFixed(2).replace('.', ',') + ' m²';
    let s = '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>' + xml(P.nome) + '</name>';
    s += st('cob', 'ff00ffff', '2200ffff', 2) + st('par', 'ff0000ff', '330000ff', 3) + st('amb', 'ffffaa00', '44ffaa00', 1.5);
    s += pm('Projeção da cobertura', 'cob', C.roof, 'Área: ' + m2(C.areas.cobertura));
    s += pm('Área construída (paredes externas)', 'par', C.walls, 'Área: ' + m2(C.areas.construida));
    s += '<Folder><name>Ambientes</name>';
    for (const r of C.rooms) s += pm(r.nome, 'amb', r.pts, 'Área: ' + m2(r.area));
    s += '</Folder></Document></kml>\n';
    return s;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = G;
  root.G = G;
})(typeof window !== 'undefined' ? window : globalThis);
