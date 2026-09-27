// ぴよボード — iPhoneのホーム画面ウィジェット
// 無料アプリ「Scriptable」で動かすスクリプトです。
//
// 【使い方】
// 1. App Storeで「Scriptable」をインストール
// 2. アプリを開いて右上の「+」→ このファイルの中身を全部貼り付け
// 3. 名前を「ぴよボード」にする（左上の設定アイコンから変更）
// 4. 一度アプリ内で実行（▶ボタン）→ フィードURLを貼って「保存」
//    URLはiPhoneのキーチェーンに保存され、他のアプリからは見えません
// 5. ホーム画面を長押し → 「+」 → Scriptable → ウィジェットを追加
// 6. 追加したウィジェットを長押し → 「ウィジェットを編集」
//    → Script に「ぴよボード」、When Interacting は「Run Script」でOK

const KEY = 'piyologFeedUrl';

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
const WARN_MINUTES = 180;   // 授乳からこの分数を超えたら赤くする

// ===== 色（iPhoneのライト/ダークどちらでも読めるように）=====
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
const last = (types) => records ? [...records].reverse().find(r => types.includes(r.type)) : null;

function fmtTime(d) {
  return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}
function fmtMinutes(min) {
  min = Math.max(0, Math.round(min));
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h}時間${m}分` : `${m}分`;
}
// 母乳の左右秒数 → 「左7分右10分」
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

// ===== ウィジェットを組み立てる =====
const widget = new ListWidget();
widget.backgroundColor = C.bg;
widget.setPadding(14, 14, 12, 14);

if (errorMsg) {
  const t = widget.addText('🐥 ' + errorMsg);
  t.font = Font.systemFont(15);
  t.textColor = C.warn;
  widget.addSpacer(6);
  const h = widget.addText('Scriptableでこのスクリプトを開き、フィードURLを登録してください');
  h.font = Font.systemFont(11);
  h.textColor = C.sub;
} else {
  buildBoard(widget);
}

// iOSに「5分後以降に更新して」と伝える。実際のタイミングはiOSが決めます
widget.refreshAfterDate = new Date(now.getTime() + 5 * 60 * 1000);

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  // アプリ内で実行したときはプレビュー表示
  await widget.presentMedium();
}
Script.complete();


function buildBoard(w) {
  const small = config.widgetFamily === 'small';
  const feed = last(FEED_TYPES);

  // --- 最後の授乳「時刻」を主役にする ---
  // ウィジェットは毎分更新されないので、古くならない時刻を大きく出す
  const head = w.addText(feed ? `🍼 ${fmtTime(new Date(feed.datetime))}` : '🍼 記録なし');
  head.font = Font.boldSystemFont(small ? 28 : 34);
  head.textColor = C.text;

  if (feed) {
    const mins = (now - new Date(feed.datetime)) / 60000;
    const line = w.addText(`${fmtMinutes(mins)}前・${TYPE_LABEL[feed.type] || feed.type} ${detail(feed)}`);
    line.font = Font.systemFont(small ? 11 : 13);
    line.textColor = mins > WARN_MINUTES ? C.warn : C.sub;

    // --- 次の授乳の目安 ---
    const avg = avgFeedInterval();
    const bits = [];
    if (avg) bits.push(`次 ${fmtTime(new Date(new Date(feed.datetime).getTime() + avg * 60000))}ごろ`);
    if (feed.type === 'BreastFeeding' && feed.last) bits.push(`${feed.last === 'right' ? '左' : '右'}から`);
    if (bits.length) {
      w.addSpacer(small ? 4 : 6);
      const nx = w.addText(bits.join('・'));
      nx.font = Font.mediumSystemFont(small ? 12 : 14);
      nx.textColor = C.accent;
    }
  }

  w.addSpacer(small ? 4 : 8);

  // --- おしっこ・うんちも「時刻」で並べる ---
  const pee = last(['Pee']), poop = last(['Poop']);
  const row = w.addStack();
  row.layoutHorizontally();
  row.spacing = 10;
  for (const [icon, ev] of [['💧', pee], ['💩', poop]]) {
    const t = row.addText(ev ? `${icon} ${fmtTime(new Date(ev.datetime))}` : `${icon} --`);
    t.font = Font.systemFont(small ? 12 : 14);
    t.textColor = C.text;
  }
  row.addSpacer();

  // --- 24時間の回数 ---
  if (!small) {
    w.addSpacer(4);
    const feedCount = records.filter(r => FEED_TYPES.includes(r.type)).length;
    const peeCount = records.filter(r => r.type === 'Pee').length;
    const poopCount = records.filter(r => r.type === 'Poop').length;
    const sum = w.addText(`24h: 授乳${feedCount} / 💧${peeCount} / 💩${poopCount}`);
    sum.font = Font.systemFont(11);
    sum.textColor = C.sub;
  }

  // --- いつ時点の表示なのかを明記（ウィジェットは毎分更新されないため）---
  w.addSpacer(2);
  const foot = w.addText(`${fmtTime(now)} 時点`);
  foot.font = Font.systemFont(10);
  foot.textColor = C.sub;
}
