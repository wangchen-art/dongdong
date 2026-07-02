process.env.ADMIN_PASSWORD = "test123";
var fs2 = require("fs");
var path2 = require("path");
try { fs2.unlinkSync(path2.join(__dirname,"..","data","admin-password.json")); } catch(e) {}
try { fs2.unlinkSync(path2.join(__dirname,"..","data","differentials.json")); } catch(e) {}
try { fs2.unlinkSync(path2.join(__dirname,"..","data","sales-differentials.json")); } catch(e) {}

var chai = require("chai");
var expect = chai.expect;
var supertest = require("supertest");
var serverMod = require("../server");
var app = serverMod.app;
var request = supertest(app);
var fs = require("fs");
var path = require("path");

var html = fs.readFileSync(path.join(__dirname,"..","public","index.html"),"utf-8");
var appJs = fs.readFileSync(path.join(__dirname,"..","public","js","app.js"),"utf-8");
var adminJs = fs.readFileSync(path.join(__dirname,"..","public","js","admin.js"),"utf-8");
var apiJs = fs.readFileSync(path.join(__dirname,"..","public","js","api.js"),"utf-8");
var css = fs.readFileSync(path.join(__dirname,"..","public","css","style.css"),"utf-8");
var serverJs = fs.readFileSync(path.join(__dirname,"..","server.js"),"utf-8");

async function getToken(pwd) {
  var res = await request.post("/api/admin/login").send({ password: pwd || "test123" });
  if (res.status !== 200) throw new Error("Login failed: " + res.status);
  return res.body.token;
}

describe("[API] 价格数据接口", function() {
  this.timeout(15000);

  it("GET /api/prices 返回 200", async function() {
    var res = await request.get("/api/prices");
    expect(res.status).to.equal(200);
  });

  it("返回数组且包含 4 种金属", async function() {
    var res = await request.get("/api/prices");
    expect(res.body).to.be.an("array").with.lengthOf(4);
  });

  it("每种金属包含完整字段", async function() {
    var res = await request.get("/api/prices");
    var requiredFields = ["metal","name","symbol","internationalPrice","domesticPrice","recyclingPrice","salesPrice","differential","lastUpdated","source"];
    res.body.forEach(function(item) {
      requiredFields.forEach(function(f) {
        expect(item).to.have.property(f);
      });
    });
  });

  it("金属名称为黄金/白银/铂金/钯金", async function() {
    var res = await request.get("/api/prices");
    var names = res.body.map(function(i) { return i.name; });
    expect(names).to.have.members(["黄金","白银","铂金","钯金"]);
  });

  it("价格均为正数", async function() {
    var res = await request.get("/api/prices");
    res.body.forEach(function(item) {
      expect(item.internationalPrice).to.be.above(0);
      expect(item.domesticPrice).to.be.above(0);
      expect(item.recyclingPrice).to.be.above(0);
      expect(item.salesPrice).to.be.above(0);
    });
  });

  it("回购价 = 国际价 - 收购差价", async function() {
    var res = await request.get("/api/prices");
    res.body.forEach(function(item) {
      var expected = parseFloat((item.internationalPrice - item.differential).toFixed(2));
      expect(item.recyclingPrice).to.equal(expected);
    });
  });

  it("销售价 = 国际价 + 销售差价", async function() {
    var loginRes = await request.post("/api/admin/login").send({ password: "test123" });
    var t = loginRes.body.token;
    await request.put("/api/admin/sales-differentials/gold").set("Authorization","Bearer "+t).send({differential:8});
    await request.put("/api/admin/sales-differentials/silver").set("Authorization","Bearer "+t).send({differential:0.5});
    await request.put("/api/admin/sales-differentials/platinum").set("Authorization","Bearer "+t).send({differential:5});
    await request.put("/api/admin/sales-differentials/palladium").set("Authorization","Bearer "+t).send({differential:6});
    var res = await request.get("/api/prices");
    var sdRes = await request.get("/api/admin/sales-differentials").set("Authorization","Bearer "+t);
    var salesDiffs = sdRes.body.differentials;
    res.body.forEach(function(item) {
      var expected = parseFloat((item.internationalPrice + salesDiffs[item.metal]).toFixed(2));
      expect(item.salesPrice).to.equal(expected);
    });
  });
});

describe("[API] 管理员登录与锁定", function() {
  this.timeout(15000);
  beforeEach(function() { if (serverMod.resetLoginAttempts) serverMod.resetLoginAttempts(); });

  it("正确密码返回 200 和 token", async function() {
    var res = await request.post("/api/admin/login").send({ password: "test123" });
    expect(res.status).to.equal(200);
    expect(res.body).to.have.property("token").that.is.a("string").with.length.above(20);
  });

  it("错误密码返回 401", async function() {
    var res = await request.post("/api/admin/login").send({ password: "wrong_password" });
    expect(res.status).to.equal(401);
  });

  it("缺失密码返回 401", async function() {
    var res = await request.post("/api/admin/login").send({});
    expect(res.status).to.equal(401);
  });

  it("空字符串密码返回 401", async function() {
    var res = await request.post("/api/admin/login").send({ password: "" });
    expect(res.status).to.equal(401);
  });

  it("错误密码返回 remainingAttempts", async function() {
    var res = await request.post("/api/admin/login").send({ password: "wrong1" });
    expect(res.status).to.equal(401);
    expect(res.body.remainingAttempts).to.equal(4);
  });

  it("连续 5 次失败后锁定 429", async function() {
    for (var i = 0; i < 5; i++) { await request.post("/api/admin/login").send({ password: "bad"+i }); }
    var res = await request.post("/api/admin/login").send({ password: "test123" });
    expect(res.status).to.equal(429);
    expect(res.body.locked).to.be.true;
  });

  it("锁定后正确密码也无法登录", async function() {
    for (var i = 0; i < 5; i++) { await request.post("/api/admin/login").send({ password: "bad"+i }); }
    var res = await request.post("/api/admin/login").send({ password: "test123" });
    expect(res.status).to.equal(429);
  });

  it("登录成功清除失败记录", async function() {
    for (var i = 0; i < 3; i++) { await request.post("/api/admin/login").send({ password: "bad"+i }); }
    var loginRes = await request.post("/api/admin/login").send({ password: "test123" });
    expect(loginRes.status).to.equal(200);
    var nextFail = await request.post("/api/admin/login").send({ password: "wrong_again" });
    expect(nextFail.status).to.equal(401);
    expect(nextFail.body.remainingAttempts).to.equal(4);
  });
});

describe("[API] 登录状态查询", function() {
  this.timeout(10000);
  beforeEach(function() { if (serverMod.resetLoginAttempts) serverMod.resetLoginAttempts(); });

  it("GET /api/admin/status 返回 locked:false", async function() {
    var res = await request.get("/api/admin/status");
    expect(res.body.locked).to.be.false;
  });

  it("失败 5 次后 status 返回 locked:true", async function() {
    for (var i = 0; i < 5; i++) { await request.post("/api/admin/login").send({ password: "bad"+i }); }
    var res = await request.get("/api/admin/status");
    expect(res.body.locked).to.be.true;
  });
});

describe("[API] 收购差价管理", function() {
  this.timeout(15000);
  var token;

  before(async function() {
    if (serverMod.resetLoginAttempts) serverMod.resetLoginAttempts();
    token = await getToken("test123");
  });

  it("未认证请求返回 401", async function() {
    expect((await request.get("/api/admin/differentials")).status).to.equal(401);
  });

  it("无效 token 返回 401", async function() {
    expect((await request.get("/api/admin/differentials").set("Authorization","Bearer invalid")).status).to.equal(401);
  });

  it("有效 token 可获取差价", async function() {
    var res = await request.get("/api/admin/differentials").set("Authorization","Bearer "+token);
    expect(res.status).to.equal(200);
    expect(res.body.differentials).to.have.all.keys("gold","silver","platinum","palladium");
  });

  it("设置差价后返回更新值", async function() {
    var res = await request.put("/api/admin/differentials/gold").set("Authorization","Bearer "+token).send({differential:15.5});
    expect(res.status).to.equal(200);
    expect(res.body.differential).to.equal(15.5);
  });

  it("设置后 GET 查询已更新", async function() {
    var res = await request.get("/api/admin/differentials").set("Authorization","Bearer "+token);
    expect(res.body.differentials.gold).to.equal(15.5);
  });

  it("无效金属返回 400", async function() {
    expect((await request.put("/api/admin/differentials/copper").set("Authorization","Bearer "+token).send({differential:10})).status).to.equal(400);
  });

  it("非数字返回 400", async function() {
    expect((await request.put("/api/admin/differentials/gold").set("Authorization","Bearer "+token).send({differential:"abc"})).status).to.equal(400);
  });

  it("差价不能大于当前国际价返回 400", async function() {
    var priceRes = await request.get("/api/prices");
    var gold = priceRes.body.find(function(m){return m.metal==="gold";});
    var res = await request.put("/api/admin/differentials/gold").set("Authorization","Bearer "+token).send({differential:gold.internationalPrice+1000});
    expect(res.status).to.equal(400);
  });
});

describe("[API] 销售差价管理", function() {
  this.timeout(15000);
  var token;

  before(async function() {
    if (serverMod.resetLoginAttempts) serverMod.resetLoginAttempts();
    token = await getToken("test123");
  });

  it("未认证请求返回 401", async function() {
    expect((await request.get("/api/admin/sales-differentials")).status).to.equal(401);
  });

  it("有效 token 可获取销售差价", async function() {
    var res = await request.get("/api/admin/sales-differentials").set("Authorization","Bearer "+token);
    expect(res.status).to.equal(200);
    expect(res.body.differentials).to.have.all.keys("gold","silver","platinum","palladium");
  });

  it("设置销售差价成功", async function() {
    var res = await request.put("/api/admin/sales-differentials/gold").set("Authorization","Bearer "+token).send({differential:10});
    expect(res.status).to.equal(200);
    expect(res.body.differential).to.equal(10);
  });

  it("销售差价为负数返回 400", async function() {
    expect((await request.put("/api/admin/sales-differentials/gold").set("Authorization","Bearer "+token).send({differential:-5})).status).to.equal(400);
  });

  it("无效金属返回 400", async function() {
    expect((await request.put("/api/admin/sales-differentials/copper").set("Authorization","Bearer "+token).send({differential:10})).status).to.equal(400);
  });

  it("非数字返回 400", async function() {
    expect((await request.put("/api/admin/sales-differentials/gold").set("Authorization","Bearer "+token).send({differential:"xyz"})).status).to.equal(400);
  });
});

describe("[API] 管理员密码管理", function() {
  this.timeout(15000);
  var token;

  before(async function() {
    if (serverMod.resetLoginAttempts) serverMod.resetLoginAttempts();
    var loginRes = await request.post("/api/admin/login").send({ password: "test123" });
    expect(loginRes.status).to.equal(200);
    token = loginRes.body.token;
  });

  it("未认证请求返回 401", async function() {
    expect((await request.put("/api/admin/password").send({oldPassword:"test123",newPassword:"newpwd"})).status).to.equal(401);
  });

  it("正确原密码可修改", async function() {
    var res = await request.put("/api/admin/password").set("Authorization","Bearer "+token).send({oldPassword:"test123",newPassword:"newpass789"});
    expect(res.status).to.equal(200);
    expect(res.body.message).to.equal("密码修改成功");
  });

  it("新密码可用于登录", async function() {
    var res = await request.post("/api/admin/login").send({ password: "newpass789" });
    expect(res.status).to.equal(200);
    token = res.body.token;
  });

  it("旧密码无法登录", async function() {
    expect((await request.post("/api/admin/login").send({password:"test123"})).status).to.equal(401);
  });

  it("原密码错误返回 401", async function() {
    var res = await request.put("/api/admin/password").set("Authorization","Bearer "+token).send({oldPassword:"wrong_old",newPassword:"abc12345"});
    expect(res.status).to.equal(401);
    expect(res.body.error).to.include("原密码错误");
  });

  it("新密码太短 (<4位) 返回 400", async function() {
    var res = await request.put("/api/admin/password").set("Authorization","Bearer "+token).send({oldPassword:"newpass789",newPassword:"ab"});
    expect(res.status).to.equal(400);
  });

  it("新密码不能与原密码相同返回 400", async function() {
    var res = await request.put("/api/admin/password").set("Authorization","Bearer "+token).send({oldPassword:"newpass789",newPassword:"newpass789"});
    expect(res.status).to.equal(400);
  });

  it("恢复初始密码", async function() {
    var res = await request.put("/api/admin/password").set("Authorization","Bearer "+token).send({oldPassword:"newpass789",newPassword:"test123"});
    expect(res.status).to.equal(200);
    var loginRes = await request.post("/api/admin/login").send({ password: "test123" });
    expect(loginRes.status).to.equal(200);
  });
});

describe("[API] 跨域与错误处理", function() {
  this.timeout(10000);
  it("CORS 头包含 Access-Control-Allow-Origin: *", async function() {
    expect((await request.get("/api/prices")).headers["access-control-allow-origin"]).to.equal("*");
  });
  it("CORS 预检 OPTIONS 返回 204", async function() {
    expect((await request.options("/api/prices")).status).to.equal(204);
  });
  it("未知路由不崩溃", async function() {
    expect((await request.get("/api/nonexistent")).status).to.not.equal(500);
  });
});

describe("[FRONTEND] 静态资源可访问", function() {
  this.timeout(10000);
  it("index.html 返回 200", async function() { expect((await request.get("/")).status).to.equal(200); });
  it("style.css 可加载", async function() { expect((await request.get("/css/style.css")).status).to.equal(200); });
  it("app.js 可加载", async function() { expect((await request.get("/js/app.js")).status).to.equal(200); });
  it("api.js 可加载", async function() { expect((await request.get("/js/api.js")).status).to.equal(200); });
  it("admin.js 可加载", async function() { expect((await request.get("/js/admin.js")).status).to.equal(200); });
  it("qr-code.png 可访问 (200 + image/png)", async function() {
    var res = await request.get("/qr-code.png");
    expect(res.status).to.equal(200);
    expect(res.headers["content-type"]).to.include("image/png");
  });
});

describe("[FRONTEND] 首页 HTML 结构", function() {
  it("标题含小王黄金烟酒", function() { expect(html).to.include("小王黄金烟酒"); });
  it("含实时时钟 realtimeClock", function() { expect(html).to.include("id=\"realtimeClock\""); });
  it("含管理后台按钮 adminBtn", function() { expect(html).to.include("id=\"adminBtn\""); });
  it("含价格看板 priceBoard", function() { expect(html).to.include("id=\"priceBoard\""); });
  it("含加载指示器", function() { expect(html).to.include("id=\"loadingIndicator\""); });
  it("含状态条 statusBar", function() { expect(html).to.include("id=\"statusBar\""); });
  it("不包含已删除的 updateTime", function() { expect(html).to.not.include("id=\"updateTime\""); });
});

describe("[FRONTEND] 底部联系方式（二维码+电话）", function() {
  it("含 footer", function() { expect(html).to.include("<footer class=\"footer\">"); });
  it("含 footer-content", function() { expect(html).to.include("footer-content"); });
  it("含二维码区域", function() { expect(html).to.include("footer-qr-section"); });
  it("含 qr-code.png", function() { expect(html).to.include("qr-code.png"); });
  it("含扫一扫加微信咨询", function() { expect(html).to.include("扫一扫加微信咨询"); });
  it("含电话链接 phoneLink", function() { expect(html).to.include("id=\"phoneLink\""); });
  it("含号码 19191621889", function() { expect(html).to.include("19191621889"); });
  it("含点击复制提示", function() { expect(html).to.include("点击复制"); });
});

describe("[FRONTEND] 管理后台浮层", function() {
  it("含 overlay", function() { expect(html).to.include("id=\"adminOverlay\""); });
  it("含登录表单", function() { expect(html).to.include("id=\"loginForm\""); });
  it("含差价面板", function() { expect(html).to.include("id=\"diffPanel\""); });
  it("含收购差价列表", function() { expect(html).to.include("id=\"diffList\""); });
  it("含销售差价列表", function() { expect(html).to.include("id=\"salesDiffList\""); });
  it("含退出登录按钮", function() { expect(html).to.include("id=\"logoutBtn\""); });
  it("含密码修改元素", function() {
    expect(html).to.include("id=\"pwdToggleBtn\"");
    expect(html).to.include("id=\"savePwdBtn\"");
  });
  it("含 Toast 提示", function() { expect(html).to.include("class=\"toast\""); });
});

describe("[FRONTEND] /admin 路由", function() {
  it("返回 200", async function() { expect((await request.get("/admin")).status).to.equal(200); });
  it("含 Cache-Control: no-store", async function() {
    expect((await request.get("/admin")).headers["cache-control"]).to.include("no-store");
  });
});

describe("[FRONTEND] app.js 前端逻辑", function() {
  it("定义 priceBoard/statusBar/adminBtn/overlay/loadingIndicator", function() {
    expect(appJs).to.include("var priceBoard");
    expect(appJs).to.include("var statusBar");
    expect(appJs).to.include("var adminBtn");
    expect(appJs).to.include("var overlay");
    expect(appJs).to.include("var loadingIndicator");
  });
  it("含刷新函数 refreshPrices", function() { expect(appJs).to.include("async function refreshPrices"); });
  it("含渲染函数 renderPrices", function() { expect(appJs).to.include("function renderPrices"); });
  it("含时钟函数 startClock", function() { expect(appJs).to.include("function startClock"); });
  it("使用 price-table", function() { expect(appJs).to.include("price-table"); });
  it("含回购/销售表头", function() { expect(appJs).to.include("回购价格"); expect(appJs).to.include("销售价格"); });
  it("含 up/down 涨跌类", function() { expect(appJs).to.include('classList.add("up")'); expect(appJs).to.include('classList.add("down")'); });
  it("含电话复制功能", function() { expect(appJs).to.include("PHONE_NUMBER"); expect(appJs).to.include("function copyPhoneNumber"); });
  it("phoneLink 绑定了事件", function() { expect(appJs).to.include("phoneLink.addEventListener"); });
  it("不包含已删除的 updateTimeEl", function() { expect(appJs).to.not.include("updateTimeEl"); });
});

describe("[FRONTEND] admin.js 后台逻辑", function() {
  it("含 handleLogin", function() { expect(adminJs).to.include("async function handleLogin"); });
  it("含 handleLogout", function() { expect(adminJs).to.include("function handleLogout"); });
  it("含 checkAuth", function() { expect(adminJs).to.include("async function checkAuth"); });
  it("含 handlePasswordChange", function() { expect(adminJs).to.include("async function handlePasswordChange"); });
  it("含 loadSalesDifferentials", function() { expect(adminJs).to.include("async function loadSalesDifferentials"); });
  it("使用 localStorage 管理 token", function() {
    expect(adminJs).to.include("localStorage.getItem");
    expect(adminJs).to.include("localStorage.setItem");
    expect(adminJs).to.include("localStorage.removeItem");
  });
  it("检测 /admin 路径自动打开后台", function() {
    expect(adminJs).to.include("pathname === '/admin'");
    expect(adminJs).to.include("overlay.classList.add('active')");
  });
  it("支持 Ctrl+Shift+A 快捷键", function() {
    expect(adminJs).to.include("ctrlKey");
    expect(adminJs).to.include("shiftKey");
  });
  it("退出登录跳转首页", function() { expect(adminJs).to.include("window.location.href = '/'"); });
});

describe("[FRONTEND] style.css 样式", function() {
  it("含深色主题 CSS 变量", function() { expect(css).to.include("--bg-primary: #0d1117"); });
  it("含金色强调色", function() { expect(css).to.include("--accent-gold: #c9a94e"); });
  it("含涨红跌绿样式", function() { expect(css).to.include(".price-cell.up"); expect(css).to.include(".price-cell.down"); });
  it("含闪烁动画", function() { expect(css).to.include("@keyframes priceFlash"); });
  it("含二维码区域样式", function() {
    expect(css).to.include(".footer-content");
    expect(css).to.include(".footer-qr-section");
    expect(css).to.include(".footer-qr-img");
  });
  it("含 Toast 样式", function() { expect(css).to.include(".toast.show"); });
  it("含响应式媒体查询 900px 和 520px", function() {
    expect(css).to.include("@media (max-width: 900px)");
    expect(css).to.include("@media (max-width: 520px)");
  });
});

describe("[FRONTEND] api.js 接口封装", function() {
  it("含 fetchPrices", function() { expect(apiJs).to.include("fetchPrices"); });
  it("含 adminLogin", function() { expect(apiJs).to.include("adminLogin"); });
  it("含 getDifferentials", function() { expect(apiJs).to.include("getDifferentials"); });
  it("含 setDifferential", function() { expect(apiJs).to.include("setDifferential"); });
  it("含 getSalesDifferentials", function() { expect(apiJs).to.include("getSalesDifferentials"); });
  it("含 setSalesDifferential", function() { expect(apiJs).to.include("setSalesDifferential"); });
  it("含 setPassword", function() { expect(apiJs).to.include("setPassword"); });
});

describe("[BACKEND] 服务端模块", function() {
  this.timeout(10000);
  it("导出 app、DifferentialStore、AuthStore、PriceCache", function() {
    expect(serverMod).to.have.property("app");
    expect(serverMod).to.have.property("DifferentialStore");
    expect(serverMod).to.have.property("AuthStore");
    expect(serverMod).to.have.property("PriceCache");
    expect(serverMod).to.have.property("METALS").that.is.an("array").with.lengthOf(4);
  });
  it("server.js 含密码加密存储", function() { expect(serverJs).to.include("class PasswordStore"); });
  it("server.js 含登录锁定", function() { expect(serverJs).to.include("MAX_LOGIN_ATTEMPTS"); });
  it("server.js 含模拟数据降级", function() { expect(serverJs).to.include("MOCK_PRICES"); });
  it("server.js 含 scraper 子进程", function() { expect(serverJs).to.include("spawn("); });
  it("server.js 含随机刷新间隔", function() { expect(serverJs).to.include("randomInterval"); });
  it("server.js 含认证中间件", function() { expect(serverJs).to.include("function authMiddleware"); });
  it("server.js 含 8 个 API 路由", function() {
    expect(serverJs).to.include("app.get('/api/prices'");
    expect(serverJs).to.include("app.post('/api/admin/login'");
    expect(serverJs).to.include("app.get('/api/admin/status'");
    expect(serverJs).to.include("app.get('/api/admin/differentials'");
    expect(serverJs).to.include("app.put('/api/admin/differentials/");
    expect(serverJs).to.include("app.get('/api/admin/sales-differentials'");
    expect(serverJs).to.include("app.put('/api/admin/sales-differentials/");
    expect(serverJs).to.include("app.put('/api/admin/password'");
  });
  it("Token 24h 过期+定期清理", function() { expect(serverJs).to.include("TOKEN_TTL"); expect(serverJs).to.include("_cleanup"); });
  it("支持重置密码标志", function() { expect(serverJs).to.include("--reset-password"); });
});

describe("[BACKEND] DifferentialStore 单元测试", function() {
  var store;
  beforeEach(function() { store = new serverMod.DifferentialStore(); });
  it("初始化差价=0", function() { var all=store.getAll(); ["gold","silver","platinum","palladium"].forEach(function(k){expect(all[k]).to.equal(0);}); });
  it("set/get 正常", function() { store.set("gold",10.5); expect(store.get("gold")).to.equal(10.5); });
  it("多种金属互不干扰", function() { store.set("gold",5); store.set("silver",1.2); expect(store.get("gold")).to.equal(5); expect(store.get("silver")).to.equal(1.2); expect(store.get("platinum")).to.equal(0); });
  it("无效金属抛异常", function() { expect(function(){store.set("invalid",10);}).to.throw(); });
});

describe("[BACKEND] AuthStore 单元测试", function() {
  it("createToken 返回长字符串", function() {
    var auth = new serverMod.AuthStore();
    expect(auth.createToken()).to.be.a("string").with.length.above(30);
  });
  it("有效 token 返回 true", function() {
    var auth = new serverMod.AuthStore();
    expect(auth.validateToken(auth.createToken())).to.be.true;
  });
  it("无效 token 返回 false", function() {
    expect((new serverMod.AuthStore()).validateToken("invalid")).to.be.false;
  });
  it("多次调用生成不同 token", function() {
    var auth = new serverMod.AuthStore();
    expect(auth.createToken()).to.not.equal(auth.createToken());
  });
});
