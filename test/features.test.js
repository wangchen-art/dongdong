process.env.ADMIN_PASSWORD = 'test123';
var fs = require('fs');
var path = require('path');
try { fs.unlinkSync(path.join(__dirname, '..', 'data', 'admin-password.json')); } catch(e) {}
var chai = require('chai');
var expect = chai.expect;
var request = require('supertest');
var mod = require('../server');
var app = mod.app;
var r = request(app);
async function login(pwd) { var res = await r.post('/api/admin/login').send({ password: pwd || 'test123' }); return res.body.token; }
describe('完整功能测试', function() {
  this.timeout(15000);
  describe('价格接口', function() {
    it('GET /api/prices 返回 200', async function() {
      var res = await r.get('/api/prices');
      expect(res.status).to.equal(200);
    });
    it('返回4种金属数据', async function() {
      var res = await r.get('/api/prices');
      expect(res.body).to.be.an('array').with.lengthOf(4);
    });
    it('每条数据包含完整字段', async function() {
      var res = await r.get('/api/prices');
      var item = res.body[0];
      expect(item).to.include.keys('metal','name','symbol','internationalPrice','recyclingPrice','salesPrice','differential','lastUpdated');
    });
    it('金属名称为黄金白银铂金钯金', async function() {
      var res = await r.get('/api/prices');
      var names = res.body.map(function(i) { return i.name; });
      expect(names).to.have.members(['黄金','白银','铂金','钯金']);
    });
  });
  describe('管理员登录', function() {
    it('正确密码返回 token', async function() {
      var res = await r.post('/api/admin/login').send({ password: 'test123' });
      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('token');
      expect(res.body.token).to.be.a('string').with.length.above(20);
    });
    it('错误密码返回 401', async function() {
      var res = await r.post('/api/admin/login').send({ password: 'wrong' });
      expect(res.status).to.equal(401);
      expect(res.body).to.have.property('error').that.includes('密码错误');
    });
    it('空密码返回 401', async function() {
      var res = await r.post('/api/admin/login').send({});
      expect(res.status).to.equal(401);
    });
  });
  describe('登录锁定', function() {
    beforeEach(function() { mod.resetLoginAttempts(); });
    it('连续 5 次错误后锁定', async function() {
      for (var i = 0; i < 5; i++) { await r.post('/api/admin/login').send({ password: 'wrong' }); }
      var res = await r.post('/api/admin/login').send({ password: 'test123' });
      expect(res.status).to.equal(429);
      expect(res.body).to.have.property('locked', true);
    });
    it('锁定状态可通过 status 查询', async function() {
      for (var i = 0; i < 5; i++) { await r.post('/api/admin/login').send({ password: 'wrong' }); }
      var res = await r.get('/api/admin/status');
      expect(res.body).to.have.property('locked', true);
    });
    it('未锁定时 status 返回 locked:false', async function() {
      var res = await r.get('/api/admin/status');
      expect(res.body).to.have.property('locked', false);
    });
  });
  describe('收购差价管理', function() {
    var token;
    before(async function() { token = await login(); });
    beforeEach(function() { mod.resetLoginAttempts(); });
    it('未认证请求返回 401', async function() {
      var res = await r.get('/api/admin/differentials');
      expect(res.status).to.equal(401);
    });
    it('认证后可获取差价', async function() {
      var res = await r.get('/api/admin/differentials').set('Authorization', 'Bearer ' + token);
      expect(res.status).to.equal(200);
      expect(res.body.differentials).to.include.keys('gold','silver','platinum','palladium');
    });
    it('可设置差价', async function() {
      var res = await r.put('/api/admin/differentials/gold').set('Authorization', 'Bearer ' + token).send({ differential: 15 });
      expect(res.status).to.equal(200);
      expect(res.body.differential).to.equal(15);
    });
    it('无效金属类型返回 400', async function() {
      var res = await r.put('/api/admin/differentials/copper').set('Authorization', 'Bearer ' + token).send({ differential: 10 });
      expect(res.status).to.equal(400);
    });
    it('非数字返回 400', async function() {
      var res = await r.put('/api/admin/differentials/gold').set('Authorization', 'Bearer ' + token).send({ differential: 'abc' });
      expect(res.status).to.equal(400);
    });
  });
  describe('销售差价管理', function() {
    var token;
    before(async function() { token = await login(); });
    it('可设置销售差价', async function() {
      var res = await r.put('/api/admin/sales-differentials/gold').set('Authorization', 'Bearer ' + token).send({ differential: 10 });
      expect(res.status).to.equal(200);
    });
    it('可获取销售差价', async function() {
      var res = await r.get('/api/admin/sales-differentials').set('Authorization', 'Bearer ' + token);
      expect(res.status).to.equal(200);
      expect(res.body.differentials).to.include.keys('gold','silver','platinum','palladium');
    });
    it('销售差价为负数拒绝', async function() {
      var res = await r.put('/api/admin/sales-differentials/gold').set('Authorization', 'Bearer ' + token).send({ differential: -5 });
      expect(res.status).to.equal(400);
    });
  });
  describe('修改密码', function() {
    var token;
    before(async function() { token = await login(); });
    it('正确原密码可修改', async function() {
      var res = await r.put('/api/admin/password').set('Authorization', 'Bearer ' + token).send({ oldPassword: 'test123', newPassword: 'newpwd456' });
      expect(res.status).to.equal(200);
      expect(res.body.message).to.equal('密码修改成功');
    });
    it('新密码可用于登录', async function() {
      var res = await r.post('/api/admin/login').send({ password: 'newpwd456' });
      expect(res.status).to.equal(200);
    });
    it('旧密码无法登录', async function() {
      var res = await r.post('/api/admin/login').send({ password: 'test123' });
      expect(res.status).to.equal(401);
    });
    it('原密码错误返回 401', async function() {
      var nt = await login('newpwd456');
      var res = await r.put('/api/admin/password').set('Authorization', 'Bearer ' + nt).send({ oldPassword: 'wrong', newPassword: 'abc' });
      expect(res.status).to.equal(401);
    });
    it('新密码太短返回 400', async function() {
      var nt = await login('newpwd456');
      var res = await r.put('/api/admin/password').set('Authorization', 'Bearer ' + nt).send({ oldPassword: 'newpwd456', newPassword: 'ab' });
      expect(res.status).to.equal(400);
    });
  });
  describe('前台页面', function() {
    it('首页返回 200', async function() {
      var res = await r.get('/');
      expect(res.status).to.equal(200);
    });
    it('首页包含价格看板结构', async function() {
      var res = await r.get('/');
      expect(res.text).to.include('price-board');
      expect(res.text).to.include('realtime-clock');
    });
    it('/admin 返回 200 且无缓存', async function() {
      var res = await r.get('/admin');
      expect(res.status).to.equal(200);
      expect(res.headers['cache-control']).to.include('no-store');
    });
    it('admin.js 可正常加载', async function() {
      var res = await r.get('/js/admin.js');
      expect(res.status).to.equal(200);
    });
    it('app.js 和 style.css 可正常加载', async function() {
      expect((await r.get('/js/app.js')).status).to.equal(200);
      expect((await r.get('/css/style.css')).status).to.equal(200);
    });
    it('页面包含管理后台 DOM 元素', async function() {
      var res = await r.get('/');
      expect(res.text).to.include('id="adminOverlay"');
      expect(res.text).to.include('id="loginForm"');
      expect(res.text).to.include('id="adminBtn"');
    });
  });
});
