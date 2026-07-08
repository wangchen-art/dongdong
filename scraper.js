/**
 * 水贝金价爬虫（单次执行版）
 * 从金价查询网获取国内贵金属实时行情（水贝大盘价）
 * 数据源: http://res.huangjinjiage.com.cn/panjia2.js
 *
 * 使用示例:
 *   node scraper.js
 *   node scraper.js --pretty
 *   node scraper.js --output prices.json
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const METAL_INDICES = {
  XAU: { start: 12, name: '黄金' },
  XAG: { start: 16, name: '白银' },
  XAP: { start: 20, name: '铂金' },
  XPD: { start: 24, name: '钯金' },
};

const CONFIG = {
  priceUrl: 'http://res.huangjinjiage.com.cn/panjia2.js',
  retryCount: 3,
  retryDelay: 3000,
  timeout: 10000,
};

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: CONFIG.timeout, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': '*/*', 'Referer': 'http://www.huangjinjiage.cn/quote/117716.html' } }, (res) => {
      let d = ''; res.on('data', (c) => d += c.toString()); res.on('end', () => resolve(d));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
  });
}

function parsePanjia2(raw) {
  const match = raw.match(/(?<=")([^"]+)(?=")/);
  if (!match) throw new Error('无法解析 panjia2 数据格式');
  const csvStr = match[1].replace(/^\[/, '').replace(/\]$/, '');
  const values = csvStr.split(',');
  const items = [];
  for (const [code, cfg] of Object.entries(METAL_INDICES)) {
    const s = cfg.start;
    items.push({ code, name: cfg.name, priceCny: parseFloat(values[s]) || 0, salesPriceCny: parseFloat(values[s + 1]) || 0, high: parseFloat(values[s + 2]) || 0, low: parseFloat(values[s + 3]) || 0 });
  }
  return items;
}

function writeJsonFile(items, fp) {
  const dir = path.dirname(fp);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = fp + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ success: true, fetchedAt: new Date().toISOString(), items }, null, 2), 'utf-8');
  fs.renameSync(tmp, fp);
}

async function main() {
  const pretty = process.argv.includes('--pretty');
  const outIdx = process.argv.indexOf('--output');
  const outputFile = outIdx >= 0 ? process.argv[outIdx + 1] : null;
  const url = CONFIG.priceUrl + '?t=' + Math.floor(Date.now() / 60000);
  for (let a = 1; a <= CONFIG.retryCount; a++) {
    try {
      const raw = await httpGet(url);
      const items = parsePanjia2(raw);
      if (!items.length) throw new Error('未解析到任何金属价格');
      if (outputFile) writeJsonFile(items, outputFile);
      const result = { success: true, fetchedAt: new Date().toISOString(), items };
      process.stdout.write(pretty ? JSON.stringify(result, null, 2) + '\n' : JSON.stringify(result));
      process.exit(0);
    } catch (e) { if (a < CONFIG.retryCount) await new Promise((r) => setTimeout(r, CONFIG.retryDelay)); else { process.stdout.write(JSON.stringify({ success: false, error: e.message })); process.exit(1); } }
  }
}
main();
