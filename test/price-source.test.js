const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { parsePanjia2 } = require('../scraper');
const { PriceCache } = require('../server');

// 取自 2026-10-30 的真实响应，保留后面的其他品种和缺失字段。
const raw = 'const panjia2 = "[1,838.83,841.83,865.04,835.88,11.105,11.205,11.813,11.065,309.4,310.9,321.6,306.7,209.6,211.1,216.9,207.2,36430,36437,--,--,838.83,612.34,292.38,203.31,3917.23,3917.58,4026.24,3891.59]";';

describe('报价源回归测试', function() {
  it('从真实响应读取四种金属，不能读取后面的其他品种', function() {
    const items = parsePanjia2(raw);
    expect(items.map((i) => [i.priceCny, i.salesPriceCny])).to.deep.equal([
      [838.83, 841.83], [11.105, 11.205], [309.4, 310.9], [209.6, 211.1],
    ]);
  });

  for (const value of ['--', '0', '-1', 'NaN', 'Infinity', '838.83oops']) {
    it('拒绝无效字段 ' + value, function() {
      expect(() => parsePanjia2(raw.replace('838.83', value))).to.throw();
    });
  }

  it('拒绝字段不足、布局变化和买卖价格颠倒', function() {
    for (const bad of ['const panjia2 = "[1,2]";', raw.replace('[1,', '[2,'), raw.replace('841.83', '800')]) {
      expect(() => parsePanjia2(bad)).to.throw();
    }
  });

  function output() {
    return { status: 'ok', prices: {
      '黄金': { ref_bp: 838.83, ref_sp: 841.83 },
      '白银': { ref_bp: 11.105, ref_sp: 11.205 },
      '铂金': { ref_bp: 309.4, ref_sp: 310.9 },
      '钯金': { ref_bp: 209.6, ref_sp: 211.1 },
    } };
  }

  it('启动时标记报价不可用，成功抓取后恢复正常', async function() {
    const cache = new PriceCache({ getAll: () => ({}) });
    expect(cache.getAll().every((i) => !i.available && i.stale)).to.equal(true);
    cache._runPaqujinjia = async () => output();
    await cache.update();
    expect(cache.getAll().every((i) => i.available && !i.stale)).to.equal(true);
    expect(cache.getAll()[0].domesticBuybackPrice).to.equal(838.83);
  });

  it('拒绝缺失、非有限值、负数、买卖颠倒和明显串价，保留整批旧报价及时间', async function() {
    const cache = new PriceCache({ getAll: () => ({}) });
    cache._runPaqujinjia = async () => output();
    await cache.update();
    const previous = cache.cache;
    const badOutputs = [];
    for (const value of [-0.2, NaN, Infinity, '11.1']) {
      const bad = output();
      bad.prices['白银'].ref_bp = value;
      badOutputs.push(bad);
    }
    const missing = output();
    delete missing.prices['钯金'];
    badOutputs.push(missing, { status: 'error: 上游失败' });
    const reversed = output();
    reversed.prices['黄金'].ref_sp = 100;
    badOutputs.push(reversed);
    const crossed = output();
    crossed.prices['白银'].ref_sp = 36430;
    badOutputs.push(crossed);
    for (const bad of badOutputs) {
      cache._runPaqujinjia = async () => bad;
      await cache.update();
      expect(cache.cache).to.equal(previous);
      expect(cache.getAll().every((i) => i.stale)).to.equal(true);
    }
    cache._runPaqujinjia = async () => output();
    await cache.update();
    expect(cache.getAll().every((i) => !i.stale)).to.equal(true);
  });

  it('超过 30 秒未更新的数据标记过期', async function() {
    const cache = new PriceCache({ getAll: () => ({}) });
    cache._runPaqujinjia = async () => output();
    await cache.update();
    cache.cache.gold.timestamp = Date.now() - 31000;
    expect(cache.getAll()[0].stale).to.equal(true);
  });

  it('页面对过期报价显示提示，对未初始化报价显示占位符', async function() {
    const element = { addEventListener() {}, style: {} };
    const context = vm.createContext({
      document: { getElementById: () => element, addEventListener() {} },
      API: { fetchPrices: async () => [{ stale: true }] },
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8'), context);
    vm.runInContext('renderPrices = function() {};', context);
    await context.refreshPrices();
    expect(element.textContent).to.include('报价更新异常');
    expect(context.formatCNY(null)).to.equal('--');
    expect(context.formatCNY(841.83)).to.include('841.83');
  });
});
