// GitHub Actions 자동 실행 시 Gist에서 현재 보유 종목 읽기
// stdout에 쉼표 구분 티커 출력 (없으면 빈 문자열)
const token = process.env.GH_TOKEN;
if (!token) { process.stdout.write(""); process.exit(0); }

async function ghReq(path) {
  const r = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!r.ok) return null;
  return r.json();
}

// description으로 Gist 검색
const list = await ghReq("/gists?per_page=100");
const gist = list?.find(g => g.description === "wz-stock app data");
if (!gist) { process.stdout.write(""); process.exit(0); }

const data = await ghReq(`/gists/${gist.id}`);
const raw = data?.files?.["wz_stock.json"]?.content;
if (!raw) { process.stdout.write(""); process.exit(0); }

const content = JSON.parse(raw);
const tickers = (content.positions || []).map(p => p.ticker).filter(Boolean);
process.stdout.write(tickers.join(","));
