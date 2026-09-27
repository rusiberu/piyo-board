// ぴよボード — iPhoneのウィジェット（ホーム画面・ロック画面）
// 無料アプリ「Scriptable」で動かします。
//
// 【使い方】
// 1. ぴよログのデータフィードURLを「コピー」しておく
//    （ぴよログアプリ → 設定 → データフィード → URLをコピー）
// 2. Scriptableでこのスクリプトを開き、右下の「▶」を押す
//    → コピーしていたURLを自動で読み取って保存します（入力欄は出ません）
//    → 画面下のログに「✅ URLを保存しました」と出れば成功
// 3. ホーム画面を長押し → 「+」 → Scriptable → 中サイズを追加
// 4. 置いたウィジェットを長押し → 「ウィジェットを編集」
//    → Script にこのスクリプトを選ぶ
//    → When Interacting を「Run Script」にする（タップで即更新できる）
//
// ロック画面にも置けます（手順3でロック画面を長押し）。
//
// 【経過時間について】
// iOSのウィジェットは毎分は再実行されません（OSの判断で15〜30分間隔）。
// そこで経過時間は addDate + applyRelativeStyle で表示しています。
// これは「iOSが自分で1分ごとに進めてくれる表示」なので、
// スクリプトが再実行されなくても経過時間はズレません。
// ただし「新しい授乳が記録されたこと」に気づくのは次の更新時なので、
// すぐ反映したいときはウィジェットをタップしてください。

const KEY = 'piyologFeedUrl';

// 経過時間の見せ方： 'relative' = 「2時間34分」（1分ごと） / 'timer' = 「2:34:07」（秒ごと）
const ELAPSED_STYLE = 'relative';

// 授乳からこの分数を超えたら赤くする
const WARN_MINUTES = 180;

const FEED_TYPES = ['BreastFeeding', 'Formula', 'ExpressedBreastMilk'];
const TYPE_LABEL = {
  BreastFeeding: '母乳', Formula: 'ミルク', ExpressedBreastMilk: '搾母乳', Pumping: '搾乳',
  Sleep: '寝る', WakeUp: '起きる', Pee: 'おしっこ', Poop: 'うんち',
  Temperature: '体温', Weight: '体重', Height: '身長',
};

// この行が動けば「スクリプトは走っている」と分かります（画面下のログに出ます）
console.log('ぴよボード: 開始');

// 全体をこの関数の中に入れ、最後にmain()で呼びます。
// こうすると、途中で何が起きても下のcatchで拾って画面に出せます。
main();

async function main() {
  let widget;
  try {
    const inWidget = typeof config !== 'undefined' && config.runsInWidget === true;
    const family = (typeof config !== 'undefined' && config.widgetFamily) || 'medium';
    const isAccessory = String(family).indexOf('accessory') === 0;

    // ===== フィードURLを決める =====
    let feedUrl = '';
    let status = '';

    // (1) ウィジェットのパラメータ欄に入っていればそれ
    try {
      if (typeof args !== 'undefined' && args.widgetParameter) feedUrl = String(args.widgetParameter).trim();
    } catch (e) { /* 使えない環境でも止まらないように無視 */ }

    // (2) 前回保存したもの
    if (!feedUrl) {
      try {
        if (Keychain.contains(KEY)) feedUrl = Keychain.get(KEY);
      } catch (e) { /* 同上 */ }
    }

    // (3) アプリ内で▶実行したときは、コピー中のURLを取り込む
    if (!inWidget) {
      let clip = '';
      try { clip = String(Pasteboard.paste() || '').trim(); } catch (e) { clip = ''; }
      if (clip.indexOf('https://feed.piyolog.com/') === 0) {
        feedUrl = clip;
        try { Keychain.set(KEY, clip); status = '✅ URLを保存しました'; }
        catch (e) { status = '⚠️ 保存できませんでした: ' + e.message; }
      } else if (feedUrl) {
        status = '保存済みのURLを使っています';
      } else {
        status = '⚠️ ぴよログのフィードURLをコピーしてから、もう一度▶を押してください';
      }
      console.log(status);
      console.log('URL設定: ' + (feedUrl ? 'あり' : 'なし'));
    }

    // ===== データを取ってくる =====
    let records = null;
    let errorMsg = null;
    try {
      if (!feedUrl) throw new Error('フィードURLが未設定');
      const req = new Request(feedUrl);
      req.timeoutInterval = 15;
      const json = await req.loadJSON();
      const code = req.response ? req.response.statusCode : 200;
      if (code !== 200) {
        throw new Error(code === 404 ? 'フィードが見つかりません（期限切れ？）'
          : code === 429 ? 'アクセスが多すぎます' : 'HTTP ' + code);
      }
      records = json.records || [];
      console.log('記録件数: ' + records.length);
    } catch (e) {
      errorMsg = e.message || '取得できませんでした';
      console.log('取得エラー: ' + errorMsg);
    }

    // ===== 画面を組み立てる =====
    widget = new ListWidget();
    const C = colors();

    if (!isAccessory) {
      widget.backgroundColor = C.bg;
      widget.setPadding(14, 14, 12, 14);
    } else {
      // ロック画面で文字が読みやすいようOS標準の背景を敷く（古い版では無い設定なので保護）
      try { widget.addAccessoryWidgetBackground = true; } catch (e) {}
    }

    if (errorMsg) {
      const t = widget.addText('🐥 ' + errorMsg);
      t.font = Font.systemFont(isAccessory ? 12 : 15);
      t.textColor = C.warn;
      if (!isAccessory && status) {
        widget.addSpacer(6);
        const h = widget.addText(status);
        h.font = Font.systemFont(11);
        h.textColor = C.sub;
      }
    } else if (isAccessory) {
      buildAccessory(widget, records, family, C);
    } else {
      buildHome(widget, records, family, C);
    }

    // 5分後以降の更新をiOSに希望する（実際のタイミングはiOSが決めます）
    try { widget.refreshAfterDate = new Date(Date.now() + 5 * 60 * 1000); } catch (e) {}

    if (inWidget) {
      Script.setWidget(widget);
    } else {
      await widget.presentMedium();   // アプリ内ではプレビュー
    }
  } catch (e) {
    // 何が起きたか必ず見えるようにする
    console.log('❌ エラー: ' + (e && e.message ? e.message : e));
    try {
      const w = new ListWidget();
      w.setPadding(14, 14, 14, 14);
      const t = w.addText('❌ ' + (e && e.message ? e.message : String(e)));
      t.font = Font.systemFont(13);
      w.addSpacer(6);
      const h = w.addText('この文章を伝えてもらえれば直せます');
      h.font = Font.systemFont(11);
      if (typeof config !== 'undefined' && config.runsInWidget) Script.setWidget(w);
      else await w.presentMedium();
    } catch (e2) { /* 表示すらできない場合はログだけ */ }
  }
  Script.complete();
}

// ===== 色（ライト/ダークどちらでも読めるように）=====
function colors() {
  const dyn = (light, dark) => {
    try { return Color.dynamic(new Color(light), new Color(dark)); }
    catch (e) { return new Color(light); }   // 古い版でも動くように
  };
  return {
    bg:     dyn('#fff7ed', '#1a1614'),
    text:   dyn('#3b2f2f', '#e8dfd6'),
    sub:    dyn('#8a7a6a', '#a08f80'),
    accent: dyn('#ea580c', '#fb923c'),
    warn:   dyn('#dc2626', '#f87171'),
  };
}

// ===== 小さな計算 =====
function lastOf(records, types) {
  for (let i = records.length - 1; i >= 0; i--) {
    if (types.indexOf(records[i].type) >= 0) return records[i];
  }
  return null;
}
function fmtTime(d) {
  return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}
// 母乳の左右秒数 → 「左10分右11分」
function detail(r) {
  if (r.type === 'BreastFeeding') {
    const l = Math.round((r.leftTime || 0) / 60), rt = Math.round((r.rightTime || 0) / 60);
    return [l ? '左' + l + '分' : '', rt ? '右' + rt + '分' : ''].filter(Boolean).join('');
  }
  return r.value ? r.value + 'ml' : '';
}
// 授乳の平均間隔（分）。2回未満ならnull
function avgFeedInterval(records) {
  const t = records.filter(r => FEED_TYPES.indexOf(r.type) >= 0).map(r => new Date(r.datetime).getTime());
  if (t.length < 2) return null;
  let sum = 0;
  for (let i = 1; i < t.length; i++) sum += t[i] - t[i - 1];
  return sum / (t.length - 1) / 60000;
}
// 「次はこの側から」
function nextSide(feed) {
  if (feed.type !== 'BreastFeeding' || !feed.last) return '';
  return feed.last === 'right' ? '左から' : '右から';
}
// iOSが自分で進めてくれる経過時間（ここが「細かく時間が分かる」仕組み）
function addLiveElapsed(stack, date, size, color) {
  const d = stack.addDate(date);
  if (ELAPSED_STYLE === 'timer') d.applyTimerStyle(); else d.applyRelativeStyle();
  d.font = Font.boldSystemFont(size);
  if (color) d.textColor = color;
  return d;
}

// ===== ホーム画面用 =====
function buildHome(w, records, family, C) {
  const small = family === 'small';
  const now = new Date();
  const feed = lastOf(records, FEED_TYPES);

  if (!feed) {
    const t = w.addText('🍼 24時間以内の授乳記録なし');
    t.font = Font.systemFont(14);
    t.textColor = C.sub;
    return;
  }

  const fed = new Date(feed.datetime);
  const color = (now - fed) / 60000 > WARN_MINUTES ? C.warn : C.text;

  // 1行目：何時の記録か（時刻なので古くならない）
  const head = w.addText('🍼 ' + fmtTime(fed) + ' ' + (TYPE_LABEL[feed.type] || feed.type) + ' ' + detail(feed));
  head.font = Font.systemFont(small ? 11 : 13);
  head.textColor = C.sub;
  head.lineLimit = 1;

  // 2行目：経過時間（iOSが1分ごとに進めてくれる）
  const row = w.addStack();
  row.layoutHorizontally();
  row.bottomAlignContent();
  addLiveElapsed(row, fed, small ? 28 : 36, color);
  const ago = row.addText(' 前');
  ago.font = Font.systemFont(small ? 12 : 15);
  ago.textColor = color;
  row.addSpacer();

  // 3行目：次の授乳の目安
  const bits = [];
  const avg = avgFeedInterval(records);
  if (avg) bits.push('次 ' + fmtTime(new Date(fed.getTime() + avg * 60000)) + 'ごろ');
  const side = nextSide(feed);
  if (side) bits.push(side);
  if (bits.length) {
    const nx = w.addText(bits.join('・'));
    nx.font = Font.mediumSystemFont(small ? 12 : 14);
    nx.textColor = C.accent;
    nx.lineLimit = 1;
  }

  w.addSpacer(small ? 4 : 7);

  // おしっこ・うんち（こちらも時刻で）
  const r2 = w.addStack();
  r2.layoutHorizontally();
  r2.spacing = 10;
  [['💧', lastOf(records, ['Pee'])], ['💩', lastOf(records, ['Poop'])]].forEach(([icon, ev]) => {
    const t = r2.addText(ev ? icon + ' ' + fmtTime(new Date(ev.datetime)) : icon + ' --');
    t.font = Font.systemFont(small ? 12 : 14);
    t.textColor = C.text;
  });
  r2.addSpacer();

  // 24時間の回数と、データを取ってきた時刻
  if (!small) {
    w.addSpacer(3);
    const c = (t) => records.filter(r => r.type === t).length;
    const f = records.filter(r => FEED_TYPES.indexOf(r.type) >= 0).length;
    const sum = w.addText('24h: 授乳' + f + ' / 💧' + c('Pee') + ' / 💩' + c('Poop') + '　データ ' + fmtTime(now));
    sum.font = Font.systemFont(10);
    sum.textColor = C.sub;
    sum.lineLimit = 1;
  }
}

// ===== ロック画面用 =====
function buildAccessory(w, records, family, C) {
  const feed = lastOf(records, FEED_TYPES);
  if (!feed) {
    const t = w.addText('🍼 --');
    t.font = Font.systemFont(12);
    return;
  }
  const fed = new Date(feed.datetime);

  if (family === 'accessoryCircular') {
    w.addSpacer();
    const icon = w.addText('🍼');
    icon.font = Font.systemFont(11);
    icon.centerAlignText();
    const d = w.addDate(fed);
    d.applyRelativeStyle();
    d.font = Font.boldSystemFont(13);
    d.centerAlignText();
    d.lineLimit = 1;
    w.addSpacer();
    return;
  }

  if (family === 'accessoryInline') {
    const row = w.addStack();
    row.layoutHorizontally();
    row.addText('🍼 ');
    const d = row.addDate(fed);
    d.applyRelativeStyle();
    return;
  }

  // accessoryRectangular（横長）
  const head = w.addText('🍼 ' + fmtTime(fed) + ' ' + (TYPE_LABEL[feed.type] || feed.type));
  head.font = Font.systemFont(12);
  head.lineLimit = 1;

  const row = w.addStack();
  row.layoutHorizontally();
  row.bottomAlignContent();
  addLiveElapsed(row, fed, 19, null);
  const ago = row.addText(' 前');
  ago.font = Font.systemFont(11);
  row.addSpacer();

  const bits = [];
  const avg = avgFeedInterval(records);
  if (avg) bits.push('次 ' + fmtTime(new Date(fed.getTime() + avg * 60000)));
  const side = nextSide(feed);
  if (side) bits.push(side);
  if (bits.length) {
    const nx = w.addText(bits.join('・'));
    nx.font = Font.systemFont(11);
    nx.lineLimit = 1;
  }
}
