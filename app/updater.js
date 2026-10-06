// 自動更新：GitHub の latest.json を確認し、新しい本体をダウンロードして入れ替える
// latest.json = { "version": "1.1.1", "notes": "変更内容", "zip": "releases/app-1.1.1.zip", "sha256": "..." }
var Updater = (function () {
  var C = window.COLLAB || {};
  var local = { version: '0', repo: '' };
  try { local = JSON.parse(fs.readFileSync(APP_DIR + '\\version.json', 'utf8')); } catch (e) {}

  function newer(a, b) {
    var x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
    for (var i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    return false;
  }
  function rawUrl(p) { return 'https://raw.githubusercontent.com/' + local.repo + '/main/' + p; }

  // https で取得（リダイレクト対応）。Buffer を返す
  function get(url, depth) {
    return new Promise(function (resolve, reject) {
      if ((depth || 0) > 5) return reject(new Error('リダイレクトが多すぎます'));
      nodeReq('https').get(url, { headers: { 'User-Agent': 'collab-layout-panel' } }, function (res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume(); return resolve(get(res.headers.location, (depth || 0) + 1));
        }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
        var chunks = [];
        res.on('data', function (c) { chunks.push(c); });
        res.on('end', function () { resolve(Buffer.concat(chunks)); });
      }).on('error', reject);
    });
  }

  function check(manual) {
    if (!nodeReq || !local.repo) { if (manual) status('更新の確認先が設定されていません', 'err'); return Promise.resolve(null); }
    if (C.dev) { if (manual) status('開発モードのため自動更新はオフです', 'ok'); return Promise.resolve(null); }
    if (manual) status('更新を確認中…');
    return get(rawUrl('latest.json') + '?t=' + Date.now()).then(function (buf) {
      var info = JSON.parse(buf.toString('utf8'));
      if (newer(info.version, local.version)) { showBanner(info); return info; }
      if (manual) status('最新版です（v' + local.version + '）', 'ok');
      return null;
    }).catch(function (e) {
      if (manual) status('更新を確認できませんでした: ' + e.message, 'err');
      return null;
    });
  }

  function showBanner(info) {
    var b = $('update');
    b.innerHTML = '<div><b>新しいバージョン v' + info.version + ' があります</b>' +
      (info.notes ? '<div class="un"></div>' : '') +
      '<div class="uw">※ 更新すると「今回のメンバー」は空になります（ライブラリは残ります）</div></div>' +
      '<div class="ub"><button id="up-later">あとで</button><button id="up-go">更新する</button></div>';
    if (info.notes) b.querySelector('.un').textContent = info.notes;
    b.style.display = 'flex';
    $('up-later').addEventListener('click', function () { b.style.display = 'none'; });
    $('up-go').addEventListener('click', function () { apply(info); });
  }

  function apply(info) {
    var b = $('update');
    if (!C.userAppDir || APP_DIR !== C.userAppDir) { status('この状態では自動更新できません（パネルを開き直してください）', 'err'); return; }
    b.innerHTML = '<div>更新しています…</div>';
    var root = pathMod.dirname(C.userAppDir || APP_DIR);
    var zip = pathMod.join(root, 'update.zip'), fresh = pathMod.join(root, 'app_new'), old = pathMod.join(root, 'app_old');
    get(rawUrl(info.zip)).then(function (buf) {
      // 改ざん・破損のチェック
      var sha = nodeReq('crypto').createHash('sha256').update(buf).digest('hex');
      if (info.sha256 && sha.toLowerCase() !== String(info.sha256).toLowerCase()) throw new Error('ファイルの確認に失敗しました（ハッシュ不一致）');
      fs.writeFileSync(zip, buf);
      fs.rmSync(fresh, { recursive: true, force: true });
      nodeReq('child_process').execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
        'Expand-Archive -LiteralPath $env:CL_ZIP -DestinationPath $env:CL_DST -Force'],
        { env: Object.assign({}, process.env, { CL_ZIP: zip, CL_DST: fresh }), windowsHide: true });
      var v = JSON.parse(fs.readFileSync(pathMod.join(fresh, 'version.json'), 'utf8')).version;
      if (v !== info.version || !fs.existsSync(pathMod.join(fresh, 'index.html'))) throw new Error('更新ファイルの中身が正しくありません');
      // 入れ替え（失敗したら元に戻す）
      fs.rmSync(old, { recursive: true, force: true });
      fs.renameSync(C.userAppDir, old);
      try { fs.renameSync(fresh, C.userAppDir); }
      catch (e) { fs.renameSync(old, C.userAppDir); throw e; }
      fs.rmSync(zip, { force: true });
      b.innerHTML = '<div>更新しました。再読み込みします…</div>';
      setTimeout(function () { location.replace(C.loaderUrl || location.href); }, 600); // 起動役からやり直す
    }).catch(function (e) {
      b.innerHTML = '<div style="color:#ff6b6b">更新に失敗しました（今のバージョンのまま使えます）<br>' +
        String(e.message || e).replace(/</g, '&lt;') + '</div><div class="ub"><button id="up-close">閉じる</button></div>';
      $('up-close').addEventListener('click', function () { b.style.display = 'none'; });
    });
  }

  // 本体の起動に成功した印（起動役は、これが残っていると次回は同梱版で起動し直す）
  try { if (fs) fs.rmSync(APP_DIR + '\\.booting', { force: true }); } catch (e) {}

  setTimeout(function () { check(false); }, 1500);
  return { check: check, version: local.version, dev: !!C.dev };
})();
