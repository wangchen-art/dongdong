// ==========================================
// server.js - 贵金属回收价格展示系统后端
// ==========================================

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// 加载 .env 配置（如果存在）
try { require('dotenv').config(); } catch (e) { /* dotenv 未安装时静默跳过 */ }

// ==========================================
// 配置常量
// ==========================================

/** 支持的四种贵金属 */
const METALS = [
  { key: 'gold',      name: '黄金',   symbol: 'XAU' },
  { key: 'silver',    name: '白银',   symbol: 'XAG' },
  { key: 'platinum',  name: '铂金',   symbol: 'XPT' },
  { key: 'palladium', name: '钯金',   symbol: 'XPD' },
];

/** 差价持久化文件路径 */
const DIFFERENTIALS_FILE = path.join(__dirname, 'data', 'differentials.json');

/** 管理员密码（运行时可变，初始从环境变量读取） */
let adminPassword = process.env.ADMIN_PASSWORD;

/** 登录失败次数记录（按 IP） */
var loginAttempts = new Map();
var MAX_LOGIN_ATTEMPTS = 5;
var LOCKOUT_DURATION = 60 * 60 * 1000;

// ==========================================
// 差价存储模块
// ==========================================

/**
 * 管理四种金属的差价配置
 * 数据在内存中读写，并定期持久化到 JSON 文件
 */
class DifferentialStore {
  constructor() {
    /** @type {Object.<string, number>} */
    this.data = { gold: 0, silver: 0, platinum: 0, palladium: 0 };
    this._loadFromDisk();
  }

  /** 从磁盘加载已持久化的差价数据 */
  _loadFromDisk() {
    try {
      if (fs.existsSync(DIFFERENTIALS_FILE)) {
        const raw = fs.readFileSync(DIFFERENTIALS_FILE, 'utf-8');
        const saved = JSON.parse(raw);
        Object.keys(this.data).forEach((key) => {
          if (typeof saved[key] === 'number') {
            this.data[key] = saved[key];
          }
        });
        console.log('[差价存储] 已从文件恢复差价配置');
      }
    } catch (err) {
      console.error('[差价存储] 读取持久化文件失败:', err.message);
    }
  }

  /** 将差价数据写入磁盘 */
  persist() {
    try {
      const dir = path.dirname(DIFFERENTIALS_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(DIFFERENTIALS_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[差价存储] 持久化写入失败:', err.message);
    }
  }

  /**
   * 获取某金属的差价
   * @param {string} metal - 金属 key
   * @returns {number} 差价数值
   */
  get(metal) {
    return this.data[metal] ?? 0;
  }

  /**
   * 获取所有金属的差价
   * @returns {Object.<string, number>}
   */
  getAll() {
    return { ...this.data };
  }

  /**
   * 设置某金属的差价
   * @param {string} metal - 金属 key
   * @param {number} value - 差价数值
   */
  set(metal, value) {
    if (this.data[metal] === undefined) {
      throw new Error(`无效的金属类型: ${metal}`);
    }
    this.data[metal] = value;
    this.persist();
  }
}

// ==========================================
// 认证管理模块
// ==========================================

/**
 * 管理员会话认证管理
 * 生成随机 token，支持过期清理
 */

/** Token 有效期（24 小时） */
const TOKEN_TTL = 24 * 60 * 60 * 1000;

/** Token 清理间隔 */
const TOKEN_CLEANUP_INTERVAL = 60 * 60 * 1000;
class AuthStore {
  constructor() {
    /** @type {Map.<string, number>} token -> 创建时间戳 */
    this.tokens = new Map();

    // 定时清理过期 token
    setInterval(() => this._cleanup(), TOKEN_CLEANUP_INTERVAL);
  }

  /**
   * 生成新的会话 token
   * @returns {string} 生成的 token
   */
  createToken() {
    const token = crypto.randomBytes(32).toString('hex');
    this.tokens.set(token, Date.now());
    return token;
  }

  /**
   * 校验 token 是否有效
   * @param {string} token
   * @returns {boolean}
   */
  validateToken(token) {
    const createdAt = this.tokens.get(token);
    if (!createdAt) return false;
    if (Date.now() - createdAt > TOKEN_TTL) {
      this.tokens.delete(token);
      return false;
    }
    return true;
  }

  /** 清理所有过期 token */
  _cleanup() {
    const now = Date.now();
    for (const [token, createdAt] of this.tokens.entries()) {
      if (now - createdAt > TOKEN_TTL) {
        this.tokens.delete(token);
      }
    }
  }
}

// ==========================================
// 价格数据缓存模块
// ==========================================

/**
 * 管理贵金属价格数据
 * 定时从外部 API 拉取，API 不可用时使用模拟数据降级
 */

/** 金衡盎司转克 */
const OUNCE_TO_GRAM = 31.1035;

/** 默认汇率（USD/CNY），API 不可用时使用 */
const DEFAULT_EXCHANGE_RATE = 7.25;

// ==========================================
// 模拟价格数据（API 不可用时的降级方案）
// ==========================================

const MOCK_PRICES = {
  gold:      { usd: 2350.00, cny: 548.50 },
  silver:    { usd: 30.50,   cny: 7.12 },
  platinum:  { usd: 985.00,  cny: 228.00 },
  palladium: { usd: 920.00,  cny: 213.00 },
};

class PriceCache {
  constructor(differentialStore) {
    /** @type {Object.<string, Object>} */
    this.exchangeRate = DEFAULT_EXCHANGE_RATE;

    /** @type {Object.<string, Object>} */
    this.cache = {};
    this.differentialStore = differentialStore;
    this.status = '初始化中';

    // 初始化缓存为模拟数据（国际价从 USD/oz 转换为 CNY/g）
    METALS.forEach((m) => {
      const cnyPerGram = (MOCK_PRICES[m.key].usd * DEFAULT_EXCHANGE_RATE) / OUNCE_TO_GRAM;
      this.cache[m.key] = {
        internationalPriceCNYPerGram: parseFloat(cnyPerGram.toFixed(2)),
        domesticPriceCNY: MOCK_PRICES[m.key].cny,
        timestamp: Date.now(),
        source: 'mock',
      };
    });
  }

  /** 尝试获取实时汇率（USD/CNY），失败时使用默认值 */
  async _fetchExchangeRate() {
    try {
      const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD', {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.rates && data.rates.CNY) {
          this.exchangeRate = data.rates.CNY;
          console.log('[汇率] 已获取实时汇率: 1 USD = ' + this.exchangeRate + ' CNY');
        }
      }
    } catch (err) {
      // 使用默认汇率，静默处理
    }
  }

  /**
   * 尝试从外部 API 更新价格数据
   * 优先获取实际市场价格，失败时使用模拟数据
   */
  async update() {
    await this._fetchExchangeRate();
    await this._fetchInternationalPrices();
    await this._fetchDomesticPrices();
    this._ensureMockFallback();
  }

  /** 获取国际贵金属价格（美元/盎司） */
  async _fetchInternationalPrices() {
    // 如果有 API Key，尝试请求 GoldAPI
    const apiKey = process.env.GOLD_API_KEY;
    if (!apiKey) return; // 没有 API Key，跳过

    for (const metal of METALS) {
      try {
        const url = `https://www.goldapi.io/api/${metal.symbol}/USD`;
        const response = await fetch(url, {
          headers: { 'x-access-token': apiKey },
          signal: AbortSignal.timeout(5000),
        });
        if (response.ok) {
          const data = await response.json();
          // 将国际价格从 USD/oz 转换为 CNY/g
          const cnyGram = (data.price * this.exchangeRate) / OUNCE_TO_GRAM;
          this.cache[metal.key] = {
            internationalPriceCNYPerGram: parseFloat(cnyGram.toFixed(2)),
            domesticPriceCNY: this.cache[metal.key]?.domesticPriceCNY || MOCK_PRICES[metal.key].cny,
            timestamp: Date.now(),
            source: 'goldapi',
          };
        }
      } catch (err) {
        // 单个金属请求失败不影响其他金属
        console.error(`[国际价格] ${metal.name} 获取失败:`, err.message);
      }
    }
  }

  /** 获取国内贵金属行情（人民币/克） */
  async _fetchDomesticPrices() {
    // 尝试从新浪财经获取国内行情
    const sinaSymbols = {
      gold:      'au9999',
      silver:    'ag9999',
      platinum:  'pt9995',
      palladium: 'pd9995',
    };

    for (const metal of METALS) {
      try {
        const symbol = sinaSymbols[metal.key];
        const url = `https://hq.sinajs.cn/list=${symbol}`;
        const response = await fetch(url, {
          headers: { Referer: 'https://finance.sina.com.cn' },
          signal: AbortSignal.timeout(5000),
        });
        if (response.ok) {
          const text = await response.text();
          // 解析新浪返回的 CSV 格式
          const match = text.match(/"([^"]+)"/);
          if (match) {
            const fields = match[1].split(',');
            const currentPrice = parseFloat(fields[3]); // 当前价在 index 3
            if (!isNaN(currentPrice)) {
              this.cache[metal.key] = {
                ...this.cache[metal.key],
                domesticPriceCNY: currentPrice,
                timestamp: Date.now(),
                source: 'sina',
              };
            }
          }
        }
      } catch (err) {
        console.error(`[国内行情] ${metal.name} 获取失败:`, err.message);
      }
    }
  }

  /** 确保所有金属都有有效数据，API 失败时使用模拟数据 */
  _ensureMockFallback() {
    METALS.forEach((metal) => {
      const cached = this.cache[metal.key];
      // 如果缓存数据超过 60 秒未更新，混入模拟波动保持数据"鲜活"
      if (Date.now() - cached.timestamp > 60000) {
        const usdJittered = jitter(MOCK_PRICES[metal.key].usd);
        const cnyFallback = (usdJittered * this.exchangeRate) / OUNCE_TO_GRAM;
        cached.internationalPriceCNYPerGram = parseFloat(cnyFallback.toFixed(2));
        cached.domesticPriceCNY = jitter(MOCK_PRICES[metal.key].cny);
        cached.timestamp = Date.now();
        cached.source = 'mock';
      }
    });
  }

  /**
   * 获取所有金属的展示价格（含回收价计算）
   * @returns {Array.<Object>} 前端展示数据
   */
  getAll() {
    const differentials = this.differentialStore.getAll();

    return METALS.map((metal) => {
      const price = this.cache[metal.key];
      const diff = differentials[metal.key] || 0;

      // 回收价 = 国内实时价(CNY/g) - 管理员差价
      const recyclingPrice = parseFloat(
        (price.domesticPriceCNY - diff).toFixed(2)
      );

      return {
        metal: metal.key,
        name: metal.name,
        symbol: metal.symbol,
        internationalPrice: price.internationalPriceCNYPerGram,
        domesticPrice: price.domesticPriceCNY,
        recyclingPrice: recyclingPrice,
        differential: diff,
        lastUpdated: price.timestamp,
        source: price.source,
      };
    });
  }
}

// ==========================================
// Express 应用
// ==========================================

const app = express();

/** 全局实例 */
const differentialStore = new DifferentialStore();
const authStore = new AuthStore();
const priceCache = new PriceCache(differentialStore);

// ---- 中间件 ----

// 解析 JSON 请求体
app.use(express.json());

// CORS 头（部署时按需调整）
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/**
 * 认证中间件 — 校验请求中的 Bearer Token
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '认证失败' });
  }
  const token = authHeader.slice(7);
  if (!authStore.validateToken(token)) {
    return res.status(401).json({ error: '认证失败' });
  }
  next();
}

// ---- API 路由 ----

/**
 * GET /api/prices
 * 获取所有金属的当前价格（公开接口，无需认证）
 */
app.get('/api/prices', (req, res) => {
  const prices = priceCache.getAll();
  res.json(prices);
});

/**
 * POST /api/admin/login
 * 管理员登录，验证密码并返回会话 token
 * 连续失败 MAX_LOGIN_ATTEMPTS 次后锁定 LOCKOUT_DURATION 时间
 */
app.post('/api/admin/login', (req, res) => {
  var password = req.body.password;
  var ip = req.ip || req.connection.remoteAddress;

  // 检查是否被锁定
  var record = loginAttempts.get(ip);
  if (record && record.lockedUntil && Date.now() < record.lockedUntil) {
    var remaining = Math.ceil((record.lockedUntil - Date.now()) / 60000);
    return res.status(429).json({
      error: '登录尝试过多，请 ' + remaining + ' 分钟后重试',
      locked: true,
      lockedUntil: record.lockedUntil,
    });
  }

  if (!adminPassword) {
    return res.status(500).json({ error: '服务端未配置管理员密码' });
  }

  if (password !== adminPassword) {
    var current = loginAttempts.get(ip) || { count: 0 };
    current.count = (current.count || 0) + 1;

    if (current.count >= MAX_LOGIN_ATTEMPTS) {
      current.lockedUntil = Date.now() + LOCKOUT_DURATION;
      loginAttempts.set(ip, current);
      return res.status(429).json({
        error: '密码错误次数过多，已锁定 1 小时',
        locked: true,
        lockedUntil: current.lockedUntil,
      });
    }

    loginAttempts.set(ip, current);
    return res.status(401).json({
      error: '密码错误',
      remainingAttempts: MAX_LOGIN_ATTEMPTS - current.count,
    });
  }

  // 登录成功，清除失败记录
  loginAttempts.delete(ip);

  var token = authStore.createToken();
  res.json({ token });
});

/**
 * 
/**
 * GET /api/admin/status
 * 检查当前 IP 的登录锁定状态
 */
app.get('/api/admin/status', (req, res) => {
  var ip = req.ip || req.connection.remoteAddress;
  var record = loginAttempts.get(ip);
  if (record && record.lockedUntil && Date.now() < record.lockedUntil) {
    var remaining = Math.ceil((record.lockedUntil - Date.now()) / 60000);
    return res.json({ locked: true, lockedUntil: record.lockedUntil, remainingMinutes: remaining });
  }
  res.json({ locked: false });
});

/**
 * GET /api/admin/differentials
 * 获取所有金属的当前差价配置（需认证）
 */
app.get('/api/admin/differentials', authMiddleware, (req, res) => {
  const differentials = differentialStore.getAll();
  res.json({ differentials });
});

/**
 * PUT /api/admin/differentials/:metal
 * 设置某金属的差价（需认证）
 */

/**
 * PUT /api/admin/password
 * 管理员修改密码（需认证）
 */
app.put('/api/admin/password', authMiddleware, (req, res) => {
  const { oldPassword, newPassword } = req.body;

  // 验证原密码
  if (oldPassword !== adminPassword) {
    return res.status(401).json({ error: '原密码错误' });
  }

  // 验证新密码格式
  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 4) {
    return res.status(400).json({ error: '新密码长度至少 4 位' });
  }

  // 新密码不能与原密码相同
  if (newPassword === adminPassword) {
    return res.status(400).json({ error: '新密码不能与原密码相同' });
  }

  // 更新密码
  adminPassword = newPassword;
  console.log('[认证] 管理员密码已修改');
  res.json({ message: '密码修改成功' });
});
app.put('/api/admin/differentials/:metal', authMiddleware, (req, res) => {
  const { metal } = req.params;
  const { differential } = req.body;

  // 校验金属类型
  const validMetal = METALS.find((m) => m.key === metal);
  if (!validMetal) {
    return res.status(400).json({ error: `无效的金属类型: ${metal}` });
  }

  // 校验差价数值
  if (typeof differential !== 'number' || isNaN(differential)) {
    return res.status(400).json({ error: '差价必须为有效数字' });
  }

  // 验证差价不能大于当前国内实时价
  var currentPrices = priceCache.getAll();
  var metalPrice = currentPrices.find(function(p) { return p.metal === metal; });
  if (!metalPrice) {
    return res.status(400).json({ error: '无法获取当前价格' });
  }
  if (differential > metalPrice.domesticPrice) {
    return res.status(400).json({ error: '差价不能大于当前国内价 ' + metalPrice.domesticPrice });
  }

  differentialStore.set(metal, differential);
  res.json({
    metal,
    differential: differentialStore.get(metal),
    updatedAt: Date.now(),
  });
});

// 管理后台页面路由
app.get('/admin', (req, res) => {
  // 禁止浏览器缓存，确保每次都会请求最新 JS
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---- 静态文件托管 ----
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0, etag: false, lastModified: false }));

// ---- 错误处理中间件 ----
app.use((err, req, res, _next) => {
  console.error('[服务错误]', err.stack);
  res.status(500).json({ error: '服务器内部错误' });
});

// ---- 启动定时价格更新 ----

/** 重启价格刷新定时器 */

// ---- 服务启动 ----
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`[服务启动] 贵金属回收报价系统运行于 http://localhost:${PORT}`);
    console.log(`[服务启动] 管理后台: http://localhost:${PORT}/admin`);
  });
}

// ---- 导出（供测试使用）----
module.exports = { app, DifferentialStore, AuthStore, PriceCache, METALS, resetLoginAttempts: function() { loginAttempts.clear(); } };
