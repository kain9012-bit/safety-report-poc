"""공공데이터포털 지자체 불법주정차 신고 원자료를 한데 모아 요약한다.

입력: data/opendata/raw/*.csv     (원자료, 저장소에 넣지 않음 — data/opendata/README.md 참고)
      data/opendata/sources.csv   (데이터셋 제목·등록일·수정일·주소)
출력: data/opendata/catalog.csv          파일별 행 수·기간·칸 이름·결과/사유 칸 유무
      data/opendata/nonaccept-by-city.csv 불수용률을 셀 수 있는 지자체만
실행: python scripts/opendata-summary.py

불수용 판단 기준은 지자체마다 칸 이름과 값이 달라 RULES에 하나씩 적었다.
'계도'는 불수용이 아니라 별도 조치라 세지 않는다.
"""
import csv
import io
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / 'data' / 'opendata'
RAW = ROOT / 'raw'

# 파일 접두어(ID) → (결과 칸, 불수용 값 판정, 안전신문고만 거를 칸)
RULES = {
    '15151939': ('답변처리상황', lambda v: v == '불수용', None),
    '15152262': ('과태료부과여부', lambda v: v == '제외', None),
    '15153670': ('과태료 부과 여부', lambda v: v == 'N', None),
    '15155888': ('처리결과', lambda v: '불수용' in v, None),
    '15154087': ('처리결과', lambda v: '불수용' in v, None),
    '15153734': ('과태료 부과여부', lambda v: v == '불수용', None),
    '15152540': ('과태료 부과 여부', lambda v: v == 'N', None),
    '15152348': ('과태료 여부', lambda v: v == '부', None),
    '15152833': ('과태료 부과 여부', lambda v: v == '불여', None),
    '15152847': ('과태료 부과 여부', lambda v: v == 'X', None),
    '15152922': ('과태료부과여부', lambda v: v in ('미부과', '비부과'), ('단속구분', '안전신문고')),
    '15153012': ('과태료 부과 여부', lambda v: v == '미부과', ('단속구분', '안전신문고')),
    '15125216': ('과태료부과여부', lambda v: v == 'N', ('단속방법', '안전신문고')),
    '15153524': ('과태료 부과 여부', lambda v: v == 'N', None),
    '15153602': ('과태료부과여부', lambda v: v == '미부과', None),
    '15153792': ('과태료부과여부', lambda v: v == '미부과', None),
    '15155320': ('과태료 부과여부', lambda v: v == 'N', ('단속구분', '안전신문고')),
    '15155896': ('단속구분', lambda v: v == '비부과', None),
    '15155963': ('과태료 부과여부', lambda v: v == '미부과', None),
    '15156122': ('부과여부', lambda v: v == '비부과', None),
    '15156000': ('처리결과', lambda v: v.startswith('미부과'), None),
    '15152703': ('반환오류내용', lambda v: v.strip() != '', None),
    '15153494': ('과태료 부과', lambda v: v.strip() == 'X', None),
    'ID미확인_경상남도 남해군': ('수용여부', lambda v: v == '불수용', None),
    'ID미확인_충청남도 금산군': ('과태료부과여부', lambda v: v == 'X', None),
    'ID미확인_충청북도 옥천군': ('과태료부과여부', lambda v: v == '부', None),
    'ID미확인_광주광역시 광산구': ('단속', lambda v: v == '미단속', None),
}
REASON_COLS = ('사유', '반환오류')
DATE_RE = re.compile(r'(20\d\d)[-./]?(\d\d)[-./]?(\d\d)')


def load(path):
    raw = path.read_bytes()
    for enc in ('utf-8-sig', 'cp949'):
        try:
            return enc, list(csv.DictReader(io.StringIO(raw.decode(enc))))
        except UnicodeDecodeError:
            pass
    raise ValueError(path)


def period(rows, cols):
    for c in cols:
        if not any(k in c for k in ('일시', '일자', '신고일', '위반일', '단속일', '접수일')):
            continue
        ds = sorted(m.group(1) + '-' + m.group(2) for r in rows if (m := DATE_RE.search(r.get(c) or '')))
        if ds:
            mid = ds[len(ds) // 100: len(ds) - len(ds) // 100 or None]   # 앞뒤 1% 오기 제외
            return c, mid[0], mid[-1]
    return '', '', ''


def rule_for(name):
    for key, rule in RULES.items():
        if name.startswith(key):
            return rule
    return None


def main():
    src = {r['file']: r for r in csv.DictReader(open(ROOT / 'sources.csv', encoding='utf-8-sig'))}
    cat, rates = [], []
    for f in sorted(RAW.glob('*.csv')):
        enc, rows = load(f)
        cols = list(rows[0].keys()) if rows else []
        dcol, start, end = period(rows, cols)
        s = src.get(f.name, {})
        rule = rule_for(f.name)
        reason = [c for c in cols if any(k in c for k in REASON_COLS)]
        cat.append({
            '파일': f.name, '제목': s.get('title', ''), '행 수': len(rows), '기간 시작': start, '기간 끝': end,
            '기간 기준 칸': dcol, '불수용 판단 칸': rule[0] if rule else '', '사유 칸': ','.join(reason),
            '칸 이름': '|'.join(cols), '인코딩': enc, '등록일': s.get('reg', ''), '수정일': s.get('mod', ''),
            '주소': s.get('url', ''),
        })
        if rule:
            col, is_no, flt = rule
            target = [r for r in rows if not flt or (r.get(flt[0]) or '').strip() == flt[1]]
            n = len(target)
            no = sum(1 for r in target if is_no((r.get(col) or '').strip()))
            rates.append({
                '지자체': re.sub(r'^(\d+|ID미확인)_', '', f.stem), '파일': f.name, '기간 시작': start, '기간 끝': end,
                '대상 건수': n, '불수용 건수': no, '불수용률(%)': round(no / n * 100, 1) if n else '',
                '기준': f'{col}' + (f' · {flt[0]}={flt[1]}만' if flt else ''),
                '주의': '부과 건 위주 목록일 수 있음' if n and no / n < 0.03 else '',
            })

    def write(name, rows):
        with open(ROOT / name, 'w', encoding='utf-8-sig', newline='') as fp:
            w = csv.DictWriter(fp, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)

    write('catalog.csv', cat)
    rates.sort(key=lambda r: -r['대상 건수'])
    write('nonaccept-by-city.csv', rates)
    ok = [r for r in rates if not r['주의']]
    tn, tno = sum(r['대상 건수'] for r in ok), sum(r['불수용 건수'] for r in ok)
    print(f'파일 {len(cat)}개 · 불수용률을 셀 수 있는 지자체 {len(rates)}곳')
    print(f'주의 표시 제외 {len(ok)}곳 합계: {tno:,}/{tn:,} = {tno / tn:.1%}')
    for r in rates:
        print(f"  {r['지자체']:<20} {r['대상 건수']:>7,} {r['불수용률(%)']:>6}% {r['주의']}")


if __name__ == '__main__':
    main()
