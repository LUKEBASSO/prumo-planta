/* Prumo Planta — aplicativo */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
  const fmt = (n, d) => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d });
  const num = s => { const v = parseFloat(String(s).replace(/\s/g, '').replace(',', '.')); return isFinite(v) ? v : NaN; };
  const pct = s => { const v = (s - 1) * 100; return (v >= 0 ? '+' : '−') + fmt(Math.abs(v), 1) + '%'; };
  const uid = () => 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const NOMES = ['Recepção', 'Escritório', 'Banheiro', 'Depósito', 'Produção', 'Oficina', 'Cozinha', 'Refeitório', 'Vestiário', 'Almoxarifado', 'Estoque', 'Sala', 'Circulação', 'Área de resíduos'];

  /* ---------- armazenamento ---------- */
  const DB = {
    mem: new Map(), db: null, ok: false,
    async open() {
      try {
        this.db = await new Promise((res, rej) => {
          const r = indexedDB.open('prumo-planta', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('projetos', { keyPath: 'id' });
          r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
        });
        this.ok = true;
      } catch (e) { this.ok = false; }
    },
    st(mode) { return this.db.transaction('projetos', mode).objectStore('projetos'); },
    req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
    async all() { if (!this.ok) return [...this.mem.values()]; try { return await this.req(this.st('readonly').getAll()); } catch (e) { return [...this.mem.values()]; } },
    async put(p) { this.mem.set(p.id, p); if (this.ok) try { await this.req(this.st('readwrite').put(JSON.parse(JSON.stringify(p)))); } catch (e) { this.ok = false; } },
    async del(id) { this.mem.delete(id); if (this.ok) try { await this.req(this.st('readwrite').delete(id)); } catch (e) { } }
  };
  const pref = {
    get(k) { try { return localStorage.getItem('pp_' + k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('pp_' + k, v); } catch (e) { } }
  };

  let lista = [], P = null, saveT = null;
  function novoProjeto(nome) {
    return {
      id: uid(), nome, criado: new Date().toISOString(), rooms: [],
      cont: { modo: 'satelite', roof: [], fechado: false, beiral: 0.5, beirais: {}, esp: 0.15, largura: '', comprimento: '', k: null, m: false },
      carimbo: { empreendimento: '', cliente: '', endereco: '', municipio: '', resp: pref.get('resp') || '', registro: pref.get('registro') || '', empresa: pref.get('empresa') || 'Prumo Ambiental LTDA' }
    };
  }
  function save() { if (!P) return; clearTimeout(saveT); saveT = setTimeout(() => DB.put(P), 250); }

  /* ---------- utilidades de interface ---------- */
  let toastT;
  function toast(msg, ms) { const t = $('#toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toastT); toastT = setTimeout(() => t.style.display = 'none', ms || 2600); }
  function sheet(html) { $('#sheet').innerHTML = html; $('#sheetbg').classList.add('on'); return $('#sheet'); }
  function sheetClose() { $('#sheetbg').classList.remove('on'); }
  $('#sheetbg').addEventListener('pointerdown', e => { if (e.target.id === 'sheetbg') sheetClose(); });
  function confirma(msg, sim) {
    return new Promise(res => {
      const s = sheet('<h3>' + esc(msg) + '</h3><div class="row" style="margin-top:14px"><button class="b grow" id="cN">Cancelar</button><button class="b d grow" id="cS">' + esc(sim || 'Excluir') + '</button></div>');
      $('#cN', s).onclick = () => { sheetClose(); res(false); };
      $('#cS', s).onclick = () => { sheetClose(); res(true); };
    });
  }
  function baixar(nome, conteudo, mime) {
    const blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: mime || 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const slug = s => (s || 'planta').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'planta';

  /* ---------- navegação ---------- */
  let viewAtual = 'proj';
  function go(v) {
    if (v !== 'proj' && !P) { toast('Abra ou crie um projeto primeiro.'); v = 'proj'; }
    viewAtual = v;
    $$('.view').forEach(e => e.classList.toggle('on', e.id === 'v-' + v));
    $$('nav button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
    $('#hproj').textContent = P ? P.nome : '';
    if (v === 'proj') renderProj();
    if (v === 'croqui') { cqRender(); if (!cqFitFeito) cqFit(); }
    if (v === 'cont') renderCont();
    if (v === 'planta') renderPlanta();
  }
  $$('nav button').forEach(b => b.onclick = () => go(b.dataset.v));

  /* ---------- projetos ---------- */
  function renderProj() {
    const el = $('#projbody');
    let h = '<h2>Projetos</h2>';
    if (!DB.ok) h += '<div class="aviso">Este navegador não está deixando salvar no aparelho. Ao terminar, use “Salvar arquivo do projeto” para não perder o trabalho.</div>';
    h += '<div class="row"><button class="b p" id="pNovo">+ Novo projeto</button><button class="b" id="pImp">Abrir arquivo de projeto</button></div>';
    if (!lista.length) h += '<p class="sub" style="margin-top:14px">Nenhum projeto ainda. Crie um para cada prédio levantado.</p>';
    for (const p of lista.slice().sort((a, b) => (b.criado || '').localeCompare(a.criado || ''))) {
      h += '<div class="card"><div class="row"><div class="grow"><b>' + esc(p.nome) + '</b><div class="sub">' + p.rooms.length + ' cômodo(s) · ' + new Date(p.criado).toLocaleDateString('pt-BR') + '</div></div>' +
        '<button class="b p sm" data-open="' + p.id + '">Abrir</button></div>' +
        '<div class="row" style="margin-top:8px"><button class="b sm" data-ren="' + p.id + '">Renomear</button><button class="b sm" data-exp="' + p.id + '">Salvar arquivo do projeto</button><button class="b sm d" data-del="' + p.id + '">Excluir</button></div></div>';
    }
    h += '<h2>Como usar</h2><div class="card sub"><p><b>1 · Croqui:</b> desenhe os cômodos em campo, informando as medidas (teclado, voz ou AR no aparelho compatível) e anexando fotos.</p>' +
      '<p><b>2 · Contorno:</b> marque o telhado na imagem de satélite e informe o beiral. O app encaixa o croqui dentro das paredes.</p>' +
      '<p><b>3 · Planta:</b> confira o quadro de áreas e exporte em PDF, DXF ou KML.</p></div>';
    el.innerHTML = h;
    $('#pNovo').onclick = () => nomeSheet('Novo projeto', '', async nome => { const p = novoProjeto(nome); lista.push(p); await DB.put(p); abrir(p.id); });
    $('#pImp').onclick = () => $('#fImp').click();
    $$('[data-open]', el).forEach(b => b.onclick = () => abrir(b.dataset.open));
    $$('[data-ren]', el).forEach(b => b.onclick = () => { const p = lista.find(x => x.id === b.dataset.ren); nomeSheet('Renomear projeto', p.nome, async nome => { p.nome = nome; await DB.put(p); go('proj'); }); });
    $$('[data-exp]', el).forEach(b => b.onclick = () => { const p = lista.find(x => x.id === b.dataset.exp); baixar(slug(p.nome) + '.prumoplanta.json', JSON.stringify(p), 'application/json'); });
    $$('[data-del]', el).forEach(b => b.onclick = async () => {
      const p = lista.find(x => x.id === b.dataset.del);
      if (!await confirma('Excluir o projeto “' + p.nome + '”?')) return;
      lista = lista.filter(x => x !== p); await DB.del(p.id); if (P === p) P = null; go('proj');
    });
  }
  function nomeSheet(titulo, valor, cb) {
    const s = sheet('<h3>' + esc(titulo) + '</h3><label>Nome (cliente ou prédio)</label><input type="text" id="nN" value="' + esc(valor) + '" placeholder="Ex.: Oficina do João – barracão">' +
      '<div class="row" style="margin-top:14px"><button class="b grow" id="nC">Cancelar</button><button class="b p grow" id="nOk">Salvar</button></div>');
    const i = $('#nN', s); setTimeout(() => i.focus(), 50);
    $('#nC', s).onclick = sheetClose;
    $('#nOk', s).onclick = () => { const v = i.value.trim(); if (!v) { toast('Dê um nome ao projeto.'); return; } sheetClose(); cb(v); };
  }
  function abrir(id) { P = lista.find(x => x.id === id); sel = null; cqFitFeito = false; pref.set('ultimo', id); go('croqui'); }
  $('#fImp').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const p = JSON.parse(await f.text());
      if (!p || !Array.isArray(p.rooms) || !p.cont) throw 0;
      p.id = uid(); const base = novoProjeto(p.nome || 'Projeto importado');
      p.cont = Object.assign(base.cont, p.cont); p.carimbo = Object.assign(base.carimbo, p.carimbo || {}); p.nome = p.nome || base.nome; p.criado = p.criado || base.criado;
      lista.push(p); await DB.put(p); abrir(p.id); toast('Projeto aberto.');
    } catch (err) { toast('Este arquivo não é um projeto do Prumo Planta.'); }
  };

  /* ---------- croqui ---------- */
  const V = { cx: 0, cy: 0, s: 40 };
  let sel = null, cqFitFeito = false;
  const svg = $('#cq');
  const roomById = id => P.rooms.find(r => r.id === id);
  function cqSize() { const r = svg.getBoundingClientRect(); return { W: r.width || 320, H: r.height || 400, left: r.left, top: r.top }; }
  function cqFit() {
    const { W, H } = cqSize();
    if (!P || !P.rooms.length) { V.cx = 3; V.cy = 2; V.s = 40; cqRender(); return; }
    const b = G.bbox(P.rooms.flatMap(G.roomPts));
    V.cx = (b.minx + b.maxx) / 2; V.cy = (b.miny + b.maxy) / 2;
    V.s = Math.max(4, Math.min(120, Math.min((W - 60) / Math.max(b.w, 1), (H - 150) / Math.max(b.h, 1))));
    cqFitFeito = true; cqRender();
  }
  function cqRender() {
    if (!P) return;
    const { W, H } = cqSize();
    const X = x => (x - V.cx) * V.s + W / 2, Y = y => H / 2 - (y - V.cy) * V.s;
    let h = '';
    const step = V.s >= 22 ? 1 : V.s >= 6 ? 5 : 10;
    const x0 = V.cx - W / 2 / V.s, x1 = V.cx + W / 2 / V.s, y0 = V.cy - H / 2 / V.s, y1 = V.cy + H / 2 / V.s;
    for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) h += '<line x1="' + X(x) + '" y1="0" x2="' + X(x) + '" y2="' + H + '" stroke="#e9eeeb" stroke-width="1"/>';
    for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) h += '<line x1="0" y1="' + Y(y) + '" x2="' + W + '" y2="' + Y(y) + '" stroke="#e9eeeb" stroke-width="1"/>';
    h += '<text x="8" y="' + (H - 8) + '" font-size="11" fill="#8a9690">malha de ' + step + ' m</text>';
    for (const r of P.rooms) {
      const pts = G.roomPts(r), on = r.id === sel;
      h += '<polygon data-id="' + r.id + '" points="' + pts.map(p => X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1)).join(' ') + '" fill="' + (on ? '#d9efe3' : '#f2f7f4') + '" stroke="' + (on ? '#1f4d3a' : '#33423b') + '" stroke-width="' + (on ? 3 : 2) + '"/>';
      const c = G.centroid(pts), b = G.bbox(pts), wpx = b.w * V.s, hpx = b.h * V.s;
      const fs = Math.max(8, Math.min(14, wpx / Math.max(4, r.nome.length * 0.62)));
      if (wpx > 30 && hpx > 22) {
        h += '<g pointer-events="none" text-anchor="middle" fill="#1c2421"><text x="' + X(c[0]) + '" y="' + (Y(c[1]) - 2) + '" font-size="' + fs + '" font-weight="700">' + esc(r.nome) + '</text>';
        const l2 = r.rect ? fmt(r.w) + ' × ' + fmt(r.h) : fmt(G.absArea(pts)) + ' m²';
        if (hpx > 40 && wpx > 74) h += '<text x="' + X(c[0]) + '" y="' + (Y(c[1]) + fs + 1) + '" font-size="' + Math.min(fs, 11.5) + '" fill="#5d6b65">' + l2 + (r.fotos && r.fotos.length ? ' · 📷' + r.fotos.length : '') + '</text>';
        h += '</g>';
      }
    }
    svg.innerHTML = h;
    $('#cqvazio').innerHTML = P.rooms.length ? '' : '<div><b>Croqui vazio</b><br>Toque em “+ Cômodo” e informe largura e comprimento.<br>Depois arraste os cômodos: eles se encaixam uns nos outros.</div>';
    const bar = $('#cqsel'), r = sel && roomById(sel);
    bar.classList.toggle('on', !!r);
    if (r) {
      const a = G.absArea(G.roomPts(r));
      bar.innerHTML = '<div class="row"><div class="grow"><b>' + esc(r.nome) + '</b> <span class="sub">' + (r.rect ? fmt(r.w) + ' × ' + fmt(r.h) + ' m · ' : '') + fmt(a) + ' m²</span></div></div>' +
        '<div class="row" style="margin-top:6px"><button class="b p sm" id="sEd">Editar / fotos</button><button class="b sm" id="sGi">Girar</button><button class="b sm" id="sDu">Duplicar</button><button class="b sm d" id="sEx">Excluir</button></div>';
      $('#sEd').onclick = () => roomSheet(r);
      $('#sGi').onclick = () => { girar(r); save(); cqRender(); };
      $('#sDu').onclick = () => { const n = JSON.parse(JSON.stringify(r)); n.id = uid(); n.fotos = []; const b = G.bbox(G.roomPts(r)); mover(n, b.w + (+P.cont.esp || 0), 0); P.rooms.push(n); sel = n.id; save(); cqRender(); };
      $('#sEx').onclick = async () => { if (!await confirma('Excluir o cômodo “' + r.nome + '”?')) return; P.rooms = P.rooms.filter(x => x !== r); sel = null; save(); cqRender(); };
    }
  }
  function mover(r, dx, dy) { if (r.rect) { r.x += dx; r.y += dy; } else r.pts = r.pts.map(p => [p[0] + dx, p[1] + dy]); }
  function girar(r) {
    if (r.rect) { const cx = r.x + r.w / 2, cy = r.y + r.h / 2, w = r.h, h = r.w; r.w = w; r.h = h; r.x = cx - w / 2; r.y = cy - h / 2; }
    else { const c = G.centroid(r.pts); r.pts = r.pts.map(p => { const q = G.rot([p[0] - c[0], p[1] - c[1]], Math.PI / 2); return [q[0] + c[0], q[1] + c[1]]; }); }
  }
  function snap(r) {
    const g = +P.cont.esp || 0, tol = Math.max(0.12, Math.min(0.5, 14 / V.s));
    const b = G.bbox(G.roomPts(r)); let bx = null, by = null;
    const pick = (cur, d) => (Math.abs(d) < tol && (cur == null || Math.abs(d) < Math.abs(cur))) ? d : cur;
    for (const o of P.rooms) {
      if (o === r) continue;
      const ob = G.bbox(G.roomPts(o)), m = tol + g;
      if (b.miny < ob.maxy + m && b.maxy > ob.miny - m) for (const d of [ob.maxx + g - b.minx, ob.minx - g - b.maxx, ob.minx - b.minx, ob.maxx - b.maxx]) bx = pick(bx, d);
      if (b.minx < ob.maxx + m && b.maxx > ob.minx - m) for (const d of [ob.maxy + g - b.miny, ob.miny - g - b.maxy, ob.miny - b.miny, ob.maxy - b.maxy]) by = pick(by, d);
    }
    mover(r, bx || 0, by || 0);
  }
  const ptrs = new Map(); let drag = null;
  svg.addEventListener('pointerdown', e => {
    try { svg.setPointerCapture(e.pointerId); } catch (err) { }
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) {
      const t = e.target.closest ? e.target.closest('[data-id]') : null, id = t ? t.dataset.id : null, r = id && roomById(id);
      drag = { id, x0: e.clientX, y0: e.clientY, moved: false, orig: r ? JSON.stringify(r) : null, cx: V.cx, cy: V.cy };
    } else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], { W, H, left, top } = cqSize();
      const mx = (a.x + b.x) / 2 - left, my = (a.y + b.y) / 2 - top;
      if (drag && drag.id && drag.moved && drag.orig) Object.assign(roomById(drag.id), JSON.parse(drag.orig));
      drag = { pinch: true, d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, s0: V.s, wx: (mx - W / 2) / V.s + V.cx, wy: V.cy - (my - H / 2) / V.s };
    }
  });
  svg.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId) || !drag) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (drag.pinch) {
      if (ptrs.size < 2) return;
      const [a, b] = [...ptrs.values()], { W, H, left, top } = cqSize();
      const mx = (a.x + b.x) / 2 - left, my = (a.y + b.y) / 2 - top;
      V.s = Math.max(3, Math.min(250, drag.s0 * Math.hypot(a.x - b.x, a.y - b.y) / drag.d0));
      V.cx = drag.wx - (mx - W / 2) / V.s; V.cy = drag.wy + (my - H / 2) / V.s;
      cqRender(); return;
    }
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.moved && Math.hypot(dx, dy) < 7) return;
    drag.moved = true;
    if (drag.id) {
      const r = roomById(drag.id); if (!r) return;
      Object.assign(r, JSON.parse(drag.orig)); mover(r, dx / V.s, -dy / V.s); snap(r); sel = r.id;
    } else { V.cx = drag.cx - dx / V.s; V.cy = drag.cy + dy / V.s; }
    cqRender();
  });
  const ptrUp = e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (drag && !drag.pinch && !drag.moved) { sel = drag.id || null; cqRender(); }
    if (drag && drag.moved && drag.id) save();
    if (ptrs.size === 0) drag = null;
  };
  svg.addEventListener('pointerup', ptrUp); svg.addEventListener('pointercancel', ptrUp);
  svg.addEventListener('wheel', e => { e.preventDefault(); V.s = Math.max(3, Math.min(250, V.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15))); cqRender(); }, { passive: false });
  $('#bZin').onclick = () => { V.s = Math.min(250, V.s * 1.3); cqRender(); };
  $('#bZout').onclick = () => { V.s = Math.max(3, V.s / 1.3); cqRender(); };
  $('#bZfit').onclick = cqFit;
  $('#bAdd').onclick = () => roomSheet(null);
  window.addEventListener('resize', () => { if (viewAtual === 'croqui') cqRender(); });

  /* voz */
  function ouvir(cb) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('Este navegador não tem ditado por voz. Digite a medida.'); return; }
    try {
      const r = new SR(); r.lang = 'pt-BR'; r.maxAlternatives = 1;
      r.onresult = e => cb(e.results[0][0].transcript);
      r.onerror = () => toast('Não entendi. Tente de novo ou digite.');
      r.start(); toast('Fale as medidas, por exemplo: “quatro e vinte por seis”.', 4000);
    } catch (e) { toast('Não foi possível usar o microfone.'); }
  }
  const POR_EXTENSO = { zero: 0, um: 1, uma: 1, dois: 2, duas: 2, 'três': 3, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90, cem: 100 };
  function numsFala(t) {
    // "quatro e vinte por seis" -> [4.20, 6]; "3,45 por 5 e meio" -> [3.45, 5.5]
    const partes = t.toLowerCase().replace(/metros?|m\b/g, ' ').split(/\s+(?:por|x|vezes)\s+|\s*[;×]\s*/);
    const out = [];
    for (let s of partes) {
      let toks = s.replace(/v[ií]rgula|ponto/g, ' , ').replace(/(\d),(\d)/g, '$1 , $2').trim().split(/\s+/).map(w => (w in POR_EXTENSO ? String(POR_EXTENSO[w]) : w));
      for (let i = 0; i + 2 < toks.length; i++) // "40 e 5" -> 45
        if (/^[2-9]0$/.test(toks[i]) && toks[i + 1] === 'e' && /^[1-9]$/.test(toks[i + 2])) toks.splice(i, 3, String(+toks[i] + +toks[i + 2]));
      const j = toks.join(' ');
      let v = NaN, m;
      if ((m = j.match(/^(\d+) , (\d+)$/))) v = num(m[1] + '.' + m[2]);
      else if ((m = j.match(/^(\d+) e meio$/))) v = +m[1] + 0.5;
      else if ((m = j.match(/^(\d+) e (\d+)$/))) v = +m[1] + (+m[2] < 10 ? +m[2] / 10 : +m[2] / 100);
      else if ((m = j.match(/\d+(?: , \d+)?/))) v = num(m[0].replace(' , ', '.'));
      if (isFinite(v)) out.push(v);
    }
    return out;
  }

  /* cadastro/edição de cômodo */
  function roomSheet(r) {
    const novo = !r, poli = r && !r.rect;
    let h = '<h3>' + (novo ? 'Novo cômodo' : 'Editar cômodo') + '</h3><label>Nome</label><input type="text" id="rN" value="' + esc(r ? r.nome : '') + '" placeholder="Ex.: Escritório">' +
      '<div class="chips">' + NOMES.map(n => '<button data-n="' + n + '">' + n + '</button>').join('') + '</div>';
    if (!poli) h += '<div class="two"><div><label>Largura (m)</label><input type="text" inputmode="decimal" id="rW" value="' + (r ? fmt(r.w) : '') + '" placeholder="0,00"></div>' +
      '<div><label>Comprimento (m)</label><input type="text" inputmode="decimal" id="rH" value="' + (r ? fmt(r.h) : '') + '" placeholder="0,00"></div></div>' +
      '<div class="row" style="margin-top:8px"><button class="b sm" id="rMic">🎤 Falar medidas</button><span class="sub">medidas internas, de parede a parede</span></div>';
    else h += '<p class="sub">Cômodo medido por AR (' + r.pts.length + ' cantos, ' + fmt(G.absArea(r.pts)) + ' m²).</p><div class="row"><button class="b sm" id="rSq">Esquadrejar paredes</button></div>';
    if (!novo) h += '<label>Fotos do cômodo</label><div class="fotos" id="rF"></div><div class="row" style="margin-top:6px"><button class="b sm" id="rFoto">📷 Tirar / anexar foto</button></div>';
    h += '<div class="row" style="margin-top:16px"><button class="b grow" id="rC">Cancelar</button><button class="b p grow" id="rOk">' + (novo ? 'Adicionar' : 'Salvar') + '</button></div>';
    const s = sheet(h), iN = $('#rN', s), iW = $('#rW', s), iH = $('#rH', s);
    $$('[data-n]', s).forEach(b => b.onclick = () => { const usados = P.rooms.filter(x => x !== r && x.nome.replace(/ \d+$/, '') === b.dataset.n).length; iN.value = b.dataset.n + (usados ? ' ' + (usados + 1) : ''); });
    if ($('#rMic', s)) $('#rMic', s).onclick = () => ouvir(t => {
      const v = numsFala(t);
      if (!v.length) { toast('Ouvi “' + t + '”, mas não achei a medida.'); return; }
      if (v.length >= 2) { iW.value = fmt(v[0]); iH.value = fmt(v[1]); } else if (!iW.value) iW.value = fmt(v[0]); else iH.value = fmt(v[0]);
      toast('Ouvi: ' + t);
    });
    if ($('#rSq', s)) $('#rSq', s).onclick = () => { const o = G.orthogonalize(r.pts); if (!o) { toast('Não deu para esquadrejar este formato.'); return; } r.pts = o; save(); cqRender(); toast('Paredes esquadrejadas.'); roomSheet(r); };
    if (!novo) {
      const drawF = () => {
        const f = r.fotos || [];
        $('#rF', s).innerHTML = f.length ? f.map((d, i) => '<div><img src="' + d + '"><i data-x="' + i + '">×</i></div>').join('') : '<span class="sub">Nenhuma foto.</span>';
        $$('[data-x]', s).forEach(x => x.onclick = () => { r.fotos.splice(+x.dataset.x, 1); save(); drawF(); cqRender(); });
        $$('img', $('#rF', s)).forEach(im => im.onclick = () => { const w = window.open(''); if (w) w.document.write('<img src="' + im.src + '" style="max-width:100%">'); });
      };
      drawF();
      $('#rFoto', s).onclick = () => { fotoAlvo = { r, drawF }; $('#fFoto').click(); };
    }
    $('#rC', s).onclick = sheetClose;
    $('#rOk', s).onclick = () => {
      const nome = iN.value.trim() || 'Cômodo ' + (P.rooms.length + (novo ? 1 : 0));
      if (poli) { r.nome = nome; }
      else {
        const w = num(iW.value), hh = num(iH.value);
        if (!(w > 0 && hh > 0)) { toast('Informe largura e comprimento em metros.'); return; }
        if (w > 500 || hh > 500) { toast('Medida muito grande. Use metros (ex.: 4,20).'); return; }
        if (novo) {
          const n = { id: uid(), nome, rect: true, x: 0, y: 0, w, h: hh, fotos: [] };
          const ref = (sel && roomById(sel)) || P.rooms[P.rooms.length - 1];
          if (ref) { const b = G.bbox(G.roomPts(ref)); n.x = b.maxx + (+P.cont.esp || 0); n.y = b.maxy - hh; }
          P.rooms.push(n); sel = n.id;
        } else { r.nome = nome; r.y += r.h - hh; r.w = w; r.h = hh; }
      }
      save(); sheetClose(); if (novo) cqFit(); else cqRender();
    };
    if (novo) setTimeout(() => iW.focus(), 60);
  }
  let fotoAlvo = null;
  $('#fFoto').onchange = e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f || !fotoAlvo) return;
    const url = URL.createObjectURL(f), im = new Image();
    im.onload = () => {
      const k = Math.min(1, 1280 / Math.max(im.width, im.height)), c = document.createElement('canvas');
      c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      (fotoAlvo.r.fotos = fotoAlvo.r.fotos || []).push(c.toDataURL('image/jpeg', 0.7));
      URL.revokeObjectURL(url); save(); fotoAlvo.drawF(); cqRender();
    };
    im.onerror = () => toast('Não consegui ler essa imagem.');
    im.src = url;
  };

  /* ---------- contorno ---------- */
  let map = null, mapG = null, ladoSel = null;
  function renderCont() {
    const c = P.cont, el = $('#contbody');
    if (map) { map.remove(); map = null; }
    let h = '<h2>Contorno do prédio</h2><div class="seg" id="cModo"><button data-m="satelite">Satélite</button><button data-m="medidas">Medidas externas</button><button data-m="croqui">Só o croqui</button></div>';
    if (c.modo === 'satelite') {
      h += '<p class="sub">Coloque a mira em cada canto do <b>telhado</b> e toque em “Marcar canto”. Depois feche o contorno. Se a imagem ficar borrada ou cinza, troque a fonte de imagem.</p>' +
        '<div class="row" style="margin-bottom:6px"><span class="sub">Imagem:</span><select id="mCam" class="grow" style="font-size:14px;padding:7px 9px"></select></div><div id="mapwrap"><div id="map"></div><div id="mira"></div></div>' +
        '<div id="maptools"><button class="b p sm" id="mMark">Marcar canto</button><button class="b sm" id="mUndo">Desfazer</button><button class="b sm" id="mClose">Fechar contorno</button><button class="b sm" id="mSq">Esquadrejar</button><button class="b sm d" id="mClear">Recomeçar</button></div>' +
        '<div class="row"><button class="b sm" id="mGps">📍 Onde estou</button><input type="search" id="mCoord" class="grow" placeholder="Ir para: -11.8642, -55.5025" style="font-size:14px;padding:7px 9px"><button class="b sm" id="mIr">Ir</button></div>';
    } else if (c.modo === 'medidas') {
      h += '<p class="sub">Sem imagem de satélite: informe as medidas externas do prédio (de quina a quina, pelas paredes).</p>' +
        '<div class="two"><div><label>Largura externa (m)</label><input type="text" inputmode="decimal" id="cLarg" value="' + esc(c.largura) + '"></div><div><label>Comprimento externo (m)</label><input type="text" inputmode="decimal" id="cComp" value="' + esc(c.comprimento) + '"></div></div>';
    } else {
      h += '<p class="sub">O contorno é calculado pelo próprio croqui: o retângulo que envolve os cômodos, mais a espessura da parede. Use quando as medidas internas forem confiáveis.</p>';
    }
    h += '<div class="two"><div><label>Beiral padrão (m)</label><input type="text" inputmode="decimal" id="cBeiral" value="' + fmt(+c.beiral || 0) + '"></div><div><label>Espessura das paredes (m)</label><input type="text" inputmode="decimal" id="cEsp" value="' + fmt(+c.esp || 0) + '"></div></div>' +
      '<p class="sub">Beiral: quanto o telhado passa da parede. Com platibanda, use 0.</p><div id="cRes"></div>';
    el.innerHTML = h;
    $$('#cModo button').forEach(b => { b.classList.toggle('on', b.dataset.m === c.modo); b.onclick = () => { c.modo = b.dataset.m; c.k = null; save(); renderCont(); }; });
    const bind = (id, key, txt) => { const i = $(id); if (i) i.oninput = () => { const v = num(i.value); c[key] = txt ? i.value : (isFinite(v) && v >= 0 ? v : 0); if (key !== 'beiral' && key !== 'esp') c.k = null; save(); contRes(); mapDraw(); }; };
    bind('#cBeiral', 'beiral'); bind('#cEsp', 'esp'); bind('#cLarg', 'largura', true); bind('#cComp', 'comprimento', true);
    if (c.modo === 'satelite') mapInit();
    contRes();
  }
  function contRes() {
    const c = P.cont, el = $('#cRes'); if (!el) return;
    const C = G.compute(P); let h = '';
    if (!C.ok) { el.innerHTML = '<div class="aviso">' + esc(C.motivo) + '</div>'; return; }
    if (c.modo === 'satelite') {
      h += '<h2>Lados do telhado e beiral</h2><table><tr><th>Lado</th><th class="n">Telhado</th><th>Beiral (m)</th></tr>';
      C.roof.forEach((a, i) => {
        const b = C.roof[(i + 1) % C.roof.length];
        h += '<tr class="lado" data-l="' + i + '"><td>' + (i + 1) + '</td><td class="n">' + fmt(G.dist(a, b)) + ' m</td><td><input type="text" inputmode="decimal" data-b="' + i + '" value="' + (c.beirais && c.beirais[i] != null ? fmt(+c.beirais[i]) : '') + '" placeholder="' + fmt(+c.beiral || 0) + '"></td></tr>';
      });
      h += '</table><p class="sub">Deixe em branco para usar o beiral padrão. Os números dos lados aparecem na imagem.</p>';
    }
    h += '<h2>Resultado</h2>' + quadroHTML(C, true);
    if (C.rooms.length && c.modo !== 'croqui') {
      h += '<div class="ok">Ajuste do croqui ao contorno: <b>' + pct(C.fit.sx) + '</b> na largura do croqui e <b>' + pct(C.fit.sy) + '</b> no comprimento.</div>' +
        '<div class="row"><button class="b sm" id="fGira">Girar croqui 90°</button><button class="b sm" id="fEsp">Espelhar croqui</button></div>';
    } else if (!C.rooms.length) h += '<div class="aviso">Ainda não há cômodos no croqui. A área construída já pode ser calculada, mas a planta sairá sem as divisões internas.</div>';
    for (const a of C.avisos) h += '<div class="aviso">' + esc(a) + '</div>';
    if (c.modo !== 'satelite') h += '<div class="plantabox" style="margin-top:10px">' + plantaSVG(C) + '</div>';
    el.innerHTML = h;
    $$('[data-b]', el).forEach(i => i.onchange = () => { const v = num(i.value); c.beirais = c.beirais || {}; if (i.value.trim() === '' || !isFinite(v) || v < 0) delete c.beirais[i.dataset.b]; else c.beirais[i.dataset.b] = v; save(); contRes(); mapDraw(); });
    $$('tr.lado', el).forEach(tr => tr.onclick = e => { if (e.target.tagName === 'INPUT') return; ladoSel = +tr.dataset.l; mapDraw(); });
    if ($('#fGira')) $('#fGira').onclick = () => { c.k = ((C.fit.k || 0) + 1) % 4; save(); contRes(); mapDraw(); };
    if ($('#fEsp')) $('#fEsp').onclick = () => { c.m = !c.m; save(); contRes(); mapDraw(); };
  }
  function mapInit() {
    const c = P.cont;
    let centro = [-11.8642, -55.5025], zoom = 15;
    try { const u = JSON.parse(pref.get('centro')); if (u && isFinite(u[0])) { centro = [u[0], u[1]]; zoom = u[2] || 18; } } catch (e) { }
    map = L.map('map', { maxZoom: 22, zoomSnap: 0.5, attributionControl: true }).setView(centro, zoom);
    map.zoomControl.setPosition('bottomright');
    const camadas = {
      'Google Satélite': L.tileLayer('https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', { subdomains: '0123', maxNativeZoom: 21, maxZoom: 22, attribution: 'Imagem: Google' }),
      'Google Híbrido': L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', { subdomains: '0123', maxNativeZoom: 21, maxZoom: 22, attribution: 'Imagem: Google' }),
      'Esri World Imagery': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 19, maxZoom: 22, attribution: 'Imagem: Esri, Maxar, Earthstar Geographics' }),
      'Esri Clarity': L.tileLayer('https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 19, maxZoom: 22, attribution: 'Imagem: Esri Clarity' })
    };
    const nomeCam = camadas[pref.get('camada')] ? pref.get('camada') : 'Google Satélite';
    let camAtual = camadas[nomeCam].addTo(map);
    const selCam = $('#mCam');
    selCam.innerHTML = Object.keys(camadas).map(n => '<option' + (n === nomeCam ? ' selected' : '') + '>' + n + '</option>').join('');
    selCam.onchange = () => { map.removeLayer(camAtual); camAtual = camadas[selCam.value].addTo(map); pref.set('camada', selCam.value); };
    mapG = L.layerGroup().addTo(map);
    map.on('moveend', () => { const ct = map.getCenter(); pref.set('centro', JSON.stringify([ct.lat, ct.lng, map.getZoom()])); });
    if (c.roof.length) map.fitBounds(L.latLngBounds(c.roof).pad(0.6), { maxZoom: 21 });
    $('#mMark').onclick = () => { if (c.fechado) { toast('O contorno já está fechado. Arraste os pontos amarelos para corrigir, ou recomece.'); return; } const ct = map.getCenter(); c.roof.push([ct.lat, ct.lng]); save(); mapDraw(); };
    $('#mUndo').onclick = () => { if (c.fechado) { c.fechado = false; } else c.roof.pop(); save(); mapDraw(); contRes(); };
    $('#mClose').onclick = () => {
      if (c.roof.length < 3) { toast('Marque pelo menos 3 cantos.'); return; }
      const fr = G.localFrame(c.roof[0][0], c.roof[0][1]);
      if (G.area(c.roof.map(fr.toLocal)) < 0) c.roof.reverse(); // lados sempre no sentido anti-horário
      c.fechado = true; c.beirais = {}; c.k = null; save(); mapDraw(); contRes();
    };
    $('#mSq').onclick = () => {
      if (!c.fechado) { toast('Feche o contorno antes de esquadrejar.'); return; }
      const fr = G.localFrame(c.roof[0][0], c.roof[0][1]), o = G.orthogonalize(c.roof.map(fr.toLocal));
      if (!o) { toast('Este formato não é de cantos retos; deixei como está.'); return; }
      if (o.length !== c.roof.length) c.beirais = {};
      c.roof = o.map(fr.toLatLng); save(); mapDraw(); contRes(); toast('Contorno esquadrejado.');
    };
    $('#mClear').onclick = async () => { if (c.roof.length && !await confirma('Apagar o contorno marcado?', 'Apagar')) return; c.roof = []; c.fechado = false; c.beirais = {}; c.k = null; save(); mapDraw(); contRes(); };
    $('#mGps').onclick = () => {
      if (!navigator.geolocation) { toast('Localização indisponível neste navegador.'); return; }
      toast('Buscando sua localização…');
      navigator.geolocation.getCurrentPosition(p => map.setView([p.coords.latitude, p.coords.longitude], 19), () => toast('Não consegui obter a localização. Digite a coordenada.'), { enableHighAccuracy: true, timeout: 15000 });
    };
    const ir = () => { const m = $('#mCoord').value.match(/(-?\d+(?:[.,]\d+)?)[\s,;]+(-?\d+(?:[.,]\d+)?)/); if (!m) { toast('Use o formato: -11.8642, -55.5025'); return; } const la = num(m[1]), lo = num(m[2]); if (Math.abs(la) > 90 || Math.abs(lo) > 180) { toast('Coordenada inválida.'); return; } map.setView([la, lo], 19); };
    $('#mIr').onclick = ir; $('#mCoord').onkeydown = e => { if (e.key === 'Enter') ir(); };
    mapDraw();
  }
  function mapDraw() {
    if (!map || !P || P.cont.modo !== 'satelite') return;
    const c = P.cont; mapG.clearLayers();
    if (!c.roof.length) return;
    if (!c.fechado) L.polyline(c.roof, { color: '#ffd400', weight: 3, dashArray: '6 6' }).addTo(mapG);
    else {
      const C = G.compute(P);
      L.polygon(c.roof, { color: '#ffd400', weight: 2, dashArray: '6 6', fillOpacity: 0.05 }).addTo(mapG);
      if (C.ok) {
        const ll = pts => pts.map(C.frame.toLatLng);
        L.polygon(ll(C.walls), { color: '#ff3b30', weight: 3, fillOpacity: 0.08 }).addTo(mapG);
        for (const r of C.rooms) L.polygon(ll(r.pts), { color: '#35d0ff', weight: 1.5, fillOpacity: 0.12, interactive: false }).addTo(mapG);
        C.roof.forEach((a, i) => {
          const b = C.roof[(i + 1) % C.roof.length], m = C.frame.toLatLng([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
          if (i === ladoSel) L.polyline(ll([a, b]), { color: '#fff', weight: 6 }).addTo(mapG);
          L.marker(m, { icon: L.divIcon({ className: 'ladon', html: String(i + 1), iconSize: [20, 20] }), interactive: false }).addTo(mapG);
        });
      }
    }
    c.roof.forEach((p, i) => {
      const mk = L.marker(p, { draggable: true, icon: L.divIcon({ className: 'vx', iconSize: [18, 18] }) }).addTo(mapG);
      mk.on('dragend', () => { const q = mk.getLatLng(); c.roof[i] = [q.lat, q.lng]; c.k = null; save(); mapDraw(); contRes(); });
    });
  }

  /* ---------- planta ---------- */
  function quadroHTML(C, curto) {
    const A = C.areas; let h = '<table>';
    if (!curto) {
      h += '<tr><th>Ambiente</th><th class="n">Área (m²)</th></tr>';
      for (const r of C.rooms) h += '<tr><td>' + esc(r.nome) + '</td><td class="n">' + fmt(r.area) + '</td></tr>';
      if (C.rooms.length) h += '<tr class="tot"><td>Área útil (soma dos ambientes)</td><td class="n">' + fmt(A.util) + '</td></tr>';
    } else h += '<tr><th>Item</th><th class="n">Área (m²)</th></tr>';
    h += '<tr class="tot"><td>Área construída (pelas paredes externas)</td><td class="n">' + fmt(A.construida) + '</td></tr>' +
      '<tr class="tot"><td>Área de projeção da cobertura (com beirais)</td><td class="n">' + fmt(A.cobertura) + '</td></tr></table>';
    return h;
  }
  function beiralTxt(C) {
    const u = [...new Set(C.beirais.map(v => fmt(+v)))];
    return u.length === 1 ? u[0] + ' m' : 'variável por lado (' + u.join(' / ') + ' m)';
  }
  function plantaSVG(C) {
    const d = p => { const q = G.rot(p, -C.ang); return [q[0], -q[1]]; };
    const roof = C.roof.map(d), walls = C.walls.map(d), inner = C.inner.map(d), b = G.bbox(roof);
    const dim = Math.max(b.w, b.h), t = dim / 34, m = t * 4.2, th = dim / 500;
    const P2 = pts => pts.map(p => p[0].toFixed(3) + ',' + p[1].toFixed(3)).join(' ');
    let h = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + [b.minx - m, b.miny - m, b.w + 2 * m, b.h + 2 * m].map(v => v.toFixed(3)).join(' ') + '" font-family="Arial,Helvetica,sans-serif">';
    h += '<polygon points="' + P2(roof) + '" fill="none" stroke="#666" stroke-width="' + th + '" stroke-dasharray="' + th * 6 + ' ' + th * 4 + '"/>';
    h += '<polygon points="' + P2(walls) + '" fill="#3a3a3a" stroke="#000" stroke-width="' + th + '"/>';
    h += '<polygon points="' + P2(inner) + '" fill="#fff" stroke="#000" stroke-width="' + th + '"/>';
    for (const r of C.rooms) {
      const pts = r.pts.map(d), rb = G.bbox(pts), c = d(r.c);
      h += '<polygon points="' + P2(pts) + '" fill="#f4f8f5" stroke="#000" stroke-width="' + th * 2 + '"/>';
      const fs = Math.min(t, rb.w / Math.max(4, r.nome.length * 0.6), rb.h / 3);
      h += '<text x="' + c[0].toFixed(3) + '" y="' + (c[1] - fs * 0.15).toFixed(3) + '" font-size="' + fs.toFixed(3) + '" text-anchor="middle" font-weight="bold">' + esc(r.nome) + '</text>' +
        '<text x="' + c[0].toFixed(3) + '" y="' + (c[1] + fs * 1.0).toFixed(3) + '" font-size="' + (fs * 0.8).toFixed(3) + '" text-anchor="middle">' + fmt(r.area) + ' m²</text>';
    }
    C.walls.forEach((a, i) => { // cotas das paredes externas
      const bb = C.walls[(i + 1) % C.walls.length], len = G.dist(a, bb); if (len < 0.3) return;
      const off = (C.beirais[i] || 0) + t * 1.1, nx = (bb[1] - a[1]) / len, ny = -(bb[0] - a[0]) / len;
      const p = d([(a[0] + bb[0]) / 2 + nx * off, (a[1] + bb[1]) / 2 + ny * off]), a2 = d(a), b2 = d(bb);
      let ang = Math.atan2(b2[1] - a2[1], b2[0] - a2[0]) * 180 / Math.PI; if (ang > 90 || ang <= -90) ang += 180;
      h += '<text transform="translate(' + p[0].toFixed(3) + ' ' + p[1].toFixed(3) + ') rotate(' + ang.toFixed(2) + ')" font-size="' + (t * 0.8).toFixed(3) + '" text-anchor="middle" dominant-baseline="middle" fill="#b00000">' + fmt(len) + '</text>';
    });
    const esc5 = [1, 2, 5, 10, 20, 50, 100].find(v => v >= dim / 6) || 100, ex = b.minx - m * 0.8, ey = b.maxy + m * 0.75;
    h += '<g stroke="#000" stroke-width="' + th * 1.5 + '"><line x1="' + ex + '" y1="' + ey + '" x2="' + (ex + esc5) + '" y2="' + ey + '"/><line x1="' + ex + '" y1="' + (ey - t * 0.3) + '" x2="' + ex + '" y2="' + (ey + t * 0.3) + '"/><line x1="' + (ex + esc5) + '" y1="' + (ey - t * 0.3) + '" x2="' + (ex + esc5) + '" y2="' + (ey + t * 0.3) + '"/></g>' +
      '<text x="' + (ex + esc5 / 2) + '" y="' + (ey - t * 0.45) + '" font-size="' + t * 0.7 + '" text-anchor="middle">' + esc5 + ' m</text>';
    if (C.georef) { // norte
      const n = G.rot([0, 1], -C.ang), ang = Math.atan2(n[0], n[1]) * 180 / Math.PI, nx = b.maxx + m * 0.45, ny = b.miny - m * 0.4, s = t * 1.3;
      h += '<g transform="translate(' + nx + ' ' + ny + ') rotate(' + ang.toFixed(2) + ')"><polygon points="0,' + (-s) + ' ' + (s * 0.45) + ',' + (s * 0.7) + ' 0,' + (s * 0.35) + ' ' + (-s * 0.45) + ',' + (s * 0.7) + '" fill="#000"/><text x="0" y="' + (-s * 1.15) + '" font-size="' + t * 0.9 + '" text-anchor="middle" font-weight="bold">N</text></g>';
    }
    return h + '</svg>';
  }
  function renderPlanta() {
    const el = $('#plantabody'), C = G.compute(P), cb = P.carimbo;
    if (!C.ok) { el.innerHTML = '<h2>Planta</h2><div class="aviso">' + esc(C.motivo) + '</div><p><button class="b p" id="irCont">Ir para o Contorno</button></p>'; $('#irCont').onclick = () => go('cont'); return; }
    let h = '<h2>Planta de layout</h2><div class="plantabox">' + plantaSVG(C) + '</div>';
    for (const a of C.avisos) h += '<div class="aviso">' + esc(a) + '</div>';
    h += '<h2>Quadro de áreas</h2>' + quadroHTML(C) + '<p class="sub">Beiral adotado: ' + beiralTxt(C) + '. ' +
      (C.georef ? 'Contorno marcado sobre imagem de satélite.' : 'Sem georreferenciamento (KML indisponível; DXF em coordenadas locais).') + '</p>';
    h += '<h2>Exportar</h2><div class="row"><button class="b p" id="xPdf">PDF</button><button class="b" id="xDxf">DXF</button><button class="b" id="xKml"' + (C.georef ? '' : ' disabled') + '>KML</button><button class="b" id="xJson">Arquivo do projeto</button></div>';
    h += '<h2>Dados do carimbo</h2><div class="card">';
    const campo = (k, rot, ph) => '<label>' + rot + '</label><input type="text" data-cb="' + k + '" value="' + esc(cb[k]) + '" placeholder="' + (ph || '') + '">';
    h += campo('empreendimento', 'Empreendimento / atividade', 'Ex.: Oficina mecânica') + campo('cliente', 'Cliente / razão social') + campo('endereco', 'Endereço') + campo('municipio', 'Município/UF', 'Sinop/MT') +
      campo('empresa', 'Empresa responsável') + campo('resp', 'Responsável técnico', 'Nome e título') + campo('registro', 'Registro profissional', 'CREA-MT nº') + '</div>';
    el.innerHTML = h;
    $$('[data-cb]', el).forEach(i => i.oninput = () => { cb[i.dataset.cb] = i.value; if (['resp', 'registro', 'empresa'].includes(i.dataset.cb)) pref.set(i.dataset.cb, i.value); save(); });
    $('#xPdf').onclick = () => imprimir(C);
    $('#xDxf').onclick = () => { const d = G.dxf(C, P); baixar(slug(P.nome) + '.dxf', d.text, 'application/dxf'); toast('DXF gerado em ' + d.info + '.', 4000); };
    $('#xKml').onclick = () => baixar(slug(P.nome) + '.kml', G.kml(C, P), 'application/vnd.google-earth.kml+xml');
    $('#xJson').onclick = () => baixar(slug(P.nome) + '.prumoplanta.json', JSON.stringify(P), 'application/json');
  }
  function imprimir(C) {
    const cb = P.carimbo, linha = (a, b) => b ? '<tr><th>' + a + '</th><td>' + esc(b) + '</td></tr>' : '';
    let coord = '';
    if (C.georef) { const u = G.utm(C.georef.lat0, C.georef.lng0); coord = 'E ' + fmt(u.e, 0) + ' m · N ' + fmt(u.n, 0) + ' m — SIRGAS 2000 / UTM ' + u.zone + u.hemi; }
    $('#print').innerHTML = '<div class="ptop"><div><b>PLANTA DE LAYOUT — LEVANTAMENTO EXPEDITO</b><br>' + esc(cb.empreendimento || P.nome) + '</div><div style="text-align:right">' + esc(cb.empresa) + '<br>' + new Date().toLocaleDateString('pt-BR') + '</div></div>' +
      '<div class="pgrid"><div>' + plantaSVG(C) + '</div><div><h4 style="margin-top:0">Quadro de áreas</h4>' + quadroHTML(C) +
      '<h4>Identificação</h4><table>' + linha('Cliente', cb.cliente) + linha('Endereço', cb.endereco) + linha('Município', cb.municipio) + linha('Centro do prédio', coord) + linha('Resp. técnico', cb.resp) + linha('Registro', cb.registro) + '</table>' +
      '<div class="nota"><b>Notas:</b> 1) Beiral adotado: ' + beiralTxt(C) + '. 2) A área de projeção da cobertura corresponde à visualizada em imagem de satélite e inclui beirais; a área construída é medida pelas faces externas das paredes. ' +
      '3) Linha tracejada: projeção da cobertura. Cotas em metros. 4) Levantamento expedito para representação do layout da atividade; não substitui projeto arquitetônico.</div></div></div>';
    setTimeout(() => { try { window.print(); } catch (e) { toast('Não foi possível abrir a impressão neste navegador.'); } }, 80);
  }

  /* ---------- AR (WebXR, Chrome no Android com ARCore) ---------- */
  const AR = { sess: null, pts: [], polys: [], cur: null };
  $('#bAR').onclick = async () => {
    const no = m => sheet('<h3>AR indisponível</h3><p>' + m + '</p><p class="sub">Sem AR, use “+ Cômodo” e informe as medidas pela trena (teclado ou voz).</p><div class="row" style="margin-top:12px"><button class="b p grow" onclick="document.getElementById(\'sheetbg\').classList.remove(\'on\')">Entendi</button></div>');
    if (!window.isSecureContext) return no('O AR só funciona quando o app é aberto por um endereço https (publicado na internet), não por um arquivo solto.');
    if (!navigator.xr) return no('Este navegador não tem suporte a AR. Abra o endereço do app no Chrome, em um Android compatível com ARCore (como o Galaxy A54).');
    let ok = false; try { ok = await navigator.xr.isSessionSupported('immersive-ar'); } catch (e) { }
    if (!ok) return no('Este aparelho não é compatível com ARCore, ou o “Google Play Services para RA” não está instalado.');
    try { await arStart(); } catch (e) { no('Não foi possível iniciar o AR: ' + esc(e && e.message || e)); }
  };
  async function arStart() {
    const root = $('#ar'), cv = $('#arcv');
    const sess = await navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['hit-test', 'dom-overlay'], domOverlay: { root } });
    root.classList.add('on');
    const glc = document.createElement('canvas'), gl = glc.getContext('webgl', { xrCompatible: true });
    if (gl.makeXRCompatible) await gl.makeXRCompatible();
    sess.updateRenderState({ baseLayer: new XRWebGLLayer(sess, gl) });
    const ref = await sess.requestReferenceSpace('local'), viewer = await sess.requestReferenceSpace('viewer');
    const hts = await sess.requestHitTestSource({ space: viewer });
    AR.sess = sess; AR.pts = []; AR.polys = []; AR.cur = null;
    const ctx = cv.getContext('2d');
    sess.addEventListener('end', arFim);
    const proj = (p, view) => {
      const V = view.transform.inverse.matrix, Pm = view.projectionMatrix;
      const x = V[0] * p[0] + V[4] * p[1] + V[8] * p[2] + V[12], y = V[1] * p[0] + V[5] * p[1] + V[9] * p[2] + V[13], z = V[2] * p[0] + V[6] * p[1] + V[10] * p[2] + V[14], w = V[3] * p[0] + V[7] * p[1] + V[11] * p[2] + V[15];
      const cx = Pm[0] * x + Pm[4] * y + Pm[8] * z + Pm[12] * w, cy = Pm[1] * x + Pm[5] * y + Pm[9] * z + Pm[13] * w, cw = Pm[3] * x + Pm[7] * y + Pm[11] * z + Pm[15] * w;
      if (cw <= 0.01) return null;
      return [(cx / cw + 1) / 2 * cv.width, (1 - cy / cw) / 2 * cv.height];
    };
    const loop = (t, frame) => {
      if (!AR.sess) return;
      sess.requestAnimationFrame(loop);
      const layer = sess.renderState.baseLayer; gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
      const pose = frame.getViewerPose(ref); if (!pose) return;
      const hits = frame.getHitTestResults(hts);
      AR.cur = null;
      if (hits.length) { const hp = hits[0].getPose(ref); if (hp) { const q = hp.transform.position; AR.cur = [q.x, q.y, q.z]; } }
      const dpr = window.devicePixelRatio || 1, w = Math.round(cv.clientWidth * dpr), hh = Math.round(cv.clientHeight * dpr);
      if (cv.width !== w || cv.height !== hh) { cv.width = w; cv.height = hh; }
      ctx.clearRect(0, 0, w, hh);
      const view = pose.views[0], S = p => proj(p, view);
      ctx.lineWidth = 3 * dpr; ctx.font = 'bold ' + 14 * dpr + 'px sans-serif'; ctx.textAlign = 'center';
      const seg = (a, b, cor, rot) => {
        const A2 = S(a), B2 = S(b); if (!A2 || !B2) return;
        ctx.strokeStyle = cor; ctx.beginPath(); ctx.moveTo(A2[0], A2[1]); ctx.lineTo(B2[0], B2[1]); ctx.stroke();
        if (rot) { const mx = (A2[0] + B2[0]) / 2, my = (A2[1] + B2[1]) / 2, tx = fmt(Math.hypot(a[0] - b[0], a[2] - b[2])) + ' m', tw = ctx.measureText(tx).width + 10 * dpr; ctx.fillStyle = '#000b'; ctx.fillRect(mx - tw / 2, my - 11 * dpr, tw, 22 * dpr); ctx.fillStyle = '#fff'; ctx.fillText(tx, mx, my + 5 * dpr); }
      };
      for (const pl of AR.polys) pl.forEach((a, i) => seg(a, pl[(i + 1) % pl.length], '#35d0ff', false));
      AR.pts.forEach((a, i) => { if (i) seg(AR.pts[i - 1], a, '#ffd400', true); });
      if (AR.cur && AR.pts.length) seg(AR.pts[AR.pts.length - 1], AR.cur, '#ffffff', true);
      for (const a of AR.pts) { const q = S(a); if (q) { ctx.fillStyle = '#ffd400'; ctx.beginPath(); ctx.arc(q[0], q[1], 7 * dpr, 0, 7); ctx.fill(); } }
      const c = AR.cur && S(AR.cur);
      if (c) { ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(c[0], c[1], 14 * dpr, 0, 7); ctx.stroke(); ctx.fillStyle = '#ffd400'; ctx.beginPath(); ctx.arc(c[0], c[1], 4 * dpr, 0, 7); ctx.fill(); }
      $('#artop').textContent = !AR.cur ? 'Mova o celular devagar, apontando para o piso, até aparecer o círculo.' :
        AR.pts.length ? 'Cômodo ' + (AR.polys.length + 1) + ': ' + AR.pts.length + ' canto(s). Aponte para o próximo canto no piso.' : 'Aponte o círculo para um canto do cômodo, no piso, e toque em “Marcar canto”.';
    };
    sess.requestAnimationFrame(loop);
  }
  $('#arMark').onclick = () => { if (!AR.cur) { toast('Aponte para o piso até aparecer o círculo.'); return; } AR.pts.push(AR.cur.slice()); };
  $('#arUndo').onclick = () => { if (AR.pts.length) AR.pts.pop(); else AR.polys.pop(); };
  $('#arClose').onclick = () => { if (AR.pts.length < 3) { toast('Marque pelo menos 3 cantos antes de fechar.'); return; } AR.polys.push(AR.pts); AR.pts = []; toast('Cômodo fechado. Passe para o próximo ou conclua.'); };
  $('#arEnd').onclick = () => { if (AR.pts.length >= 3) { AR.polys.push(AR.pts); AR.pts = []; } if (AR.sess) AR.sess.end(); else arFim(); };
  function arFim() {
    $('#ar').classList.remove('on'); AR.sess = null;
    const polys = AR.polys.map(pl => pl.map(p => [p[0], -p[2]])); AR.polys = []; AR.pts = [];
    if (!polys.length) return;
    arParaCroqui(polys); toast(polys.length + ' cômodo(s) trazidos do AR. Dê os nomes e confira as medidas.', 4500);
  }
  function arParaCroqui(polys) {
    const ang = G.dominantAngle(polys);
    let ps = polys.map(pl => G.ccw(pl.map(q => G.rot(q, -ang))));
    const all = G.bbox(ps.flat()); let ox = -all.minx, oy = -all.miny;
    if (P.rooms.length) { const eb = G.bbox(P.rooms.flatMap(G.roomPts)); ox = eb.maxx + 1.5 - all.minx; oy = eb.miny - all.miny; }
    ps.forEach(pts => {
      pts = pts.map(p => [p[0] + ox, p[1] + oy]);
      const proprio = G.dominantAngle(pts), alinhado = Math.abs(proprio) < 10 * Math.PI / 180;
      const o = G.orthogonalize(pts, alinhado ? 0 : null);
      const room = { id: uid(), nome: 'Cômodo ' + (P.rooms.length + 1), fotos: [] };
      if (o && o.length === 4 && alinhado) { const b = G.bbox(o); Object.assign(room, { rect: true, x: b.minx, y: b.miny, w: b.w, h: b.h }); }
      else Object.assign(room, { rect: false, pts: o || pts });
      P.rooms.push(room);
    });
    save(); cqFit();
  }

  /* ---------- início ---------- */
  window.__pp = { get P() { return P; }, set P(v) { P = v; }, go, arParaCroqui, numsFala, plantaSVG, get lista() { return lista; } };
  (async function () {
    await DB.open(); lista = await DB.all();
    const u = pref.get('ultimo'); if (u && lista.find(x => x.id === u)) P = lista.find(x => x.id === u);
    go('proj');
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
  })();
})();
