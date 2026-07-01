// ============================================
// api.js - 后端 API 通信模块
// ============================================

/** 封装所有后端 API 调用 */
const API = {

  /**
   * 获取所有金属的当前价格
   * @returns {Promise<Array>} 价格数组
   */
  async fetchPrices() {
    const res = await fetch('/api/prices');
    if (!res.ok) throw new Error('获取价格数据失败');
    return res.json();
  },

  /** 获取销售差价 */
  async getSalesDifferentials(token) {
    var res = await fetch('/api/admin/sales-differentials', {
      headers: { Authorization: 'Bearer ' + token },
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || '获取销售差价失败');
    return data;
  },

  /** 设置销售差价 */
  async setSalesDifferential(metal, differential, token) {
    var res = await fetch('/api/admin/sales-differentials/' + metal, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ differential }),
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || '设置销售差价失败');
    return data;
  },

  /**
   * 管理员修改密码
   * @param {string} oldPassword - 原密码
   * @param {string} newPassword - 新密码
   * @param {string} token - 会话令牌
   * @returns {Promise<Object>} 修改结果
   */
  async setPassword(oldPassword, newPassword, token) {
    const res = await fetch('/api/admin/password', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ oldPassword, newPassword }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '密码修改失败');
    return data;
  },

  /**
   * 管理员登录验证
   * @param {string} password - 管理密码
   * @returns {Promise<Object>} 包含 token 的对象
   */
  async adminLogin(password) {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (!res.ok) {
      var err = new Error(data.error || '登录失败');
      if (data.remainingAttempts !== undefined) err.remainingAttempts = data.remainingAttempts;
      if (data.locked) err.locked = true;
      throw err;
    }
    return data;
  },

  /**
   * 获取所有金属的差价配置
   * @param {string} token - 会话令牌
   * @returns {Promise<Object>} 差价配置
   */
  async getDifferentials(token) {
    const res = await fetch('/api/admin/differentials', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '获取差价失败');
    return data;
  },

  /**
   * 设置某金属的差价
   * @param {string} metal - 金属 key
   * @param {number} differential - 差价数值
   * @param {string} token - 会话令牌
   * @returns {Promise<Object>} 更新结果
   */
  async setDifferential(metal, differential, token) {
    const res = await fetch(`/api/admin/differentials/${metal}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ differential }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '设置差价失败');
    return data;
  },
};
