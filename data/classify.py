"""구글플레이 리뷰 200건을 주제별로 분류한다.

규칙 기반이라 누가 다시 돌려도 같은 숫자가 나온다. 한 리뷰가 여러 주제에 걸칠 수 있다.
키워드가 하나도 안 걸리면 '기타/욕설'로 남긴다 — 억지로 끼워 맞추지 않는다.
"""

import csv
import re
import sys
from collections import Counter, defaultdict

RULES = [
    ("사진 촬영·저장 실패", r"저장이?\s*안|저장되지\s*않|정상적으로\s*저장|저장실패|저장 실패|사진이\s*안\s*나|안찍힘|안 찍|촬영이 저장"),
    ("앱 튕김·먹통·프리징", r"튕|강제\s*종료|종료됩니다|초기\s*화면|초기화면|초기화\s*되|프리징|먹통|무반응|실행도 안|접속이 안|안 켜|안켜|로딩화면|재부팅"),
    ("갤러리 사진 첨부 불가(앱 카메라 강제)", r"갤러리|앨범|사진첩|내장\s*카메라|내장캠|앱내\s*카메라|앱 내 카메라|어플\s*켜서|블박|블랙박스|어플사진기"),
    ("제출·다음 단계 진행 불가", r"제출|신고가\s*안|신고도\s*안|다음\s*화면|안넘어|넘어가지|버튼.{0,6}활성화|유형\s*선택도\s*안|업로드가\s*안|안올라|업로두"),
    ("느림·로딩·버퍼링", r"느[리려린]|느림|오래\s*걸|버퍼링|렉|로딩이|딜레이|시간이 너무"),
    ("로그인·인증·가입 실패", r"인증|로그인|비번|비밀번호|가입|아이디"),
    ("사진 화질·번호판 식별 불가", r"화질|해상도|번호판.{0,10}(안|못|식별)|번호\s*식별|식별\s*불가|식별이 안"),
    ("1분 대기·현장 체류", r"1분|일\s*분|시차|대기|기다"),
    ("처리 지연·깜깜무소식", r"처리.{0,6}(늦|안)|한\s*달|두\s*달|8개월|깜깜무소식|지연|14일|진행중|답변이 (많이 )?늦|묵묵부답"),
    ("불수용·반려에 대한 불신", r"불수용|반려|빠꾸|바꾸먹|보완|계도|경고장|관할"),
    ("작성 중 내용 유실·세션 만료", r"날아|세션\s*만료|작업중이던|다시 진행"),
    ("위치·주소 입력 문제", r"위치|주소|GPS"),
    ("신고 요건 안내 미흡", r"안내|요건|공지|어디에 되어있|설명도 없"),
    ("촬영 시각 미표시로 반려", r"시간이?\s*(안\s*나|없다|미표출|표시)|일시가|날짜, ?시간"),
]


def main(path: str) -> None:
    rows = list(csv.DictReader(open(path, encoding="utf-8"), delimiter="\t"))
    counts: Counter[str] = Counter()
    examples: dict[str, list[str]] = defaultdict(list)
    untagged = []

    for r in rows:
        body = r["body"]
        hit = False
        for label, pat in RULES:
            if re.search(pat, body):
                counts[label] += 1
                if len(examples[label]) < 3 and len(body) > 25:
                    examples[label].append(f'{r["idx"]}: {body[:110]}')
                hit = True
        if not hit:
            untagged.append(r["idx"])

    stars = Counter(int(r["rating"]) for r in rows)
    print(f"# 구글플레이 리뷰 {len(rows)}건 주제 분류\n")
    print(f"수집: 최신순 {rows[-1]['date']} ~ {rows[0]['date']} (2026-09-18 수집)\n")
    print("## 별점 분포\n")
    for s in sorted(stars, reverse=True):
        print(f"- {s}점: {stars[s]}건 ({stars[s] / len(rows) * 100:.1f}%)")
    print()
    print("## 주제별 언급 수 (한 리뷰가 여러 주제에 걸칠 수 있음)\n")
    print("| 주제 | 건수 | 비율 |")
    print("| --- | ---: | ---: |")
    for label, n in counts.most_common():
        print(f"| {label} | {n} | {n / len(rows) * 100:.1f}% |")
    print(f"\n키워드가 하나도 안 걸린 리뷰: {len(untagged)}건 (대부분 욕설·한 줄 불평)\n")
    print("## 주제별 실제 문장\n")
    for label, _ in counts.most_common():
        print(f"### {label}\n")
        for e in examples[label]:
            print(f"- {e}")
        print()


if __name__ == "__main__":
    main(sys.argv[1])
