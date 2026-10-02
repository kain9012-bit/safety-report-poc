/**
 * 둘째 사진 차례 알림 — 0초가 되면 소리·진동으로 알린다(회의 결정).
 *
 * 웹에서 할 수 있는 만큼만 한다.
 *  - 소리: Web Audio 짧은 신호음. 브라우저는 사용자가 누른 뒤에만 소리를 허락하므로 셔터를 누를 때 깨워 둔다.
 *  - 진동: navigator.vibrate (안드로이드 크롬. 아이폰 사파리는 지원하지 않는다)
 *  - 다른 앱을 보고 있을 때: 알림 권한이 있으면 시스템 알림 한 번, 탭 제목에도 남은 시간을 쓴다
 * 화면 맨 위에 남은 시간을 띄우는 것(아이폰 다이내믹 아일랜드·안드로이드 상태바)은 앱으로 만들 때만 된다.
 */

let ctx: AudioContext | null = null;

/** 셔터를 누를 때 부른다 — 소리 권한을 미리 얻어 두고, 알림 권한도 이때 묻는다 */
export function primeAlerts(): void {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AC && !ctx) ctx = new AC();
    void ctx?.resume();
  } catch {
    /* 소리를 못 내는 환경 */
  }
  try {
    if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
  } catch {
    /* 알림을 못 쓰는 환경 */
  }
}

function beep(): void {
  if (!ctx) return;
  const t = ctx.currentTime;
  [0, 0.22].forEach((d) => {
    const o = ctx!.createOscillator();
    const g = ctx!.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, t + d);
    g.gain.exponentialRampToValueAtTime(0.4, t + d + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.18);
    o.connect(g).connect(ctx!.destination);
    o.start(t + d);
    o.stop(t + d + 0.2);
  });
}

/** 0초 — 소리·진동, 화면을 안 보고 있으면 시스템 알림 */
export function ringReady(): void {
  try {
    beep();
  } catch {
    /* 무시 */
  }
  try {
    navigator.vibrate?.([250, 120, 250]);
  } catch {
    /* 무시 */
  }
  try {
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      new Notification('둘째 사진을 찍을 차례입니다', { body: '첫 사진과 같은 자리·방향에서 찍어 주세요', tag: 'second-shot' });
    }
  } catch {
    /* 무시 */
  }
}

const BASE_TITLE = typeof document !== 'undefined' ? document.title : '';

/** 탭 제목에 남은 시간 — 다른 탭·앱을 보다가도 확인할 수 있게 */
export function titleCountdown(remainSec: number | null): void {
  if (typeof document === 'undefined') return;
  document.title =
    remainSec === null ? BASE_TITLE : remainSec > 0 ? `${remainSec}초 · 둘째 사진 대기` : '지금 둘째 사진 찍기';
}
