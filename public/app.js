const $ = (sel) => document.querySelector(sel);
const show = (sel) => $(sel).classList.remove("hidden");
const hide = (sel) => $(sel).classList.add("hidden");
function showOnly(id) {
  [
    "login-screen",
    "signup-screen",
    "lobby-screen",
    "shop-screen",
    "mypage-screen",
    "queue-screen",
    "battle-screen",
    "result-screen"
  ].forEach((screen) => {
    const el = document.getElementById(screen);
    if (!el) return;

    if (screen === id) {
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  });
}

let token = localStorage.getItem("world_token") || null;
let currentUser = null;
let gameData = { skills: [], items: [] };
let socket = null;
let currentMatchId = null;
let lastLogLength = 0;

const FALLBACK_ICON =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><rect width='40' height='40' fill='#333'/><text x='50%' y='55%' font-size='18' fill='#ffd24c' text-anchor='middle'>?</text></svg>`);
function assetPath(rel) { return rel ? "./assets/" + rel : FALLBACK_ICON; }

// 프로필 사진을 서버에 파일로 올리지 않고, 브라우저에서 작은 base64 이미지로 축소해서 보낸다.
// (서버에 파일을 저장하면 무료 호스팅 재배포시 사라지는 문제가 있어 DB 컬럼에 직접 저장하는 방식을 씀)
function resizeImageToBase64(file, maxSize = 96) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > h) { if (w > maxSize) { h = Math.round(h * (maxSize / w)); w = maxSize; } }
        else { if (h > maxSize) { w = Math.round(w * (maxSize / h)); h = maxSize; } }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function allActivesOfItem(item) {
  const list = [];
  if (item.active) list.push(item.active);
  if (Array.isArray(item.activeExtra)) list.push(...item.activeExtra);
  return list;
}
function getSkillDefinition(id) {
  const s = gameData.skills.find((x) => x.id === id);
  if (s) return s;
  for (const item of gameData.items) {
    const found = allActivesOfItem(item).find((a) => a.id === id);
    if (found) return found;
  }
  return null;
}
function usableSkillIds(skills, items) {
  const ids = new Set(skills);
  items.forEach((itemId) => {
    const item = gameData.items.find((i) => i.id === itemId);
    if (item) allActivesOfItem(item).forEach((a) => ids.add(a.id));
  });
  return [...ids];
}
function describeCondition(c) {
  if (c.type === "cooldown") return `쿨타임 ${c.ms / 1000}초`;
  if (c.type === "hpFull") return "HP 최대일 때만";
  if (c.type === "hpBelow") return `HP ${c.percent}% 이하일 때만`;
  if (c.type === "hpAtLeast") return `HP ${c.percent}% 이상일 때만`;
  if (c.type === "rankAtLeast") return `계급 ${c.rank} 이상`;
  if (c.type === "usesPerMatch") return `전투당 ${c.max}회 제한`;
  return "";
}

// ===================== BGM =====================
const bgmLobby = document.getElementById("bgm-lobby");
const bgmBattle = document.getElementById("bgm-battle");
const bgmVictory = document.getElementById("bgm-victory");
let muted = false;
function setupGapLoop(el) {
  el.addEventListener("ended", () => {
    if (el.dataset.active === "1") setTimeout(() => { if (el.dataset.active === "1") el.play().catch(() => {}); }, 3000);
  });
}
setupGapLoop(bgmBattle); setupGapLoop(bgmVictory);
function stopAllBgm() { [bgmLobby, bgmBattle, bgmVictory].forEach((a) => { a.dataset.active = "0"; a.pause(); a.currentTime = 0; }); }
function playLobbyBgm() { stopAllBgm(); if (muted) return; bgmLobby.dataset.active = "1"; bgmLobby.play().catch(() => {}); }
function playBattleBgm() { stopAllBgm(); if (muted) return; bgmBattle.dataset.active = "1"; bgmBattle.play().catch(() => {}); }
function playVictoryBgm() { stopAllBgm(); if (muted) return; bgmVictory.dataset.active = "1"; bgmVictory.play().catch(() => {}); }
$("#mute-btn").addEventListener("click", (e) => {
  muted = !muted;
  e.target.textContent = muted ? "🔇 BGM" : "🔊 BGM";
  if (muted) [bgmLobby, bgmBattle, bgmVictory].forEach((a) => a.pause());
  else if (!$("#lobby-screen").classList.contains("hidden")) playLobbyBgm();
  else if (!$("#battle-screen").classList.contains("hidden")) playBattleBgm();
});

// ===================== 인증 =====================
async function loadGameData() {
  const res = await fetch("/api/gamedata");
  gameData = await res.json();
}

$("#signup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const avatarFile = form.get("avatar");
  let avatarBase64 = null;
  if (avatarFile && avatarFile.size > 0) {
    try { avatarBase64 = await resizeImageToBase64(avatarFile); }
    catch (err) {
    return ($("#signup-message").textContent =
        "프로필 사진를 처리할 수 없습니다.");
    }
  const res = await fetch("/api/signup", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: form.get("username"), password: form.get("password"), avatarBase64 }),
  });
  const data = await res.json();
 if (!res.ok)
   return ($("#signup-message").textContent = data.error);
 onAuthSuccess(data);
});

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const res = await fetch("/api/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
  });
  const data = await res.json();
  if (!res.ok)
    return ($("#login-message").textContent = data.error);
  onAuthSuccess(data);
});

function onAuthSuccess(data) {
  token = data.token; currentUser = data.user;
  localStorage.setItem("world_token", token);

  const loginMsg = $("#login-message");
  if (loginMsg) loginMsg.textContent = "";

  const signupMsg = $("#signup-message");
  if (signupMsg) signupMsg.textContent = "";

  showOnly("lobby-screen");
  renderProfile();
  renderMyPage();

  playLobbyBgm();
  connectSocket();
  
$("#btn-logout").addEventListener("click", () => {
  localStorage.removeItem("world_token");
  if (socket) socket.disconnect();
  location.reload();
});

$("#go-signup").onclick = (e) => {
    e.preventDefault();
    showOnly("signup-screen");
};

$("#go-login").onclick = (e) => {
    e.preventDefault();
    showOnly("login-screen");
};

// ===================== 프로필 / 로비 =====================
function iconRow(ids, pool) {
  return ids.map((id) => {
    const def = pool.find((p) => p.id === id);
    const src = def ? assetPath(def.icon) : FALLBACK_ICON;
    return `<img class="inv-icon" src="${src}" title="${def ? def.name : id}" onerror="this.src='${FALLBACK_ICON}'" />`;
  }).join("");
}

function renderProfile() {
  const u = currentUser;
  $("#profile-card").innerHTML = `
    <img src="${u.avatarBase64 || FALLBACK_ICON}" onerror="this.src='${FALLBACK_ICON}'" />
    <div style="flex:1">
      <div><strong>${u.username}</strong> <span class="rank-badge">${u.rank}</span></div>
      <div>레벨 ${u.level} · 💰 ${u.money}G</div>
      <div class="inventory-row">${iconRow(u.skills, gameData.skills)}</div>
      <div class="inventory-row">${iconRow(u.items, gameData.items)}</div>
    </div>`;
}

$("#btn-rename").addEventListener("click", async () => {
  const newUsername = $("#rename-input").value.trim();
  if (!newUsername) return;
  const res = await fetch("/api/account/rename", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ newUsername }),
  });
  const data = await res.json();
  if (!res.ok) return alert(data.error);
  currentUser = data.user;
  renderProfile();
  $("#rename-input").value = "";
  alert(`아이디가 '${currentUser.username}'(으)로 변경되었습니다.`);
});

$("#btn-gacha").addEventListener("click", async () => {
  const res = await fetch("/api/gacha/roll", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok) return ($("#gacha-result").textContent = data.error);
  currentUser = data.user;
  renderProfile();
  $("#gacha-result").textContent = data.duplicated
    ? `[${data.result.name}] 획득! (이미 보유중이라 중복)`
    : `🎉 [${data.result.name}] (${data.result.rankTier}급) 획득!`;
});

$("#btn-report").addEventListener("click", async () => {
  const targetUsername = $("#report-target").value.trim();
  const reason = $("#report-reason").value.trim();
  if (!targetUsername || !reason) return alert("신고 대상과 사유를 입력하세요.");
  const res = await fetch("/api/report", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ targetUsername, reason }),
  });
  const data = await res.json();
  alert(res.ok ? "신고가 접수되었습니다." : data.error);
  if (res.ok) { $("#report-target").value = ""; $("#report-reason").value = ""; }
});

// ---- 랭킹 ----
$("#btn-ranking").addEventListener("click", async () => {
  const panel = $("#ranking-panel");
  if (!panel.classList.contains("hidden")) return hide("#ranking-panel");
  const res = await fetch("/api/leaderboard", { headers: { Authorization: `Bearer ${token}` } });
  const rows = await res.json();
  panel.innerHTML = "<h3>🏆 레벨 랭킹 TOP 20</h3>" + rows.map((u, i) =>
    `<div>${i + 1}위 — <strong>${u.username}</strong> <span class="rank-badge">${u.rank}</span> Lv.${u.level}</div>`
  ).join("");
  show("#ranking-panel");
});

// ---- 판매 ----
function getSellPrice(kind, id) {
  const pool = kind === "item" ? gameData.items : gameData.skills;
  const def = pool.find((d) => d.id === id);
  if (!def) return 0;
  if (typeof def.sellPrice === "number") return def.sellPrice;
  return (gameData.sellPriceByRank && gameData.sellPriceByRank[def.rankTier]) || 0;
}

function renderSellPanel() {
  const u = currentUser;
  const rowsFor = (kind, ids, pool) => ids.map((id) => {
    const def = pool.find((d) => d.id === id);
    const price = getSellPrice(kind, id);
    return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
      <img class="inv-icon" src="${def ? assetPath(def.icon) : FALLBACK_ICON}" onerror="this.src='${FALLBACK_ICON}'" />
      <span style="flex:1">${def ? def.name : id} <small>(${price}G)</small></span>
      <button class="sell-btn" data-kind="${kind}" data-id="${id}">판매</button>
    </div>`;
  }).join("") || "<div>없음</div>";

  $("#sell-panel").innerHTML = `
    <h3>💰 판매하기</h3>
    <h4>스킬</h4>${rowsFor("skill", u.skills, gameData.skills)}
    <h4>아이템</h4>${rowsFor("item", u.items, gameData.items)}`;

  $("#sell-panel").querySelectorAll(".sell-btn").forEach((btn) => {
    btn.onclick = async () => {
      const kind = btn.dataset.kind, id = btn.dataset.id;
      const price = getSellPrice(kind, id);
      if (!confirm(`${price}G에 판매하시겠습니까?`)) return;
      const res = await fetch("/api/sell", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ kind, id }),
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error);
      currentUser = data.user;
      renderProfile();
      renderSellPanel();
    };
  });
}

$("#btn-sell-panel").addEventListener("click", () => {
  const panel = $("#sell-panel");
  if (!panel.classList.contains("hidden")) return hide("#sell-panel");
  renderSellPanel();
  show("#sell-panel");
});

// ===================== 소켓 / 매칭 / 전투 =====================
function connectSocket() {
  socket = io();
  socket.emit("auth", token);

  socket.on("account:deleted", () => { alert("이 계정은 관리자에 의해 삭제되었습니다."); localStorage.removeItem("world_token"); location.reload(); });
  socket.on("queue:waiting", () => { hide("#lobby-screen"); show("#queue-screen"); });
  socket.on("match:start", (state) => { currentMatchId = state.id; lastLogLength = 0; hide("#queue-screen"); showOnly("battle-screen"); playBattleBgm(); hide("#disconnect-banner"); renderBattle(state); });
  socket.on("match:update", (state) => { hide("#disconnect-banner"); renderBattle(state); });
  socket.on("opponent:disconnected", ({ graceMs }) => {
    $("#disconnect-banner").textContent = `상대의 접속이 끊겼습니다. ${Math.round(graceMs / 1000)}초 안에 재접속하지 않으면 자동으로 기권패 처리됩니다.`;
    show("#disconnect-banner");
  });
  socket.on("opponent:reconnected", () => hide("#disconnect-banner"));
  socket.on("skill:fail", (payload) => flashSkillFail(payload));
  socket.on("error:msg", (msg) => console.warn(msg));
  socket.on("match:end", (result) => {
    currentMatchId = null;
    showOnly("result-screen");
    const iWon = result.winnerId === currentUser.id;
    currentUser = iWon ? result.winner : result.loser;
    if (iWon) playVictoryBgm(); else stopAllBgm();
    $("#result-title").textContent = iWon ? "🏆 승리!" : "💀 패배...";
    let detail = iWon ? "상대의 아이템, 스킬, 돈을 모두 빼앗았습니다." : "보유하던 아이템, 스킬, 돈을 모두 잃었습니다.";
    if (result.forfeitedByTimeout) detail += " (상대의 접속이 끊겨 자동 기권 처리됨)";
    if (iWon && result.rankedUp && result.newRank) detail += `\n🎉 계급이 [${result.newRank}]로 승급했습니다!`;
    $("#result-detail").textContent = detail;
  });
}

$("#btn-queue").addEventListener("click", () => socket.emit("queue:join"));
$("#btn-cancel-queue").addEventListener("click", () => { socket.emit("queue:leave"); showOnly("lobby-screen"); playLobbyBgm(); });
$("#btn-surrender").addEventListener("click", () => { if (confirm("정말로 기권하시겠습니까? 보유한 아이템/스킬/돈을 모두 잃습니다.")) socket.emit("surrender"); });
$("#btn-back-to-lobby").addEventListener("click", () => { renderProfile(); showOnly("lobby-screen"); playLobbyBgm(); });

function renderBattle(state) {
  const me = state.players[currentUser.id];
  const oppId = Object.keys(state.players).find((id) => id !== currentUser.id);
  const opp = state.players[oppId];
  if (!me || !opp) return;

  $("#battle-players").innerHTML = [{ p: me, label: "나" }, { p: opp, label: "상대" }].map(({ p, label }) => `
    <div class="player-panel">
      <div class="effect-layer" id="effect-layer-${p.userId}"></div>
      <strong>${label} (${p.username})${p.isGod ? " 👑THE GOD" : ""}</strong> <span class="rank-badge">${p.rank}</span>
      <div class="hp-bar-bg"><div class="hp-bar-fill" style="width:${(p.hp / p.maxHp) * 100}%"></div></div>
      <div>${p.hp} / ${p.maxHp} HP</div>
    </div>`).join("");

  const usable = usableSkillIds(me.skills, me.items);
  $("#skill-bar").innerHTML = usable.map((id) => {
    const def = getSkillDefinition(id);
    if (!def) return "";
    const condText = def.conditions.map(describeCondition).join(" · ");
    return `<button class="skill-btn" data-skill="${id}" title="${condText}">
      <img src="${assetPath(def.icon)}" onerror="this.src='${FALLBACK_ICON}'" />
      <span>${def.name}<br><small>${condText}</small></span></button>`;
  }).join("");
  $("#skill-bar").querySelectorAll(".skill-btn").forEach((btn) => { btn.onclick = () => socket.emit("skill:cast", btn.dataset.skill); });

  if (state.log.length > lastLogLength) {
    state.log.slice(lastLogLength).forEach((entry) => playCastEffect(entry));
    lastLogLength = state.log.length;
  }
  $("#battle-log").innerHTML = state.log
    .map((l) => `<div>${l.actor === currentUser.id ? "나" : "상대"}의 [${l.skillName}] → ${l.damage} 피해 (상대 HP ${l.targetHpAfter})</div>`)
    .reverse().join("");
}

function flashSkillFail(payload) {
  const btn = document.querySelector(`.skill-btn[data-skill="${payload.skillId}"]`);
  if (!btn) return;
  btn.style.background = "#ff6b6b"; btn.title = payload.reason;
  setTimeout(() => (btn.style.background = ""), 400);
}

function playCastEffect(logEntry) {
  const def = getSkillDefinition(logEntry.skillId);
  if (!def || !def.effect) return;
  const container = document.getElementById("effect-layer-" + logEntry.targetId);
  if (!container) return;
  if (def.effect.type === "spritesheet") playSpriteEffect(def.effect, container);
  else if (def.effect.type === "video") playVideoEffect(def.effect, container);
  if (def.effect.sound) playEffectSound(def.effect.sound);
}

// 영상에 소리가 있다면 같이 재생 (브라우저가 소리 자동재생을 막으면 무음으로라도 재생 시도)
function playVideoEffect(cfg, container) {
  const vid = document.createElement("video");
  vid.className = "effect-video";
  vid.src = assetPath(cfg.src);
  vid.muted = cfg.muted === true; // effect 설정에 muted:true를 넣지 않으면 기본적으로 소리 포함 재생
  vid.playsInline = true;
  vid.onended = () => vid.remove();
  vid.onerror = () => vid.remove();
  container.appendChild(vid);
  vid.play().catch(() => { vid.muted = true; vid.play().catch(() => {}); });
}

// spritesheet 이펙트에 별도 효과음 파일을 곁들이고 싶을 때, 혹은 video 이펙트에
// 영상 내장 소리와 별개로 추가 효과음을 더 얹고 싶을 때 사용
function playEffectSound(src) {
  const audio = new Audio(assetPath(src));
  audio.play().catch(() => {});
}
function playSpriteEffect(cfg, container) {
  const el = document.createElement("div");
  el.className = "effect-sprite";
  el.style.width = cfg.frameWidth + "px"; el.style.height = cfg.frameHeight + "px";
  el.style.backgroundImage = `url('${assetPath(cfg.src)}')`;
  container.appendChild(el);
  let frame = 0;
  const timer = setInterval(() => {
    el.style.backgroundPosition = `-${frame * cfg.frameWidth}px 0px`;
    frame++;
    if (frame >= cfg.frameCount) { clearInterval(timer); setTimeout(() => el.remove(), 50); }
  }, 1000 / (cfg.fps || 24));
}

// ===================== 자동 로그인 =====================
(async function init() {
  await loadGameData();
  if (token) {
    const res = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      const data = await res.json();
      currentUser = data.user;
      showOnly("lobby-screen");
      renderProfile();
      playLobbyBgm();
      connectSocket();
      return;
    }
    localStorage.removeItem("world_token"); token = null;
  }
  showOnly("login-screen");
})();
