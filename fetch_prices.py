#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""AKShare东方财富实时贵金属价格"""
import json, sys

def main():
    result = {}
    
    # 方式1: AKShare 推荐方式
    try:
        import akshare as ak
        # 黄金ETF 518880
        etf = ak.fund_etf_spot_em()
        g = etf[etf["代码"] == "518880"]
        if not g.empty:
            gold_price = float(g.iloc[0]["最新价"]) / 0.01
            result["gold"] = {"price": round(gold_price, 2), "source": "etf"}
        # 白银LOF 161226
        lof = ak.fund_lof_spot_em()
        s = lof[lof["代码"] == "161226"]
        if not s.empty:
            silver_price = float(s.iloc[0]["最新价"])
            result["silver"] = {"price": round(silver_price, 2), "source": "lof"}
    except: pass

    # 方式2: 直连东方财富HTTP
    if not result:
        try:
            import urllib.request
            u1 = "https://push2.eastmoney.com/api/qt/stock/get?secid=1.518880&fields=f43"
            with urllib.request.urlopen(u1, timeout=10) as r:
                d = json.loads(r.read())
                if d.get("data",{}).get("f43"):
                    p = d["data"]["f43"] / 1000.0 / 0.01
                    result["gold"] = {"price": round(p, 2), "source": "http"}
            u2 = "https://push2.eastmoney.com/api/qt/stock/get?secid=0.161226&fields=f43"
            with urllib.request.urlopen(u2, timeout=10) as r:
                d = json.loads(r.read())
                if d.get("data",{}).get("f43"):
                    p = d["data"]["f43"] / 1000.0
                    result["silver"] = {"price": round(p, 2), "source": "http"}
        except: pass

    # 铂金钯金按黄金比例估算
    if "gold" in result:
        g = result["gold"]["price"]
        result["platinum"] = {"price": round(g * 0.45, 2), "source": "ratio"}
        result["palladium"] = {"price": round(g * 0.33, 2), "source": "ratio"}

    if result:
        print(json.dumps(result, ensure_ascii=False))
    else:
        print(json.dumps({"error": "all_failed"}))
        sys.exit(1)

if __name__ == "__main__":
    main()
