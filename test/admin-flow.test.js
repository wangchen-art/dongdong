process.env.ADMIN_PASSWORD = "test123";
var chai = require("chai");
var expect = chai.expect;
var request = require("supertest");
var app = require("../server").app;
var r = request(app);
var fs = require("fs");
var path = require("path");

function readAdmin() { return fs.readFileSync(path.join(__dirname,"../public/js/admin.js"),"utf-8"); }

describe("/admin 跳转诊断", function(){

  it("/admin 返回 200", async function(){
    var res = await r.get("/admin");
    expect(res.status).to.equal(200);
  });

  it("admin.js 可正确加载", async function(){
    var res = await r.get("/js/admin.js");
    expect(res.status).to.equal(200);
    expect(res.text.length).to.be.above(100);
  });

  it("admin.js 的 overlay 用 var 声明", function(){
    var js = readAdmin();
    expect(js).to.include("var overlay");
  });

  it("admin.js 引用的 DOM ID 在 HTML 中存在", async function(){
    var htmlRes = await r.get("/admin");
    var html = htmlRes.text;
    var js = readAdmin();
    var ids = js.match(/getElementById\(["'"]([^"']+)["'"]\)/g) || [];
    ids.forEach(function(m){
      var id = m.match(/["'"]([^"']+)["'"]/)[1];
      expect(html).to.include("id=\"" + id + "\"");  });  });

  it("admin.js 路径检测处理 /admin", function(){
    var js = readAdmin();
    expect(js).to.include("pathname === '/admin'");
    expect(js).to.include("overlay.classList.add('active')");
    expect(js).to.include("checkAuth();");
  });

});
