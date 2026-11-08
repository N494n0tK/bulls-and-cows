import {
  COLORS,
  DEFAULT_SETTINGS,
  normalizeSettings,
  validateCode,
  createGame,
  setSecret,
  makeGuess,
  currentRound,
} from './logic.js';

const STORAGE_KEY = 'hit-and-blow-duel';
const $ = (id) => document.getElementById(id);

// ---- 保存（名前と設定だけ。失敗しても動くようにする） ----
function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {};
  } catch {
    return {};
  }
}
function savePrefs(prefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* 保存できなくても遊べる */
  }
}

// ---- アプリ全体の状態 ----
const app = {
  names: ['プレイヤー1', 'プレイヤー2'],
  settings: { ...DEFAULT_SETTINGS },
  starter: 0, // 次の対戦の先攻
  wins: [0, 0, 0], // [P1勝ち, P2勝ち, 引き分け]
  game: null,
};

// ---- 画面切り替え ----
function show(screenId) {
  for (const el of document.querySelectorAll('.screen')) el.hidden = el.id !== screenId;
  window.scrollTo({ top: 0 });
}

// ---- 部品：ピン ----
function peg(colorId, { size = '', hidden = false } = {}) {
  const el = document.createElement('span');
  el.className = `peg ${size}`;
  if (hidden) {
    el.classList.add('hidden-peg');
    el.textContent = '?';
  } else if (colorId == null) {
    el.classList.add('empty');
  } else {
    const c = COLORS[colorId];
    el.style.setProperty('--peg', c.hex);
    el.dataset.mark = c.mark;
    el.title = c.name;
    el.setAttribute('aria-label', c.name);
  }
  return el;
}

function codeRow(code, opts) {
  const row = document.createElement('div');
  row.className = 'pegs';
  for (const c of code) row.append(peg(c, opts));
  return row;
}

function pips(hit, blow, length) {
  const box = document.createElement('div');
  box.className = 'pips';
  box.style.setProperty('--cols', Math.ceil(length / 2));
  box.setAttribute('aria-label', `${hit}ヒット ${blow}ブロー`);
  for (let i = 0; i < length; i++) {
    const p = document.createElement('span');
    p.className = `pip ${i < hit ? 'hit' : i < hit + blow ? 'blow' : ''}`;
    box.append(p);
  }
  return box;
}

// ---- 部品：コード入力（スロット + パレット） ----
function createCodeInput(root) {
  let settings = app.settings;
  let slots = [];
  let active = 0;

  const slotRow = document.createElement('div');
  slotRow.className = 'slots';
  const palette = document.createElement('div');
  palette.className = 'palette';
  root.replaceChildren(slotRow, palette);

  function nextEmpty(from) {
    for (let k = 0; k < slots.length; k++) {
      const i = (from + k) % slots.length;
      if (slots[i] == null) return i;
    }
    return -1;
  }

  function render() {
    slotRow.replaceChildren();
    slots.forEach((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `slot ${i === active ? 'active' : ''}`;
      b.setAttribute('aria-label', `${i + 1}番目${c == null ? '（空）' : `：${COLORS[c].name}`}`);
      b.append(peg(c, { size: 'lg' }));
      b.addEventListener('click', () => {
        slots[i] = null;
        active = i;
        render();
      });
      slotRow.append(b);
    });

    palette.replaceChildren();
    const used = new Set(slots.filter((c) => c != null));
    for (let c = 0; c < settings.colors; c++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.append(peg(c, { size: 'lg' }));
      b.disabled = !settings.allowDuplicates && used.has(c);
      b.setAttribute('aria-label', COLORS[c].name);
      b.addEventListener('click', () => put(c));
      palette.append(b);
    }
  }

  function put(c) {
    if (active < 0) active = nextEmpty(0);
    if (active < 0) return; // 満杯
    slots[active] = c;
    active = nextEmpty(active + 1);
    render();
  }

  return {
    reset(s) {
      settings = s;
      slots = Array(s.length).fill(null);
      active = 0;
      render();
    },
    set(code) {
      slots = [...code];
      active = -1;
      render();
    },
    value: () => [...slots],
    isComplete: () => slots.every((c) => c != null),
  };
}

const secretInput = createCodeInput($('secret-input'));
const guessInput = createCodeInput($('guess-input'));

function randomCode(s) {
  const pool = [...Array(s.colors).keys()];
  const code = [];
  for (let i = 0; i < s.length; i++) {
    if (s.allowDuplicates) {
      code.push(pool[Math.floor(Math.random() * pool.length)]);
    } else {
      code.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
  }
  return code;
}

// ---- 1. 設定画面 ----
function readSetup() {
  app.names = [0, 1].map((i) => $(`name-${i}`).value.trim() || `プレイヤー${i + 1}`);
  app.settings = normalizeSettings({
    length: $('set-length').value,
    colors: $('set-colors').value,
    maxTurns: $('set-turns').value,
    allowDuplicates: $('set-dup').checked,
    fairFinish: $('set-fair').checked,
  });
}

function fillSetup() {
  [0, 1].forEach((i) => {
    $(`name-${i}`).value = app.names[i];
  });
  $('set-length').value = app.settings.length;
  $('set-colors').value = app.settings.colors;
  $('set-turns').value = app.settings.maxTurns;
  $('set-dup').checked = app.settings.allowDuplicates;
  $('set-fair').checked = app.settings.fairFinish;
  updateSetupHint();
}

function updateSetupHint() {
  const s = normalizeSettings({
    length: $('set-length').value,
    colors: $('set-colors').value,
    allowDuplicates: $('set-dup').checked,
  });
  if (String(s.colors) !== $('set-colors').value) $('set-colors').value = s.colors;
  let total = 1;
  for (let i = 0; i < s.length; i++) total *= s.allowDuplicates ? s.colors : s.colors - i;
  $('setup-hint').textContent = `コードの組み合わせは全部で ${total.toLocaleString()} 通り`;
}

for (const id of ['set-length', 'set-colors', 'set-dup']) $(id).addEventListener('change', updateSetupHint);

$('btn-start').addEventListener('click', () => {
  readSetup();
  savePrefs({ names: app.names, settings: app.settings });
  app.wins = [0, 0, 0];
  app.starter = 0;
  startMatch();
});

// ---- 2. 受け渡し画面 ----
let handoffNext = null;
function handoff(title, text, next, { icon = '🙈', button = '準備OK' } = {}) {
  $('handoff-title').textContent = title;
  $('handoff-text').textContent = text;
  document.querySelector('.handoff-icon').textContent = icon;
  $('btn-handoff').textContent = button;
  handoffNext = next;
  show('screen-handoff');
}
$('btn-handoff').addEventListener('click', () => handoffNext?.());

// ---- 3. 秘密のコード ----
let secretFor = 0;
function startMatch() {
  app.game = createGame(app.settings, app.names, app.starter);
  askSecret(app.starter);
}

function askSecret(i) {
  const name = app.names[i];
  handoff(
    `${name}さんの番`,
    `${name}さんに端末をわたしてください。ほかの人は画面を見ないでね。`,
    () => {
      secretFor = i;
      $('secret-title').textContent = `${name}さんの秘密のコード`;
      $('screen-secret').className = `screen p${i}`;
      $('secret-error').textContent = '';
      secretInput.reset(app.game.settings);
      show('screen-secret');
    },
  );
}

$('btn-secret-random').addEventListener('click', () => secretInput.set(randomCode(app.game.settings)));
$('btn-secret-clear').addEventListener('click', () => secretInput.reset(app.game.settings));
$('btn-secret-ok').addEventListener('click', () => {
  const code = secretInput.value();
  const err = validateCode(code, app.game.settings);
  if (err) {
    $('secret-error').textContent = err;
    return;
  }
  setSecret(app.game, secretFor, code);
  secretInput.reset(app.game.settings); // 画面に残さない
  if (app.game.phase === 'secret') {
    askSecret(1 - secretFor);
  } else {
    const first = app.names[app.game.starter];
    handoff(
      'コードがそろいました！',
      `画面を2人で見られる場所に置きましょう。先攻は ${first} さんです。`,
      startPlaying,
      { icon: '🎯', button: '対戦開始' },
    );
  }
});

// ---- 4. 対戦画面 ----
function startPlaying() {
  show('screen-game');
  prepareTurn();
}

function prepareTurn() {
  guessInput.reset(app.game.settings);
  $('guess-error').textContent = '';
  renderGame();
}

function renderBoards(container, game, { reveal = false } = {}) {
  container.replaceChildren();
  // 先攻を左（上）に表示
  const order = [game.starter, 1 - game.starter];
  for (const i of order) {
    const me = game.players[i];
    const opp = game.players[1 - i];
    const board = document.createElement('div');
    board.className = `card board p${i}`;
    if (game.phase === 'playing' && game.current === i) board.classList.add('turn');
    if (game.result?.winner === i) board.classList.add('winner');

    const head = document.createElement('div');
    head.className = 'board-head';
    const title = document.createElement('h3');
    const nameEl = document.createElement('span');
    nameEl.className = 'board-name';
    nameEl.textContent = me.name;
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = i === game.starter ? '先攻' : '後攻';
    title.append(nameEl, tag);
    const sub = document.createElement('p');
    sub.className = 'board-sub';
    sub.textContent = `${opp.name}さんのコードを予想中`;
    head.append(title, sub);

    const target = document.createElement('div');
    target.className = 'target';
    target.append(codeRow(opp.secret, { hidden: !reveal }));
    head.append(target);
    board.append(head);

    const list = document.createElement('ol');
    list.className = 'history';
    const rows = game.settings.maxTurns || Math.max(me.guesses.length + 1, 4);
    for (let r = 0; r < Math.max(rows, me.guesses.length); r++) {
      const li = document.createElement('li');
      const g = me.guesses[r];
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = r + 1;
      li.append(num);
      if (g) {
        li.append(codeRow(g.code, { size: 'sm' }), pips(g.hit, g.blow, game.settings.length));
        const txt = document.createElement('span');
        txt.className = 'hb-text';
        txt.innerHTML = `<b>${g.hit}</b>H <b>${g.blow}</b>B`;
        li.append(txt);
        if (g.hit === game.settings.length) li.classList.add('solved');
        if (r === me.guesses.length - 1 && game.phase === 'playing' && game.current !== i) li.classList.add('latest');
      } else {
        li.classList.add('blank');
        li.append(codeRow(Array(game.settings.length).fill(null), { size: 'sm' }));
      }
      list.append(li);
    }
    board.append(list);
    container.append(board);
  }
}

function renderGame() {
  const g = app.game;
  const cur = g.current;
  const name = g.players[cur].name;
  renderBoards($('boards'), g);

  const status = $('status');
  status.className = `status p${cur}`;
  if (g.pendingWinner !== null) {
    status.textContent = `${g.players[g.pendingWinner].name}さんが正解！ ${name}さん、最後のチャンス！`;
    status.classList.add('alert');
  } else {
    status.textContent = `${name}さんの番です`;
  }

  $('guess-panel').className = `card guess-panel p${cur}`;
  $('guess-title').textContent = `${name}さんのコール`;
  const max = g.settings.maxTurns;
  $('round-label').textContent = max ? `${currentRound(g)} / ${max} 回目` : `${currentRound(g)} 回目`;
}

$('btn-guess-clear').addEventListener('click', () => guessInput.reset(app.game.settings));
$('btn-guess').addEventListener('click', () => {
  const g = app.game;
  const code = guessInput.value();
  const err = validateCode(code, g.settings);
  if (err) {
    $('guess-error').textContent = err;
    return;
  }
  const who = g.players[g.current].name;
  const res = makeGuess(g, code);
  toast(res.solved ? `${who}さん、全部ヒット！` : `${who}さん：${res.hit}ヒット ${res.blow}ブロー`, res.solved);
  if (g.phase === 'finished') {
    finishMatch();
  } else {
    prepareTurn();
  }
});

// confirm() が使えない環境もあるので、2回押しで確認する
let quitTimer;
$('btn-quit').addEventListener('click', (e) => {
  const btn = e.currentTarget;
  if (!btn.classList.contains('confirm')) {
    btn.classList.add('confirm');
    btn.textContent = 'もう一度押すと対戦をやめます';
    clearTimeout(quitTimer);
    quitTimer = setTimeout(resetQuit, 3000);
    return;
  }
  resetQuit();
  app.game = null;
  fillSetup();
  show('screen-setup');
});
function resetQuit() {
  clearTimeout(quitTimer);
  $('btn-quit').classList.remove('confirm');
  $('btn-quit').textContent = '対戦をやめる';
}

// ---- 5. 結果画面 ----
function finishMatch() {
  const g = app.game;
  const { winner, reason } = g.result;
  if (winner === null) app.wins[2]++;
  else app.wins[winner]++;

  const card = document.querySelector('#screen-result .result');
  card.className = `card result ${winner === null ? 'draw' : `p${winner}`}`;
  if (winner === null) {
    $('result-badge').textContent = '🤝';
    $('result-title').textContent = '引き分け！';
    $('result-text').textContent =
      reason === 'both-solved'
        ? '2人とも同じ回数で当てました。いい勝負！'
        : '回数を使い切りました。どちらも当てられず…';
  } else {
    const turns = g.players[winner].guesses.length;
    $('result-badge').textContent = '🏆';
    $('result-title').textContent = `${g.players[winner].name}さんの勝ち！`;
    $('result-text').textContent = `${turns}回目のコールでコードを当てました。`;
  }

  const reveal = $('result-reveal');
  reveal.replaceChildren();
  for (const i of [0, 1]) {
    const box = document.createElement('div');
    box.className = `reveal-item p${i}`;
    const label = document.createElement('span');
    label.textContent = `${g.players[i].name}さんのコード`;
    box.append(label, codeRow(g.players[i].secret));
    reveal.append(box);
  }

  $('score-board').textContent = `通算成績　${app.names[0]} ${app.wins[0]}勝 ／ ${app.names[1]} ${app.wins[1]}勝 ／ 引き分け ${app.wins[2]}`;
  renderBoards($('result-boards'), g, { reveal: true });
  setTimeout(() => show('screen-result'), 600);
}

$('btn-rematch').addEventListener('click', () => {
  app.starter = 1 - app.game.starter;
  startMatch();
});
$('btn-back').addEventListener('click', () => {
  fillSetup();
  show('screen-setup');
});

// ---- トースト ----
let toastTimer;
function toast(text, big = false) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = text;
  el.classList.toggle('big', big);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

// ---- あそびかた ----
$('btn-rules').addEventListener('click', () => $('rules').showModal());

// ---- 起動 ----
const prefs = loadPrefs();
if (Array.isArray(prefs.names)) app.names = prefs.names.slice(0, 2);
if (prefs.settings) app.settings = normalizeSettings(prefs.settings);
fillSetup();
show('screen-setup');
