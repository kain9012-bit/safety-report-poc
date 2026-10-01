/**
 * 촬영과 워터마크.
 *
 * 사진에 촬영시각이 찍혀 있지 않으면 반려된다(반려 사유 중 하나).
 * 그래서 찍는 순간 시각·좌표를 사진 위에 직접 그려 넣는다.
 * 화질은 건드리지 않는다 — 번호판이 안 읽히면 그것도 반려 사유다(요구사항 R2).
 */

export interface CaptureMeta {
  takenAt: number;
  lat?: number;
  lng?: number;
  accuracy?: number;
}

export function formatStamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes(),
  )}:${p(d.getSeconds())}`;
}

/** 비디오 한 프레임을 원본 해상도로 떠서 워터마크를 얹은 JPEG 데이터 URL */
export function captureFrame(video: HTMLVideoElement, meta: CaptureMeta): string {
  const w = video.videoWidth;
  const h = video.videoHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('캔버스를 만들 수 없습니다');
  ctx.drawImage(video, 0, 0, w, h);

  const lines = [formatStamp(meta.takenAt)];
  if (meta.lat !== undefined && meta.lng !== undefined) {
    const acc = meta.accuracy !== undefined ? ` (±${Math.round(meta.accuracy)}m)` : '';
    lines.push(`${meta.lat.toFixed(6)}, ${meta.lng.toFixed(6)}${acc}`);
  } else {
    lines.push('위치 정보 없음');
  }
  drawStamp(ctx, w, h, lines);

  // 품질 0.92 — 번호판이 읽혀야 한다. 용량보다 판독이 먼저다.
  return canvas.toDataURL('image/jpeg', 0.92);
}

/** 사진 왼쪽 아래에 글줄을 박는다 — 카메라 사진과 앨범 사진이 같은 모양을 쓴다 */
export function drawStamp(ctx: CanvasRenderingContext2D, w: number, h: number, lines: string[]): void {
  const pad = Math.round(h * 0.018);
  const size = Math.max(14, Math.round(h * 0.028));
  ctx.font = `bold ${size}px sans-serif`;
  ctx.textBaseline = 'bottom';
  const lineH = Math.round(size * 1.35);
  const boxH = lineH * lines.length + pad;
  const boxW = Math.min(w - pad * 2, Math.max(...lines.map((t) => ctx.measureText(t).width)) + pad * 2);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.68)';
  ctx.fillRect(pad, h - boxH - pad, boxW, boxH);
  ctx.fillStyle = '#ffffff';
  lines.forEach((t, i) => {
    ctx.fillText(t, pad * 2, h - boxH - pad + lineH * (i + 1));
  });
}

export async function startCamera(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('이 브라우저에서는 카메라를 쓸 수 없습니다');
  }
  return navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
    audio: false,
  });
}

export function stopCamera(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}
