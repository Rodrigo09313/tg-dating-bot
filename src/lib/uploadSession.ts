/**
 * Простая in-memory сессия загрузки фото.
 * Ключ — chatId. Хранит массив file_id и флаг "processing".
 * Этого достаточно для онбординга/регистрации.
 * Если знаешь, что у тебя будет несколько инстансов — позже вынесем в Redis.
 */

type Session = {
  photos: string[];
  max: number;
  processing: boolean;
};

const SESSIONS = new Map<number, Session>();

export function createUploadSession(chatId: number, maxPhotos: number) {
  SESSIONS.set(chatId, { photos: [], max: Math.max(1, maxPhotos), processing: false });
}

export function clearUploadSession(chatId: number) {
  SESSIONS.delete(chatId);
}

export function getSessionPhotos(chatId: number): string[] {
  const s = SESSIONS.get(chatId);
  return s ? [...s.photos] : [];
}

export function canAddMorePhotos(chatId: number): boolean {
  const s = SESSIONS.get(chatId);
  if (!s) return false;
  return s.photos.length < s.max;
}

export function addPhotoToSession(chatId: number, fileId: string): { success: true } | { success: false; error: string } {
  const s = SESSIONS.get(chatId);
  if (!s) return { success: false, error: 'SESSION_NOT_FOUND' };
  if (s.photos.includes(fileId)) return { success: false, error: 'DUPLICATE' };
  if (s.photos.length >= s.max) return { success: false, error: 'LIMIT_REACHED' };
  s.photos.push(fileId);
  return { success: true };
}

export function setProcessingFlag(chatId: number, value: boolean): void {
  const s = SESSIONS.get(chatId);
  if (!s) return;
  s.processing = value;
}

export function isProcessing(chatId: number): boolean {
  const s = SESSIONS.get(chatId);
  return !!s?.processing;
}
