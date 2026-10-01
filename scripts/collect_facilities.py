#!/usr/bin/env python3
"""
횡단보도·어린이보호구역 위치를 공공데이터포털 표준데이터 API에서 받아 격자 파일로 만든다.

  python scripts/collect_facilities.py

- 키: .env.local 의 DATA_GO_KR_KEY (Decoding 키). 키는 출력하지 않는다.
- 범위: 서울특별시 · 전북특별자치도(전라북도)
- 결과: public/fac/{위도칸}_{경도칸}.json  (0.01° 격자, src/lib/facilities.ts 와 같은 규칙)
        public/fac/meta.json                (수집 시각·건수)
- 표준데이터는 반기마다 갱신된다. 갱신되면 이 스크립트를 다시 돌린다.
- 받은 원본 페이지는 .cache/fac/ 에 저장해 두어, 중간에 끊겨도 이어 받는다.

표준데이터 API는 좌표 주변 검색이 없어 목록을 통째로 받는다. 그래서 실시간이 아니라 미리 모아 둔다.
"""
from __future__ import annotations

import json
import math
import pathlib
import shutil
import sys
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "fac"
CACHE = ROOT / ".cache" / "fac"
CELL_DEG = 0.01
ROWS = 1000

SOURCES = {
    "crosswalk": "http://api.data.go.kr/openapi/tn_pubr_public_crosswalk_api",
    "school": "http://api.data.go.kr/openapi/tn_pubr_public_child_prtc_zn_api",
}
# 시도명 필터로 줄여 받을 때 쓰는 이름 (전북은 2024년에 이름이 바뀌어 두 가지가 섞여 있다)
REGION_NAMES = ["서울특별시", "전북특별자치도", "전라북도"]
REGION_PREFIX = ("서울", "전북", "전라북도")


def load_key() -> str:
    for name in (".env.local", ".env"):
        p = ROOT / name
        if not p.exists():
            continue
        for line in p.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if line.startswith("DATA_GO_KR_KEY="):
                v = line.split("=", 1)[1].strip().strip('"').strip("'")
                if v:
                    return v
    sys.exit("DATA_GO_KR_KEY 가 .env.local 에 없습니다.")


def get(url: str, params: dict, tries: int = 4) -> dict:
    q = urllib.parse.urlencode(params)
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(f"{url}?{q}", timeout=40) as r:
                text = r.read().decode("utf-8")
            j = json.loads(text)
            if "OpenAPI_ServiceResponse" in j:
                msg = j["OpenAPI_ServiceResponse"].get("cmmMsgHeader", {}).get("errMsg")
                raise RuntimeError(f"API 오류: {msg}")
            return j
        except RuntimeError:
            raise
        except Exception as e:  # 네트워크·일시 오류는 다시
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"요청 실패: {last}")


def body(j: dict) -> tuple[int, list[dict]]:
    r = j.get("response", {})
    code = r.get("header", {}).get("resultCode")
    if code not in ("00", "0", None):
        if code == "03":  # NODATA
            return 0, []
        raise RuntimeError(f"결과코드 {code}: {r.get('header', {}).get('resultMsg')}")
    b = r.get("body", {})
    items = b.get("items") or []
    if isinstance(items, dict):
        items = items.get("item") or []
    if isinstance(items, dict):
        items = [items]
    return int(b.get("totalCount") or 0), items


def total(url: str, key: str, extra: dict) -> int:
    j = get(url, {"serviceKey": key, "pageNo": 1, "numOfRows": 1, "type": "json", **extra})
    return body(j)[0]


def fetch_all(kind: str, url: str, key: str) -> list[dict]:
    """시도명 필터가 먹으면 지역별로, 아니면 전국을 통째로 받는다."""
    all_n = total(url, key, {})
    filters: list[dict] = []
    for name in REGION_NAMES:
        n = total(url, key, {"ctprvnNm": name})
        if 0 < n < all_n:
            filters.append({"ctprvnNm": name})
    if not filters:
        filters = [{}]
        print(f"[{kind}] 시도명 필터를 쓸 수 없어 전국 {all_n:,}건을 받습니다", flush=True)
    else:
        print(f"[{kind}] 전국 {all_n:,}건 중 지역 필터 {len(filters)}개로 받습니다", flush=True)

    rows: list[dict] = []
    for f in filters:
        tag = f.get("ctprvnNm", "all")
        n = total(url, key, f)
        pages = math.ceil(n / ROWS)
        for page in range(1, pages + 1):
            cp = CACHE / f"{kind}-{tag}-{page}.json"
            if cp.exists():
                items = json.loads(cp.read_text(encoding="utf-8"))
            else:
                j = get(url, {"serviceKey": key, "pageNo": page, "numOfRows": ROWS, "type": "json", **f})
                items = body(j)[1]
                cp.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
            rows.extend(items)
            print(f"[{kind}] {tag} {page}/{pages}쪽 · 누적 {len(rows):,}건", flush=True)
    return rows


def in_region(row: dict) -> bool:
    for k in ("ctprvnNm", "rdnmadr", "lnmadr"):
        v = str(row.get(k) or "").strip()
        if v.startswith(REGION_PREFIX):
            return True
    return False


def coord(row: dict) -> tuple[float, float] | None:
    try:
        lat = float(row.get("latitude") or row.get("lat") or "nan")
        lng = float(row.get("longitude") or row.get("lot") or row.get("lng") or "nan")
    except ValueError:
        return None
    if not (32.5 < lat < 39 and 124 < lng < 132.5):
        return None
    return round(lat, 6), round(lng, 6)


def school_name(row: dict) -> str:
    for k in ("trgetFcltyNm", "fcltyNm", "trgetFcltyName", "instNm"):
        v = str(row.get(k) or "").strip()
        if v:
            return v
    return ""


def main() -> None:
    key = load_key()
    CACHE.mkdir(parents=True, exist_ok=True)

    raw = {kind: fetch_all(kind, url, key) for kind, url in SOURCES.items()}
    if raw["crosswalk"]:
        print("[crosswalk] 항목 예:", sorted(raw["crosswalk"][0].keys()), flush=True)
    if raw["school"]:
        print("[school] 항목 예:", sorted(raw["school"][0].keys()), flush=True)

    cells: dict[str, dict] = {}
    seen: set = set()
    counts = {"crosswalk": 0, "school": 0, "skipped_no_coord": 0, "skipped_region": 0}

    for kind, rows in raw.items():
        for row in rows:
            if not in_region(row):
                counts["skipped_region"] += 1
                continue
            c = coord(row)
            if not c:
                counts["skipped_no_coord"] += 1
                continue
            dedupe = (kind, c)
            if dedupe in seen:
                continue
            seen.add(dedupe)
            cell = f"{math.floor(c[0] / CELL_DEG)}_{math.floor(c[1] / CELL_DEG)}"
            d = cells.setdefault(cell, {})
            if kind == "crosswalk":
                d.setdefault("c", []).append([c[0], c[1]])
            else:
                d.setdefault("s", []).append([c[0], c[1], school_name(row)])
            counts[kind] += 1

    if counts["crosswalk"] + counts["school"] == 0:
        sys.exit("모은 시설이 0건입니다. 지역 필터나 항목 이름을 확인해야 합니다. 파일은 그대로 둡니다.")

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    for cell, d in cells.items():
        (OUT / f"{cell}.json").write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    meta = {
        "collectedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "regions": ["서울특별시", "전북특별자치도"],
        "cellDeg": CELL_DEG,
        "cells": len(cells),
        "counts": counts,
        "sources": {
            "crosswalk": "공공데이터포털 전국횡단보도표준데이터 (15028201)",
            "school": "공공데이터포털 전국어린이보호구역표준데이터 (15012891)",
        },
    }
    (OUT / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    size = sum(p.stat().st_size for p in OUT.glob("*.json"))
    print(f"완료: 칸 {len(cells):,}개 · 횡단보도 {counts['crosswalk']:,} · 보호구역 {counts['school']:,} · {size/1024:.0f}KB", flush=True)
    print(json.dumps(counts, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
