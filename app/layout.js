// 配置計算・描画・色抽出（Premiereに依存しない部分）
var W = 1920, H = 1080;
var LABEL_FONT = '900 {px}px LabelFont, "Source Han Sans JP", "Noto Sans JP", "Yu Gothic", sans-serif';
var LABEL_FONT_DEFAULT = LABEL_FONT;
var LABEL_ITALIC = false;  // 斜体（日本語フォントには斜体がないので傾けて描く）
var ITALIC_SKEW = 0.2;     // 傾き（約11度）

// n人分の配置を計算。各要素 {x, y} はアイコン左上、size はアイコン一辺
var MAX_PER_ROW = 4;
// 人数ごとの例外の並び（上の段から）
var SPECIAL_ROWS = { 9: [4, 5], 10: [5, 5] };
function computeLayout(n) {
  // 1行は最大4人。行数は最小限にし、各行の人数を均等に（余りは上の行へ）例: 5人→3・2、7人→4・3
  var counts = SPECIAL_ROWS[n] ? SPECIAL_ROWS[n].slice() : null;
  if (!counts) {
    var rowsN = Math.max(1, Math.ceil(n / MAX_PER_ROW));
    var base = Math.floor(n / rowsN), extra = n % rowsN;
    counts = [];
    for (var k = 0; k < rowsN; k++) counts.push(base + (k < extra ? 1 : 0));
  }
  var rows = counts.length;
  var perRow = Math.max.apply(null, counts); // 一番人数の多い段で大きさを決める
  var marginX = 80, marginY = 60;
  var gapR = 0.4;            // アイコン間の隙間（アイコン幅に対する比率）
  var blockR = 1.2;          // アイコン＋はみ出したラベルの高さ比率
  var rowGapR = 0.15;
  var byW = (W - marginX * 2) / (perRow + (perRow - 1) * gapR);
  var byH = (H - marginY * 2) / (rows * blockR + (rows - 1) * rowGapR);
  var size = Math.floor(Math.min(400, byW, byH));
  var gap = size * gapR;
  var totalH = rows * size * blockR + (rows - 1) * size * rowGapR;
  var top = (H - totalH) / 2;
  var pos = [];
  for (var r = 0; r < rows; r++) {
    var count = counts[r];
    var rowW = count * size + (count - 1) * gap;
    var left = (W - rowW) / 2;
    var y = top + r * size * (blockR + rowGapR);
    for (var c = 0; c < count; c++) pos.push({ x: Math.round(left + c * (size + gap)), y: Math.round(y) });
  }
  return { size: size, pos: pos };
}

// 1人分を描画（全員分なら preview 用に呼び出し側でループ）
// scale: ラベルの文字サイズ倍率（1 = 自動調整のまま）
function drawPerson(ctx, img, name, color, p, size, scale) {
  scale = scale || 1;
  // アイコン（正方形でなければ中央を切り抜き）
  var s = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
  var sx = ((img.naturalWidth || img.width) - s) / 2, sy = ((img.naturalHeight || img.height) - s) / 2;
  ctx.drawImage(img, sx, sy, s, s, p.x, p.y, size, size);
  if (!name) return;

  // ラベル：黒帯＋色付き文字。アイコン下端に少し重ねる
  var labelH = size * 0.3 * scale;
  var fontPx = labelH * 0.82;
  var maxW = size * 1.3 * scale;   // 長い名前はこの幅に収まるよう自動で縮める
  ctx.font = LABEL_FONT.replace('{px}', fontPx);
  var tw = ctx.measureText(name).width;
  if (tw > maxW) { fontPx *= maxW / tw; ctx.font = LABEL_FONT.replace('{px}', fontPx); }
  var m = ctx.measureText(name);
  tw = m.width;
  var asc = m.actualBoundingBoxAscent || fontPx * 0.8, desc = m.actualBoundingBoxDescent || fontPx * 0.1;
  var lean = LABEL_ITALIC ? ITALIC_SKEW * (asc + desc) : 0; // 傾けた分だけ帯を広げる
  var padX = labelH * 0.1;
  var boxW = tw + lean + padX * 2;
  var boxX = p.x + size / 2 - boxW / 2;
  var boxY = p.y + size - size * 0.1;
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(boxX, boxY, boxW, labelH);
  var baseY = boxY + labelH / 2 + (asc - desc) / 2;
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  ctx.save();
  ctx.translate(boxX + padX + (LABEL_ITALIC ? ITALIC_SKEW * desc : 0), baseY);
  if (LABEL_ITALIC) ctx.transform(1, 0, -ITALIC_SKEW, 1, 0, 0);
  ctx.fillText(name, 0, 0);
  ctx.restore();
}

// アイコンの中で一番多い色の系統を、黒帯の上で読める明るさにして返す
function dominantColor(img) {
  var N = 48, c = document.createElement('canvas');
  c.width = c.height = N;
  var x = c.getContext('2d');
  x.drawImage(img, 0, 0, N, N);
  var d = x.getImageData(0, 0, N, N).data;
  var BINS = 24, hist = [], total = 0;
  for (var b = 0; b < BINS; b++) hist.push(0);
  for (var i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    var r = d[i] / 255, g = d[i + 1] / 255, bl = d[i + 2] / 255;
    var mx = Math.max(r, g, bl), mn = Math.min(r, g, bl), v = mx, s = mx ? (mx - mn) / mx : 0;
    if (s < 0.3 || v < 0.25) continue;   // 白・黒・灰色は無視
    var h;
    if (mx === r) h = ((g - bl) / (mx - mn)) % 6;
    else if (mx === g) h = (bl - r) / (mx - mn) + 2;
    else h = (r - g) / (mx - mn) + 4;
    h = (h * 60 + 360) % 360;
    var w = s * v;
    hist[Math.floor(h / 360 * BINS) % BINS] += w;
    total += w;
  }
  if (total < 5) return '#ffffff';
  var best = 0;
  for (b = 1; b < BINS; b++) if (hist[b] > hist[best]) best = b;
  var hue = (best + 0.5) * 360 / BINS;
  return hslToHex(hue, 0.95, hue > 200 && hue < 290 ? 0.65 : 0.55); // 青紫系は暗く見えるので少し明るく
}

function hslToHex(h, s, l) {
  var a = s * Math.min(l, 1 - l);
  function f(n) {
    var k = (n + h / 30) % 12;
    var c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return ('0' + Math.round(c * 255).toString(16)).slice(-2);
  }
  return '#' + f(0) + f(8) + f(4);
}
