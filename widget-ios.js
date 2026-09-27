// ぴよボード — iPhoneのウィジェット（ホーム画面・ロック画面）
// 無料アプリ「Scriptable」で動かすスクリプトです。
//
// 【使い方】
// 1. App Storeで「Scriptable」をインストール
// 2. アプリを開いて右上の「+」→ このファイルの中身を全部貼り付け
// 3. 左上の設定アイコンから名前を「ぴよボード」にする
// 4. 一度アプリ内で実行（▶ボタン）→ フィードURLを貼って「保存」
//    URLはiPhoneのキーチェーンに保存され、他のアプリからは見えません
// 5. ホーム画面を長押し → 「+」 → Scriptable → ウィジェットを追加（中サイズ推奨）
// 6. 追加したウィジェットを長押し → 「ウィジェットを編集」
//    → Script に「ぴよボード」
//    → When Interacting を「Run Script」にする（タップでその場で最新に更新できる）
//
// ロック画面にも置けます（手順5でロック画面を長押し → ウィジェットを追加）。
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

const WARN_MINUTES = 180;   // 授乳からこの分数を超えたら赤くする

// ===== フィードURLの取得 =====
// 優先順：ウィジェットのパラメータ → キーチェーンに保存したもの
let feedUrl = (args.widgetParameter || '').trim();
if (!feedUrl && Keychain.contains(KEY)) feedUrl = Keychain.get(KEY);

// Scriptableアプリの中で実行したときだけ、URLの登録・変更ができる
if (!config.runsInWidget) {
  const alert = new Alert();
  alert.title = 'ぴよボード';
  alert.message = 'ぴよログのデータフィードURLを貼り付けてください。\n（このiPhoneの中だけに保存されます）';
  alert.addTextField('https://feed.piyolog.com/v1/feed/24h/...', feedUrl);
  alert.addAction('保存');
  alert.addCancelAction('そのまま表示');
  const tapped = await alert.present();
  if (tapped === 0) {
    feedUrl = alert.textFieldValue(0).trim();
    Keychain.set(KEY, feedUrl);
  }
}

// ===== 記録の種類 =====
const TYPE_LABEL = {
  BreastFeeding: '母乳', Formula: 'ミルク', ExpressedBreastMilk: '搾母乳', Pumping: '搾乳',
  Sleep: '寝る', WakeUp: '起きる', Pee: 'おしっこ', Poop: 'うんち',
  Temperature: '体温', Weight: '体重', Height: '身長',
};
const FEED_TYPES = ['BreastFeeding', 'Formula', 'ExpressedBreastMilk'];

// ===== 色（ライト/ダークどちらでも読めるように）=====
const C = {
  bg:     Color.dynamic(new Color('#fff7ed'), new Color('#1a1614')),
  text:   Color.dynamic(new Color('#3b2f2f'), new Color('#e8dfd6')),
  sub:    Color.dynamic(new Color('#8a7a6a'), new Color('#a08f80')),
  accent: Color.dynamic(new Color('#ea580c'), new Color('#fb923c')),
  warn:   Color.dynamic(new Color('#dc2626'), new Color('#f87171')),
};

// ===== データ取得 =====
let records = null;
let errorMsg = null;
try {
  if (!feedUrl) throw new Error('URLが未設定です');
  const req = new Request(feedUrl);
  req.timeoutInterval = 15;
  const json = await req.loadJSON();
  const code = req.response.statusCode;
  if (code !== 200) {
    throw new Error(code === 404 ? 'フィードが見つかりません' : code === 429 ? 'アクセスが多すぎます' : 'HTTP ' + code);
  }
  records = json.records || [];
} catch (e) {
  errorMsg = e.message || '取得できませんでした';
}

// ===== 計算 =====
const now = new Date();
const family = config.widgetFamily || 'medium';
const isAccessory = family.startsWith('accessory');   // ロック画面のウィジェット

const last = (types) => records ? [...records].reverse().find(r => types.includes(r.type)) : null;

function fmtTime(d) {
  return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}
// 母乳の左右秒数 → 「左10分右11分」
function detail(r) {
  if (r.type === 'BreastFeeding') {
    const l = Math.round((r.leftTime || 0) / 60), rt = Math.round((r.rightTime || 0) / 60);
    return [l ? `左${l}分` : '', rt ? `右${rt}分` : ''].filter(Boolean).join('');
  }
  return r.value ? `${r.value}ml` : '';
}
// 授乳の平均間隔（分）。2回未満ならnull
function avgFeedInterval() {
  const times = records.filter(r => FEED_TYPES.includes(r.type)).map(r => new Date(r.datetime).getTime());
  if (times.length < 2) return null;
  let sum = 0;
  for (let i = 1; i < times.length; i++) sum += times[i] - times[i - 1];
  return sum / (times.length - 1) / 60000;
}
// 「次はこの側から」
function nextSide(feed) {
  if (feed.type !== 'BreastFeeding' || !feed.last) return '';
  return feed.last === 'right' ? '左から' : '右から';
}

// iOSが自分で進めてくれる経過時間を置く（ここが「細かく時間が分かる」仕組み）
function addLiveElapsed(stack, date, size, color) {
  const d = stack.addDate(date);
  if (ELAPSED_STYLE === 'timer') d.applyTimerStyle();
  else d.applyRelativeStyle();
  d.font = Font.boldSystemFont(size);
  d.textColor = color;
  return d;
}

// ===== ウィジェットを組み立てる =====
const widget = new ListWidget();
if (!isAccessory) {
  widget.backgroundColor = C.bg;
  widget.setPadding(14, 14, 12, 14);
} else {
  // ロック画面では文字が読みやすいよう、OS標準の背景を敷く
  widget.addAccessoryWidgetBackground = true;
}

if (errorMsg) {
  const t = widget.addText('🐥 ' + errorMsg);
  t.font = Font.systemFont(isAccessory ? 12 : 15);
  t.textColor = isAccessory ? Color.white() : C.warn;
  if (!isAccessory) {
    widget.addSpacer(6);
    const h = widget.addText('Scriptableでこのスクリプトを開き、フィードURLを登録してください');
    h.font = Font.systemFont(11);
    h.textColor = C.sub;
  }
} else if (isAccessory) {
  buildAccessory(widget);
} else {
  buildHome(widget);
}

// 5分後以降の更新をiOSに希望する（実際のタイミングはiOSが決めます）
widget.refreshAfterDate = new Date(now.getTime() + 5 * 60 * 1000);

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentMedium();   // アプリ内ではプレビュー
}
Script.complete();


// ===== ホーム画面用（small / medium / large）=====
function buildHome(w) {
  const small = family === 'small';
  const feed = last(FEED_TYPES);

  if (!feed) {
    const t = w.addText('🍼 24時間以内の授乳記録なし');
    t.font = Font.systemFont(14);
    t.textColor = C.sub;
    return;
  }

  const fed = new Date(feed.datetime);
  const mins = (now - fed) / 60000;
  const color = mins > WARN_MINUTES ? C.warn : C.text;

  // --- 1行目: 何時の記録か（時刻なので古くならない）---
  const head = w.addText(`🍼 ${fmtTime(fed)} ${TYPE_LABEL[feed.type] || feed.type} ${detail(feed)}`);
  head.font = Font.systemFont(small ? 11 : 13);
  head.textColor = C.sub;
  head.lineLimit = 1;

  // --- 2行目: 経過時間（iOSが1分ごとに進めてくれる）---
  const row = w.addStack();
  row.layoutHorizontally();
  row.bottomAlignContent();
  addLiveElapsed(row, fed, small ? 28 : 36, color);
  const ago = row.addText(' 前');
  ago.font = Font.systemFont(small ? 12 : 15);
  ago.textColor = color;
  row.addSpacer();

  // --- 3行目: 次の授乳の目安 ---
  const bits = [];
  const avg = avgFeedInterval();
  if (avg) bits.push(`次 ${fmtTime(new Date(fed.getTime() + avg * 60000))}ごろ`);
  const side = nextSide(feed);
  if (side) bits.push(side);
  if (bits.length) {
    const nx = w.addText(bits.join('・'));
    nx.font = Font.mediumSystemFont(small ? 12 : 14);
    nx.textColor = C.accent;
    nx.lineLimit = 1;
  }

  w.addSpacer(small ? 4 : 7);

  // --- おしっこ・うんち（こちらも時刻で）---
  const pee = last(['Pee']), poop = last(['Poop']);
  const r2 = w.addStack();
  r2.layoutHorizontally();
  r2.spacing = 10;
  for (const [icon, ev] of [['💧', pee], ['💩', poop]]) {
    const t = r2.addText(ev ? `${icon} ${fmtTime(new Date(ev.datetime))}` : `${icon} --`);
    t.font = Font.systemFont(small ? 12 : 14);
    t.textColor = C.text;
  }
  r2.addSpacer();

  // --- 24時間の回数と、データを取ってきた時刻 ---
  if (!small) {
    w.addSpacer(3);
    const c = (t) => records.filter(r => r.type === t).length;
    const f = records.filter(r => FEED_TYPES.includes(r.type)).length;
    const sum = w.addText(`24h: 授乳${f} / 💧${c('Pee')} / 💩${c('Poop')}　データ ${fmtTime(now)}`);
    sum.font = Font.systemFont(10);
    sum.textColor = C.sub;
    sum.lineLimit = 1;
  }
}

// ===== ロック画面用（accessoryCircular / Rectangular / Inline）=====
function buildAccessory(w) {
  const feed = last(FEED_TYPES);
  if (!feed) {
    const t = w.addText('🍼 --');
    t.font = Font.systemFont(12);
    return;
  }
  const fed = new Date(feed.datetime);

  if (family === 'accessoryCircular') {
    // 丸い枠：経過時間だけ
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
    // 時計の下の1行：アイコン＋経過時間
    const row = w.addStack();
    row.layoutHorizontally();
    row.addText('🍼 ');
    const d = row.addDate(fed);
    d.applyRelativeStyle();
    return;
  }

  // accessoryRectangular（横長）：時刻・経過時間・次の目安
  const head = w.addText(`🍼 ${fmtTime(fed)} ${TYPE_LABEL[feed.type] || feed.type}`);
  head.font = Font.systemFont(12);
  head.lineLimit = 1;

  const row = w.addStack();
  row.layoutHorizontally();
  row.bottomAlignContent();
  const d = row.addDate(fed);
  if (ELAPSED_STYLE === 'timer') d.applyTimerStyle(); else d.applyRelativeStyle();
  d.font = Font.boldSystemFont(19);
  const ago = row.addText(' 前');
  ago.font = Font.systemFont(11);
  row.addSpacer();

  const bits = [];
  const avg = avgFeedInterval();
  if (avg) bits.push(`次 ${fmtTime(new Date(fed.getTime() + avg * 60000))}`);
  const side = nextSide(feed);
  if (side) bits.push(side);
  if (bits.length) {
    const nx = w.addText(bits.join('・'));
    nx.font = Font.systemFont(11);
    nx.lineLimit = 1;
  }
}
