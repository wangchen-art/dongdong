// ============================================
// app.js - 价格看板主逻辑
// 表格布局 · 涨红跌绿 · 实时时钟
// ============================================

var priceBoard = document.getElementById("priceBoard");
var statusBar = document.getElementById("statusBar");
var adminBtn = document.getElementById("adminBtn");
var overlay = document.getElementById("adminOverlay");
var loadingIndicator = document.getElementById("loadingIndicator");

/** 存储上一次价格，用于判断涨跌方向和颜色持久化 */
let lastPrice = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  try { await refreshPrices(); }
  catch (err) { showStatus("无法加载价格数据", "error"); }
  startPolling();
  startClock();
}

function startClock() {
  var el = document.getElementById("realtimeClock");
  if (!el) return;
  function tick() {
    var d = new Date();
    el.textContent = d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0") + " " + String(d.getHours()).padStart(2,"0") + ":" + String(d.getMinutes()).padStart(2,"0") + ":" + String(d.getSeconds()).padStart(2,"0");
  }
  tick();
  setInterval(tick, 1000);
}

function startPolling() { setInterval(refreshPrices, 5000); }

async function refreshPrices() {
  try {
    var prices = await API.fetchPrices();
    renderPrices(prices);
    if (prices.some(function(item) { return item.stale; })) {
      showStatus('报价更新异常：当前显示上次有效数据，未获取到报价的品种显示 --', 'warning');
    } else {
      hideStatus();
    }
  } catch (err) { showStatus("数据更新中...", "warning"); }
}

/** 更新单个价格单元格的颜色（涨红跌绿），仅当价格变化时更新，变化后颜色保持到下一次变化 */
function updatePriceCell(el, newPrice, prevPrice) {
  if (prevPrice === undefined) {
    // 首次加载，默认显示红色（上涨）
    el.classList.add("up");
    return;
  }
  if (prevPrice !== newPrice) {
    el.classList.remove("up", "down");
    void el.offsetWidth;
    el.classList.add(newPrice > prevPrice ? "up" : "down");
  }
}

function renderPrices(prices) {
  loadingIndicator.style.display = "none";
  var wrapper = priceBoard.querySelector(".table-wrapper");
  if (!wrapper) {
    priceBoard.innerHTML = "<div class=\"table-wrapper\"><table class=\"price-table\">"
      + "<thead><tr><th>商品</th><th>回购价格</th><th>销售价格</th></tr></thead>"
      + "<tbody id=\"priceTableBody\"></tbody></table></div>";
    wrapper = priceBoard.querySelector(".table-wrapper");
  }
  var tbody = document.getElementById("priceTableBody");
  prices.forEach(function(item) {
    if (item.available === false) {
      item.recyclingPrice = null;
      item.salesPrice = null;
    }
    var row = document.getElementById("metal-" + item.metal);
    if (!lastPrice[item.metal]) {
      lastPrice[item.metal] = {};
    }
    var prevRecycling = lastPrice[item.metal].recycling;
    var prevSales = lastPrice[item.metal].sales;

    if (!row) {
      row = document.createElement("tr");
      row.id = "metal-" + item.metal;
      row.innerHTML = "<td class=\"metal-cell\">" + item.name + " <small>" + item.symbol + "</small></td>"
        + "<td class=\"price-cell\" id=\"rec-" + item.metal + "\">"
        + formatCNY(item.recyclingPrice) + "<span class=\"price-unit\">CNY/g</span></td>"
        + "<td class=\"price-cell\" id=\"sales-price-" + item.metal + "\">"
        + formatCNY(item.salesPrice) + "<span class=\"price-unit\">CNY/g</span></td>";
      tbody.appendChild(row);
      // 首次加载，所有价格默认红色
      var recEl = row.querySelector("#rec-" + item.metal);
      var salesEl = row.querySelector("#sales-price-" + item.metal);
      if (recEl) recEl.classList.add("up");
      if (salesEl) salesEl.classList.add("up");
    } else {
      // 更新回购价格
      var recEl = row.querySelector("#rec-" + item.metal);
      if (recEl) {
        recEl.innerHTML = formatCNY(item.recyclingPrice) + "<span class=\"price-unit\">CNY/g</span>";
        updatePriceCell(recEl, item.recyclingPrice, prevRecycling);
      }
      // 更新销售价格
      var salesEl = row.querySelector("#sales-price-" + item.metal);
      if (salesEl) {
        salesEl.innerHTML = formatCNY(item.salesPrice) + "<span class=\"price-unit\">CNY/g</span>";
        updatePriceCell(salesEl, item.salesPrice, prevSales);
      }
    }
    // 记录本次价格，供下次比较
    lastPrice[item.metal].recycling = item.recyclingPrice;
    lastPrice[item.metal].sales = item.salesPrice;
  });
}

function formatCNY(val) {
  if (!Number.isFinite(val)) return '--';
  return "\u00a5" + val.toLocaleString("zh-CN", {minimumFractionDigits:2, maximumFractionDigits:2});
}

function showStatus(msg, type) {
  if (!type) type = "warning";
  statusBar.textContent = msg;
  statusBar.className = "status-bar " + type;
  statusBar.style.display = "block";
}

function hideStatus() { statusBar.style.display = "none"; }

// ============================================
// 电话复制功能 — 支持非安全上下文（手机局域网等）
// ============================================

/** 客服电话号码 */
var PHONE_NUMBER = "19191621889";

/** 显示复制成功提示 */
function showCopyToast() {
  var t = document.getElementById("toast");
  if (!t) return;
  t.textContent = "\u2713 \u5df2\u590d\u5236\u53f7\u7801 " + PHONE_NUMBER;
  t.className = "toast show";
  setTimeout(function() {
    t.classList.remove("show");
  }, 1200);
}

/** 降级方案：使用 execCommand 复制（兼容手机非 HTTPS 环境） */
function fallbackCopy(text) {
  var ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  ta.style.top = "-9999px";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try { document.execCommand("copy"); } catch (e) { /* 静默忽略 */ }
  document.body.removeChild(ta);
  showCopyToast();
}

/** 主复制函数：优先 navigator.clipboard，降级到 execCommand */
function copyPhoneNumber() {
  if (window.isSecureContext && navigator.clipboard) {
    navigator.clipboard.writeText(PHONE_NUMBER).then(showCopyToast).catch(function() {
      fallbackCopy(PHONE_NUMBER);
    });
  } else {
    fallbackCopy(PHONE_NUMBER);
  }
}

// 绑定电话点击事件
var phoneLink = document.getElementById("phoneLink");
if (phoneLink) {
  phoneLink.addEventListener("click", function(e) {
    e.preventDefault();
    copyPhoneNumber();
  });
}
