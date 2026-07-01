process.env.ADMIN_PASSWORD = "test123";
var supertest = require("supertest");
var chai = require("chai");
var expect = chai.expect;
var fs = require("fs");
var path = require("path");

var serverMod = require("../server");
var app = serverMod.app;
var request = supertest(app);

var adminJs = fs.readFileSync(path.join(__dirname, "../public/js/admin.js"), "utf-8");
var apiJs = fs.readFileSync(path.join(__dirname, "../public/js/api.js"), "utf-8");
var html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf-8");

describe("密码修改功能完整检测", function() {

  // === 1. 前端 UI 元素检查 ===
  it("index.html 包含 savePwdBtn 元素", function() {
    expect(html).to.include("id=\"savePwdBtn\"");
  });

  it("admin.js 引用了 savePwdBtn", function() {
    expect(adminJs).to.include("savePwdBtn");
  });

  it("admin.js 定义了 handlePasswordChange 函数", function() {
    expect(adminJs).to.include("async function handlePasswordChange");
  });

  it("admin.js 绑定了 savePwdBtn 点击事件", function() {
    expect(adminJs).to.include("savePwdBtn.addEventListener");
  });

  // === 2. 前端校验逻辑检查 ===
  it("handlePasswordChange 检测原密码是否传入 API", function() {
    expect(adminJs).to.include("API.setPassword(");
    expect(adminJs).to.include("oldPwd");
    expect(adminJs).to.include("newPwd");
  });

  it("handlePasswordChange 校验两次密码输入一致", function() {
    expect(adminJs).to.include("newPwd !== confirmPwd");
  });

  it("修改成功后显示成功提示", function() {
    expect(adminJs).to.include("密码修改成功");
  });

  it("修改成功后不清除 token 不跳转", function() {
    // 检查 handlePasswordChange 中没有 location.href 或 redirect
    var startIdx = adminJs.indexOf("async function handlePasswordChange");
    var endIdx = adminJs.indexOf("}\n\n", startIdx);
    var fnBody = adminJs.slice(startIdx, endIdx + 2);
    expect(fnBody).to.not.include("location.href");
    expect(fnBody).to.not.include("window.location");
  });

  // === 3. API 后端功能测试 ===
  it("API 验证原密码错误返回 401", async function() {
    var loginRes = await request.post("/api/admin/login").send({ password: "test123" });
    var token = loginRes.body.token;
    var res = await request.put("/api/admin/password")
      .set("Authorization", "Bearer " + token)
      .send({ oldPassword: "wrong", newPassword: "newpass" });
    expect(res.status).to.equal(401);
    expect(res.body.error).to.include("原密码错误");
  });

  it("API 验证新密码长度不足 4 位返回 400", async function() {
    var loginRes = await request.post("/api/admin/login").send({ password: "test123" });
    var token = loginRes.body.token;
    var res = await request.put("/api/admin/password")
      .set("Authorization", "Bearer " + token)
      .send({ oldPassword: "test123", newPassword: "ab" });
    expect(res.status).to.equal(400);
  });

  it("修改密码后新密码可登录", async function() {
    // 登录
    var loginRes = await request.post("/api/admin/login").send({ password: "test123" });
    var token = loginRes.body.token;
    // 修改密码
    var res = await request.put("/api/admin/password")
      .set("Authorization", "Bearer " + token)
      .send({ oldPassword: "test123", newPassword: "newpass456" });
    expect(res.status).to.equal(200);
    // 用新密码登录
    var loginRes2 = await request.post("/api/admin/login").send({ password: "newpass456" });
    expect(loginRes2.status).to.equal(200);
    // 用旧密码登录应失败
    var loginRes3 = await request.post("/api/admin/login").send({ password: "test123" });
    expect(loginRes3.status).to.equal(401);
    // 恢复原密码
    var token2 = loginRes2.body.token;
    await request.put("/api/admin/password")
      .set("Authorization", "Bearer " + token2)
      .send({ oldPassword: "newpass456", newPassword: "test123" });
  });

});
