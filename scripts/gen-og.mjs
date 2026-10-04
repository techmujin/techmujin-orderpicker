// communities.json から、シェア用のカード画像（OGP 画像、JPEG）を全パターン生成して public/og/ に書き出す。
//   public/og/default.jpg               … サイト全体のカード
//   public/og/{session}-{id}-{slot}.jpg … 結果ごとのカード（紹介 13×13 + LT 10×10 通り）
// コミュニティ名や LT 参加を変えたら再生成すること（npm run deploy の前に自動で実行される）。
// イベントロゴは scripts/og/logo.svg（差し替える場合も同じ名前で置く）。
// ブラウザが無い場合は `npx playwright-core install chromium-headless-shell` で入れる。
import { readFileSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const SESSION_LABEL = { intro: "コミュニティ紹介（午前）", lt: "ライトニングトーク（午後）" };
const OUT_DIR = "public/og";

const communities = JSON.parse(readFileSync("communities.json", "utf8")).map((c, i) => ({ id: i + 1, ...c }));
const members = {
  intro: communities,
  lt: communities.filter((c) => c.lt),
};

const jobs = [{ file: "default.jpg", data: {
  kind: "default", communities: communities.length, introSlots: members.intro.length, ltSlots: members.lt.length,
} }];
for (const [session, list] of Object.entries(members)) {
  const total = list.length;
  for (const c of list) {
    for (let slot = 1; slot <= total; slot++) {
      const badge = slot === 1 ? "TOP BATTER" : slot === total ? "大トリ" : "";
      jobs.push({ file: `${session}-${c.id}-${slot}.jpg`, data: {
        kind: "result", session, sessionLabel: SESSION_LABEL[session], community: c.name, slot, total, badge,
      } });
    }
  }
}

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
const template = fileURLToPath(new URL("./og/card.html", import.meta.url));
await page.goto(pathToFileURL(template).href);
await page.evaluate(() => document.fonts.ready);
await page.evaluate((svg) => window.setLogo(svg), readFileSync(new URL("./og/logo.svg", import.meta.url), "utf8"));

for (const [i, { file, data }] of jobs.entries()) {
  await page.evaluate((d) => window.render(d), data);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${OUT_DIR}/${file}`, type: "jpeg", quality: 88 });
  if ((i + 1) % 50 === 0 || i + 1 === jobs.length) console.log(`${i + 1} / ${jobs.length}`);
}
await browser.close();
console.log(`${jobs.length} 枚のカード画像を ${OUT_DIR}/ に書き出しました。`);
