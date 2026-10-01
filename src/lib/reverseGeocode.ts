/**
 * 좌표 → 주소. 브라우저는 키를 모른다 — 서버 함수(api/address.ts)를 부른다.
 * 실패해도 신고서는 계속 쓸 수 있어야 하므로 예외를 던지지 않고 이유를 돌려준다.
 */
export type AddressState = 'idle' | 'loading' | 'ok' | 'no_key' | 'not_found' | 'error';

export interface AddressLookup {
  state: Exclude<AddressState, 'idle' | 'loading'>;
  road?: string;
  parcel?: string;
}

export async function reverseGeocode(lat: number, lng: number): Promise<AddressLookup> {
  try {
    const res = await fetch(`/api/address?lat=${lat}&lng=${lng}`, { cache: 'no-store' });
    const json = (await res.json().catch(() => ({}))) as {
      road?: string;
      parcel?: string;
      error?: string;
    };
    if (res.ok && (json.road || json.parcel)) return { state: 'ok', road: json.road, parcel: json.parcel };
    if (json.error === 'no_key') return { state: 'no_key' };
    if (json.error === 'not_found') return { state: 'not_found' };
    return { state: 'error' };
  } catch {
    return { state: 'error' };
  }
}
