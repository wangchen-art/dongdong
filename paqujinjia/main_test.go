package main

import (
	"math"
	"os"
	"strings"
	"testing"
)

// 保留真实响应后面的缺失字段，验证不会误用其他品种的数据。
const referenceFixture = `const panjia2 = "[1,838.83,841.83,865.04,835.88,11.105,11.205,11.813,11.065,309.4,310.9,321.6,306.7,209.6,211.1,216.9,207.2,36430,36437,--,--,838.83,612.34,292.38,203.31,3917.23,3917.58,4026.24,3891.59]";`

func TestParseReferenceSnapshot(t *testing.T) {
	items, err := parseHuangjinjiage(referenceFixture)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string][2]float64{
		"黄金": {838.83, 841.83}, "白银": {11.105, 11.205},
		"铂金": {309.4, 310.9}, "钯金": {209.6, 211.1},
	}
	for name, pair := range want {
		if items[name].BuyPrice != pair[0] || items[name].SellPrice != pair[1] {
			t.Fatalf("%s: %+v", name, items[name])
		}
	}
}

func TestRejectMalformedReference(t *testing.T) {
	for _, value := range []string{"--", "0", "-1", "NaN", "Infinity", "838.83oops"} {
		t.Run(value, func(t *testing.T) {
			if _, err := parseHuangjinjiage(strings.Replace(referenceFixture, "838.83", value, 1)); err == nil {
				t.Fatal("无效字段不得进入校准")
			}
		})
	}
	for _, body := range []string{`const panjia2 = "[1,2]";`, strings.Replace(referenceFixture, "[1,", "[2,", 1), strings.Replace(referenceFixture, "841.83", "800", 1)} {
		if _, err := parseHuangjinjiage(body); err == nil {
			t.Fatal("布局或报价关系异常必须拒绝")
		}
	}
}

func TestInvalidPricePairs(t *testing.T) {
	for _, pair := range [][2]float64{{0, 1}, {-1, 2}, {3, 2}, {math.NaN(), 2}, {1, math.Inf(1)}} {
		if validPricePair(pair[0], pair[1]) {
			t.Fatalf("错误接受了报价: %v", pair)
		}
	}
}

func TestCalibrationVersion(t *testing.T) {
	previous, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	defer os.Chdir(previous)
	if err := os.WriteFile(ADJUST_FILE, []byte(`{"offsets":{"黄金":{"bp_offset":500}}}`), 0600); err != nil {
		t.Fatal(err)
	}
	if len(loadCalib().Offsets) != 0 {
		t.Fatal("旧版本错误校准不应继续使用")
	}
	want := CalibData{Offsets: map[string]MetalOffset{"黄金": {BPOffset: -10, SPOffset: 0}}}
	if err := saveCalib(want); err != nil {
		t.Fatal(err)
	}
	got := loadCalib()
	if got.SchemaVersion != CALIB_SCHEMA_VERSION || got.Offsets["黄金"].BPOffset != -10 {
		t.Fatalf("新版本校准未正确保存: %+v", got)
	}
}
