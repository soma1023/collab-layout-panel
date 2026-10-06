// フォントファイル（.otf/.ttf/.ttc）から PostScript 名を読み取る
// MOGRT のフォント指定は PostScript 名（例: SourceHanSansJP-Heavy）で行うため
var psNameCache = {};

function readFontNames(buf, offset) {
  // テーブルディレクトリから 'name' テーブルを探す
  var numTables = buf.readUInt16BE(offset + 4);
  for (var i = 0; i < numTables; i++) {
    var rec = offset + 12 + i * 16;
    if (buf.toString('latin1', rec, rec + 4) !== 'name') continue;
    var tbl = buf.readUInt32BE(rec + 8);
    var count = buf.readUInt16BE(tbl + 2), strOff = tbl + buf.readUInt16BE(tbl + 4);
    var out = {};
    for (var j = 0; j < count; j++) {
      var r = tbl + 6 + j * 12;
      var platform = buf.readUInt16BE(r), nameId = buf.readUInt16BE(r + 6);
      var len = buf.readUInt16BE(r + 8), off = strOff + buf.readUInt16BE(r + 10);
      if (nameId !== 4 && nameId !== 6) continue;
      var s;
      if (platform === 3 || platform === 0) { // UTF-16BE
        var b = Buffer.alloc(len);
        for (var k = 0; k + 1 < len; k += 2) { b[k] = buf[off + k + 1]; b[k + 1] = buf[off + k]; }
        s = b.toString('utf16le');
      } else {
        s = buf.toString('latin1', off, off + len);
      }
      var key = nameId === 6 ? 'ps' : 'full';
      if (!out[key]) out[key] = [];
      if (out[key].indexOf(s) < 0) out[key].push(s);
    }
    return out;
  }
  return {};
}

// 表示名（レジストリ名）とファイルから PostScript 名を返す。見つからなければ ''
function psNameFor(name, file) {
  if (!name) return '';
  if (psNameCache[name] !== undefined) return psNameCache[name];
  var result = '';
  try {
    var buf = fs.readFileSync(file);
    var faces = [];
    if (buf.toString('latin1', 0, 4) === 'ttcf') {
      var n = buf.readUInt32BE(8);
      for (var i = 0; i < n; i++) faces.push(readFontNames(buf, buf.readUInt32BE(12 + i * 4)));
    } else {
      faces.push(readFontNames(buf, 0));
    }
    // .ttc は表示名と一致するフルネームを持つフェイスを選ぶ
    var pick = faces[0];
    faces.forEach(function (f) { if ((f.full || []).indexOf(name) >= 0) pick = f; });
    result = (pick && pick.ps && pick.ps[0]) || '';
  } catch (e) {}
  psNameCache[name] = result;
  return result;
}
