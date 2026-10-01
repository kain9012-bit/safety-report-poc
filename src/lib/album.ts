/**
 * 앨범 사진 읽기 — 파일에서 촬영 정보(EXIF)를 꺼내고, 카메라 사진과 같은 모양으로 촬영시각·위치를 박는다.
 * EXIF 읽기 라이브러리는 앨범을 고를 때만 받는다(첫 화면 번들에는 넣지 않음).
 */
import { drawStamp, formatStamp } from './camera';
import type { PhotoMeta } from './authenticity';
import type { Shot } from '../types/report';

/** 신고서에 붙일 사진의 긴 변 상한(px) — 번호판이 읽히는 선에서 용량을 줄인다 */
const MAX_EDGE = 1920;

interface ExifTags {
  DateTimeOriginal?: Date;
  CreateDate?: Date;
  ModifyDate?: Date;
  Software?: string;
  Make?: string;
  Model?: string;
  latitude?: number;
  longitude?: number;
}

const ms = (d?: Date) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : undefined);

export async function readMeta(file: File): Promise<Omit<PhotoMeta, 'width' | 'height'>> {
  const exifr = (await import('exifr')).default;
  const t = ((await exifr
    .parse(file, { tiff: true, exif: true, gps: true, xmp: false, icc: false, iptc: false })
    .catch(() => null)) ?? {}) as ExifTags;
  return {
    takenAt: ms(t.DateTimeOriginal) ?? ms(t.CreateDate),
    modifiedAt: ms(t.ModifyDate),
    software: t.Software?.trim() || undefined,
    make: t.Make?.trim() || undefined,
    model: t.Model?.trim() || undefined,
    lat: typeof t.latitude === 'number' ? t.latitude : undefined,
    lng: typeof t.longitude === 'number' ? t.longitude : undefined,
    fileName: file.name,
    fileSize: file.size,
  };
}

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // decode 가 끝난 뒤에는 그림이 메모리에 있으므로 주소를 풀어도 된다
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** 파일 한 장 → 신고서 사진(촬영 정보 박힘) */
export async function readAlbumFile(file: File): Promise<Shot> {
  const [meta, img] = await Promise.all([readMeta(file), loadImage(file)]);
  const w0 = img.naturalWidth;
  const h0 = img.naturalHeight;
  const k = Math.min(1, MAX_EDGE / Math.max(w0, h0));
  const w = Math.round(w0 * k);
  const h = Math.round(h0 * k);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);
  drawStamp(ctx, w, h, [
    meta.takenAt !== undefined ? `${formatStamp(meta.takenAt)} (사진 파일 기록)` : '촬영시각 기록 없음',
    meta.lat !== undefined && meta.lng !== undefined ? `${meta.lat.toFixed(6)}, ${meta.lng.toFixed(6)}` : '위치 기록 없음',
    '앨범에서 고른 사진',
  ]);
  const full: PhotoMeta = { ...meta, width: w0, height: h0 };
  return {
    takenAt: meta.takenAt ?? file.lastModified,
    lat: meta.lat,
    lng: meta.lng,
    dataUrl: c.toDataURL('image/jpeg', 0.92),
    source: 'album',
    meta: full,
  };
}

/** 고른 파일들 → 촬영시각 순 두 장 */
export async function readAlbum(files: File[]): Promise<Shot[]> {
  const shots = await Promise.all(files.slice(0, 2).map(readAlbumFile));
  return shots.sort((a, b) => a.takenAt - b.takenAt);
}
