// パネルの操作とPremiereへの受け渡し
var inCEP = !!(window.__adobe_cep__);
var nodeReq = window.cep_node ? window.cep_node.require : (typeof require === 'function' ? require : null);
var fs = nodeReq && nodeReq('fs'), pathMod = nodeReq && nodeReq('path');

// ---------- 設定（PCごと：%APPDATA%\collab-layout\config.json） ----------
// 起動役 loader.js から URL の # で渡される情報（本体の場所・開発モードなど）
try { window.COLLAB = JSON.parse(decodeURIComponent(location.hash.slice(1))); } catch (e) { window.COLLAB = null; }
// 本体の場所（直接開いたときは自分の場所）
var APP_DIR = (window.COLLAB && window.COLLAB.appDir) ||
  decodeURIComponent(location.pathname).replace(/^\/(?=[a-zA-Z]:)/, '').replace(/\/[^\/]*$/, '').replace(/\//g, '\\');
var MOGRT_PATH = APP_DIR + '\\mogrt\\CollabLabel.mogrt';
// Premiere 側の処理（host.jsx）も本体から読み込む（更新されたものが毎回反映される）
if (window.__adobe_cep__) {
  window.__adobe_cep__.evalScript('$.evalFile("' + (APP_DIR + '\\host\\host.jsx').replace(/\\/g, '/') + '")', function () {});
}
var CONFIG_FILE = nodeReq ? pathMod.join(process.env.APPDATA || '', 'collab-layout', 'config.json') : '';
var config = { libDir: '', bake: false };
(function loadConfig() {
  try { if (fs && fs.existsSync(CONFIG_FILE)) config = Object.assign(config, JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))); } catch (e) {}
  if (!config.libDir && nodeReq) {
    // 初期値：以前の保存場所があればそれ、なければ「ドキュメント\コラボ紹介ライブラリ」
    var old = 'D:\\素材ライブラリ\\ICON\\コラボ相手';
    config.libDir = fs.existsSync(old) ? old : pathMod.join(process.env.USERPROFILE || '', 'Documents', 'コラボ紹介ライブラリ');
  }
})();
function saveConfig() {
  if (!fs) return;
  fs.mkdirSync(pathMod.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}
var LIB_DIR = config.libDir;

var people = []; // {img, name, color, scale, libId?, iconFile?}  libId/iconFile はライブラリから追加した人
var $ = function (id) { return document.getElementById(id); };

function status(msg, cls) { var s = $('status'); s.textContent = msg || ''; s.className = cls || ''; }

// ---------- タブ ----------
function showTab(name) {
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
    t.classList.toggle('on', t.getAttribute('data-tab') === name);
  });
  $('pane-members').classList.toggle('on', name === 'members');
  $('pane-library').classList.toggle('on', name === 'library');
  if (name === 'library' && window.renderLibrary) renderLibrary();
}
Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
  t.addEventListener('click', function () { showTab(t.getAttribute('data-tab')); });
});

// ---------- 画像の追加 ----------
// extra: ライブラリから追加するときの {name, color, libId, iconFile}
function addFromSrc(src, extra) {
  var img = new Image();
  img.onload = function () {
    var p = { img: img, name: '', color: dominantColor(img) };
    if (extra) for (var k in extra) p[k] = extra[k];
    people.push(p);
    render();
  };
  img.onerror = function () { status('画像を読み込めませんでした', 'err'); };
  img.src = src;
}

function addFile(file) {
  if (!/^image\//.test(file.type)) return;
  var r = new FileReader();
  r.onload = function () { addFromSrc(r.result); };
  r.readAsDataURL(file);
}

// ブラウザからドラッグしたURL（Xのアイコンは高画質版に置き換える）
function addFromUrl(url) {
  url = url.replace(/_(normal|bigger|mini|reasonably_small|x96|200x200)\.(jpe?g|png|webp)/i, '_400x400.$2');
  if (!nodeReq) { addFromSrc(url); return; }
  var mod = nodeReq(/^https:/.test(url) ? 'https' : 'http');
  status('ダウンロード中…');
  mod.get(url, function (res) {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { addFromUrl(res.headers.location); return; }
    var chunks = [];
    res.on('data', function (c) { chunks.push(c); });
    res.on('end', function () {
      var type = res.headers['content-type'] || 'image/jpeg';
      addFromSrc('data:' + type + ';base64,' + Buffer.concat(chunks).toString('base64'));
      status('');
    });
  }).on('error', function (e) { status('ダウンロード失敗: ' + e.message, 'err'); });
}

var drop = $('drop');
['dragenter', 'dragover'].forEach(function (ev) {
  document.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
});
document.addEventListener('dragleave', function (e) { if (!e.relatedTarget) drop.classList.remove('over'); });
document.addEventListener('drop', function (e) {
  e.preventDefault();
  drop.classList.remove('over');
  showTab('members');
  var files = e.dataTransfer.files;
  if (files && files.length) {
    // ファイル名順に並べて追加
    var arr = Array.prototype.slice.call(files).sort(function (a, b) { return a.name.localeCompare(b.name, 'ja'); });
    arr.forEach(addFile);
    return;
  }
  var url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
  if (url && /^https?:\/\//.test(url.trim())) addFromUrl(url.trim().split('\n')[0]);
});
drop.addEventListener('click', function () { $('file').click(); });
$('file').addEventListener('change', function () {
  Array.prototype.slice.call(this.files).forEach(addFile);
  this.value = '';
});
document.addEventListener('paste', function (e) {
  if (e.target.tagName === 'INPUT') return;
  var items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (var i = 0; i < items.length; i++) if (/^image\//.test(items[i].type)) addFile(items[i].getAsFile());
});

// ---------- リスト表示とプレビュー ----------
function render() {
  var list = $('list');
  list.innerHTML = '';
  people.forEach(function (p, i) {
    var row = document.createElement('div');
    row.className = 'row';
    row.innerHTML =
      '<span class="num">' + (i + 1) + '</span>' +
      '<div class="btns"><button data-a="up">▲</button><button data-a="down">▼</button></div>' +
      '<img><input type="text" placeholder="名前（空欄ならラベルなし）">' +
      '<input type="color" title="ラベルの色">' +
      '<div class="sz"><button data-a="sm" title="文字を小さく">A−</button><span class="pct"></span>' +
      '<button data-a="lg" title="文字を大きく">A+</button></div>' +
      '<button data-a="del" title="削除">✕</button>';
    row.querySelector('.pct').textContent = Math.round((p.scale || 1) * 100) + '%';
    row.querySelector('img').src = p.img.src;
    var name = row.querySelector('input[type=text]');
    name.value = p.name;
    name.addEventListener('input', function () { p.name = name.value; drawPreview(); });
    name.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { var all = list.querySelectorAll('input[type=text]'); if (all[i + 1]) all[i + 1].focus(); }
    });
    var col = row.querySelector('input[type=color]');
    col.value = p.color;
    col.addEventListener('input', function () { p.color = col.value; drawPreview(); });
    row.querySelector('[data-a=up]').disabled = i === 0;
    row.querySelector('[data-a=down]').disabled = i === people.length - 1;
    row.addEventListener('click', function (e) {
      var a = e.target.getAttribute('data-a');
      if (a === 'up') swap(i, i - 1);
      else if (a === 'down') swap(i, i + 1);
      else if (a === 'del') { people.splice(i, 1); render(); }
      else if (a === 'sm' || a === 'lg') {
        p.scale = Math.max(0.5, Math.min(2, Math.round(((p.scale || 1) + (a === 'lg' ? 0.1 : -0.1)) * 10) / 10));
        row.querySelector('.pct').textContent = Math.round(p.scale * 100) + '%';
        drawPreview();
      }
    });
    list.appendChild(row);
  });
  $('cnt').textContent = people.length ? '(' + people.length + ')' : '';
  if (window.markLibrarySelection) markLibrarySelection();
  drawPreview();
}

function swap(a, b) { var t = people[a]; people[a] = people[b]; people[b] = t; render(); }

function drawPreview() {
  var c = $('preview'), ctx = c.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.scale(c.width / W, c.height / H);
  if (!people.length) return;
  var L = computeLayout(people.length);
  people.forEach(function (p, i) { drawPerson(ctx, p.img, p.name.trim(), p.color, L.pos[i], L.size, p.scale); });
}

$('clear').addEventListener('click', function () { people = []; render(); status(''); });

// ---------- ラベル（MOGRT）に渡す値：プレビューの描画（layout.js drawPerson）と同じ寸法 ----------
function labelParams(p, pos, size) {
  var name = p.name.trim();
  if (!name) return null;
  var scale = p.scale || 1;
  var labelH = size * 0.3 * scale;
  var hex = p.color.replace('#', '');
  var fontName = ($('font').value || '').trim();
  var font = fontName ? psNameFor(fontName, fontFiles[fontName]) : '';
  return {
    text: name,
    color: [parseInt(hex.substr(0, 2), 16), parseInt(hex.substr(2, 2), 16), parseInt(hex.substr(4, 2), 16)],
    size: labelH * 0.82,
    maxW: size * 1.3 * scale,
    x: pos.x + size / 2,
    y: pos.y + size - size * 0.1 + labelH / 2,
    w: W, h: H,
    font: font,
    italic: LABEL_ITALIC
  };
}

// ---------- 決定：画像を書き出してPremiereに配置 ----------
function evalHost(script) {
  return new Promise(function (resolve) { window.__adobe_cep__.evalScript(script, resolve); });
}
function pad(n) { return ('0' + n).slice(-2); }

$('go').addEventListener('click', function () {
  if (!people.length) { status('アイコンを追加してください', 'err'); return; }
  var seconds = parseFloat($('sec').value);
  if (!(seconds > 0)) { status('表示秒数を入力してください', 'err'); return; }
  if (!inCEP) { status('Premiere上でのみ実行できます（今はプレビューのみ）', 'err'); return; }
  $('go').disabled = true;
  status('作成中…');

  evalHost('collab_info()').then(function (res) {
    var info = JSON.parse(res);
    if (!info.ok) throw new Error(info.msg);
    if (!info.seq) throw new Error('シーケンスを開いてから実行してください');
    if (!/\.prproj$/i.test(info.path) || !fs.existsSync(info.path)) throw new Error('先にプロジェクトを保存してください');

    var now = new Date();
    var date = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
    var time = pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
    var dir = pathMod.join(pathMod.dirname(info.path), 'コラボ紹介', date);
    fs.mkdirSync(dir, { recursive: true });

    var L = computeLayout(people.length);
    var useMogrt = !config.bake && fs.existsSync(MOGRT_PATH);
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    var files = people.map(function (p, i) {
      ctx.clearRect(0, 0, W, H);
      // 文字（MOGRT）で置くときはアイコンだけを画像にする
      drawPerson(ctx, p.img, useMogrt ? '' : p.name.trim(), p.color, L.pos[i], L.size, p.scale);
      var safe = (p.name.trim() || 'icon').replace(/[\\\/:*?"<>|]/g, '_');
      var file = pathMod.join(dir, time + '_' + pad(i + 1) + '_' + safe + '.png');
      fs.writeFileSync(file, Buffer.from(canvas.toDataURL('image/png').split(',')[1], 'base64'));
      return file;
    });

    var labels = useMogrt ? people.map(function (p, i) { return labelParams(p, L.pos[i], L.size); }) : [];
    var payload = JSON.stringify({ files: files, seconds: seconds, nestName: 'コラボ紹介_' + date + '_' + time,
      labels: labels, mogrt: MOGRT_PATH });
    return evalHost('collab_place(' + JSON.stringify(payload) + ')');
  }).then(function (res) {
    var r = JSON.parse(res);
    if (!r.ok) throw new Error(r.msg);
    var msg = '配置しました（V' + r.track + '）' + (r.warn ? '\n' + r.warn : '');
    try { var n = libRecord(people); if (n) msg += ' / ライブラリに' + n + '人保存'; }
    catch (e) { msg += '\nライブラリ保存に失敗: ' + e.message; }
    status(msg, 'ok');
  }).catch(function (e) {
    status(e.message || String(e), 'err');
  }).then(function () { $('go').disabled = false; });
});

// ---------- フォント選択 ----------
// インストール済みフォントの名前をレジストリから取得して候補に出す
function loadFontList() {
  if (!nodeReq) return;
  var names = {};
  ['HKLM', 'HKCU'].forEach(function (root) {
    try {
      var buf = nodeReq('child_process').execFileSync('reg',
        ['query', root + '\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'], { windowsHide: true });
      var out;
      try { out = new TextDecoder('shift_jis').decode(buf); } catch (e) { out = buf.toString('utf8'); }
      out.split(/\r?\n/).forEach(function (line) {
        var m = line.match(/^\s{4}(.+?)\s{4}REG_SZ\s{4}(.+)$/);
        if (!m) return;
        var file = m[2].trim();
        if (!/^[a-z]:\\/i.test(file)) file = 'C:\\Windows\\Fonts\\' + file;
        m[1].replace(/\s*\((TrueType|OpenType)\)\s*$/i, '').split(' & ').forEach(function (n) { names[n.trim()] = file; });
      });
    } catch (e) {}
  });
  fontFiles = names;
  fontNames = Object.keys(names).sort(function (a, b) { return a.localeCompare(b, 'ja'); });
  // 検索用キー：表示名＋ファイル名（英語名 NewRodin などでも引けるように）
  fontKeys = {};
  fontNames.forEach(function (n) { fontKeys[n] = searchKey(n + ' ' + pathMod.basename(names[n])); });
}

// ひらがな→カタカナ・全角半角・大小文字をそろえて比較する
function searchKey(s) {
  return String(s).normalize('NFKC').toLowerCase()
    .replace(/[ぁ-ゖ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) + 0x60); });
}
var fontKeys = {};

// お気に入りフォント：ライブラリと同じ場所の settings.json に保存（読めなければこのPC内に保存）
var FAV_FILE = LIB_DIR + '\\settings.json';
var favFonts = [];
function loadFavFonts() {
  try {
    if (fs && fs.existsSync(FAV_FILE)) { favFonts = JSON.parse(fs.readFileSync(FAV_FILE, 'utf8')).favFonts || []; return; }
  } catch (e) {}
  try { favFonts = JSON.parse(localStorage.getItem('collab_favfonts') || '[]'); } catch (e) { favFonts = []; }
}
function saveFavFonts() {
  try { localStorage.setItem('collab_favfonts', JSON.stringify(favFonts)); } catch (e) {}
  if (!fs) return;
  try {
    var s = {};
    if (fs.existsSync(FAV_FILE)) s = JSON.parse(fs.readFileSync(FAV_FILE, 'utf8'));
    s.favFonts = favFonts;
    fs.mkdirSync(pathMod.dirname(FAV_FILE), { recursive: true });
    fs.writeFileSync(FAV_FILE, JSON.stringify(s, null, 2), 'utf8');
  } catch (e) { status('お気に入りの保存に失敗: ' + e.message, 'err'); }
}
loadFavFonts();

// フォント候補の一覧（Premiereのパネルでは datalist が出ないので自前で表示）
var fontNames = [], fontHl = -1;
var fontIn = $('font'), fontPop = $('fontpop');
function showFontPop() {
  var q = searchKey(fontIn.value).trim();
  // 今選ばれている名前そのままなら全件表示
  if (q && fontNames.some(function (n) { return searchKey(n) === q; }) && !fontIn.dataset.typed) q = '';
  var words = q.split(/\s+/).filter(Boolean); // スペース区切りは AND 検索（例: 「ろだん ub」）
  function match(n) {
    var k = fontKeys[n] || searchKey(n);
    return words.every(function (w) { return k.indexOf(w) >= 0; });
  }
  function item(n) {
    var fav = favFonts.indexOf(n) >= 0;
    return '<div class="fi" data-name="' + n.replace(/"/g, '&quot;') + '"><span class="star' + (fav ? ' on' : '') +
      '" title="お気に入り">' + (fav ? '★' : '☆') + '</span>' + n.replace(/</g, '&lt;') + '</div>';
  }
  var favHits = favFonts.filter(function (n) { return fontFiles[n] && match(n); });
  var hits = fontNames.filter(function (n) { return favFonts.indexOf(n) < 0 && match(n); });
  fontPop.innerHTML = '<div class="fi def" data-name="">（初期設定に戻す：' +
    (fontFiles[DEFAULT_FONT] ? DEFAULT_FONT : '源ノ角ゴシック Heavy') + '）</div>' +
    (favHits.length ? '<div class="fh">★ お気に入り</div>' + favHits.map(item).join('') + '<div class="fh">すべて</div>' : '') +
    hits.map(item).join('') + (hits.length || favHits.length ? '' : '<div class="fi def">見つかりません</div>');
  fontHl = -1;
  fontPop.style.display = 'block';
}
function hideFontPop() { fontPop.style.display = 'none'; delete fontIn.dataset.typed; }
function pickFont(name) { fontIn.value = name; hideFontPop(); fontIn.blur(); setFont(name); }
fontIn.addEventListener('focus', showFontPop);
fontIn.addEventListener('click', showFontPop);
fontIn.addEventListener('input', function () { fontIn.dataset.typed = '1'; showFontPop(); });
fontIn.addEventListener('blur', function () { setTimeout(hideFontPop, 150); });
fontIn.addEventListener('keydown', function (e) {
  var items = fontPop.querySelectorAll('.fi[data-name]');
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (fontPop.style.display !== 'block') showFontPop();
    fontHl = Math.max(0, Math.min(items.length - 1, fontHl + (e.key === 'ArrowDown' ? 1 : -1)));
    Array.prototype.forEach.call(items, function (it, i) { it.classList.toggle('hl', i === fontHl); });
    if (items[fontHl]) items[fontHl].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    pickFont(fontHl >= 0 && items[fontHl] ? items[fontHl].getAttribute('data-name') : fontIn.value.trim());
  } else if (e.key === 'Escape') {
    hideFontPop();
  }
});
fontPop.addEventListener('mousedown', function (e) {
  var star = e.target.closest('.star');
  if (star) {
    e.preventDefault();
    var n = star.parentNode.getAttribute('data-name'), i = favFonts.indexOf(n);
    if (i >= 0) favFonts.splice(i, 1); else favFonts.push(n);
    saveFavFonts();
    var top = fontPop.scrollTop;
    showFontPop();
    fontPop.scrollTop = top;
    return;
  }
  var it = e.target.closest('.fi[data-name]');
  if (it) { e.preventDefault(); pickFont(it.getAttribute('data-name')); }
});

var fontSeq = 0, fontFiles = {};
// 初期フォント（入っていないPCでは源ノ角ゴシック Heavy にフォールバック）
var DEFAULT_FONT = 'FOT-ニューロダン Pro EB';
var DEFAULT_ITALIC = true;
function setFont(name) {
  name = (name || '').trim();
  if (!name && fontFiles[DEFAULT_FONT]) name = DEFAULT_FONT; // 空＝初期設定
  fontIn.value = name;
  try { localStorage.setItem('collab_font', name); } catch (e) {}
  if (!name) { LABEL_FONT = LABEL_FONT_DEFAULT; drawPreview(); return; }
  // フォントファイルを直接読み込む（.ttc や一覧にない名前は local() で名前から探す）
  var fam = 'PickedFont' + (++fontSeq);
  var esc = name.replace(/"/g, '');
  var fallback = '900 {px}px "' + esc + '", ' + LABEL_FONT_DEFAULT.replace('900 {px}px ', '');
  var file = fontFiles[name];
  var src = file && !/\.ttc$/i.test(file)
    ? 'url("file:///' + file.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace('%3A', ':') + '")'
    : 'local("' + esc + '")';
  var face = new FontFace(fam, src);
  face.load().then(function () {
    document.fonts.add(face);
    LABEL_FONT = '{px}px ' + fam + ', ' + fallback.replace('900 {px}px ', '');
    drawPreview();
  }).catch(function () {
    LABEL_FONT = fallback;
    if (document.fonts) document.fonts.load(LABEL_FONT.replace('{px}', 100), 'あ').then(drawPreview); else drawPreview();
  });
}

var savedFont = '';
try { savedFont = localStorage.getItem('collab_font') || ''; } catch (e) {}
$('font').value = savedFont;
loadFontList();

// 斜体のオン/オフ（次回も引き継ぐ）
LABEL_ITALIC = DEFAULT_ITALIC;
try { var savedItalic = localStorage.getItem('collab_italic'); if (savedItalic !== null) LABEL_ITALIC = savedItalic === '1'; } catch (e) {}
$('italic').checked = LABEL_ITALIC;
$('italic').addEventListener('change', function () {
  LABEL_ITALIC = this.checked;
  try { localStorage.setItem('collab_italic', LABEL_ITALIC ? '1' : '0'); } catch (e) {}
  drawPreview();
});

// フォントの読み込みを待ってからプレビューを更新
if (document.fonts) document.fonts.load(LABEL_FONT.replace('{px}', 100), 'あ').then(drawPreview);
setFont(savedFont); // 未設定なら初期フォント
render();
