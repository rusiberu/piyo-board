// piyo-board widget for Scriptable (iOS)
// Setup: copy your piyolog feed URL, then tap Run. Or paste the URL into the
// widget's Parameter field (long press widget > Edit Widget > Parameter).

const KEY = 'piyologFeedUrl';

// 'relative' = counts by minute, 'timer' = counts by second
const ELAPSED_STYLE = 'relative';

// turn the elapsed time red after this many minutes
const WARN_MINUTES = 180;

const FEED_TYPES = ['BreastFeeding', 'Formula', 'ExpressedBreastMilk'];
const TYPE_LABEL = {
  BreastFeeding: '母乳', Formula: 'ミルク', ExpressedBreastMilk: '搾母乳', Pumping: '搾乳',
  Sleep: '寝る', WakeUp: '起きる', Pee: 'おしっこ', Poop: 'うんち',
  Temperature: '体温', Weight: '体重', Height: '身長',
};

console.log('start');

main();

async function main() {
  try {
    const inWidget = typeof config !== 'undefined' && config.runsInWidget === true;
    const family = (typeof config !== 'undefined' && config.widgetFamily) || 'medium';
    const isAccessory = String(family).indexOf('accessory') === 0;

    // ---- decide which feed URL to use ----
    let feedUrl = '';
    let status = '';

    // 1) the widget's Parameter field
    try {
      if (typeof args !== 'undefined' && args.widgetParameter) {
        feedUrl = String(args.widgetParameter).trim();
      }
    } catch (e) { /* ignore */ }

    // 2) saved from a previous run
    if (!feedUrl) {
      try {
        if (Keychain.contains(KEY)) feedUrl = Keychain.get(KEY);
      } catch (e) { /* ignore */ }
    }

    // 3) when run inside the app, pick the URL up from the clipboard
    if (!inWidget) {
      let clip = '';
      try { clip = String(Pasteboard.paste() || '').trim(); } catch (e) { clip = ''; }
      if (clip.indexOf('https://feed.piyolog.com/') === 0) {
        feedUrl = clip;
        try {
          Keychain.set(KEY, clip);
          status = 'URLを保存しました';
        } catch (e) {
          status = '保存できませんでした: ' + e.message;
        }
      } else if (feedUrl) {
        status = '保存済みのURLを使っています';
      } else {
        status = 'フィードURLをコピーしてから、もう一度実行してください';
      }
      console.log(status);
    }

    // ---- load the feed ----
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
      console.log('records: ' + records.length);
    } catch (e) {
      errorMsg = e.message || '取得できませんでした';
      console.log('fetch error: ' + errorMsg);
    }

    // ---- build the widget ----
    const widget = new ListWidget();
    const C = colors();

    if (!isAccessory) {
      widget.backgroundColor = C.bg;
      widget.setPadding(14, 14, 12, 14);
    } else {
      // lock screen: use the standard backdrop so text stays readable
      try { widget.addAccessoryWidgetBackground = true; } catch (e) { /* older versions */ }
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

    // ask iOS to refresh after 5 minutes (iOS decides the real timing)
    try { widget.refreshAfterDate = new Date(Date.now() + 5 * 60 * 1000); } catch (e) { /* ignore */ }

    if (inWidget) Script.setWidget(widget);
    else await widget.presentMedium();

  } catch (e) {
    // always surface what went wrong
    const msg = e && e.message ? e.message : String(e);
    console.log('error: ' + msg);
    try {
      const w = new ListWidget();
      w.setPadding(14, 14, 14, 14);
      const t = w.addText('❌ ' + msg);
      t.font = Font.systemFont(13);
      if (typeof config !== 'undefined' && config.runsInWidget) Script.setWidget(w);
      else await w.presentMedium();
    } catch (e2) { /* log only */ }
  }
  Script.complete();
}

// ---- colors, light and dark ----
function colors() {
  const dyn = (light, dark) => {
    try { return Color.dynamic(new Color(light), new Color(dark)); }
    catch (e) { return new Color(light); }
  };
  return {
    bg:     dyn('#fff7ed', '#1a1614'),
    text:   dyn('#3b2f2f', '#e8dfd6'),
    sub:    dyn('#8a7a6a', '#a08f80'),
    accent: dyn('#ea580c', '#fb923c'),
    warn:   dyn('#dc2626', '#f87171'),
  };
}

// ---- small helpers ----
function lastOf(records, types) {
  for (let i = records.length - 1; i >= 0; i--) {
    if (types.indexOf(records[i].type) >= 0) return records[i];
  }
  return null;
}

function fmtTime(d) {
  return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

// breast feeding stores seconds per side
function detail(r) {
  if (r.type === 'BreastFeeding') {
    const l = Math.round((r.leftTime || 0) / 60);
    const rt = Math.round((r.rightTime || 0) / 60);
    return [l ? '左' + l + '分' : '', rt ? '右' + rt + '分' : ''].filter(Boolean).join('');
  }
  return r.value ? r.value + 'ml' : '';
}

// average gap between feeds, in minutes
function avgFeedInterval(records) {
  const t = records.filter(r => FEED_TYPES.indexOf(r.type) >= 0)
                   .map(r => new Date(r.datetime).getTime());
  if (t.length < 2) return null;
  let sum = 0;
  for (let i = 1; i < t.length; i++) sum += t[i] - t[i - 1];
  return sum / (t.length - 1) / 60000;
}

// which side to start from next
function nextSide(feed) {
  if (feed.type !== 'BreastFeeding' || !feed.last) return '';
  return feed.last === 'right' ? '左から' : '右から';
}

// iOS keeps this number ticking on its own, without re-running the script
function addLiveElapsed(stack, date, size, color) {
  const d = stack.addDate(date);
  if (ELAPSED_STYLE === 'timer') d.applyTimerStyle();
  else d.applyRelativeStyle();
  d.font = Font.boldSystemFont(size);
  if (color) d.textColor = color;
  return d;
}

// ---- home screen ----
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

  // clock time never goes stale, so show it first
  const head = w.addText('🍼 ' + fmtTime(fed) + ' ' + (TYPE_LABEL[feed.type] || feed.type) + ' ' + detail(feed));
  head.font = Font.systemFont(small ? 11 : 13);
  head.textColor = C.sub;
  head.lineLimit = 1;

  const row = w.addStack();
  row.layoutHorizontally();
  row.bottomAlignContent();
  addLiveElapsed(row, fed, small ? 28 : 36, color);
  const ago = row.addText(' 前');
  ago.font = Font.systemFont(small ? 12 : 15);
  ago.textColor = color;
  row.addSpacer();

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

  const r2 = w.addStack();
  r2.layoutHorizontally();
  r2.spacing = 10;
  [['💧', lastOf(records, ['Pee'])], ['💩', lastOf(records, ['Poop'])]].forEach(pair => {
    const icon = pair[0], ev = pair[1];
    const t = r2.addText(ev ? icon + ' ' + fmtTime(new Date(ev.datetime)) : icon + ' --');
    t.font = Font.systemFont(small ? 12 : 14);
    t.textColor = C.text;
  });
  r2.addSpacer();

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

// ---- lock screen ----
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
