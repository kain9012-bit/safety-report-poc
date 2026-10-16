#!/usr/bin/env python3
"""
발표자료 시연 영상 2개의 해설 음성을 다시 입힌다. 화면(영상)은 그대로 두고 소리만 바꾼다.

  pip install edge-tts      # 마이크로소프트 신경망 음성(인터넷 필요)
  python scripts/deck-voiceover.py            # 두 영상 모두
  python scripts/deck-voiceover.py current    # 하나만

- 대본은 아래 SCRIPTS — 장면마다 [시작초, 끝초, 문장]. 시작초에 말을 시작하고, 끝초 전에 끝나야 한다.
  장면 시각은 기존 해설의 말 구간(무음 감지)에 맞췄다. 화면을 다시 녹화하면 시각도 다시 맞춘다.
- 말이 칸보다 길면 말 빠르기를 올려 다시 만든다(최대 +30%). 그래도 길면 오류로 멈춘다 — 문장을 줄인다.
- 결과: public/deck/assets/demo-*.webm 을 덮어쓴다(원본은 깃 기록에 있다). 중간 파일은 .cache/vo/
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "public" / "deck" / "assets"
WORK = ROOT / ".cache" / "vo"

VOICE = "ko-KR-HyunsuMultilingualNeural"  # 남성, 30대 느낌의 또렷한 음성
BASE_RATE = 6  # %, 기본 말 빠르기
PITCH = "-3Hz"  # 살짝 낮춰 차분하고 자신감 있게

SCRIPTS: dict[str, list[tuple[float, float, str]]] = {
    "current": [
        (0.65, 9.6, "먼저 지금의 안전신문고 앱입니다. 실제 화면으로 신고 순서를 따라가 보겠습니다."),
        (9.68, 16.6, "촬영 버튼을 누르면, 카메라 대신 유형부터 고르라는 알림이 뜹니다."),
        (16.73, 28.2, "요건은 안내문으로만 보여 줍니다. 지역 행정예고를 먼저 확인하라, 요건이 안 맞으면 과태료가 없을 수 있다. 여기까지입니다."),
        (28.32, 40.8, "맞는지는 신고자 혼자 판단해야 합니다. 사진은 찍는 대로 첨부되고, 번호판이 잘려도 아무 안내가 없습니다."),
        (40.96, 49.3, "첫 사진을 붙이면 1분을 기다려야 합니다. 그동안은 버튼을 눌러도 카메라가 열리지 않습니다."),
        (49.47, 54.4, "발생지역은 지도를 열어 직접 찾아 고릅니다."),
        (54.57, 61.5, "내용은 다섯 자 이상 직접 쓰고, 로그인하지 않았다면 휴대전화 인증까지 거칩니다."),
        (61.65, 68.0, "요건을 제대로 지켰는지는, 제출하고 처리 결과를 받아 봐야 압니다."),
        (68.14, 73.3, "요건은 혼자 해석하고, 결과는 제출 뒤에야 압니다."),
    ],
    "improved": [
        (0.68, 7.0, "이번에는 개선안으로, 버스정류소 앞에 선 차를 신고해 보겠습니다."),
        (7.12, 14.0, "사진부터 찍기를 누르면, 유형을 고르지 않아도 카메라가 바로 열립니다."),
        (14.16, 17.6, "첫 번째 사진은 찍자마자 판독합니다."),
        (17.72, 22.6, "번호판이 화면에 없으면, 그 이유를 바로 알려 줍니다."),
        (22.77, 30.4, "제출하고 며칠 뒤에야 알게 되는 일은 없습니다."),
        (30.52, 38.9, "다시 찍으면 유형과 차량 번호, 발생지역이 저절로 채워집니다."),
        (39.06, 44.6, "두 번째 사진까지는 1분. 이 시간에는 자리를 떠도 됩니다."),
        (44.75, 48.8, "영 초가 되면 소리와 진동으로 알려 줍니다."),
        (48.95, 59.0, "그사이 전화가 와서 앱을 닫아도, 다시 켜면 하던 신고로 바로 돌아옵니다."),
        (59.20, 64.6, "두 번째 사진을 찍을 때는 첫 번째 사진이 흐리게 겹쳐 보입니다."),
        (64.74, 68.9, "잔상에 맞추면 같은 구도가 됩니다."),
        (69.08, 82.0, "찍자마자 두 사진이 같은 자리인지, 번호판이 같은지 확인합니다."),
        (82.19, 86.0, "번호판은 두 사진에서 잘라 크게 보여 줍니다."),
        (86.10, 93.7, "한 글자씩 맞춰 보기만 하면 됩니다."),
        (93.84, 98.4, "제출 전에는 자주 반려되는 사유를 신호등으로 점검합니다."),
        (98.56, 102.2, "빨간불이 하나라도 있으면 제출할 수 없습니다."),
        (102.34, 109.2, "담당 공무원에게는 간격과 겹침, 번호판 일치 여부가 요약으로 함께 갑니다."),
        (109.35, 118.7, "담당자는 다시 재지 않고, 확인만 하면 됩니다."),
        (118.86, 133.6, "소화전 앞이나 어린이보호구역도 마찬가지입니다. 사진만 찍으면 같은 방식으로 유형을 찾아 줍니다."),
        (133.78, 140.1, "현장에서는 찍기만, 판단은 앱이 근거와 함께 합니다."),
    ],
}


def dur(p: pathlib.Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)],
                         capture_output=True, text=True, check=True).stdout
    return float(out.strip())


def tts(text: str, out: pathlib.Path, rate: int) -> None:
    subprocess.run([sys.executable, "-m", "edge_tts", "--voice", VOICE, f"--rate=+{rate}%", f"--pitch={PITCH}",
                    "--text", text, "--write-media", str(out)], check=True, capture_output=True)


def build(name: str) -> dict:
    src = ASSETS / f"demo-{name}.webm"
    orig = WORK / f"demo-{name}.orig.webm"
    if not orig.exists():  # 처음 한 번 원본 화면을 보관(소리는 버린다)
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(src), "-c", "copy", str(orig)], check=True)
    total = dur(orig)
    clips, report = [], []
    for i, (a, b, text) in enumerate(SCRIPTS[name]):
        out = WORK / f"{name}-{i:02d}.mp3"
        rate = BASE_RATE
        while True:
            tts(text, out, rate)
            d = dur(out)
            if d <= b - a or rate >= 30:
                break
            rate += 4
        if d > b - a:
            raise SystemExit(f"[{name} {i}] {d:.1f}초 > 칸 {b - a:.1f}초 — 문장을 줄이세요: {text}")
        clips.append((a, out))
        report.append({"i": i, "start": a, "slot": round(b - a, 2), "speech": round(d, 2), "rate": rate})
    # 소리 합치기: 각 문장을 시작초에 놓고, 크기를 맞춘다
    args = ["ffmpeg", "-loglevel", "error", "-y", "-i", str(orig)]
    for _, p in clips:
        args += ["-i", str(p)]
    parts = [f"[{k + 1}:a]adelay={int(a * 1000)}|{int(a * 1000)}[a{k}]" for k, (a, _) in enumerate(clips)]
    mix = "".join(f"[a{k}]" for k in range(len(clips)))
    fc = ";".join(parts) + f";{mix}amix=inputs={len(clips)}:normalize=0,apad,atrim=0:{total:.3f},loudnorm=I=-16:TP=-1.5[out]"
    tmp = WORK / f"demo-{name}.new.webm"
    args += ["-filter_complex", fc, "-map", "0:v", "-map", "[out]", "-c:v", "copy", "-c:a", "libopus", "-b:a", "96k", str(tmp)]
    subprocess.run(args, check=True)
    tmp.replace(src)
    return {"video": src.name, "length": round(total, 1), "lines": report}


def main() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    names = sys.argv[1:] or list(SCRIPTS)
    for n in names:
        print(json.dumps(build(n), ensure_ascii=False))


if __name__ == "__main__":
    main()
