const SESSIONS = ["intro", "lt"];
const SESSION_LABEL = { intro: "コミュニティ紹介（午前）", lt: "ライトニングトーク（午後）" };
const MAX_DRAWER_LENGTH = 40;
// 検索エンジンにインデックスさせない（静的ファイルは public/_headers で同じヘッダーを付ける）
const NOINDEX = { "x-robots-tag": "noindex, nofollow" };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/state" && request.method === "GET") {
        return json(await getState(env.DB));
      }
      if (url.pathname === "/api/draw" && request.method === "POST") {
        return await handleDraw(request, env.DB);
      }
      const share = url.pathname.match(/^\/s\/(intro|lt)\/(\d+)\/?$/);
      if (share && (request.method === "GET" || request.method === "HEAD")) {
        return await sharePage(env.DB, url, share[1], Number(share[2]));
      }
      if (url.pathname.startsWith("/api/")) return json({ error: "not found" }, 404);
      return await withAbsoluteOgp(await env.ASSETS.fetch(request), url);
    } catch (err) {
      console.error(err);
      return json({ error: "サーバーエラーが発生しました" }, 500);
    }
  },
};

async function getState(db) {
  const [communities, draws] = await db.batch([
    db.prepare("SELECT id, name, in_lt FROM communities ORDER BY id"),
    db.prepare(
      `SELECT d.session, d.community_id, c.name AS community, d.slot, d.drawer, d.drawn_at
         FROM draws d JOIN communities c ON c.id = d.community_id
        ORDER BY d.drawn_at, d.id`,
    ),
  ]);
  return { communities: communities.results, draws: draws.results };
}

async function handleDraw(request, db) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "リクエストの形式が不正です" }, 400);
  }

  const session = body.session;
  const communityId = Number(body.communityId);
  const code = String(body.code ?? "").trim().toUpperCase();
  const drawer = String(body.drawer ?? "").trim();

  if (!SESSIONS.includes(session)) return json({ error: "セッションを選択してください" }, 400);
  if (!Number.isInteger(communityId)) return json({ error: "コミュニティを選択してください" }, 400);
  if (!drawer) return json({ error: "くじを引く人の名前を入力してください" }, 400);
  if (drawer.length > MAX_DRAWER_LENGTH) {
    return json({ error: `名前は${MAX_DRAWER_LENGTH}文字以内で入力してください` }, 400);
  }

  const community = await db
    .prepare("SELECT id, name, code_hash, in_lt FROM communities WHERE id = ?")
    .bind(communityId)
    .first();
  if (!community || community.code_hash !== (await sha256(code))) {
    return json({ error: "コミュニティまたは合言葉が正しくありません" }, 403);
  }

  if (session === "lt" && !community.in_lt) {
    return json({ error: "このコミュニティはライトニングトークに参加しません" }, 403);
  }

  // 枠の数 = そのセッションに参加するコミュニティの数（午前は全コミュニティ、午後は LT 参加分のみ）
  const total = (
    await db
      .prepare(`SELECT COUNT(*) AS n FROM communities${session === "lt" ? " WHERE in_lt = 1" : ""}`)
      .first()
  ).n;

  // 同時に引かれた場合は UNIQUE(session, slot) 違反になるので、空き枠を取り直して再試行する
  for (let attempt = 0; attempt < 20; attempt++) {
    const existing = await findDraw(db, session, communityId);
    if (existing) {
      return json({ error: "このコミュニティは既にくじを引いています", draw: existing }, 409);
    }

    const taken = new Set(
      (await db.prepare("SELECT slot FROM draws WHERE session = ?").bind(session).all()).results.map(
        (r) => r.slot,
      ),
    );
    const free = [];
    for (let s = 1; s <= total; s++) if (!taken.has(s)) free.push(s);
    if (free.length === 0) return json({ error: "空いている枠がありません" }, 409);

    const slot = free[randomIndex(free.length)];
    try {
      await db
        .prepare(
          "INSERT INTO draws (session, community_id, slot, drawer, drawn_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(session, communityId, slot, drawer, new Date().toISOString())
        .run();
    } catch (err) {
      if (String(err).includes("UNIQUE")) continue;
      throw err;
    }
    return json({ draw: await findDraw(db, session, communityId) });
  }
  return json({ error: "混み合っています。もう一度お試しください" }, 503);
}

// シェア用ページ。実際に引いた結果がある場合だけ、その結果のカード画像を OGP に設定する
// （URL を書き換えても、引いていない結果の画像は出せない）
async function sharePage(db, url, session, communityId) {
  const draw = await findDraw(db, session, communityId);
  let title = "テック無尽 発表順くじ引き";
  let description = "コミュニティ紹介（午前）とライトニングトーク（午後）の発表順をくじ引きで決めています。";
  let image = "/og/default.jpg";
  if (draw) {
    const total = (
      await db
        .prepare(`SELECT COUNT(*) AS n FROM communities${session === "lt" ? " WHERE in_lt = 1" : ""}`)
        .first()
    ).n;
    const badge = draw.slot === 1 ? "トップバッター！" : draw.slot === total ? "大トリ！" : "";
    title = `${draw.community} は「${SESSION_LABEL[session]}」で ${draw.slot} 番目に決定！${badge && ` ${badge}`}`;
    description = `テック無尽の発表順くじ引きの結果です（${draw.slot} / ${total}）。`;
    image = `/og/${session}-${communityId}-${draw.slot}.jpg`;
  }
  const abs = (path) => new URL(path, url.origin).href;
  const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="テック無尽 発表順くじ引き">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url.href)}">
<meta property="og:image" content="${esc(abs(image))}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="/common.css">
<style>
  main { max-width: 760px; text-align: center; }
  img { width: 100%; height: auto; border-radius: 12px; display: block; margin: 0 0 20px; }
  .links { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; font-size: .9rem; }
</style>
</head>
<body>
<main>
  <h1>${esc(title)}</h1>
  <p class="lead">${esc(description)}</p>
  <img src="${esc(image)}" alt="${esc(title)}" width="1200" height="630">
  <p><a class="cta" href="https://techmujin.jp" target="_blank" rel="noopener">テック無尽 2026 について見る →</a></p>
  <p class="links"><a href="/results.html">途中結果を見る</a><a href="/">くじ引きページへ</a></p>
</main>
<footer class="site-footer">
  <a href="https://techmujin.jp" target="_blank" rel="noopener">テック無尽 2026 公式サイト</a>
  <span>山梨ITコミュニティ合同イベント</span>
  <a class="repo" href="https://github.com/techmujin/techmujin-orderpicker" target="_blank" rel="noopener"><svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>ソースコード</a>
</footer>
</body>
</html>`;
  return new Response(html, {
    headers: {
      ...NOINDEX,
      "content-type": "text/html; charset=utf-8",
      // 引いた結果は変わらないので少しキャッシュする。未抽選の間は結果が変わるのでキャッシュしない
      "cache-control": draw ? "public, max-age=300" : "no-store",
    },
  });
}

// X などは og:image に絶対 URL を求めるため、静的 HTML の相対パスをリクエストのオリジンで補う
function withAbsoluteOgp(response, url) {
  if (!response.ok || !(response.headers.get("content-type") || "").includes("text/html")) return response;
  return new HTMLRewriter()
    .on('meta[property="og:image"]', {
      element(el) {
        el.setAttribute("content", new URL(el.getAttribute("content") || "/og/default.jpg", url.origin).href);
      },
    })
    .on('meta[property="og:url"]', {
      element(el) {
        el.setAttribute("content", url.href);
      },
    })
    .transform(response);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function findDraw(db, session, communityId) {
  return db
    .prepare(
      `SELECT d.session, d.community_id, c.name AS community, d.slot, d.drawer, d.drawn_at
         FROM draws d JOIN communities c ON c.id = d.community_id
        WHERE d.session = ? AND d.community_id = ?`,
    )
    .bind(session, communityId)
    .first();
}

// 偏りのない一様乱数（rejection sampling）
function randomIndex(n) {
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return buf[0] % n;
}

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...NOINDEX, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
