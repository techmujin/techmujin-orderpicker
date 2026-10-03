const SESSIONS = ["intro", "lt"];
const MAX_DRAWER_LENGTH = 40;

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
      return json({ error: "not found" }, 404);
    } catch (err) {
      console.error(err);
      return json({ error: "サーバーエラーが発生しました" }, 500);
    }
  },
};

async function getState(db) {
  const [communities, draws] = await db.batch([
    db.prepare("SELECT id, name FROM communities ORDER BY id"),
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
    .prepare("SELECT id, name, code_hash FROM communities WHERE id = ?")
    .bind(communityId)
    .first();
  if (!community || community.code_hash !== (await sha256(code))) {
    return json({ error: "コミュニティまたは合言葉が正しくありません" }, 403);
  }

  const total = (await db.prepare("SELECT COUNT(*) AS n FROM communities").first()).n;

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
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
