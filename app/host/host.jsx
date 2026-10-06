// コラボ紹介パネル: Premiere側の処理（ExtendScript）

function cl_q(s) {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ') + '"';
}
function cl_err(msg) { return '{"ok":false,"msg":' + cl_q(msg) + '}'; }

// ExtendScript には JSON がないので最小限の変換を用意
function cl_toJSON(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  var out = [], k;
  if (v instanceof Array) { for (k = 0; k < v.length; k++) out.push(cl_toJSON(v[k])); return '[' + out.join(',') + ']'; }
  for (k in v) if (v.hasOwnProperty(k)) out.push(cl_toJSON(k) + ':' + cl_toJSON(v[k]));
  return '{' + out.join(',') + '}';
}

// ラベル用 MOGRT の値を設定
function cl_setLabel(clip, L) {
  var props = clip.getMGTComponent().properties;
  var t = props.getParamForDisplayName('Name');
  var v = eval('(' + t.getValue() + ')');
  v.textEditValue = L.text;
  v.fontTextRunLength = [L.text.length];
  if (L.font) v.fontEditValue = [L.font];
  v.fontFSItalicValue = [!!L.italic];
  t.setValue(cl_toJSON(v), true);

  var c = props.getParamForDisplayName('TextColor');
  c.setColorValue(255, L.color[0], L.color[1], L.color[2], true);
  props.getParamForDisplayName('Size').setValue(L.size, true);
  props.getParamForDisplayName('MaxWidth').setValue(L.maxW, true);
  var pos = props.getParamForDisplayName('Pos');
  var cur = pos.getValue();
  // 位置は 0〜1 の比率で扱われる場合とピクセルの場合がある
  if (cur && cur[0] <= 1.5 && cur[1] <= 1.5) pos.setValue([L.x / L.w, L.y / L.h], true);
  else pos.setValue([L.x, L.y], true);
}
function cl_sec(s) { var t = new Time(); t.seconds = s; return t; }
function cl_norm(p) { return String(p).replace(/\//g, '\\').toLowerCase(); }

function collab_info() {
  if (!app.project) return cl_err('プロジェクトが開かれていません');
  var seq = app.project.activeSequence;
  return '{"ok":true,"path":' + cl_q(app.project.path) + ',"seq":' + (seq ? 'true' : 'false') + '}';
}

function cl_findBin(parent, name) {
  for (var i = 0; i < parent.children.numItems; i++) {
    var c = parent.children[i];
    if (c.type === ProjectItemType.BIN && c.name === name) return c;
  }
  return parent.createBin(name);
}

function cl_findItem(bin, path) {
  var want = cl_norm(path);
  for (var i = bin.children.numItems - 1; i >= 0; i--) {
    var c = bin.children[i];
    try { if (cl_norm(c.getMediaPath()) === want) return c; } catch (e) {}
  }
  return null;
}

// 指定範囲 [s, e) にクリップがないか
function cl_isFree(track, s, e) {
  for (var i = 0; i < track.clips.numItems; i++) {
    var c = track.clips[i];
    if (c.start.seconds < e - 0.001 && c.end.seconds > s + 0.001) return false;
  }
  return true;
}

function collab_place(json) {
  try {
    var d = eval('(' + json + ')');
    app.enableQE();
    var proj = app.project;
    var seq = proj.activeSequence;
    if (!seq) return cl_err('シーケンスを開いてから実行してください');

    var startSec = seq.getPlayerPosition().seconds;
    var endSec = startSec + d.seconds;
    var innerLen = Math.max(d.seconds, 60); // ネストの中身は長めにして、外側で自由に伸縮できるように

    // 1. 素材の読み込み
    var bin = cl_findBin(proj.rootItem, 'コラボ紹介');
    proj.importFiles(d.files, true, bin, false);
    var items = [];
    for (var i = 0; i < d.files.length; i++) {
      var it = cl_findItem(bin, d.files[i]);
      if (!it) return cl_err('読み込みに失敗しました: ' + d.files[i]);
      try { it.setOutPoint(innerLen, 4); } catch (e) {}
      items.push(it);
    }

    // 2. ネストを作成（設定は今のシーケンスと同じに）
    var nest = proj.createNewSequenceFromClips(d.nestName, [items[0]], bin);
    if (!nest) return cl_err('ネストの作成に失敗しました');
    try { nest.setSettings(seq.getSettings()); } catch (e) {}
    proj.openSequence(nest.sequenceID);
    // トラック構成：下からアイコン n 本、その上にラベル（文字）n 本
    var labels = d.labels || [];
    var total = items.length + (labels.length ? items.length : 0);
    var need = total - nest.videoTracks.numTracks;
    if (need > 0) qe.project.getActiveSequence().addTracks(need, nest.videoTracks.numTracks, 0);
    for (i = 1; i < items.length; i++) nest.videoTracks[i].overwriteClip(items[i], 0);
    for (i = 0; i < items.length; i++) {
      var clips = nest.videoTracks[i].clips;
      if (clips.numItems > 0) { try { clips[0].end = cl_sec(innerLen); } catch (e) {} }
    }
    var labelErr = '';
    for (i = 0; i < labels.length; i++) {
      if (!labels[i]) continue;
      try {
        var mg = nest.importMGT(d.mogrt, '0', items.length + i, 0);
        if (!mg) { labelErr = 'ラベルの読み込みに失敗しました'; continue; }
        try { mg.end = cl_sec(innerLen); } catch (e) {}
        cl_setLabel(mg, labels[i]);
      } catch (e) { labelErr = 'ラベル設定エラー: ' + e.toString() + ' (line ' + e.line + ')'; }
    }

    // 3. 元のシーケンスに戻り、映像・音声とも空いているトラック番号を探す（V1は避ける）
    proj.openSequence(seq.sequenceID);
    var qs = qe.project.getActiveSequence();
    var v = 1;
    while (true) {
      var vOk = v >= seq.videoTracks.numTracks || cl_isFree(seq.videoTracks[v], startSec, endSec);
      var aOk = v >= seq.audioTracks.numTracks || cl_isFree(seq.audioTracks[v], startSec, endSec);
      if (vOk && aOk) break;
      v++;
    }
    if (v >= seq.videoTracks.numTracks) qs.addTracks(v - seq.videoTracks.numTracks + 1, seq.videoTracks.numTracks, 0);
    if (v >= seq.audioTracks.numTracks) qs.addTracks(0, 0, v - seq.audioTracks.numTracks + 1, 1, seq.audioTracks.numTracks);

    // 4. ネストを配置して長さを調整、付いてきた空の音声は削除
    var track = seq.videoTracks[v];
    track.overwriteClip(nest.projectItem, startSec);
    var nestId = nest.projectItem.nodeId;
    for (i = 0; i < track.clips.numItems; i++) {
      var c = track.clips[i];
      if (Math.abs(c.start.seconds - startSec) < 0.01 && c.projectItem && c.projectItem.nodeId === nestId) {
        try { c.end = cl_sec(endSec); } catch (e) {}
      }
    }
    if (v < seq.audioTracks.numTracks) {
      var at = seq.audioTracks[v];
      for (i = at.clips.numItems - 1; i >= 0; i--) {
        var ac = at.clips[i];
        if (ac.projectItem && ac.projectItem.nodeId === nestId) ac.remove(false, false);
      }
    }
    return '{"ok":true,"track":' + (v + 1) + ',"warn":' + cl_q(labelErr) + '}';
  } catch (e) {
    return cl_err('エラー: ' + e.toString() + ' (line ' + e.line + ')');
  }
}
