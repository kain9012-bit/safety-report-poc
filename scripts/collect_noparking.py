#!/usr/bin/env python3
"""
전국 주정차금지(지정)구역 표준데이터를 받아 시군구별 파일로 만든다.

  python scripts/collect_noparking.py

- 키: .env.local 의 DATA_GO_KR_KEY. 키는 출력하지 않는다.
  (윈도우에서 만든 .env.local 은 줄 끝에 \\r 이 붙는다 — 떼고 쓴다. 안 떼면 '등록되지 않은 서비스키')
- API: http://api.data.go.kr/openapi/tn_pubr_public_prkstop_prhibt_area_api (공공데이터포털 15034542)
- 결과: public/noparking/index.json      시군구 이름 → 파일, 수집 시각·건수
        public/noparking/{시군구코드}.json  그 시군구의 구간 목록
- 받은 원본 페이지는 .cache/noparking/ 에 저장해, 중간에 끊겨도 이어 받는다.
  새로 받으려면 .cache/noparking/ 를 비우고 다시 돌린다(표준데이터는 수시 갱신).

이 자료에는 **좌표가 없다.** 도로명(rdnmadr)과 구간 설명(descLc)뿐이다.
그래서 앱은 휴대폰 위치 → 도로명주소 → 같은 시군구·같은 도로명인 구간을 '참고'로 보여 준다.
"""
from __future__ import annotations

import datetime as dt
import json
import pathlib
import sys
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "noparking"
CACHE = ROOT / ".cache" / "noparking"
URL = "http://api.data.go.kr/openapi/tn_pubr_public_prkstop_prhibt_area_api"
ROWS = 1000


def load_key() -> str:
    for name in (".env.local", ".env"):
        p = ROOT / name
        if not p.exists():
            continue
        for line in p.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()  # \r 포함
            if line.startswith("DATA_GO_KR_KEY="):
                v = line.split("=", 1)[1].strip().strip('"').strip("'")
                if v:
                    return v
    sys.exit("DATA_GO_KR_KEY 가 .env.local 에 없습니다.")


def page(key: str, no: int) -> dict:
    f = CACHE / f"p{no:03d}.json"
    if f.exists():
        return json.loads(f.read_text(encoding="utf-8"))
    q = urllib.parse.urlencode({"serviceKey": key, "pageNo": no, "numOfRows": ROWS, "type": "json"})
    last = None
    for i in range(4):
        try:
            with urllib.request.urlopen(f"{URL}?{q}", timeout=60) as r:
                text = r.read().decode("utf-8")
            j = json.loads(text)
            if "OpenAPI_ServiceResponse" in j:
                msg = j["OpenAPI_ServiceResponse"].get("cmmMsgHeader", {}).get("errMsg")
                sys.exit(f"API 오류: {msg}")
            f.write_text(text, encoding="utf-8")
            return j
        except SystemExit:
            raise
        except Exception as e:  # 네트워크·일시 오류는 다시
            last = e
            time.sleep(2 * (i + 1))
    sys.exit(f"요청 실패: {last}")


def items_of(j: dict) -> tuple[int, list[dict]]:
    body = (j.get("response") or j)["body"]
    items = body.get("items") or []
    if isinstance(items, dict):
        items = items.get("item") or []
    if isinstance(items, dict):
        items = [items]
    return int(body.get("totalCount") or 0), items


def hhmm(v: str | None) -> str:
    v = (v or "").strip()
    return v if len(v) == 5 and v[2] == ":" else ""


def window(a: str | None, b: str | None) -> list[str] | None:
    a, b = hhmm(a), hhmm(b)
    return [a, b] if a and b else None


def slim(x: dict) -> dict:
    return {
        "road": (x.get("rdnmadr") or "").strip(),
        "desc": (x.get("descLc") or "").strip(),
        "wd": window(x.get("weekdayPrhibtOpenHhmm"), x.get("weekdayPrhibtColseHhmm")),
        "wdOk": window(x.get("weekdayPrhibtPermsHhmm"), x.get("weekdayPrhibtPermeHhmm")),
        "sat": window(x.get("satHhmmOpenHhmm"), x.get("satHhmmColseHhmm")),
        "satOk": window(x.get("satPrhibtPermsHhmm"), x.get("satPrhibtPermeHhmm")),
        "hol": window(x.get("holidayPrhibtOpenHhmm"), x.get("holidayPrhibtColseHhmm")),
        "holOk": window(x.get("holidayPrhibtPermsHhmm"), x.get("holidayPrhibtPermeHhmm")),
        "holFree": (x.get("holidayPermYn") or "").strip().upper() == "Y",
        "ref": (x.get("referenceDate") or "").strip(),
        "org": (x.get("institutionNm") or x.get("insttNm") or "").strip(),
        "tel": (x.get("institutionPhoneNumber") or "").strip(),
    }


def main() -> None:
    key = load_key()
    CACHE.mkdir(parents=True, exist_ok=True)
    rows: list[dict] = []
    total, first = items_of(page(key, 1))
    rows += first
    pages = (total + ROWS - 1) // ROWS
    for no in range(2, pages + 1):
        rows += items_of(page(key, no))[1]
        print(f"\r{no}/{pages}쪽", end="", flush=True)
    print(f"\n받은 구간 {len(rows):,} / 전체 {total:,}")

    by: dict[str, dict] = {}
    for x in rows:
        code = (x.get("signguCode") or "").strip()
        sgg = (x.get("signguNm") or "").strip()
        sido = (x.get("ctprvnNm") or "").strip()
        if not code or not sgg:
            continue
        g = by.setdefault(code, {"sido": sido, "sigungu": sgg, "zones": []})
        z = slim(x)
        if z["road"]:
            g["zones"].append(z)

    if OUT.exists():
        for f in OUT.glob("*.json"):
            f.unlink()
    OUT.mkdir(parents=True, exist_ok=True)
    index = []
    for code, g in sorted(by.items()):
        (OUT / f"{code}.json").write_text(json.dumps(g["zones"], ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        index.append({"code": code, "sido": g["sido"], "sigungu": g["sigungu"], "count": len(g["zones"])})
    meta = {
        "source": "공공데이터포털 전국주정차금지(지정)구역표준데이터(15034542)",
        "collectedAt": dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).strftime("%Y-%m-%d"),
        "zones": sum(i["count"] for i in index),
        "regions": index,
    }
    (OUT / "index.json").write_text(json.dumps(meta, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"시군구 {len(index)}곳, 구간 {meta['zones']:,} → {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
