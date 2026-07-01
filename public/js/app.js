// ============================================
// app.js - 价格看板主逻辑
// 表格布局 · 涨红跌绿 · 实时时钟
// ============================================

var priceBoard = document.getElementById('priceBoard');
var updateTimeEl = document.getElementById('updateTime');
var statusBar = document.getElementById('statusBar');
var adminBtn = document.getElementById('adminBtn');
var overlay = document.getElementById('adminOverlay');
var loadingIndicator = document.getElementById('loadingIndicator');

let lastPrice = {};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  try { await refreshPrices(); }
  catch (err) { showStatus('无法加载价格数据', 'error'); }
  startPolling();
  startClock();
}

function startClock() {
  var el = document.getElementById('realtimeClock');
  if (!el) return;
  function tick() {
    var d = new Date();
    el.textContent = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0') + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0') + ':' + String(d.getSeconds()).padStart(2,'0');
  }
  tick();
  setInterval(tick, 1000);
}

function startPolling() { setInterval(refreshPrices, 12000); }

async function refreshPrices() {
  try {
    var prices = await API.fetchPrices();
    renderPrices(prices);
    updateTimeEl.textContent = formatTime(Date.now());
    hideStatus();
  } catch (err) { showStatus('数据更新中...', 'warning'); }
}

function renderPrices(prices) {
  loadingIndicator.style.display = 'none';
  var wrapper = priceBoard.querySelector('.table-wrapper');
  if (!wrapper) {
    priceBoard.innerHTML = '<div class="table-wrapper"><table class="price-table">'
      + '<thead><tr><th>商品</th><th>回购价格</th><th>销售价格</th></tr></thead>'
      + '<tbody id="priceTableBody"></tbody></table></div>';
    wrapper = priceBoard.querySelector('.table-wrapper');
  }
  var tbody = document.getElementById('priceTableBody');
  prices.forEach(function(item) {
    var row = document.getElementById('metal-' + item.metal);
    var prev = lastPrice[item.metal];
    if (!row) {
      row = document.createElement('tr');
      row.id = 'metal-' + item.metal;
      row.innerHTML = '<td class="metal-cell">' + item.name + ' <small>' + item.symbol + '</small></td>'
        + '<td class="price-cell" id="rec-' + item.metal + '">'
        + '<span class="price-unit">CNY/g</span>' + formatCNY(item.recyclingPrice) + '</td>'
      + '<td class="price-cell" id="sales-price-' + item.metal + '">'
      + '<span class="price-unit">CNY/g</span>' + formatCNY(item.salesPrice) + '</td>';
      tbody.appendChild(row);
    } else {
      var el = row.querySelector('#rec-' + item.metal);
      if (el) {
        var unitHtml = '<span class="price-unit">CNY/g</span>' + formatCNY(item.recyclingPrice);
        el.innerHTML = unitHtml;
        el.classList.remove('up', 'down');
        if (prev !== undefined && prev !== item.recyclingPrice) {
          void el.offsetWidth;
          el.classList.add(item.recyclingPrice > prev ? 'up' : 'down');
        }
        // 更新销售价格
        var salesEl = row.querySelector('#sales-price-' + item.metal);
        if (salesEl) {
          salesEl.innerHTML = '<span class="price-unit">CNY/g</span>' + formatCNY(item.salesPrice);
        }
      }
    }
    lastPrice[item.metal] = item.recyclingPrice;
  });
}

function formatCNY(val) {
  return '¥' + val.toLocaleString('zh-CN', {minimumFractionDigits:2, maximumFractionDigits:2});
}

function formatTime(ts) {
  var d = new Date(ts);
  var pad = function(n) { return String(n).padStart(2,'0'); };
  return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

function showStatus(msg, type) {
  if (!type) type = 'warning';
  statusBar.textContent = msg;
  statusBar.className = 'status-bar ' + type;
  statusBar.style.display = 'block';
}

function hideStatus() { statusBar.style.display = 'none'; }

