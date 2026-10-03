// index.html と results.html で共有する表示ロジック
const LABEL = { intro: "コミュニティ紹介（午前）", lt: "ライトニングトーク（午後）" };
const SHORT = { intro: "午前：コミュニティ紹介", lt: "午後：ライトニングトーク" };
const SESSIONS = ["intro", "lt"];
const $ = (id) => document.getElementById(id);
const fmt = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric",
  hour: "2-digit", minute: "2-digit", second: "2-digit" });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

async function fetchState() {
  const res = await fetch("/api/state", { cache: "no-store" });
  if (!res.ok) throw new Error(res.status);
  return res.json();
}

function bySlot(state, session) {
  return new Map(state.draws.filter((d) => d.session === session).map((d) => [d.slot, d]));
}

// そのセッションの枠数（午前は全コミュニティ、午後は LT 参加コミュニティのみ）
function slotCount(state, session) {
  return session === "lt" ? state.communities.filter((c) => c.in_lt).length : state.communities.length;
}

function progress(state, session) {
  return `${state.draws.filter((d) => d.session === session).length} / ${slotCount(state, session)} 確定`;
}

// 引いた人の名前は results.html でのみ表示する（showDrawer: true）

// 順番表（tbody の中身）。fresh は新しく増えた "session:community_id" の集合
function orderRowsHTML(state, session, { fresh = new Set(), showDrawer = false } = {}) {
  const map = bySlot(state, session);
  const rows = [];
  for (let s = 1; s <= slotCount(state, session); s++) {
    const d = map.get(s);
    rows.push(d
      ? `<tr class="${fresh.has(`${session}:${d.community_id}`) ? "fresh" : ""}"><td class="slot">${s}</td><td>${esc(d.community)}</td><td>${showDrawer ? `${esc(d.drawer)}<span class="sub">` : `<span class="nowrap">`}${fmt.format(new Date(d.drawn_at))}</span></td></tr>`
      : `<tr><td class="slot">${s}</td><td class="empty" colspan="2">未確定</td></tr>`);
  }
  return rows.join("");
}

function logRowsHTML(state, { showDrawer = false } = {}) {
  return [...state.draws].reverse().map((d) =>
    `<tr><td class="nowrap">${fmt.format(new Date(d.drawn_at))}</td><td>${esc(d.community)}${showDrawer ? `<span class="sub">${esc(d.drawer)}</span>` : ""}</td><td class="nowrap">${d.session === "intro" ? "紹介" : "LT"} <b>${d.slot} 番</b></td></tr>`
  ).join("") || `<tr><td colspan="3" class="empty">まだ誰も引いていません</td></tr>`;
}

// ダイアログ用のコンパクトな全体表。focus のセッションを強調し、highlight の枠をハイライトする
function boardHTML(state, { focus, highlight } = {}) {
  return SESSIONS.map((session) => {
    const map = bySlot(state, session);
    const items = [];
    for (let s = 1; s <= slotCount(state, session); s++) {
      const d = map.get(s);
      const hl = highlight && highlight.session === session && highlight.slot === s;
      items.push(d
        ? `<li class="${hl ? "hl" : ""}"><b>${s}</b><span>${esc(d.community)}</span></li>`
        : `<li class="open"><b>${s}</b><span>空き</span></li>`);
    }
    const dim = focus && focus !== session ? "dim" : "";
    return `<section class="${dim}"><h3>${SHORT[session]}<small>${progress(state, session)}</small></h3><ol>${items.join("")}</ol></section>`;
  }).join("");
}
