/** 원본 프레임을 먼저 보존하고 표시용 사본에 촬영 정보를 새긴다.
 * 앱의 워터마크는 시제품 메타데이터이며 공식 신고 접수 자격을 보장하지 않는다.
 */
import { kstStamp } from './kst';

export interface CaptureMeta {
  takenAt: number;
  lat?: number;
  lng?: number;
  accuracy?: number;
}

/** 사진에 새기는 촬영시각 — 기기 시간대와 상관없이 한국 시각 */
export function formatStamp(ms: number): string {
  return kstStamp(ms);
}

/** 비디오 한 프레임을 원본 해상도로 떠서 워터마크를 얹은 JPEG 데이터 URL */
export function captureFrame(video: HTMLVideoElement, meta: CaptureMeta): string {
  return captureEvidenceFrame(video, meta).dataUrl;
}

export function captureEvidenceFrame(video: HTMLVideoElement, meta: CaptureMeta): { originalDataUrl: string; dataUrl: string } {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (w <= 0 || h <= 0 || video.readyState < 2) throw new Error('촬영 화면이 아직 준비되지 않았습니다');
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('캔버스를 만들 수 없습니다');
  ctx.drawImage(video, 0, 0, w, h);
  const originalDataUrl = canvas.toDataURL('image/jpeg', 0.92);

  const lines = [formatStamp(meta.takenAt)];
  if (meta.lat !== undefined && meta.lng !== undefined) {
    const acc = meta.accuracy !== undefined ? ` (±${Math.round(meta.accuracy)}m)` : '';
    lines.push(`${meta.lat.toFixed(6)}, ${meta.lng.toFixed(6)}${acc}`);
  } else {
    lines.push('위치 정보 없음');
  }
  drawStamp(ctx, w, h, lines);

  // 품질 0.92 — 번호판이 읽혀야 한다. 용량보다 판독이 먼저다.
  return { originalDataUrl, dataUrl: canvas.toDataURL('image/jpeg', 0.92) };
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
