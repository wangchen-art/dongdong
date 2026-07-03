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
/** scraper.js 品种代码到系统 key 的映射（XAP=铂金） */
const SCRAPER_METAL_MAP = { XAU: 'gold', XAG: 'silver', XAP: 'platinum', XPD: 'palladium' };



/** 密码存储（加密持久化，使用 crypto.scryptSync） */
const PASSWORD_FILE = path.join(__dirname, 'data', 'admin-password.json');
const DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD;

class PasswordStore {
  constructor() { this._load(); }
  _load() {
    // 检测重置密码标志：--reset-password 或 RESET_ADMIN_PASSWORD=true
    if (process.argv.includes('--reset-password') || process.env.RESET_ADMIN_PASSWORD === 'true' || process.env.RESET_ADMIN_PASSWORD === '1') {
      try { fs.unlinkSync(PASSWORD_FILE); console.log('[密码] 检测到重置标志，已删除密码文件'); } catch {}
    }
    try {
      const data = JSON.parse(fs.readFileSync(PASSWORD_FILE, 'utf8'));
      this.hash = Buffer.from(data.hash, 'hex');
      this.salt = Buffer.from(data.salt, 'hex');
      console.log('[密码] 已加载加密密码存储');
      return;
    } catch {}
    this.hash = null;
    this.salt = null;
    const pwd = DEFAULT_PASSWORD || 'admin123';
    console.log('[密码] 首次使用，保存默认密码');
    this.salt = crypto.randomBytes(16);
    this.hash = crypto.scryptSync(pwd, this.salt, 64);
    this._save();
  }
  _save() {
    const dir = path.dirname(PASSWORD_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = PASSWORD_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({
      hash: this.hash.toString('hex'), salt: this.salt.toString('hex'),
    }));
    fs.renameSync(tmp, PASSWORD_FILE);
  }
  verify(password) {
    if (!this.hash || !this.salt) return false;
    try {
      const hash = crypto.scryptSync(String(password), this.salt, 64);
      return crypto.timingSafeEqual(this.hash, hash);
    } catch { return false; }
  }
  change(oldPassword, newPassword) {
    if (this.hash && this.salt && !this.verify(oldPassword)) throw new Error('原密码错误');
    if (!newPassword || newPassword.length < 4) throw new Error('新密码长度至少 4 位');
    if (this.verify(newPassword)) throw new Error('新密码不能与原密码相同');
    this.salt = crypto.randomBytes(16);
    this.hash = crypto.scryptSync(newPassword, this.salt, 64);
    this._save();
  }
  isConfigured() { return !!(this.hash && this.salt); }
}
const passwordStore = new PasswordStore();
/** 差价持久化文件路径 */
const DIFFERENTIALS_FILE = path.join(__dirname, 'data', 'differentials.json');
const SALES_DIFF_FILE = path.join(__dirname, 'data', 'sales-differentials.json');


/** 登录失败次数记录（按 IP） */
var loginAttempts = new Map();
var MAX_LOGIN_ATTEMPTS = 5;
var LOCKOUT_DURATION = 60 * 60 * 1000;

/** 每小时清理过期登录失败记录，防止内存无限增长 */
setInterval(function() {
  var now = Date.now();
  for (var ip of loginAttempts.keys()) {
    var rec = loginAttempts.get(ip);
    // 锁定已完全过期（超过锁定期 2 小时），或非锁定记录存留超 24 小时 → 清除
    if ((rec.lockedUntil && now > rec.lockedUntil + 7200000) || (!rec.lockedUntil && now - rec._ts > 86400000)) {
      loginAttempts.delete(ip);
    }
  }
  // Map 过大时直接清空，极端兜底
  if (loginAttempts.size > 10000) { loginAttempts.clear(); }
}, 3600000);

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
      const tmp = this.filePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8');
      fs.renameSync(tmp, this.filePath);
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
      throw new Error('无效的金属类型: ' + metal);
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
    this.scraperPath = path.join(__dirname, 'scraper.js');

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
    // 通过 scraper.js 获取贵金属价格
    var startTs = Date.now();
    try {
      const data = await this._runScraper();
      var elapsed = Date.now() - startTs;
      if (data.success && data.items && data.items.length > 0) {
        const ts = Date.now();
        data.items.forEach((item) => {
          const key = SCRAPER_METAL_MAP[item.code];
          if (key && typeof item.priceCny === 'number') {
            this.cache[key] = {
              internationalPriceCNYPerGram: item.priceCny,
              domesticPriceCNY: item.priceCny,
              timestamp: ts,
              source: 'fx678',
            };
          }
        });
        console.log('[价格更新] ' + new Date(startTs).toLocaleString() + ' | 成功 | 退出码 ' + data._exitCode + ' | 耗时 ' + elapsed + 'ms');
        return;
      }
    } catch (err) {
      var elapsed = Date.now() - startTs;
      console.error('[价格更新] ' + new Date(startTs).toLocaleString() + ' | 失败 | ' + err.message + ' | 耗时 ' + elapsed + 'ms');
    }
    // 降级：使用模拟数据
    this._mockFallback();
  }

  /** 执行 scraper.js 并解析输出 */
  _runScraper() {
    return new Promise(function(resolve, reject) {
      var child = spawn('node', [this.scraperPath], {
        cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000,
      });
      var stdout = '', stderr = '';
      var settled = false;
      function done(err, result) {
        if (settled) return;
        settled = true;
        child.stdout.removeAllListeners();
        child.stderr.removeAllListeners();
        child.removeAllListeners();
        if (!child.killed) child.kill('SIGKILL');
        if (err) reject(err);
        else resolve(result);
      }
      child.stdout.on('data', function(c) { stdout += c.toString(); });
      child.stderr.on('data', function(c) { stderr += c.toString(); });
      child.on('close', function(code) {
        if (code !== 0) { done(new Error(stderr.trim() || '退出码 ' + code)); return; }
        try { var d = JSON.parse(stdout); d._exitCode = code; done(null, d); } catch (e) { done(new Error('JSON 解析失败: ' + e.message)); }
      });
      child.on('error', done);
      // 安全兜底：25 秒后强制 SIGKILL
      setTimeout(function() { if (!settled) { child.kill('SIGKILL'); done(new Error('scraper 子进程超时')); } }, 25000);
    }.bind(this));
  }

  /** 模拟数据降级 */
  _mockFallback() {
    METALS.forEach((m) => {
      this.cache[m.key] = {
        internationalPriceCNYPerGram: jitter(MOCK_PRICES[m.key].cny),
        domesticPriceCNY: jitter(MOCK_PRICES[m.key].cny),
        timestamp: Date.now(),
        source: 'mock',
      };
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

  if (!passwordStore.isConfigured()) {
    return res.status(500).json({ error: '服务端未配置管理员密码' });
  }

  if (!passwordStore.verify(password)) {
    var current = loginAttempts.get(ip) || { count: 0, _ts: Date.now() };
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

  try {
    passwordStore.change(oldPassword, newPassword);
    console.log('[密码] 管理员密码已修改并持久化');
    res.json({ message: '密码修改成功' });
  } catch (err) {
    if (err.message === '原密码错误') {
      return res.status(401).json({ error: err.message });
    }
    return res.status(400).json({ error: err.message });
  }
});
app.put('/api/admin/differentials/:metal', authMiddleware, (req, res) => {
  const { metal } = req.params;
  const { differential } = req.body;

  // 校验金属类型
  const validMetal = METALS.find((m) => m.key === metal);
  if (!validMetal) {
    return res.status(400).json({ error: '无效的金属类型: ' + metal });
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

// 微信二维码不再使用独立页面，已直接嵌入首页底部
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

//** 获取 10~15 秒之间的随机等待时间（毫秒） */
function randomInterval() {
  return Math.floor(10000 + Math.random() * 5000);
}

/**
 * 启动定时价格更新
 * 1. 启动时立即拉取一次
 * 2. 之后每次完成后等待 10~15 秒随机间隔再拉取
 */
async function startPriceUpdates() {
  console.log('[价格更新] 启动定时价格刷新，间隔 10~15 秒随机');
  // 首次立即拉取
  await priceCache.update().catch(err => {
    console.error('[价格更新] 首次拉取失败:', err.message);
  });
  // 后续使用随机间隔
  async function scheduleNext() {
    const delay = randomInterval();
    setTimeout(async () => {
      await priceCache.update().catch(err => {
        console.error('[价格更新] 定时拉取失败:', err.message);
      });
      scheduleNext();
    }, delay);
  }
  scheduleNext();
}

// ---- 服务启动 ----
if (require.main === module) {
  startPriceUpdates();
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log('[服务启动] 贵金属回收报价系统运行于 http://localhost:' + PORT);
    console.log('[服务启动] 管理后台: http://localhost:' + PORT + '/admin');
  });
}

// ---- 导出（供测试使用）----
module.exports = { app, DifferentialStore, AuthStore, PriceCache, METALS, salesDifferentialStore, resetLoginAttempts: function() { loginAttempts.clear(); } };










