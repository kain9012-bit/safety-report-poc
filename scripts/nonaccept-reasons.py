"""불수용 사유 칸이 있는 지자체 원자료(양주시·남해군)의 사유를 묶어 센다.

자료: data/opendata/raw/ (깃에는 안 올림, data/opendata/README.md 참고)
      양주시 15152703 — '반환오류내용' 칸이 채워진 건
      남해군(ID 미확인) — '수용여부'가 불수용인 건의 '불수용사유' 칸
실행: python scripts/nonaccept-reasons.py            # 두 곳 모두
      python scripts/nonaccept-reasons.py 파일.csv   # 한 파일만
결과는 docs/officer-impact.md 2-2장과 발표자료 '불수용 사유' 장에 옮겨 적는다.

사유 칸('반환오류내용')은 담당자가 자유롭게 적어 표기가 수백 가지다.
같은 뜻끼리 아래 규칙으로 묶는다. 묶는 기준은 우리가 정했다.
앱 단계: A=사진 규칙으로 제출 전에 거름 / B=지역 단속 시간 기준이 있으면 거름
         P=AI 판독으로 일부 / N=앱으로 못 거름(현장·구역 판단)
"""
import collections
import csv
import io
import re
import sys
from pathlib import Path

CATS = [
    ('time', '위반시간 부족(1분 미달)', 'A', [r'위반시간', r'시간\s*부족', r'1분']),
    ('angle', '사진 각도·위치 상이', 'A', [r'각도', r'동일\s*(위치|장소|방향)', r'위치\s*상이', r'장소\s*상이']),
    ('plate', '번호판 판독 불가', 'A', [r'번호판?\s*(판)?독', r'번호\s*판독', r'번호판\s*(가림|식별)', r'차량\s*번호']),
    ('phone', '안전신문고 카메라 미사용(일반 사진)', 'A', [r'스마트\s*폰', r'일반\s*사진', r'갤러리', r'앨범', r'캡[처쳐]']),
    ('photo', '신고 사진 부족', 'A', [r'(?<!배경)사진\s*부족', r'사진\s*1장', r'사진\s*미첨부']),
    ('late', '신고 기한 경과', 'A', [r'기일', r'기한', r'경과']),
    ('hours', '단속 시간 외(점심 유예 등)', 'B', [r'단속\s*시간', r'점심', r'유예', r'시간\s*외', r'야간', r'휴일', r'주말', r'공휴']),
    ('loc', '위반 장소가 사진에 안 보임', 'P', [r'판독\s*[불블]가', r'판단\s*불가', r'(?<!전화번호 )확인\s*불가', r'미확인', r'식별\s*(불가|어려)', r'증거\s*사진', r'배경\s*사진']),
    ('zone', '금지구역 아님·사유지·미설치 구간', 'N', [
        r'사유지', r'시유지', r'구역\s*아님', r'미\s*해당', r'미지정', r'미\s*설치', r'미침범', r'주출입', r'아닌', r'아님', r'정지선',
        r'공사', r'개발', r'택지', r'회천', r'\d-\d\s*지구', r'구간', r'주차장', r'아파트', r'단지\s*내',
        r'통신선로', r'지중배선', r'택시정류장', r'토요일\s*제외', r'빌', r'상가', r'전세버스']),
    ('move', '차량 움직임', 'N', [r'움직', r'운전자', r'탑승', r'승하차', r'주행']),
    ('etc', '기타(취하·계도 등)', 'N', [r'.']),
]
LABEL = {k: (lab, tier) for k, lab, tier, _ in CATS}


def classify(text):
    s = text.strip()
    found = [k for k, _, _, pats in CATS if any(re.search(p, s) for p in pats)]
    if 'plate' in found and 'loc' in found:
        found.remove('loc')          # '번호판 판독불가'는 장소가 아니라 번호판
    if 'loc' in found and 'zone' in found:
        found.remove('zone')         # '정지선 면적 판독불가'는 판독 문제
    if 'loc' in found and 'move' in found:
        found.remove('loc')          # '차량움직임 판독불가'는 움직임 문제
    if 'hours' in found and 'time' in found and not re.search(r'위반시간', s):
        found.remove('time')         # '단속시간 부족'은 단속 시간 문제
    if len(found) > 1:
        found.remove('etc')
    return found


ROOT = Path(__file__).resolve().parent.parent / 'data' / 'opendata' / 'raw'
SOURCES = {
    '15152703_경기도 양주시.csv': ('반환오류내용', None),
    'ID미확인_경상남도 남해군.csv': ('불수용사유', ('수용여부', '불수용')),
}


def load(path):
    raw = Path(path).read_bytes()
    for enc in ('utf-8-sig', 'cp949'):
        try:
            return list(csv.DictReader(io.StringIO(raw.decode(enc))))
        except UnicodeDecodeError:
            pass
    raise ValueError(path)


def run(path):
    name = Path(path).name
    col, flt = SOURCES.get(name, ('반환오류내용', None))
    rows = load(path)
    if flt:
        picked = [r for r in rows if (r.get(flt[0]) or '').strip() == flt[1]]
    else:
        picked = [r for r in rows if (r.get(col) or '').strip()]
    reasons = [(r.get(col) or '').strip() for r in picked]
    n, r = len(rows), len(reasons)
    blank = sum(1 for s in reasons if not s)
    print(f'## {name}')
    print(f'신고 {n:,}건 · 불수용 {r:,}건 ({r / n:.1%}) · 사유 표기 {len(set(reasons))}가지 · 사유 빈칸 {blank}건\n')

    per_cat, per_tier = collections.Counter(), collections.Counter()
    for s in reasons:
        if not s:
            per_tier['?'] += 1
            continue
        cats = classify(s)
        per_cat.update(cats)
        tiers = {LABEL[c][1] for c in cats}
        per_tier[next(t for t in 'ABPN' if t in tiers)] += 1   # 앱이 거를 수 있는 쪽 우선

    print('사유 묶음 (한 건에 사유가 여럿이면 각각 셈)')
    for k, v in per_cat.most_common():
        print(f'  {LABEL[k][1]}  {LABEL[k][0]:<24} {v:>5,}  {v / r:6.1%}')
    print('\n건 단위 (앱이 거를 수 있는 쪽 우선)')
    names = {'A': '사진 규칙으로 거름', 'B': '지역 단속 시간 기준이 있으면 거름', 'P': 'AI 판독으로 일부', 'N': '못 거름', '?': '사유 빈칸'}
    for t in 'ABPN?':
        if per_tier[t]:
            print(f'  {names[t]:<22} {per_tier[t]:>5,}  {per_tier[t] / r:6.1%}')
    print()


def main(paths):
    for p in paths or [ROOT / f for f in SOURCES]:
        run(p)


if __name__ == '__main__':
    main(sys.argv[1:])
