// ============================================
// api.test.js - API 接口集成测试
// 使用 supertest 模拟 HTTP 请求
// ============================================

const chai = require('chai');
const supertest = require('supertest');

// 设置测试环境变量（在引入 server 前设置）
process.env.ADMIN_PASSWORD = 'test123';

const serverModule = require('../server');
const app = serverModule.app;
const resetLoginAttempts = serverModule.resetLoginAttempts;

const { expect } = chai;
const request = supertest(app);

describe('API 接口集成测试', () => {
  /** @type {string} 登录后获取的 token */
  let token;

  // ========== GET /api/prices ==========
  describe('GET /api/prices — 获取价格数据', () => {

    it('应返回 200 状态码', async () => {
      const res = await request.get('/api/prices');
      expect(res.status).to.equal(200);
    });

    it('应返回包含 4 种金属的数组', async () => {
      const res = await request.get('/api/prices');
      expect(res.body).to.be.an('array');
      expect(res.body).to.have.lengthOf(4);
    });

    it('每种金属应包含完整的价格字段', async () => {
      const res = await request.get('/api/prices');
      res.body.forEach((item) => {
        expect(item).to.have.all.keys(
          'metal', 'name', 'symbol',
          'internationalPrice', 'domesticPrice',
          'recyclingPrice', 'differential',
          'lastUpdated', 'source'
        );
      });
    });

    it('黄金的回收价 = 国内价(CNY/g) - 差价', async () => {
      const res = await request.get('/api/prices');
      const gold = res.body.find((m) => m.metal === 'gold');
      const expected = parseFloat((gold.domesticPrice - gold.differential).toFixed(2));
      expect(gold.recyclingPrice).to.equal(expected);
    });
  });

  // ========== POST /api/admin/login ==========
  describe('POST /api/admin/login — 管理员登录', () => {

    it('正确密码应返回 token', async () => {
      const res = await request.post('/api/admin/login').send({ password: 'test123' });
      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('token');
      expect(res.body.token).to.be.a('string').with.length.greaterThan(0);
      token = res.body.token;
    });

    it('错误密码应返回 401', async () => {
      const res = await request.post('/api/admin/login').send({ password: 'wrong_password' });
      expect(res.status).to.equal(401);
      expect(res.body).to.have.property('error');
    });

    it('缺失密码字段应返回 401', async () => {
      const res = await request.post('/api/admin/login').send({});
      expect(res.status).to.equal(401);
    });
  });

  // ========== GET /api/admin/differentials ==========
  describe('登录失败锁定机制', () => {

    beforeEach(function() {
      // 每次测试前重置失败记录
      if (resetLoginAttempts) resetLoginAttempts();
    });

    it('错误密码返回剩余尝试次数', async () => {
      var res = await request.post('/api/admin/login').send({ password: 'wrong1' });
      expect(res.status).to.equal(401);
      expect(res.body.remainingAttempts).to.equal(4);
    });

    it('连续 5 次密码错误后锁定', async () => {
      for (var i = 0; i < 4; i++) {
        await request.post('/api/admin/login').send({ password: 'wrong' + i });
      }
      // 第 5 次错误
      var res = await request.post('/api/admin/login').send({ password: 'wrong_final' });
      expect(res.status).to.equal(429);
      expect(res.body.locked).to.be.true;

      // 第 5 次触发锁定 → 锁定
      var res2 = await request.post('/api/admin/login').send({ password: 'wrong_again' });
      expect(res2.status).to.equal(429);
      expect(res2.body.locked).to.be.true;
    });

    it('锁定后正确密码也无法登录', async () => {
      // 先触发锁定
      for (var i = 0; i < 6; i++) {
        await request.post('/api/admin/login').send({ password: 'bad' + i });
      }
      // 用正确密码尝试
      var res = await request.post('/api/admin/login').send({ password: 'test123' });
      expect(res.status).to.equal(429);
    });

    it('登录成功后清除失败记录', async () => {
      // 失败 3 次
      for (var i = 0; i < 3; i++) {
        await request.post('/api/admin/login').send({ password: 'bad' + i });
      }
      // 正确登录
      var loginRes = await request.post('/api/admin/login').send({ password: 'test123' });
      expect(loginRes.status).to.equal(200);
      token = loginRes.body.token;

      // 再次失败应该从 0 开始计数
      var failRes = await request.post('/api/admin/login').send({ password: 'wrong_again' });
      expect(failRes.status).to.equal(401);
      expect(failRes.body.remainingAttempts).to.equal(4);
    });
  });

  describe('GET /api/admin/differentials — 获取差价配置', () => {

    it('未携带 token 应返回 401', async () => {
      const res = await request.get('/api/admin/differentials');
      expect(res.status).to.equal(401);
    });

    it('携带无效 token 应返回 401', async () => {
      const res = await request
        .get('/api/admin/differentials')
        .set('Authorization', 'Bearer invalid-token-here');
      expect(res.status).to.equal(401);
    });

    it('有效 token 应返回差价配置对象', async () => {
      const res = await request
        .get('/api/admin/differentials')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('differentials');
      expect(res.body.differentials).to.have.all.keys('gold', 'silver', 'platinum', 'palladium');
    });
  });

  // ========== PUT /api/admin/differentials/:metal ==========
  describe('PUT /api/admin/password — 修改密码', () => {

    it('未认证的请求应返回 401', async () => {
      const res = await request.put('/api/admin/password').send({ oldPassword: 'x', newPassword: 'y' });
      expect(res.status).to.equal(401);
    });

    it('原密码错误应返回 401', async () => {
      const res = await request
        .put('/api/admin/password')
        .set('Authorization', 'Bearer ' + token)
        .send({ oldPassword: 'wrong_old', newPassword: 'newpass' });
      expect(res.status).to.equal(401);
    });

    it('新密码长度不足 4 位应返回 400', async () => {
      const res = await request
        .put('/api/admin/password')
        .set('Authorization', 'Bearer ' + token)
        .send({ oldPassword: 'test123', newPassword: 'ab' });
      expect(res.status).to.equal(400);
    });

    it('新密码不能与原密码相同应返回 400', async () => {
      const res = await request
        .put('/api/admin/password')
        .set('Authorization', 'Bearer ' + token)
        .send({ oldPassword: 'test123', newPassword: 'test123' });
      expect(res.status).to.equal(400);
    });

    it('有效密码修改应成功', async () => {
      const res = await request
        .put('/api/admin/password')
        .set('Authorization', 'Bearer ' + token)
        .send({ oldPassword: 'test123', newPassword: 'new456' });
      expect(res.status).to.equal(200);

      // 验证新密码可以登录
      const loginRes = await request.post('/api/admin/login').send({ password: 'new456' });
      expect(loginRes.status).to.equal(200);
      expect(loginRes.body).to.have.property('token');

      // 恢复原密码
      const newToken = loginRes.body.token;
      await request
        .put('/api/admin/password')
        .set('Authorization', 'Bearer ' + newToken)
        .send({ oldPassword: 'new456', newPassword: 'test123' });
    });
  });

  describe('PUT /api/admin/differentials/:metal — 设置差价', () => {

    it('未认证的请求应返回 401', async () => {
      const res = await request
        .put('/api/admin/differentials/gold')
        .send({ differential: 10 });
      expect(res.status).to.equal(401);
    });

    it('设置有效差价应返回更新后的值', async () => {
      const res = await request
        .put('/api/admin/differentials/gold')
        .set('Authorization', `Bearer ${token}`)
        .send({ differential: 15.5 });
      expect(res.status).to.equal(200);
      expect(res.body.differential).to.equal(15.5);
      expect(res.body.metal).to.equal('gold');
      expect(res.body).to.have.property('updatedAt');
    });

    it('无效金属类型应返回 400', async () => {
      const res = await request
        .put('/api/admin/differentials/invalid_metal')
        .set('Authorization', `Bearer ${token}`)
        .send({ differential: 10 });
      expect(res.status).to.equal(400);
    });

    it('非数值差价应返回 400', async () => {
      const res = await request
        .put('/api/admin/differentials/gold')
        .set('Authorization', `Bearer ${token}`)
        .send({ differential: 'not-a-number' });
      expect(res.status).to.equal(400);
    });

    it('设置差价后通过价格接口验证回收价更新', async () => {
      // 先设置一个已知差价
      await request
        .put('/api/admin/differentials/gold')
        .set('Authorization', `Bearer ${token}`)
        .send({ differential: 10 });

      // 验证价格接口中的回收价已更新
      const res = await request.get('/api/prices');
      const gold = res.body.find((m) => m.metal === 'gold');
      expect(gold.differential).to.equal(10);

      // 清理
      await request
        .put('/api/admin/differentials/gold')
        .set('Authorization', `Bearer ${token}`)
        .send({ differential: 0 });
    });
  });
});
  describe('GET /admin — 管理后台页面', () => {

    it('返回状态码 200', async () => {
      var res = await request.get('/admin');
      expect(res.status).to.equal(200);
    });

    it('页面包含登录表单', async () => {
      var res = await request.get('/admin');
      expect(res.text).to.include('管理员登录');
      expect(res.text).to.include('loginForm');
    });

    it('admin.js 可正常加载', async () => {
      var res = await request.get('/js/admin.js');
      expect(res.status).to.equal(200);
    });
  });

describe('差价约束验证', () => {

  it('差价不能大于当前国内价时应返回 400', async () => {
    // 先登录
    var loginRes = await request.post('/api/admin/login').send({ password: 'test123' });
    var t = loginRes.body.token;

    // 获取当前黄金国内价
    var priceRes = await request.get('/api/prices');
    var gold = priceRes.body.find(function(m) { return m.metal === 'gold'; });

    // 设置大于国内价的差价
    var res = await request
      .put('/api/admin/differentials/gold')
      .set('Authorization', 'Bearer ' + t)
      .send({ differential: gold.domesticPrice + 1000 });
    expect(res.status).to.equal(400);
    expect(res.body.error).to.include('差价不能大于');
  });

  it('差价等于国内价时应允许通过', async () => {
    var loginRes = await request.post('/api/admin/login').send({ password: 'test123' });
    var t = loginRes.body.token;

    var priceRes = await request.get('/api/prices');
    var gold = priceRes.body.find(function(m) { return m.metal === 'gold'; });

    var res = await request
      .put('/api/admin/differentials/gold')
      .set('Authorization', 'Bearer ' + t)
      .send({ differential: gold.domesticPrice });
    expect(res.status).to.equal(200);

    // 恢复
    await request
      .put('/api/admin/differentials/gold')
      .set('Authorization', 'Bearer ' + t)
      .send({ differential: 0 });
  });
});


