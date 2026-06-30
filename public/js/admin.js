// ============================================
// admin.js - 管理员后台逻辑
// 负责登录认证、差价设置管理
// ============================================

/** localStorage 中保存 token 的键名 */
const ADMIN_TOKEN_KEY = 'admin_token';

// ---- DOM 元素引用 ----
const loginForm = document.getElementById('loginForm');
const diffPanel = document.getElementById('diffPanel');
const passwordInput = document.getElementById('passwordInput');
const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');
const logoutBtn = document.getElementById('logoutBtn');
const diffList = document.getElementById('diffList');
const overlayBackdrop = document.getElementById('overlayBackdrop');
const pwdToggleBtn = document.getElementById('pwdToggleBtn');
const pwdForm = document.getElementById('pwdForm');
const oldPwdInput = document.getElementById('oldPwdInput');
const newPwdInput = document.getElementById('newPwdInput');
const confirmPwdInput = document.getElementById('confirmPwdInput');
const savePwdBtn = document.getElementById('savePwdBtn');
const pwdStatus = document.getElementById('pwdStatus');

/** 当前会话 token */
let currentToken = localStorage.getItem(ADMIN_TOKEN_KEY);

// ---- 事件绑定 ----

// 管理员按钮：打开后台浮层
adminBtn.addEventListener('click', () => {
  overlay.classList.add('active');
  checkAuth();
});

// 点击遮罩层：关闭浮层
overlayBackdrop.addEventListener('click', () => {
  overlay.classList.remove('active');
});

// 按下回车键触发的登录
passwordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleLogin();
});

// 登录按钮点击
loginBtn.addEventListener('click', handleLogin);

// 退出登录按钮
logoutBtn.addEventListener('click', handleLogout);

// 密码修改：展开/收起表单
pwdToggleBtn.addEventListener('click', () => {
  pwdForm.classList.toggle('visible');
  if (pwdForm.classList.contains('visible')) {
    oldPwdInput.value = '';
    newPwdInput.value = '';
    confirmPwdInput.value = '';
    pwdStatus.textContent = '';
    pwdStatus.className = 'pwd-status';
  }
});

// 密码修改：保存按钮
savePwdBtn.addEventListener('click', handlePasswordChange);

// 密码修改：回车保存
confirmPwdInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handlePasswordChange();
});



// ---- 管理按钮可见性 ----

/** 显示管理后台按钮（仅登录后可见） */
function showAdminButton() {
  adminBtn.classList.add('visible');
}

/** 隐藏管理后台按钮 */
function hideAdminButton() {
  adminBtn.classList.remove('visible');
}

/** 页面加载时检查是否已有有效 token，有则显示按钮 */
function checkSavedToken() {
  if (localStorage.getItem(ADMIN_TOKEN_KEY)) {
    showAdminButton();
  }
}

// 页面加载时检查已保存的登录状态
checkSavedToken();

// 检测是否在 /admin 路径下，直接打开管理后台
if (window.location.pathname === '/admin') {
  // 脚本在页面底部加载，DOM 已就绪，直接执行
  var board = document.querySelector('.price-board');
  var footer = document.querySelector('.footer');
  var headerRight = document.querySelector('.header-right');
  if (board) board.style.display = 'none';
  if (footer) footer.style.display = 'none';
  if (headerRight) headerRight.style.display = 'none';

  // 打开管理后台浮层，显示登录界面
  overlay.classList.add('active');
  checkAuth();
}

// ---- 键盘快捷键：Ctrl+Shift+A 打开登录 ----
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && (e.key === 'a' || e.key === 'A')) {
    e.preventDefault();
    overlay.classList.add('active');
    if (!currentToken) {
      showLoginForm();
    } else {
      checkAuth();
    }
  }
});

// ---- 认证检查 ----

/** 检查当前 token 是否有效，决定显示登录表单还是差价面板 */
async function checkAuth() {
  if (currentToken) {
    try {
      const data = await API.getDifferentials(currentToken);
      // token 有效，显示差价面板
      renderDiffPanel(data.differentials);
      showDiffPanel();
    } catch {
      // token 已过期或无效，清除并显示登录表单
      currentToken = null;
      localStorage.removeItem(ADMIN_TOKEN_KEY);
      showLoginForm();
    }
  } else {
    showLoginForm();
  }
}

// ---- 视图切换 ----

/** 显示登录表单 */
function showLoginForm() {
  loginForm.style.display = 'flex';
  diffPanel.style.display = 'none';
  loginError.style.display = 'none';
  passwordInput.value = '';
  passwordInput.classList.remove('error');
  passwordInput.focus();
}

/** 显示差价设置面板 */
function showDiffPanel() {
  loginForm.style.display = 'none';
  diffPanel.style.display = 'block';
}

// ---- 登录逻辑 ----

/** 处理管理员登录 */
async function handleLogin() {
  const password = passwordInput.value.trim();
  if (!password) {
    showLoginError('请输入管理密码');
    return;
  }

  loginBtn.disabled = true;
  loginBtn.textContent = '登录中...';
  loginError.style.display = 'none';
  passwordInput.classList.remove('error');

  try {
    const data = await API.adminLogin(password);
    currentToken = data.token;
    localStorage.setItem(ADMIN_TOKEN_KEY, currentToken);
    // 获取差价数据并渲染面板
    const diffData = await API.getDifferentials(currentToken);
    renderDiffPanel(diffData.differentials);
    showDiffPanel();
    showAdminButton();
  } catch (err) {
    // 检查是否包含剩余次数信息
    if (err.remainingAttempts !== undefined) {
      showLoginError('密码错误，还剩 ' + err.remainingAttempts + ' 次机会');
    } else if (err.message && (err.message.includes('锁定') || err.message.includes('过多'))) {
      showLockoutMessage(err.message);
    } else {
      showLoginError(err.message || '密码错误');
    }
    passwordInput.classList.add('error');
    passwordInput.select();
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = '登 录';
  }
}

/** 显示登录错误提示 */
function showLoginError(msg) {
  loginError.textContent = msg;
  loginError.style.display = 'block';
}

/** 显示登录锁定提示，禁用输入 */
function showLockoutMessage(msg) {
  loginError.textContent = msg;
  loginError.style.display = 'block';
  loginError.className = 'form-error lockout';
  passwordInput.disabled = true;
  loginBtn.disabled = true;
}

/** 处理退出登录 */
function handleLogout() {
  currentToken = null;
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  hideAdminButton();
  showLoginForm();
}

// ---- 差价面板渲染 ----

/**
 * 渲染差价设置面板
 * @param {Object.<string, number>} differentials - 各金属差价数据
 */
function renderDiffPanel(differentials) {
  // 金属配置（与后端 METALS 保持同步）
  const metals = [
    { key: 'gold',      name: '黄金' },
    { key: 'silver',    name: '白银' },
    { key: 'platinum',  name: '铂金' },
    { key: 'palladium', name: '钯金' },
  ];

  diffList.innerHTML = '';

  metals.forEach((metal) => {
    const currentDiff = differentials[metal.key] ?? 0;
    const row = document.createElement('div');
    row.className = 'diff-row';
    row.id = `diff-row-${metal.key}`;

    row.innerHTML = `
      <span class="diff-metal">${metal.name}</span>
      <span class="diff-current-price" id="diff-price-${metal.key}">--</span>
      <input
        type="number"
        class="diff-input"
        id="diff-input-${metal.key}"
        value="${currentDiff}"
        step="0.01"
        min="0"
        placeholder="差价"
      >
      <span class="diff-unit">CNY/g</span>
      <button class="btn btn-primary btn-small" id="diff-save-${metal.key}">保存</button>
      <span class="diff-status" id="diff-status-${metal.key}"></span>
    `;

    diffList.appendChild(row);

    // 绑定保存按钮事件
    const saveBtn = row.querySelector(`#diff-save-${metal.key}`);
    saveBtn.addEventListener('click', () => handleSaveDifferential(metal.key));

    // 输入框回车保存
    const input = row.querySelector(`#diff-input-${metal.key}`);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleSaveDifferential(metal.key);
    });
  });

  // 尝试获取当前价格显示在差价面板中
  updateDiffPanelPrices();
}

/** 从最新价格数据中更新差价面板的实时价显示 */
async function updateDiffPanelPrices() {
  try {
    const prices = await API.fetchPrices();
    prices.forEach((item) => {
      const priceEl = document.getElementById(`diff-price-${item.metal}`);
      if (priceEl) {
        priceEl.textContent = `¥${item.domesticPrice.toFixed(2)}`;
      }
    });
  } catch {
    // 获取价格失败，静默处理
  }
}

// ---- 差价保存逻辑 ----

/**
 * 保存某金属的差价到后端
 * @param {string} metal - 金属 key
 */
async function handleSaveDifferential(metal) {
  const input = document.getElementById(`diff-input-${metal}`);
  const statusEl = document.getElementById(`diff-status-${metal}`);
  const saveBtn = document.getElementById(`diff-save-${metal}`);

  const value = parseFloat(input.value);
  if (isNaN(value) || value < 0) {
    showDiffStatus(metal, '无效数值', 'error');
    return;
  }

  // 获取当前国内价做客户端验证
  var priceEl = document.getElementById('diff-price-' + metal);
  if (priceEl) {
    var currentPrice = parseFloat(priceEl.textContent.replace('¥', ''));
    if (!isNaN(currentPrice) && value > currentPrice) {
      showDiffStatus(metal, '差价不能大于当前价 ' + currentPrice.toFixed(2), 'error');
      return;
    }
  }

  saveBtn.disabled = true;
  saveBtn.textContent = '保存中...';
  showDiffStatus(metal, '', '');

  try {
    const result = await API.setDifferential(metal, value, currentToken);
    showDiffStatus(metal, '已保存', '');
    // 保存后自动刷新价格看板，使回收价更新
    await refreshPrices();
  } catch (err) {
    showDiffStatus(metal, '保存失败', 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = '保存';
    // 2 秒后清除状态文字
    setTimeout(() => showDiffStatus(metal, '', ''), 2000);
  }
}

/**
 * 显示差价保存状态
 * @param {string} metal - 金属 key
 * @param {string} msg - 状态消息
 * @param {string} type - 类型（'' / 'error'）
 */
/** 处理修改密码 */
async function handlePasswordChange() {
  var oldPwd = oldPwdInput.value;
  var newPwd = newPwdInput.value;
  var confirmPwd = confirmPwdInput.value;

  if (!oldPwd || !newPwd || !confirmPwd) {
    pwdStatus.textContent = '请填写所有字段';
    pwdStatus.className = 'pwd-status error';
    return;
  }

  if (newPwd.length < 4) {
    pwdStatus.textContent = '新密码长度至少 4 位';
    pwdStatus.className = 'pwd-status error';
    return;
  }

  if (newPwd !== confirmPwd) {
    pwdStatus.textContent = '两次密码输入不一致';
    pwdStatus.className = 'pwd-status error';
    return;
  }

  savePwdBtn.disabled = true;
  savePwdBtn.textContent = '保存中...';
  pwdStatus.textContent = '';

  try {
    var result = await API.setPassword(oldPwd, newPwd, currentToken);
    pwdStatus.textContent = '密码修改成功';
    pwdStatus.className = 'pwd-status success';
    oldPwdInput.value = '';
    newPwdInput.value = '';
    confirmPwdInput.value = '';
  } catch (err) {
    pwdStatus.textContent = err.message || '修改失败';
    pwdStatus.className = 'pwd-status error';
  } finally {
    savePwdBtn.disabled = false;
    savePwdBtn.textContent = '保存';
  }
}


function showDiffStatus(metal, msg, type) {
  const el = document.getElementById(`diff-status-${metal}`);
  if (el) {
    el.textContent = msg;
    el.className = `diff-status${type ? ' ' + type : ''}`;
  }
}

