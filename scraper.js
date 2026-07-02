/**
 * 汇通网国际贵金属行情爬虫（单次执行版）
 * 输出价格含两种单位：USD/盎司 (国际标准) + CNY/克
 *
 * 环境变量:
 *   HTTPS_PROXY       HTTP/HTTPS 代理地址（可选）
 *
 * 可选参数:
 *   --output <path>   同时写入 CSV 文件
 *   --pretty          美化 JSON 输出
 *
 * 使用示例:
 *   node scraper.js
 *   node scraper.js --pretty
 *   node scraper.js --output prices.csv
 *   set HTTPS_PROXY=http://127.0.0.1:1080 && node scraper.js
 */

const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

const OZ_TO_GRAM = 31.1034768;

const CONFIG = {
  metalsUrl: "https://api-q.fx678img.com/exchangeSymbol.php?exchName=WGJS",
  forexUrl:  "https://api-q.fx678img.com/exchangeSymbol.php?exchName=WH",
  symbols: {
    XAU: "现货黄金",
    XPD: "现货钯金",
    XAG: "现货白银",
    XAP: "现货铂金"
  },
  retryCount: 3,
  retryDelay: 5000,
  timeout: 15000,
};

// ====== 代理解析 ======
function getProxyUrl() {
  const u = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;
  return u || null;
}

// ====== HTTP 请求 ======
function httpsRequest(targetUrl, proxyUrl) {
  return new Promise((resolve, reject) => {
    const target = new URL(targetUrl);
    function handleResponse(res) {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        try { resolve(JSON.parse(d)); }
        catch (e) { reject(new Error("JSON parse: " + e.message + " (len=" + d.length + ")")); }
      });
    }
    function direct() {
      const req = https.get(targetUrl, {
        timeout: CONFIG.timeout,
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", Accept: "application/json, text/plain, */*", Referer: "https://quote.fx678.com/exchange/WGJS" },
      }, handleResponse);
      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
      req.end();
    }
    if (!proxyUrl) { direct(); return; }
    const proxy = new URL(proxyUrl);
    if (proxy.protocol.startsWith("socks")) { direct(); return; }
    const pport = parseInt(proxy.port) || 8080;
    const tport = target.port || 443;
    const pr = http.request({
      hostname: proxy.hostname, port: pport, method: "CONNECT",
      path: target.hostname + ":" + tport,
      headers: { Host: target.hostname + ":" + tport, "User-Agent": "Mozilla/5.0", "Proxy-Connection": "Keep-Alive" },
      timeout: CONFIG.timeout,
    });
    if (proxy.username && proxy.password) {
      const auth = Buffer.from(decodeURIComponent(proxy.username) + ":" + decodeURIComponent(proxy.password)).toString("base64");
      pr.setHeader("Proxy-Authorization", "Basic " + auth);
    }
    pr.on("connect", (res, socket) => {
      if (res.statusCode !== 200) return reject(new Error("CONNECT: " + res.statusCode));
      const req = https.request({
        hostname: target.hostname, path: target.pathname + target.search,
        method: "GET", socket, agent: false, timeout: CONFIG.timeout,
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", Accept: "application/json, text/plain, */*", Referer: "https://quote.fx678.com/exchange/WGJS" },
      }, handleResponse);
      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
      req.end();
    });
    pr.on("error", reject);
    pr.on("timeout", () => { pr.destroy(); reject(new Error("proxy timeout")); });
    pr.end();
  });
}

// ====== 获取 USD/CNY 汇率 ======
async function fetchExchangeRate(proxyUrl) {
  const data = await httpsRequest(CONFIG.forexUrl, proxyUrl);
  const item = data.find(d => d.i === "USDCNY") || data.find(d => d.i === "USDCNH");
  if (!item) throw new Error("无法获取汇率");
  return parseFloat(item.c);
}

// ====== 数据提取（含单位转换） ======
function extractPrices(data, usdcny) {
  const keys = Object.keys(CONFIG.symbols);
  return data
    .filter((d) => keys.includes(d.i))
    .map((d) => {
      const priceUsd = parseFloat(d.c);
      const prevUsd = parseFloat(d.p);
      const changeUsd = Math.round((priceUsd - prevUsd) * 100) / 100;
      const changePct = prevUsd ? Math.round((changeUsd / prevUsd) * 10000) / 100 : 0;

      // USD/oz → CNY/克
      const perGramUsd = priceUsd / OZ_TO_GRAM;
      const priceCny = Math.round(perGramUsd * usdcny * 100) / 100;
      const prevCny = Math.round((prevUsd / OZ_TO_GRAM * usdcny) * 100) / 100;
      const changeCny = Math.round((priceCny - prevCny) * 100) / 100;
      const changeCnyPct = prevCny ? Math.round((changeCny / prevCny) * 10000) / 100 : 0;

      return {
        code: d.i,
        name: d.name || CONFIG.symbols[d.i],
        // USD/盎司
        priceUsd: priceUsd,
        changeUsd: changeUsd,
        changeUsdPercent: changePct,
        prevCloseUsd: prevUsd,
        // CNY/克
        priceCny: priceCny,
        changeCny: changeCny,
        changeCnyPercent: changeCnyPct,
        prevCloseCny: prevCny,
        // 汇率参考
        usdCnyRate: usdcny,
        // 时间
        timestamp: parseInt(d.t),
        updateTime: new Date(parseInt(d.t) * 1000).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }),
      };
    });
}

// ====== CSV 输出 ======
function appendCsv(prices, filepath) {
  return new Promise((resolve) => {
    const isNew = !fs.existsSync(filepath);
    const s = fs.createWriteStream(filepath, { flags: "a" });
    if (isNew) s.write("时间,品种代码,品种名称,最新价(USD/盎司),涨跌(USD),涨跌幅(%),最新价(CNY/克),涨跌(CNY),涨跌幅(%),汇率(USDCNY)\n");
    const now = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
    for (const p of prices) {
      s.write(now + "," + p.code + "," + p.name + "," + p.priceUsd + "," + p.changeUsd + "," + p.changeUsdPercent + "," + p.priceCny + "," + p.changeCny + "," + p.changeCnyPercent + "," + p.usdCnyRate + "\n");
    }
    s.end(resolve);
  });
}

// ====== 主函数 ======
async function main() {
  const pretty = process.argv.includes("--pretty");
  const outIdx = process.argv.indexOf("--output");
  const outputFile = outIdx >= 0 ? process.argv[outIdx + 1] : null;
  const proxyUrl = getProxyUrl();
  let lastErr;

  for (let attempt = 1; attempt <= CONFIG.retryCount; attempt++) {
    try {
      // 并行请求金属价格和汇率
      const [metalsData, usdcny] = await Promise.all([
        httpsRequest(CONFIG.metalsUrl, proxyUrl),
        fetchExchangeRate(proxyUrl),
      ]);

      const prices = extractPrices(metalsData, usdcny);
      if (!prices.length) throw new Error("未找到目标品种");

      if (outputFile) {
        const dir = path.dirname(outputFile);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        await appendCsv(prices, outputFile);
      }

      const result = {
        success: true,
        fetchedAt: new Date().toISOString(),
        proxy: !!proxyUrl,
        usdCnyRate: usdcny,
        items: prices,
      };
      process.stdout.write(pretty ? JSON.stringify(result, null, 2) + "\n" : JSON.stringify(result));
      process.exit(0);

    } catch (e) {
      lastErr = e;
      if (attempt < CONFIG.retryCount) {
        await new Promise((r) => setTimeout(r, CONFIG.retryDelay));
      }
    }
  }

  const errorResult = { success: false, error: lastErr.message };
  process.stdout.write(JSON.stringify(errorResult));
  process.exit(1);
}

main();
