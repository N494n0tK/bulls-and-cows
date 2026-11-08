import {
  COLORS,
  DEFAULT_SETTINGS,
  normalizeSettings,
  validateCode,
  countCodes,
  createGame,
  makeGuess,
  callsBy,
  countCandidates,
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
  candidates: [], // 各コール後の残り候補数（先頭はコール前）
};

// ---- 画面切り替え ----
function show(screenId) {
  for (const el of document.querySelectorAll('.screen')) el.hidden = el.id !== screenId;
  window.scrollTo({ top: 0 });
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

// ---- 部品：ピン ----
const useNumbers = () => (app.game?.settings ?? app.settings).symbols === 'number';
const symbolName = (c) => (useNumbers() ? String(c + 1) : COLORS[c].name);

function peg(colorId, { size = '', hidden = false } = {}) {
  const p = el('span', `peg ${size}`);
  if (useNumbers()) p.classList.add('num-peg');
  if (hidden) {
    p.classList.add('hidden-peg');
    p.textContent = '?';
  } else if (colorId == null) {
    p.classList.add('empty');
  } else if (useNumbers()) {
    p.textContent = colorId + 1;
    p.setAttribute('aria-label', String(colorId + 1));
  } else {
    const c = COLORS[colorId];
    p.style.setProperty('--peg', c.hex);
    p.dataset.mark = c.mark;
    p.title = c.name;
    p.setAttribute('aria-label', c.name);
  }
  return p;
}

function codeRow(code, opts) {
  const row = el('div', 'pegs');
  for (const c of code) row.append(peg(c, opts));
  return row;
}

function pips(hit, blow, length) {
  const box = el('div', 'pips');
  box.style.setProperty('--cols', Math.ceil(length / 2));
  box.setAttribute('aria-label', `${hit}ヒット ${blow}ブロー`);
  for (let i = 0; i < length; i++) {
    box.append(el('span', `pip ${i < hit ? 'hit' : i < hit + blow ? 'blow' : ''}`));
  }
  return box;
}

// ---- 部品：コード入力（スロット + パレット） ----
function createCodeInput(root) {
  let settings = app.settings;
  let slots = [];
  let active = 0;

  const slotRow = el('div', 'slots');
  const palette = el('div', 'palette');
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
      const b = el('button', `slot ${i === active ? 'active' : ''}`);
      b.type = 'button';
      b.setAttribute('aria-label', `${i + 1}番目${c == null ? '（空）' : `：${symbolName(c)}`}`);
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
      const b = el('button', 'swatch');
      b.type = 'button';
      b.append(peg(c, { size: 'lg' }));
      b.disabled = !settings.allowDuplicates && used.has(c);
      b.setAttribute('aria-label', symbolName(c));
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
    value: () => [...slots],
  };
}

const guessInput = createCodeInput($('guess-input'));

// ---- 1. 設定画面 ----
function readSetup() {
  app.names = [0, 1].map((i) => $(`name-${i}`).value.trim() || `プレイヤー${i + 1}`);
  app.settings = normalizeSettings({
    length: $('set-length').value,
    colors: $('set-colors').value,
    maxTurns: $('set-turns').value,
    allowDuplicates: $('set-dup').checked,
    symbols: $('set-symbols').value,
  });
}

function fillSetup() {
  [0, 1].forEach((i) => {
    $(`name-${i}`).value = app.names[i];
  });
  $('set-length').value = app.settings.length;
  $('set-colors').value = app.settings.colors;
  $('set-turns').value = app.settings.maxTurns;
  if (!$('set-turns').value) $('set-turns').value = DEFAULT_SETTINGS.maxTurns; // 選択肢にない古い保存値
  $('set-dup').checked = app.settings.allowDuplicates;
  $('set-symbols').value = app.settings.symbols;
  updateSetupHint();
}

function updateSetupHint() {
  const s = normalizeSettings({
    length: $('set-length').value,
    colors: $('set-colors').value,
    allowDuplicates: $('set-dup').checked,
  });
  if (String(s.colors) !== $('set-colors').value) $('set-colors').value = s.colors;
  $('setup-hint').textContent = `お題の組み合わせは全部で ${countCodes(s).toLocaleString()} 通り`;
}

for (const id of ['set-length', 'set-colors', 'set-dup']) $(id).addEventListener('change', updateSetupHint);

$('btn-start').addEventListener('click', () => {
  readSetup();
  savePrefs({ names: app.names, settings: app.settings });
  app.wins = [0, 0, 0];
  app.starter = 0;
  startMatch();
});

// ---- 2. お題決定 ----
function startMatch() {
  app.game = createGame(app.settings, app.names, app.starter);
  app.candidates = [countCodes(app.game.settings)];
  $('ready-pegs').replaceChildren(codeRow(app.game.secret, { hidden: true }));
  $('ready-text').textContent = `先攻は ${app.names[app.starter]} さん。画面を2人で見られる場所に置いて、交互にコールしましょう。`;
  show('screen-ready');
}
$('btn-ready').addEventListener('click', () => {
  show('screen-game');
  prepareTurn();
});

// ---- 3. 対戦画面 ----
function prepareTurn() {
  guessInput.reset(app.game.settings);
  $('guess-error').textContent = '';
  renderGame();
}

function renderBoard(container, game, { reveal = false } = {}) {
  container.replaceChildren();
  const s = game.settings;

  const head = el('div', 'board-head');
  const titleBox = el('div', 'board-title');
  titleBox.append(el('h2', '', 'お題'));
  // 残りの候補数はプレイ中は隠し、終わってからの振り返りでだけ見せる
  if (reveal) titleBox.append(el('p', 'cand', '振り返り：各コール後に残っていた答えの候補数'));
  head.append(titleBox, codeRow(game.secret, { hidden: !reveal }));
  container.append(head);

  const list = el('ol', 'history');
  game.guesses.forEach((g, r) => {
    const li = el('li', `p${g.player}`);
    li.append(el('span', 'num', r + 1), el('span', 'who', game.names[g.player]));
    li.append(codeRow(g.code, { size: 'sm' }), pips(g.hit, g.blow, s.length));
    const txt = el('span', 'hb-text');
    txt.innerHTML = `<b>${g.hit}</b>H <b>${g.blow}</b>B`;
    li.append(txt);
    if (reveal) {
      const n = app.candidates[r + 1];
      li.append(el('span', `left ${n <= 3 ? 'danger' : ''}`, g.hit === s.length ? '正解' : `のこり${n}`));
    }
    if (g.hit === s.length) li.classList.add('solved');
    if (r === game.guesses.length - 1 && !reveal) li.classList.add('latest');
    list.append(li);
  });
  if (game.phase === 'playing') {
    const li = el('li', `blank p${game.current}`);
    li.append(el('span', 'num', game.guesses.length + 1), el('span', 'who', game.names[game.current]));
    li.append(codeRow(Array(s.length).fill(null), { size: 'sm' }));
    list.append(li);
  }
  if (!game.guesses.length && game.phase === 'playing') {
    list.prepend(el('li', 'empty-note', 'まだコールはありません。最初のコールで様子を見よう！'));
  }
  container.append(list);
}

function renderScorebar() {
  const g = app.game;
  const bar = $('scorebar');
  bar.replaceChildren();
  for (const i of [g.starter, 1 - g.starter]) {
    const chip = el('div', `player-chip p${i} ${g.phase === 'playing' && g.current === i ? 'turn' : ''}`);
    chip.append(el('span', 'chip-name', g.names[i]), el('span', 'chip-tag', i === g.starter ? '先攻' : '後攻'));
    const max = g.settings.maxTurns;
    chip.append(el('span', 'chip-left', max ? `残り ${max - callsBy(g, i)} 回` : `${callsBy(g, i)} 回コール`));
    bar.append(chip);
  }
}

function renderGame() {
  const g = app.game;
  const cur = g.current;
  const name = g.names[cur];
  renderScorebar();
  renderBoard($('board'), g);

  const status = $('status');
  status.className = `status p${cur}`;
  status.textContent = `${name}さんの番です`;

  $('guess-panel').className = `card guess-panel p${cur}`;
  $('guess-title').textContent = `${name}さんのコール`;
  const max = g.settings.maxTurns;
  const n = callsBy(g, cur) + 1;
  $('round-label').textContent = max ? `${n} / ${max} 回目` : `${n} 回目`;
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
  const who = g.names[g.current];
  const res = makeGuess(g, code);
  app.candidates.push(res.solved ? 1 : countCandidates(g));
  toast(res.solved ? `${who}さん、全部ヒット！` : `${who}さん：${res.hit}ヒット ${res.blow}ブロー`, res.solved);
  if (g.phase === 'finished') {
    renderScorebar();
    renderBoard($('board'), g);
    finishMatch();
  } else {
    prepareTurn();
    // 最新のコールと入力欄が見えるように
    $('guess-panel').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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

// ---- 4. 結果画面 ----
function finishMatch() {
  const g = app.game;
  const { winner } = g.result;
  if (winner === null) app.wins[2]++;
  else app.wins[winner]++;

  $('result-card').className = `card result ${winner === null ? 'draw' : `p${winner}`}`;
  if (winner === null) {
    $('result-badge').textContent = '🤝';
    $('result-title').textContent = '引き分け！';
    $('result-text').textContent = 'コール回数を使い切りました。2人とも当てられず…';
  } else {
    $('result-badge').textContent = '🏆';
    $('result-title').textContent = `${g.names[winner]}さんの勝ち！`;
    const loser = g.names[1 - winner];
    const prev = g.guesses[g.guesses.length - 2];
    const helped = prev && prev.player === 1 - winner && app.candidates[g.guesses.length - 1] <= 3;
    $('result-text').textContent = helped
      ? `${loser}さんのコールで候補がしぼれたところを、すかさず当てました！`
      : `全体の${g.guesses.length}コール目で、お題を当てました。`;
  }
  $('result-secret').replaceChildren(codeRow(g.secret, { size: 'lg' }));
  $('total').textContent = `通算成績　${app.names[0]} ${app.wins[0]}勝 ／ ${app.names[1]} ${app.wins[1]}勝 ／ 引き分け ${app.wins[2]}`;
  renderBoard($('result-board'), g, { reveal: true });
  setTimeout(() => show('screen-result'), 700);
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
  let t = document.querySelector('.toast');
  if (!t) {
    t = el('div', 'toast');
    t.setAttribute('role', 'status');
    document.body.append(t);
  }
  t.textContent = text;
  t.classList.toggle('big', big);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

// ---- あそびかた ----
$('btn-rules').addEventListener('click', () => $('rules').showModal());

// ---- 起動 ----
const prefs = loadPrefs();
if (Array.isArray(prefs.names)) app.names = prefs.names.slice(0, 2);
if (prefs.settings) app.settings = normalizeSettings(prefs.settings);
fillSetup();
show('screen-setup');
