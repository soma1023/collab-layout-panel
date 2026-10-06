// コラボ相手ライブラリ：保存・検索・並べ替え・呼び出し
// LIB_DIR は main.js で設定（config.json）から決まる
var LIB_JSON = LIB_DIR + '\\library.json';
var LIB_ICONS = LIB_DIR + '\\icons';

var lib = { version: 1, people: [] }; // people: {id, name, color, icons:[file], current, uses, lastUsed, hidden}
var thumbCache = {};

function libKey(name) { return String(name || '').normalize('NFKC').trim().toLowerCase(); }
function libGet(id) { for (var i = 0; i < lib.people.length; i++) if (lib.people[i].id === id) return lib.people[i]; return null; }
function libFindByName(name) {
  var k = libKey(name);
  for (var i = 0; i < lib.people.length; i++) if (libKey(lib.people[i].name) === k) return lib.people[i];
  return null;
}

function libLoad() {
  if (!fs) return;
  try {
    if (fs.existsSync(LIB_JSON)) lib = JSON.parse(fs.readFileSync(LIB_JSON, 'utf8'));
  } catch (e) { status('ライブラリの読み込みに失敗: ' + e.message, 'err'); }
}

function libSave() {
  if (!fs) return;
  fs.mkdirSync(LIB_ICONS, { recursive: true });
  if (fs.existsSync(LIB_JSON)) fs.copyFileSync(LIB_JSON, LIB_JSON + '.bak'); // 1つ前の状態を残す
  fs.writeFileSync(LIB_JSON + '.tmp', JSON.stringify(lib, null, 2), 'utf8');
  fs.renameSync(LIB_JSON + '.tmp', LIB_JSON);
}

// アイコン画像を data URL で取得（キャンバスで扱えるようにファイルを直接読む）
function iconSrc(file) {
  if (thumbCache[file]) return thumbCache[file];
  if (!fs) return '';
  try {
    thumbCache[file] = 'data:image/png;base64,' + fs.readFileSync(LIB_ICONS + '\\' + file).toString('base64');
  } catch (e) { thumbCache[file] = ''; }
  return thumbCache[file];
}

// 正方形に切り抜いてPNG化（最大800px）
function imgToPng(img) {
  var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, s = Math.min(w, h), out = Math.min(s, 800);
  var c = document.createElement('canvas');
  c.width = c.height = out;
  c.getContext('2d').drawImage(img, (w - s) / 2, (h - s) / 2, s, s, 0, 0, out, out);
  var url = c.toDataURL('image/png');
  return { buf: Buffer.from(url.split(',')[1], 'base64'), url: url };
}

// 「決定」時に、名前のある人をライブラリへ保存・更新。保存した人数を返す
function libRecord(list) {
  if (!fs) return 0;
  libLoad();
  fs.mkdirSync(LIB_ICONS, { recursive: true });
  var crypto = nodeReq('crypto'), now = new Date().toISOString(), n = 0;
  list.forEach(function (p) {
    var name = p.name.trim();
    if (!name) return;
    var e = p.libId ? libGet(p.libId) : null;
    var same = libFindByName(name);
    if (!e || (same && same !== e)) e = same; // 名前が一致する人がいればその人として扱う
    if (!e) {
      e = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name, color: p.color,
            icons: [], current: null, uses: 0, lastUsed: null, hidden: false };
      lib.people.push(e);
    }
    var file = p.iconFile;
    if (!file || !fs.existsSync(LIB_ICONS + '\\' + file)) {
      var png = imgToPng(p.img);
      file = crypto.createHash('sha1').update(png.buf).digest('hex').slice(0, 12) + '.png';
      if (!fs.existsSync(LIB_ICONS + '\\' + file)) fs.writeFileSync(LIB_ICONS + '\\' + file, png.buf);
      thumbCache[file] = png.url;
    }
    if (e.icons.indexOf(file) < 0) e.icons.push(file);
    e.current = file;
    e.name = name;
    e.color = p.color;
    e.scale = p.scale || 1;
    e.hidden = false;
    e.uses = (e.uses || 0) + 1;
    e.lastUsed = now;
    p.libId = e.id;
    p.iconFile = file;
    n++;
  });
  libSave();
  if ($('pane-library').classList.contains('on')) renderLibrary();
  return n;
}

// ---------- 一覧表示 ----------
var sortSel = $('sort');
try { sortSel.value = localStorage.getItem('collab_sort') || 'recent'; } catch (e) {}
sortSel.addEventListener('change', function () {
  try { localStorage.setItem('collab_sort', sortSel.value); } catch (e) {}
  renderLibrary();
});
$('q').addEventListener('input', function () { renderLibrary(); });

function sortedPeople() {
  var q = libKey($('q').value);
  var arr = lib.people.filter(function (e) { return !e.hidden && (!q || libKey(e.name).indexOf(q) >= 0); });
  var mode = sortSel.value;
  arr.sort(function (a, b) {
    if (mode === 'kana') return a.name.localeCompare(b.name, 'ja');
    if (mode === 'freq' && (b.uses || 0) !== (a.uses || 0)) return (b.uses || 0) - (a.uses || 0);
    return String(b.lastUsed || '').localeCompare(String(a.lastUsed || ''));
  });
  return arr;
}

function renderLibrary() {
  var grid = $('grid');
  grid.innerHTML = '';
  var arr = sortedPeople();
  if (!arr.length) {
    grid.innerHTML = '<div class="empty">' + (lib.people.some(function (e) { return !e.hidden; })
      ? '見つかりませんでした'
      : 'まだ誰も保存されていません。<br>名前を入れて「決定」を押すと自動で保存されます') + '</div>';
    return;
  }
  arr.forEach(function (e) {
    var t = document.createElement('div');
    t.className = 'tile';
    t.setAttribute('data-id', e.id);
    t.title = e.name + '\n使用 ' + (e.uses || 0) + '回' + (e.lastUsed ? ' / 最終 ' + e.lastUsed.slice(0, 10) : '');
    t.innerHTML = '<span class="chk">✓</span><img><div class="nm"></div>';
    t.querySelector('img').src = iconSrc(e.current);
    var nm = t.querySelector('.nm');
    nm.textContent = e.name;
    nm.style.color = e.color;
    t.addEventListener('click', function () { toggleMember(e); });
    t.addEventListener('contextmenu', function (ev) { ev.preventDefault(); openMenu(e, ev.clientX, ev.clientY); });
    grid.appendChild(t);
  });
  markLibrarySelection();
}

function markLibrarySelection() {
  var ids = {};
  people.forEach(function (p) { if (p.libId) ids[p.libId] = 1; });
  Array.prototype.forEach.call(document.querySelectorAll('.tile'), function (t) {
    t.classList.toggle('sel', !!ids[t.getAttribute('data-id')]);
  });
}

function toggleMember(e) {
  var had = people.some(function (p) { return p.libId === e.id; });
  if (had) { people = people.filter(function (p) { return p.libId !== e.id; }); render(); return; }
  addFromSrc(iconSrc(e.current), { name: e.name, color: e.color, scale: e.scale || 1, libId: e.id, iconFile: e.current });
}

// 今回のメンバーに入っている同じ人にも変更を反映
function syncMembers(e) {
  var src = iconSrc(e.current), pending = 0;
  people.forEach(function (p) {
    if (p.libId !== e.id) return;
    p.name = e.name; p.color = e.color;
    if (p.iconFile !== e.current) {
      p.iconFile = e.current;
      var img = new Image();
      pending++;
      img.onload = function () { p.img = img; if (--pending === 0) render(); };
      img.src = src;
    }
  });
  render();
}

// ---------- 右クリックメニュー ----------
var menu = $('menu');
function closeMenu() { menu.style.display = 'none'; }
document.addEventListener('click', function (ev) { if (!menu.contains(ev.target)) closeMenu(); });
document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { closeMenu(); closeModal(); } });

function openMenu(e, x, y) {
  menu.innerHTML = '';
  if (e.icons.length > 1) {
    var cap = document.createElement('div');
    cap.className = 'cap';
    cap.textContent = 'アイコンを選び直す';
    menu.appendChild(cap);
    var hist = document.createElement('div');
    hist.className = 'hist';
    e.icons.slice().reverse().forEach(function (f) {
      var im = document.createElement('img');
      im.src = iconSrc(f);
      if (f === e.current) im.className = 'cur';
      im.addEventListener('click', function () {
        e.current = f;
        libSave(); closeMenu(); renderLibrary(); syncMembers(e);
      });
      hist.appendChild(im);
    });
    menu.appendChild(hist);
  }
  addItem('名前・色を編集', function () { editPerson(e); });
  addItem('ライブラリから外す', function () { hidePerson(e); });
  menu.style.display = 'block';
  var r = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, innerWidth - r.width - 4) + 'px';
  menu.style.top = Math.min(y, innerHeight - r.height - 4) + 'px';

  function addItem(label, fn) {
    var d = document.createElement('div');
    d.className = 'mi';
    d.textContent = label;
    d.addEventListener('click', function () { closeMenu(); fn(); });
    menu.appendChild(d);
  }
}

// ---------- ダイアログ ----------
var modal = $('modal'), box = modal.querySelector('.box');
function closeModal() { modal.style.display = 'none'; }
modal.addEventListener('click', function (ev) { if (ev.target === modal) closeModal(); });

function editPerson(e) {
  box.innerHTML =
    '<b>名前・色を編集</b>' +
    '<label style="display:flex;gap:6px;align-items:center">名前 <input type="text" id="ed-name" style="flex:1"></label>' +
    '<label style="display:flex;gap:6px;align-items:center">ラベル色 <input type="color" id="ed-color">' +
    '<button id="ed-auto">アイコンから自動</button></label>' +
    '<div id="ed-msg" style="color:#ff6b6b;min-height:14px"></div>' +
    '<div class="act"><button id="ed-cancel">キャンセル</button><button id="ed-ok">保存</button></div>';
  var nameIn = $('ed-name'), colIn = $('ed-color');
  nameIn.value = e.name;
  colIn.value = e.color;
  $('ed-auto').addEventListener('click', function () {
    var img = new Image();
    img.onload = function () { colIn.value = dominantColor(img); };
    img.src = iconSrc(e.current);
  });
  $('ed-cancel').addEventListener('click', closeModal);
  $('ed-ok').addEventListener('click', function () {
    var name = nameIn.value.trim();
    if (!name) { $('ed-msg').textContent = '名前を入力してください'; return; }
    var same = libFindByName(name);
    if (same && same !== e && !same.hidden) { $('ed-msg').textContent = '同じ名前の人がすでにいます'; return; }
    if (same && same !== e) lib.people.splice(lib.people.indexOf(same), 1); // 非表示の同名データは統合
    e.name = name;
    e.color = colIn.value;
    libSave(); closeModal(); renderLibrary(); syncMembers(e);
  });
  modal.style.display = 'flex';
  nameIn.focus();
}

function hidePerson(e) {
  box.innerHTML =
    '<b>ライブラリから外しますか？</b>' +
    '<div style="color:var(--dim)">「' + e.name.replace(/[<>&]/g, '') + '」を一覧から外します。画像ファイルは消えません。' +
    '同じ名前で「決定」すると、また一覧に戻ります。</div>' +
    '<div class="act"><button id="hd-cancel">キャンセル</button><button id="hd-ok">外す</button></div>';
  $('hd-cancel').addEventListener('click', closeModal);
  $('hd-ok').addEventListener('click', function () {
    e.hidden = true;
    libSave(); closeModal(); renderLibrary();
  });
  modal.style.display = 'flex';
}

// ---------- 設定画面（⚙） ----------
$('settings').addEventListener('click', function () {
  box.innerHTML =
    '<b>設定</b>' +
    '<div>ライブラリの保存場所<br><span style="color:var(--dim);font-size:11px">コラボ相手のアイコン・名前・お気に入りフォントを保存します</span></div>' +
    '<div style="display:flex;gap:4px"><input type="text" id="st-dir" style="flex:1;min-width:0"><button id="st-browse">参照</button></div>' +
    '<label style="display:flex;gap:6px;align-items:flex-start;cursor:pointer"><input type="checkbox" id="st-bake">' +
    '<span>ラベルを画像で焼き込む<br><span style="color:var(--dim);font-size:11px">オフ：Premiereで文字を直接編集できる（おすすめ）<br>オン：以前の方式（文字は編集できない）</span></span></label>' +
    '<div style="display:flex;align-items:center;gap:6px;border-top:1px solid #3a3a3a;padding-top:8px">' +
    '<span style="flex:1;color:var(--dim)">バージョン <span id="st-ver"></span></span><button id="st-check">更新を確認</button></div>' +
    '<div id="st-msg" style="color:#ff6b6b;min-height:14px"></div>' +
    '<div class="act"><button id="st-cancel">キャンセル</button><button id="st-ok">保存</button></div>';
  $('st-ver').textContent = window.Updater ? 'v' + Updater.version + (Updater.dev ? '（開発モード）' : '') : '';
  $('st-check').addEventListener('click', function () { closeModal(); if (window.Updater) Updater.check(true); });
  $('st-dir').value = config.libDir;
  $('st-bake').checked = !!config.bake;
  $('st-browse').addEventListener('click', function () {
    try {
      var r = window.cep.fs.showOpenDialogEx(false, true, 'ライブラリの保存場所を選択', $('st-dir').value);
      if (r && r.data && r.data.length) $('st-dir').value = r.data[0];
    } catch (e) { $('st-msg').textContent = 'フォルダ選択を開けませんでした。パスを直接入力してください'; }
  });
  $('st-cancel').addEventListener('click', closeModal);
  $('st-ok').addEventListener('click', function () {
    var dir = $('st-dir').value.trim();
    if (!dir) { $('st-msg').textContent = '保存場所を入力してください'; return; }
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { $('st-msg').textContent = 'このフォルダは使えません: ' + e.message; return; }
    var moved = dir !== config.libDir;
    config.libDir = dir;
    config.bake = $('st-bake').checked;
    saveConfig();
    closeModal();
    if (moved) location.reload(); // 保存場所を変えたら読み込み直す
    else status('設定を保存しました', 'ok');
  });
  modal.style.display = 'flex';
});

libLoad();
