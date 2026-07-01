// ==========================================
// server.js - 贵金属回收价格展示系统后端
// ==========================================

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

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
const SALES_DIFF_FILE = path.join(__dirname, 'data', 'sales-differentials.json');

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
  constructor(filePath) {
    /** @type {Object.<string, number>} */
    this.data = { gold: 0, silver: 0, platinum: 0, palladium: 0 };
    this.filePath = filePath || DIFFERENTIALS_FILE;
    this._loadFromDisk();
  }

  /** 从磁盘加载已持久化的差价数据 */
  _loadFromDisk() {
    try {
      if (fs.existsSync(this.filePath)) {
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
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
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
/** 默认汇率（USD/CNY），API 不可用时使用 */
// ==========================================
// 模拟价格数据（API 不可用时的降级方案）
// ==========================================

const MOCK_PRICES = {
  gold:      { cny: 548.50 },
  silver:    { cny: 7.12 },
  platinum:  { cny: 228.00 },
  palladium: { cny: 213.00 },
};

/** 模拟数据波动函数 */
function jitter(val, pct = 0.02) { return parseFloat((val * (1 + (Math.random() - 0.5) * pct)).toFixed(2)); }

class PriceCache {
  constructor(differentialStore) {
    this.cache = {};
    this.differentialStore = differentialStore;
    this.status = '初始化中';

    // 初始化缓存为模拟数据
    METALS.forEach((m) => {
      this.cache[m.key] = {
        internationalPriceCNYPerGram: MOCK_PRICES[m.key].cny,
        domesticPriceCNY: MOCK_PRICES[m.key].cny,
        timestamp: Date.now(),
        source: 'mock',
      };
    });
  }

  async update() {
    // 通过 Python 子进程获取 CCMN 贵金属价格
    await this._fetchFromPython();
    this._ensureMockFallback();
  }

  /**
   * 使用 Python (AKShare) 获取长江有色金属网贵金属行情
   */
  async _fetchFromPython() {
    const scriptPath = path.join(__dirname, 'fetch_prices.py');
    try {
      const result = await new Promise((resolve, reject) => {
        const child = spawn('python', [scriptPath], { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 });
        let stdout = '', stderr = '';
        child.stdout.on('data', (c) => { stdout += c.toString(); });
        child.stderr.on('data', (c) => { stderr += c.toString(); });
        child.on('close', (code) => {
          if (code !== 0) { if (stderr) console.error('[Python] 错误:', stderr.trim()); reject(new Error('退出码 ' + code)); return; }
          try { resolve(JSON.parse(stdout)); } catch(e) { reject(new Error('解析失败: ' + e.message)); }
        });
        child.on('error', reject);
      });
      const ts = Date.now();
      METALS.forEach((m) => {
        const d = result[m.key];
        if (d && typeof d.price === 'number') {
          this.cache[m.key] = { internationalPriceCNYPerGram: d.price, domesticPriceCNY: d.price, timestamp: ts, source: 'ccmn' };
        }
      });
    } catch(err) { console.error('[Python] 获取失败:', err.message); }
  }

  /** 确保所有金属都有有效数据，Python 失败时使用模拟数据降级 */
  _ensureMockFallback() {
    METALS.forEach((metal) => {
      const cached = this.cache[metal.key];
      if (Date.now() - cached.timestamp > 90000) {
        cached.domesticPriceCNY = jitter(MOCK_PRICES[metal.key].cny);
        cached.internationalPriceCNYPerGram = cached.domesticPriceCNY;
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
      var salesDiff = salesDifferentialStore.getAll()[metal.key] || 0;

      // 回收价 = 国际价 - 回收差价
      const recyclingPrice = parseFloat(
        (price.internationalPriceCNYPerGram - diff).toFixed(2)
      );
      // 销售价 = 国际价 + 销售差价
      const salesPrice = parseFloat(
        (price.internationalPriceCNYPerGram + salesDiff).toFixed(2)
      );

      return {
        metal: metal.key,
        name: metal.name,
        symbol: metal.symbol,
        internationalPrice: price.internationalPriceCNYPerGram,
        domesticPrice: price.domesticPriceCNY,
        recyclingPrice: recyclingPrice,
        salesPrice: salesPrice,
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
const differentialStore = new DifferentialStore(DIFFERENTIALS_FILE);
const salesDifferentialStore = new DifferentialStore(SALES_DIFF_FILE);
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
  if (differential > metalPrice.internationalPrice) {
    return res.status(400).json({ error: '差价不能大于当前国际价 ' + metalPrice.internationalPrice });
  }

  differentialStore.set(metal, differential);
  res.json({
    metal,
    differential: differentialStore.get(metal),
    updatedAt: Date.now(),
  });


});

/**
 * GET /api/admin/sales-differentials
 * 获取所有金属的销售差价（需认证）
 */
app.get('/api/admin/sales-differentials', authMiddleware, (req, res) => {
  const differentials = salesDifferentialStore.getAll();
  res.json({ differentials });
});

/**
 * PUT /api/admin/sales-differentials/:metal
 * 设置某金属的销售差价（需认证）
 */
app.put('/api/admin/sales-differentials/:metal', authMiddleware, (req, res) => {
  const { metal } = req.params;
  const { differential } = req.body;

  const validMetal = METALS.find(function(m) { return m.key === metal; });
  if (!validMetal) {
    return res.status(400).json({ error: '无效的金属类型: ' + metal });
  }
  if (typeof differential !== 'number' || isNaN(differential)) {
    return res.status(400).json({ error: '差价必须为有效数字' });
  }
  if (differential < 0) {
    return res.status(400).json({ error: '销售差价不能为负数' });
  }

  salesDifferentialStore.set(metal, differential);
  res.json({
    metal: metal,
    differential: salesDifferentialStore.get(metal),
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

/** 价格刷新间隔（毫秒） */
const PRICE_UPDATE_INTERVAL = 15000;

/**
 * 启动定时价格更新
 * 1. 启动时立即拉取一次真实数据
 * 2. 之后每隔 15 秒拉取一次
 */
async function startPriceUpdates() {
  console.log('[价格更新] 启动定时价格刷新，间隔 15 秒');
  // 首次立即拉取
  await priceCache.update().catch(err => {
    console.error('[价格更新] 首次拉取失败:', err.message);
  });
  // 后续每隔 15 秒拉取一次
  setInterval(() => {
    priceCache.update().catch(err => {
      console.error('[价格更新] 定时拉取失败:', err.message);
    });
  }, PRICE_UPDATE_INTERVAL);
}

// ---- 服务启动 ----
if (require.main === module) {
  startPriceUpdates();
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`[服务启动] 贵金属回收报价系统运行于 http://localhost:${PORT}`);
    console.log(`[服务启动] 管理后台: http://localhost:${PORT}/admin`);
  });
}

// ---- 导出（供测试使用）----
module.exports = { app, DifferentialStore, AuthStore, PriceCache, METALS, salesDifferentialStore, resetLoginAttempts: function() { loginAttempts.clear(); } };
