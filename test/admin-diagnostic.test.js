
// ============================================
// admin-diagnostic.test.js - admin.js 前端完整性诊断
// ============================================

process.env.ADMIN_PASSWORD = 'test123';
var serverMod = require('../server');
var app = serverMod.app;
var supertest = require('supertest');
var request = supertest(app);
var resetLoginAttempts = serverMod.resetLoginAttempts;
var chai = require('chai');
var expect = chai.expect;

describe('admin.js 前端诊断', function() {

  beforeEach(function() {
    if (resetLoginAttempts) resetLoginAttempts();
  });

  it('admin.js 中所有 getElementById 引用的 ID 都存在于 index.html', async function() {
    var adminRes = await request.get('/js/admin.js');
    var htmlRes = await request.get('/');
    var adminJs = adminRes.text;
    var html = htmlRes.text;

    var idRegex = /getElementById\(\'([^']+)\'\)/g;
    var adminIds = [];
    var match;
    while ((match = idRegex.exec(adminJs)) !== null) {
      adminIds.push(match[1]);
    }

    var htmlIdRegex = /id="([^"]+)"/g;
    var htmlIds = [];
    while ((match = htmlIdRegex.exec(html)) !== null) {
      htmlIds.push(match[1]);
    }

    var missing = adminIds.filter(function(id) { return htmlIds.indexOf(id) === -1; });
    expect(missing).to.deep.equal([]);
  });

  it('/admin 页面包含所有关键元素', async function() {
    var res = await request.get('/admin');
    var html = res.text;
    expect(html).to.include('adminOverlay');
    expect(html).to.include('loginForm');
    expect(html).to.include('diffPanel');
    expect(html).to.include('loginBtn');
    expect(html).to.include('passwordInput');
  });

  it('admin.js 包含 /admin 路径检测代码', async function() {
    var res = await request.get('/js/admin.js');
    var js = res.text;
    expect(js).to.include("location.pathname === '/admin'");
    expect(js).to.include("overlay.classList.add('active')");
    expect(js).to.include('checkAuth()');
    expect(js).to.include('showLoginForm()');
  });

  it('admin.js 可安全执行（所有回调函数已定义）', async function() {
    var res = await request.get('/js/admin.js');
    var js = res.text;
    expect(js).to.include('function handleLogin');
    expect(js).to.include('function handleLogout');
    expect(js).to.include('function checkAuth');
    expect(js).to.include('function showLoginForm');
    expect(js).to.include('function showDiffPanel');
    expect(js).to.include('function handlePasswordChange');
    expect(js).to.include('function handleSaveDifferential');
  });

  it('app.js 定义了 overlay 变量（admin.js 依赖它）', async function() {
    var res = await request.get('/js/app.js');
    var js = res.text;
    expect(js).to.include('var overlay');
    expect(js).to.include('getElementById');
    expect(js).to.include('adminBtn');
  
  it('退出登录后跳转到首页 /', async function () {
    var adminRes = await request.get('/js/admin.js');
    var adminJs = adminRes.text;
    expect(adminJs).to.include('window.location.href');
  });

});
});
