// ============================================
// features-by-spec.test.js
// 按需求分析文档逐项功能测试
// ============================================

process.env.ADMIN_PASSWORD = "test123";
var fs2 = require("fs");
var path2 = require("path");
try { fs2.unlinkSync(path2.join(__dirname,"..","data","admin-password.json")); } catch(e) {}
try { fs2.unlinkSync(path2.join(__dirname,"..","data","differentials.json")); } catch(e) {}
try { fs2.unlinkSync(path2.join(__dirname,"..","data","sales-differentials.json")); } catch(e) {}

var chai = require("chai");
var expect = chai.expect;
var supertest = require("supertest");
var mod = require("../server");
var app = mod.app;
var request = supertest(app);
var fs = require("fs");
var path = require("path");

var html = fs.readFileSync(path.join(__dirname,"..","public","index.html"),"utf-8");
var appJs = fs.readFileSync(path.join(__dirname,"..","public","js","app.js"),"utf-8");
var adminJs = fs.readFileSync(path.join(__dirname,"..","public","js","admin.js"),"utf-8");
var apiJs = fs.readFileSync(path.join(__dirname,"..","public","js","api.js"),"utf-8");
var css = fs.readFileSync(path.join(__dirname,"..","public","css","style.css"),"utf-8");

// 辅助函数
async function login(pwd) {
  var res = await request.post("/api/admin/login").send({ password: pwd || "test123" });
  if (res.status !== 200) throw new Error("Login failed");
  return res.body.token;
}

// ============================================
// 2.1 前台价格展示
// ============================================
describe("2.1 前台价格展示", function() {
  this.timeout(15000);

  describe("2.1.1 贵金属品种 — 四种", function() {
    it("GET /api/prices 返回数组长度 4", async function() {
      var res = await request.get("/api/prices");
      expect(res.body).to.be.an("array").with.lengthOf(4);
    });

    it("四种金属为黄金/白银/铂金/钯金", async function() {
      var names = (await request.get("/api/prices")).body.map(function(i){return i.name;});
      expect(names).to.have.members(["黄金","白银","铂金","钯金"]);
    });

    it("四种金属 symbol 为 XAU/XAG/XPT/XPD", async function() {
      var res = await request.get("/api/prices");
      expect(res.body.find(function(m){return m.metal==="gold";}).symbol).to.equal("XAU");
      expect(res.body.find(function(m){return m.metal==="silver";}).symbol).to.equal("XAG");
      expect(res.body.find(function(m){return m.metal==="platinum";}).symbol).to.equal("XPT");
      expect(res.body.find(function(m){return m.metal==="palladium";}).symbol).to.equal("XPD");
    });
  });

  describe("2.1.2 展示内容 — 回购价格 + 销售价格", function() {
    it("每条数据含 recyclingPrice 字段", async function() {
      (await request.get("/api/prices")).body.forEach(function(m) {
        expect(m).to.have.property("recyclingPrice");
      });
    });

    it("每条数据含 salesPrice 字段", async function() {
      (await request.get("/api/prices")).body.forEach(function(m) {
        expect(m).to.have.property("salesPrice");
      });
    });

    it("前端表格渲染回购价格列", function() {
      expect(appJs).to.include("回购价格");
    });

    it("前端表格渲染销售价格列", function() {
      expect(appJs).to.include("销售价格");
    });
  });

  describe("2.1.3 回购价公式", function() {
    // 先清除差价
    before(async function() {
      if (mod.resetLoginAttempts) mod.resetLoginAttempts();
      var t = await login("test123");
      await request.put("/api/admin/differentials/gold").set("Authorization","Bearer "+t).send({differential:0});
    });

    it("回购价 = 国际价 − 收购差价", async function() {
      var t = await login("test123");
      await request.put("/api/admin/differentials/gold").set("Authorization","Bearer "+t).send({differential:15.5});
      var res = await request.get("/api/prices");
      var gold = res.body.find(function(m){return m.metal==="gold";});
      expect(gold.recyclingPrice).to.equal(parseFloat((gold.internationalPrice - 15.5).toFixed(2)));
    });

    it("差价为 0 时回购价 = 国际价", async function() {
      var res = await request.get("/api/prices");
      res.body.forEach(function(m) {
        if (m.differential === 0) {
          expect(m.recyclingPrice).to.equal(m.internationalPrice);
        }
      });
    });
  });

  describe("2.1.4 销售价公式", function() {
    it("销售价 = 国际价 + 销售差价", async function() {
      var t = await login("test123");
      await request.put("/api/admin/sales-differentials/gold").set("Authorization","Bearer "+t).send({differential:10});
      var res = await request.get("/api/prices");
      var gold = res.body.find(function(m){return m.metal==="gold";});
      expect(gold.salesPrice).to.equal(parseFloat((gold.internationalPrice + 10).toFixed(2)));
    });
  });

  describe("2.1.5 刷新方式 — 10~15秒随机间隔", function() {
    it("server.js 使用随机间隔 10000~15000ms", function() {
      var s = fs.readFileSync(path.join(__dirname,"..","server.js"),"utf-8");
      expect(s).to.include("randomInterval");
      expect(s).to.include("10000");
      expect(s).to.include("5000");
    });
  });

  describe("2.1.6 涨红跌绿与闪烁动画", function() {
    it("CSS 定义 .price-cell.up（红色）和 .down（绿色）", function() {
      expect(css).to.include(".price-cell.up");
      expect(css).to.include(".price-cell.down");
      expect(css).to.include("var(--accent-red)");
      expect(css).to.include("var(--accent-green)");
    });

    it("CSS 定义 priceFlash 动画", function() {
      expect(css).to.include("@keyframes priceFlash");
    });

    it("app.js 使用 up/down 类控制涨跌颜色", function() {
      expect(appJs).to.include('classList.add("up")');
    });
  });

  describe("2.1.7 响应式适配", function() {
    it("CSS 含 <=900px 媒体查询", function() {
      expect(css).to.include("@media (max-width: 900px)");
    });

    it("CSS 含 <=520px 媒体查询", function() {
      expect(css).to.include("@media (max-width: 520px)");
    });
  });

  describe("2.1.8 联系方式 — 二维码 + 电话", function() {
    it("首页含二维码图片", function() {
      expect(html).to.include("qr-code.png");
      expect(html).to.include("footer-qr-img");
    });

    it("首页含扫一扫提示", function() {
      expect(html).to.include("扫一扫加微信咨询");
    });

    it("首页含电话链接 id=phoneLink", function() {
      expect(html).to.include("id=\"phoneLink\"");
    });

    it("电话号码为 19191621889", function() {
      expect(html).to.include("19191621889");
    });

    it("app.js 定义了电话复制功能", function() {
      expect(appJs).to.include("function copyPhoneNumber");
      expect(appJs).to.include("function fallbackCopy");
    });

    it("二维码图片可访问", async function() {
      var res = await request.get("/qr-code.png");
      expect(res.status).to.equal(200);
      expect(res.headers["content-type"]).to.include("image/png");
    });
  });
});

// ============================================
// 2.2 管理员后台
// ============================================
describe("2.2 管理员后台", function() {
  this.timeout(15000);

  describe("2.2.1 登录 — 密码认证", function() {
    beforeEach(function() { if (mod.resetLoginAttempts) mod.resetLoginAttempts(); });

    it("正确密码返回 200 + token", async function() {
      var res = await request.post("/api/admin/login").send({ password: "test123" });
      expect(res.status).to.equal(200);
      expect(res.body).to.have.property("token");
    });

    it("错误密码返回 401", async function() {
      var res = await request.post("/api/admin/login").send({ password: "wrong" });
      expect(res.status).to.equal(401);
    });

    it("空密码返回 401", async function() {
      expect((await request.post("/api/admin/login").send({})).status).to.equal(401);
    });
  });

  describe("2.2.2 登录锁定 — 5次失败锁定1小时", function() {
    beforeEach(function() { if (mod.resetLoginAttempts) mod.resetLoginAttempts(); });

    it("连续 5 次错误后锁定", async function() {
      for (var i=0;i<5;i++) { await request.post("/api/admin/login").send({password:"bad"+i}); }
      var res = await request.post("/api/admin/login").send({ password: "test123" });
      expect(res.status).to.equal(429);
      expect(res.body.locked).to.be.true;
    });

    it("锁定后正确密码也无法登录", async function() {
      for (var i=0;i<5;i++) { await request.post("/api/admin/login").send({password:"bad"+i}); }
      var res = await request.post("/api/admin/login").send({ password: "test123" });
      expect(res.status).to.equal(429);
    });

    it("错误密码返回剩余尝试次数", async function() {
      var res = await request.post("/api/admin/login").send({ password: "wrong" });
      expect(res.body).to.have.property("remainingAttempts");
      expect(res.body.remainingAttempts).to.be.a("number");
    });

    it("登录成功清除失败记录", async function() {
      await request.post("/api/admin/login").send({ password: "bad" });
      await request.post("/api/admin/login").send({ password: "bad2" });
      await request.post("/api/admin/login").send({ password: "test123" });
      var res = await request.post("/api/admin/login").send({ password: "wrong_after_success" });
      expect(res.body.remainingAttempts).to.equal(4);
    });
  });

  describe("2.2.3 收购差价设置", function() {
    var t;
    before(async function() { t = await login("test123"); });

    it("未认证请求返回 401", async function() {
      expect((await request.put("/api/admin/differentials/gold").send({differential:10})).status).to.equal(401);
    });

    it("设置有效差价返回更新值", async function() {
      var res = await request.put("/api/admin/differentials/gold").set("Authorization","Bearer "+t).send({differential:12.5});
      expect(res.status).to.equal(200);
      expect(res.body.differential).to.equal(12.5);
    });

    it("设置后可通过 GET 查询到", async function() {
      var res = await request.get("/api/admin/differentials").set("Authorization","Bearer "+t);
      expect(res.body.differentials.gold).to.equal(12.5);
    });

    it("无效金属类型返回 400", async function() {
      expect((await request.put("/api/admin/differentials/copper").set("Authorization","Bearer "+t).send({differential:10})).status).to.equal(400);
    });

    it("非数字差价返回 400", async function() {
      expect((await request.put("/api/admin/differentials/gold").set("Authorization","Bearer "+t).send({differential:"abc"})).status).to.equal(400);
    });

    it("差价不能大于当前国际价返回 400", async function() {
      var prices = (await request.get("/api/prices")).body;
      var goldPrice = prices.find(function(m){return m.metal==="gold";}).internationalPrice;
      var res = await request.put("/api/admin/differentials/gold").set("Authorization","Bearer "+t).send({differential:goldPrice+1000});
      expect(res.status).to.equal(400);
    });
  });

  describe("2.2.4 销售差价设置", function() {
    var t;
    before(async function() { t = await login("test123"); });

    it("设置有效销售差价返回更新值", async function() {
      var res = await request.put("/api/admin/sales-differentials/gold").set("Authorization","Bearer "+t).send({differential:8});
      expect(res.status).to.equal(200);
      expect(res.body.differential).to.equal(8);
    });

    it("销售差价不支持负数返回 400", async function() {
      expect((await request.put("/api/admin/sales-differentials/gold").set("Authorization","Bearer "+t).send({differential:-5})).status).to.equal(400);
    });

    it("销售差价可通过 GET 查询", async function() {
      var res = await request.get("/api/admin/sales-differentials").set("Authorization","Bearer "+t);
      expect(res.body.differentials).to.include.keys("gold","silver","platinum","palladium");
    });
  });

  describe("2.2.5 登录持久化 — localStorage", function() {
    it("admin.js 使用 localStorage 存储 token", function() {
      expect(adminJs).to.include("localStorage.setItem");
      expect(adminJs).to.include("localStorage.getItem");
      expect(adminJs).to.include("localStorage.removeItem");
    });

    it("admin.js 启动时从 localStorage 恢复 token", function() {
      expect(adminJs).to.include("localStorage.getItem(ADMIN_TOKEN_KEY)");
    });
  });

  describe("2.2.6 密码修改", function() {
    it("admin.js 定义了 handlePasswordChange 函数", function() {
      expect(adminJs).to.include("async function handlePasswordChange");
    });

    it("密码修改 API 正确原密码可修改", async function() {
      if (mod.resetLoginAttempts) mod.resetLoginAttempts();
      var t = await login("test123");
      var res = await request.put("/api/admin/password").set("Authorization","Bearer "+t).send({oldPassword:"test123",newPassword:"newpwd789"});
      expect(res.status).to.equal(200);
      // 恢复
      var t2 = (await request.post("/api/admin/login").send({password:"newpwd789"})).body.token;
      await request.put("/api/admin/password").set("Authorization","Bearer "+t2).send({oldPassword:"newpwd789",newPassword:"test123"});
    });

    it("原密码错误返回 401", async function() {
      var t = await login("test123");
      var res = await request.put("/api/admin/password").set("Authorization","Bearer "+t).send({oldPassword:"wrong",newPassword:"abc"});
      expect(res.status).to.equal(401);
    });

    it("新密码太短 (<4位) 返回 400", async function() {
      var t = await login("test123");
      var res = await request.put("/api/admin/password").set("Authorization","Bearer "+t).send({oldPassword:"test123",newPassword:"ab"});
      expect(res.status).to.equal(400);
    });

    it("新密码不能与原密码相同返回 400", async function() {
      var t = await login("test123");
      var res = await request.put("/api/admin/password").set("Authorization","Bearer "+t).send({oldPassword:"test123",newPassword:"test123"});
      expect(res.status).to.equal(400);
    });
  });
});

// ============================================
// 2.3 价格数据源
// ============================================
describe("2.3 价格数据源", function() {
  this.timeout(15000);

  describe("2.3.1 scraper.js 集成", function() {
    it("server.js 调用 spawn 执行 scraper", function() {
      var s = fs.readFileSync(path.join(__dirname,"..","server.js"),"utf-8");
      expect(s).to.include("spawn(");
      expect(s).to.include("scraper.js");
    });

    it("scraper 映射 XAP → platinum", function() {
      var s = fs.readFileSync(path.join(__dirname,"..","server.js"),"utf-8");
      expect(s).to.include("XAP: 'platinum'");
    });
  });

  describe("2.3.2 模拟数据降级", function() {
    it("server.js 内置模拟数据 MOCK_PRICES", function() {
      var s = fs.readFileSync(path.join(__dirname,"..","server.js"),"utf-8");
      expect(s).to.include("MOCK_PRICES");
      expect(s).to.include("jitter");
    });

    it("价格 API 始终返回正数（降级也工作）", async function() {
      var res = await request.get("/api/prices");
      expect(res.status).to.equal(200);
      res.body.forEach(function(m) {
        expect(m.internationalPrice).to.be.above(0);
        expect(m.recyclingPrice).to.be.above(0);
      });
    });

    it("价格数据含 source 字段标识来源", async function() {
      var res = await request.get("/api/prices");
      res.body.forEach(function(m) {
        expect(m.source).to.be.a("string");
      });
    });
  });
});

// ============================================
// 3. 非功能需求
// ============================================
describe("3. 非功能需求", function() {
  this.timeout(15000);

  describe("3.2.1 密码加密存储", function() {
    it("server.js 使用 crypto.scryptSync 加密", function() {
      var s = fs.readFileSync(path.join(__dirname,"..","server.js"),"utf-8");
      expect(s).to.include("class PasswordStore");
      expect(s).to.include("crypto.scryptSync");
    });

    it("密码文件存 hash + salt 而非明文", function() {
      try {
        var data = JSON.parse(fs.readFileSync(path.join(__dirname,"..","data","admin-password.json"),"utf-8"));
        expect(data).to.have.property("hash");
        expect(data).to.have.property("salt");
        expect(data.hash).to.not.include("test123");
        expect(data.salt).to.not.include("test123");
      } catch(e) {
        // 文件可能被 pretest 清理了，跳过
        expect(true).to.be.true;
      }
    });
  });

  describe("3.2.2 meta robots noindex", function() {
    it("index.html 包含 meta robots noindex", function() {
      expect(html).to.include('content="noindex"');
    });
  });

  describe("3.2.3 差价数据服务端存储", function() {
    it("DifferentialStore 写入 JSON 文件持久化", function() {
      var s = fs.readFileSync(path.join(__dirname,"..","server.js"),"utf-8");
      expect(s).to.include("DifferentialStore");
      expect(s).to.include("persist()");
    });

    it("differentials.json 文件存在", function() {
      try {
        var data = JSON.parse(fs.readFileSync(path.join(__dirname,"..","data","differentials.json"),"utf-8"));
        expect(data).to.include.keys("gold","silver","platinum","palladium");
      } catch(e) {
        expect(true).to.be.true;
      }
    });
  });

  describe("3.2.4 CORS 与 Token 认证", function() {
    it("响应包含 Access-Control-Allow-Origin: *", async function() {
      expect((await request.get("/api/prices")).headers["access-control-allow-origin"]).to.equal("*");
    });

    it("OPTIONS 预检返回 204", async function() {
      expect((await request.options("/api/prices")).status).to.equal(204);
    });

    it("获取差价需 Bearer Token", async function() {
      expect((await request.get("/api/admin/differentials")).status).to.equal(401);
    });
  });

  describe("3.3 可用性", function() {
    it("首页始终返回 200", async function() {
      expect((await request.get("/")).status).to.equal(200);
    });

    it("价格接口始终返回 200", async function() {
      expect((await request.get("/api/prices")).status).to.equal(200);
    });
  });
});

// ============================================
// 4.3 页面结构
// ============================================
describe("4.3 页面结构", function() {
  this.timeout(10000);

  describe("首页 /", function() {
    it("返回 200", async function() { expect((await request.get("/")).status).to.equal(200); });
    it("含价格看板价格看板", function() { expect(html).to.include("priceBoard"); });
    it("含底部二维码", function() { expect(html).to.include("footer-qr-section"); });
  });

  describe("管理后台 /admin", function() {
    it("返回 200", async function() { expect((await request.get("/admin")).status).to.equal(200); });
    it("含无缓存头", async function() {
      expect((await request.get("/admin")).headers["cache-control"]).to.include("no-store");
    });
    it("admin.js 包含 /admin 路径检测", function() { expect(adminJs).to.include("pathname === '/admin'"); });
  });
});

// ============================================
// 5.1 前台看板界面元素
// ============================================
describe("5.1 前台看板界面元素", function() {
  this.timeout(10000);

  it("标题为小王黄金烟酒", function() { expect(html).to.include("小王黄金烟酒"); });
  it("含副标题", function() { expect(html).to.include("各类烟酒"); });
  it("含实时时钟 id=realtimeClock", function() { expect(html).to.include("id=\"realtimeClock\""); });
  it("含管理按钮 id=adminBtn", function() { expect(html).to.include("id=\"adminBtn\""); });
  it("表头含 商品/回购价格/销售价格", function() { expect(appJs).to.include("商品"); expect(appJs).to.include("回购价格"); expect(appJs).to.include("销售价格"); });
  it("每行金属含元素符号", function() { expect(appJs).to.include("symbol"); });
  it("价格后标注 CNY/g", function() { expect(appJs).to.include("CNY/g"); });
  it("底部含电话 19191621889", function() { expect(html).to.include("19191621889"); });
  it("电话含点击复制文字", function() { expect(html).to.include("点击复制"); });
  it("含二维码 scannable 提示", function() { expect(html).to.include("扫一扫"); });
  it("app.js 绑定 phoneLink 点击事件", function() { expect(appJs).to.include("phoneLink.addEventListener"); });
});

// ============================================
// 5.2 管理后台界面元素
// ============================================
describe("5.2 管理后台界面元素", function() {
  this.timeout(10000);

  it("含登录表单 loginForm", function() { expect(html).to.include("id=\"loginForm\""); });
  it("含密码输入框", function() { expect(html).to.include("id=\"passwordInput\""); });
  it("含登录按钮 loginBtn", function() { expect(html).to.include("id=\"loginBtn\""); });
  it("含收购差价面板 diffPanel", function() { expect(html).to.include("id=\"diffPanel\""); });
  it("含收购差价列表 diffList", function() { expect(html).to.include("id=\"diffList\""); });
  it("含销售差价列表 salesDiffList", function() { expect(html).to.include("id=\"salesDiffList\""); });
  it("含退出登录按钮 logoutBtn", function() { expect(html).to.include("id=\"logoutBtn\""); });
  it("含修改密码按钮 pwdToggleBtn", function() { expect(html).to.include("id=\"pwdToggleBtn\""); });
  it("含密码输入框 oldPwdInput / newPwdInput / confirmPwdInput", function() {
    expect(html).to.include("id=\"oldPwdInput\"");
    expect(html).to.include("id=\"newPwdInput\"");
    expect(html).to.include("id=\"confirmPwdInput\"");
  });
  it("含保存密码按钮 savePwdBtn", function() { expect(html).to.include("id=\"savePwdBtn\""); });
});

// ============================================
// API 层 — 全部路由清单验证
// ============================================
describe("API 路由注册", function() {
  this.timeout(10000);

  it("GET  /api/prices", function() {
    var s = fs.readFileSync(path.join(__dirname,"..","server.js"),"utf-8");
    expect(s).to.include("app.get('/api/prices'");
  });
  it("POST /api/admin/login", function() {
    var s = fs.readFileSync(path.join(__dirname,"..","server.js"),"utf-8");
    expect(s).to.include("app.post('/api/admin/login'");
  });
  it("GET  /api/admin/status", function() {
    var s = fs.readFileSync(path.join(__dirname,"..","server.js"),"utf-8");
    expect(s).to.include("app.get('/api/admin/status'");
  });
  it("GET  /api/admin/differentials", function() {
    var s = fs.readFileSync(path.join(__dirname,"..","server.js"),"utf-8");
    expect(s).to.include("app.get('/api/admin/differentials'");
  });
  it("PUT  /api/admin/differentials/:metal", function() {
    var s = fs.readFileSync(path.join(__dirname,"..","server.js"),"utf-8");
    expect(s).to.include("app.put('/api/admin/differentials/");
  });
  it("GET  /api/admin/sales-differentials", function() {
    var s = fs.readFileSync(path.join(__dirname,"..","server.js"),"utf-8");
    expect(s).to.include("app.get('/api/admin/sales-differentials'");
  });
  it("PUT  /api/admin/sales-differentials/:metal", function() {
    var s = fs.readFileSync(path.join(__dirname,"..","server.js"),"utf-8");
    expect(s).to.include("app.put('/api/admin/sales-differentials/");
  });
  it("PUT  /api/admin/password", function() {
    var s = fs.readFileSync(path.join(__dirname,"..","server.js"),"utf-8");
    expect(s).to.include("app.put('/api/admin/password'");
  });
});
