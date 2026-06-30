// ============================================
// app.js - 价格看板主逻辑
// 负责价格渲染、定时轮询、跳动动画
// ============================================

// ---- DOM 元素引用 ----
var priceBoard = document.getElementById('priceBoard');
var updateTimeEl = document.getElementById('updateTime');
var statusBar = document.getElementById('statusBar');
var adminBtn = document.getElementById('adminBtn');
var overlay = document.getElementById('adminOverlay');
var loadingIndicator = document.getElementById('loadingIndicator');

/** 缓存上一次价格，用于对比触发动画 */
let lastPrices = {};

// ---- 页面初始化 ----
document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    await refreshPrices();
  } catch (err) {
    // 初始加载失败，显示错误
    showStatus('无法加载价格数据，请检查网络连接', 'error');
  }
  // 启动定时轮询（无论首次是否成功）
  startPolling();
}

// ---- 定时轮询 ----

/** 每 12 秒刷新一次价格 */
function startPolling() {
  setInterval(refreshPrices, 12000);
}

/** 从后端获取最新价格并更新页面 */
async function refreshPrices() {
  try {
    const prices = await API.fetchPrices();
    renderPrices(prices);
    updateTimeEl.textContent = formatTime(Date.now());
    hideStatus();
  } catch (err) {
    // 轮询失败时显示温和提示，不影响已有数据
    showStatus('数据更新中...', 'warning');
  }
}

// ---- 价格渲染 ----

/**
 * 在页面上渲染所有金属的价格卡片
 * @param {Array} prices - 后端返回的价格数据数组
 */
function renderPrices(prices) {
  // 隐藏加载指示器
  loadingIndicator.style.display = 'none';

  // 首次渲染时创建卡片结构
  if (!priceBoard.querySelector('.price-grid')) {
    priceBoard.innerHTML = '<div class="price-grid"></div>';
  }

  const grid = priceBoard.querySelector('.price-grid');

  prices.forEach((item) => {
    let card = document.getElementById(`card-${item.metal}`);

    if (!card) {
      // 创建新卡片
      card = createCard(item);
      grid.appendChild(card);
    } else {
      // 更新已有卡片的价格
      updateCardPrices(card, item);
    }

    // 保存本次价格，供下次对比
    lastPrices[item.metal] = {
      international: item.internationalPrice,
      domestic: item.domesticPrice,
      recycling: item.recyclingPrice,
    };
  });
}

/**
 * 创建一张金属价格卡片的 DOM 结构
 * @param {Object} item - 金属价格数据
 * @returns {HTMLElement} 卡片 DOM 元素
 */
function createCard(item) {
  const card = document.createElement('div');
  card.className = 'price-card';
  card.id = `card-${item.metal}`;

  card.innerHTML = `
    <div class="card-header">
      <span class="metal-name">${item.name}</span>
      <span class="metal-symbol">${item.symbol}</span>
    </div>
    <div class="price-row">
      <div class="price-item">
        <span class="price-label">国际价</span>
        <span class="price-value international" id="intl-${item.metal}">
          ${formatCNY(item.internationalPrice)}
          <span class="price-unit">CNY/g</span>
        </span>
      </div>
      <div class="price-item">
        <span class="price-label">国内价</span>
        <span class="price-value domestic" id="dom-${item.metal}">
          ${formatCNY(item.domesticPrice)}
          <span class="price-unit">CNY/g</span>
        </span>
      </div>
      <div class="price-item">
        <span class="price-label">回收价</span>
        <span class="price-value recycling" id="rec-${item.metal}">
          ${formatCNY(item.recyclingPrice)}
          <span class="price-unit">CNY/g</span>
        </span>
      </div>
    </div>
    <div class="card-source">
      来源：${item.source === 'mock' ? '模拟数据 · 仅供参考' : '实时市场数据'}
    </div>
  `;

  return card;
}

/**
 * 更新卡片中的价格数值，并触发跳动动画
 * @param {HTMLElement} card - 卡片 DOM 元素
 * @param {Object} item - 新的价格数据
 */
function updateCardPrices(card, item) {
  const prev = lastPrices[item.metal] || {};

  updatePriceWithAnimation(card, `intl-${item.metal}`, item.internationalPrice, prev.international, formatCNY);
  updatePriceWithAnimation(card, `dom-${item.metal}`, item.domesticPrice, prev.domestic, formatCNY);
  updatePriceWithAnimation(card, `rec-${item.metal}`, item.recyclingPrice, prev.recycling, formatCNY);

  // 更新数据源信息
  const sourceEl = card.querySelector('.card-source');
  if (sourceEl) {
    sourceEl.textContent = `来源：${item.source === 'mock' ? '模拟数据 · 仅供参考' : '实时市场数据'}`;
  }
}

/**
 * 更新单个价格元素的数值，价格变化时触发跳动动画
 * @param {HTMLElement} card - 父卡片元素
 * @param {string} id - 价格元素 ID
 * @param {number} newVal - 新价格
 * @param {number} oldVal - 旧价格
 * @param {Function} formatter - 价格格式函数
 */
function updatePriceWithAnimation(card, id, newVal, oldVal, formatter) {
  const el = card.querySelector(`#${id}`);
  if (!el) return;

  // 更新文本
  const formatted = formatter(newVal);
  const unitSpan = el.querySelector('.price-unit');
  el.textContent = formatted;
  if (unitSpan) el.appendChild(unitSpan);

  // 价格变化时触发跳动动画
  if (oldVal !== undefined && oldVal !== newVal) {
    const direction = newVal > oldVal ? 'flash-up' : 'flash-down';
    el.classList.remove('flash-up', 'flash-down');
    // 迫使浏览器重排以重新触发动画
    void el.offsetWidth;
    el.classList.add(direction);
  }
}

// ---- 工具函数 ----

/**
 * 格式化人民币价格
 * @param {number} val
 * @returns {string}
 */
function formatCNY(val) {
  return `¥${val.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * 格式化时间戳
 * @param {number} ts - 时间戳
 * @returns {string}
 */
function formatTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * 显示状态提示条
 * @param {string} msg - 提示消息
 * @param {string} type - 类型（warning / error）
 */
function showStatus(msg, type = 'warning') {
  statusBar.textContent = msg;
  statusBar.className = `status-bar ${type}`;
  statusBar.style.display = 'block';
}

/** 隐藏状态提示条 */
function hideStatus() {
  statusBar.style.display = 'none';
}
