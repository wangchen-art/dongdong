// ============================================
// differential-store.test.js - 差价存储模块测试
// ============================================

const chai = require('chai');
const { DifferentialStore, METALS } = require('../server');

const { expect } = chai;

describe('DifferentialStore — 差价存储模块', () => {

  /** @type {DifferentialStore} */
  let store;

  beforeEach(() => {
    store = new DifferentialStore();
  });

  // 每个测试结束后清除差价数据，避免测试间互相干扰
  afterEach(() => {
    METALS.forEach((m) => store.set(m.key, 0));
  });

  it('初始化时所有金属差价默认为 0', () => {
    const all = store.getAll();
    METALS.forEach((m) => {
      expect(all[m.key]).to.equal(0, `${m.name} 初始差价应为 0`);
    });
  });

  it('设置差价后可通过 get() 正确读取', () => {
    store.set('gold', 10.5);
    expect(store.get('gold')).to.equal(10.5);
  });

  it('设置多种金属差价互不干扰', () => {
    store.set('gold', 5);
    store.set('silver', 1.2);
    expect(store.get('gold')).to.equal(5);
    expect(store.get('silver')).to.equal(1.2);
    expect(store.get('platinum')).to.equal(0);
    expect(store.get('palladium')).to.equal(0);
  });

  it('设置无效金属类型时抛出异常', () => {
    expect(() => store.set('invalid_metal', 10)).to.throw();
  });

  it('设置负差价时允许通过（业务层可自定义约束）', () => {
    store.set('gold', -5);
    expect(store.get('gold')).to.equal(-5);
    store.set('gold', 0);
  });

  it('getAll() 返回当前所有金属差价快照', () => {
    store.set('gold', 8.88);
    store.set('palladium', 15.0);
    const snapshot = store.getAll();
    expect(snapshot.gold).to.equal(8.88);
    expect(snapshot.silver).to.equal(0);
    expect(snapshot.platinum).to.equal(0);
    expect(snapshot.palladium).to.equal(15.0);
  });

  it('persist() 写入文件后重启可恢复数据', () => {
    store.set('gold', 25.5);
    const store2 = new DifferentialStore();
    expect(store2.get('gold')).to.equal(25.5);
    store2.set('gold', 0);
  });
});
