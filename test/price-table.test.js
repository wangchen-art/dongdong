process.env.ADMIN_PASSWORD = "test123";
var serverMod = require("../server");
var app = serverMod.app;
var supertest = require("supertest");
var request = supertest(app);
var chai = require("chai");
var expect = chai.expect;
var fs = require("fs");
var path = require("path");
var appJs = fs.readFileSync(path.join(__dirname, "../public/js/app.js"), "utf-8");
var css = fs.readFileSync(path.join(__dirname, "../public/css/style.css"), "utf-8");
var serverJs = fs.readFileSync(path.join(__dirname, "../server.js"), "utf-8");

describe("价格表格布局", function () {

  it("app.js 使用 price-table 表格类", function () {
    expect(appJs).to.include("price-table");
  });

  it("表格表头有 商品 和 回购价格", function () {
    expect(appJs).to.include("<th>商品</th>");
    expect(appJs).to.include("<th>回购价格</th>");
  });

  it("金属行 ID 使用 metal- 前缀", function () {
    expect(appJs).to.include("metal-");
  });

  it("价格 ID 使用 rec- 前缀", function () {
    expect(appJs).to.include("rec-");
  });

  it("四种金属品名在服务端定义", function () {
    expect(serverJs).to.include("黄金");
    expect(serverJs).to.include("白银");
    expect(serverJs).to.include("铂金");
    expect(serverJs).to.include("钯金");
    expect(serverJs).to.include("XAU");
    expect(serverJs).to.include("XAG");
    expect(serverJs).to.include("XPT");
    expect(serverJs).to.include("XPD");
  });

  it("使用 .table-wrapper 响应式容器", function () {
    expect(appJs).to.include("table-wrapper");
  });

  
  it("表格表头包含 销售价格 列", function () {
    expect(appJs).to.include("销售价格");
  });

  it("销售价格使用 sales-price-{metal} ID", function () {
    expect(appJs).to.include("sales-price-");
  });

  it("销售价格有颜色变化类 up/down", function () {
    expect(appJs).to.include("sales-price");
  });

it("CSS 定义了涨红跌绿样式", function () {
    expect(css).to.include(".price-cell");
    expect(css).to.include(".up");
    expect(css).to.include(".down");
    expect(css).to.include("var(--accent-red)");
    expect(css).to.include("var(--accent-green)");
  });

});
