// src/lib/uploadSession.ts
// Управление сессиями загрузки фото

// Управление сессиями загрузки фото

// Интерфейс для сессии загрузки
export interface UploadSession {
  userId: number;
  photos: string[]; // file_id загруженных фото
  maxPhotos: number;
  createdAt: number;
  isProcessing: boolean; // флаг обработки фото
}

// Хранилище сессий (в реальном проекте лучше использовать Redis)
const uploadSessions = new Map<number, UploadSession>();

// TTL сессии (30 минут)
const SESSION_TTL = 30 * 60 * 1000;

/**
 * Создать новую сессию загрузки
 */
export function createUploadSession(userId: number, maxPhotos: number = 3): UploadSession {
  const session: UploadSession = {
    userId,
    photos: [],
    maxPhotos,
    createdAt: Date.now(),
    isProcessing: false
  };
  
  uploadSessions.set(userId, session);
  return session;
}

/**
 * Получить сессию загрузки
 */
export function getUploadSession(userId: number): UploadSession | null {
  const session = uploadSessions.get(userId);
  if (!session) return null;
  
  // Проверяем TTL
  if (Date.now() - session.createdAt > SESSION_TTL) {
    uploadSessions.delete(userId);
    return null;
  }
  
  return session;
}

/**
 * Добавить фото в сессию
 */
export function addPhotoToSession(userId: number, fileId: string): { success: boolean; error?: string } {
  const session = getUploadSession(userId);
  if (!session) {
    return { success: false, error: "Сессия загрузки не найдена. Начните загрузку заново." };
  }
  
  if (session.photos.length >= session.maxPhotos) {
    return { success: false, error: `Максимальное количество фото: ${session.maxPhotos}. Выберите самые лучшие!` };
  }
  
  session.photos.push(fileId);
  return { success: true };
}


/**
 * Очистить сессию загрузки
 */
export function clearUploadSession(userId: number): void {
  uploadSessions.delete(userId);
}

/**
 * Получить все фото из сессии
 */
export function getSessionPhotos(userId: number): string[] {
  const session = getUploadSession(userId);
  return session?.photos || [];
}

/**
 * Проверить, можно ли добавить еще фото
 */
export function canAddMorePhotos(userId: number): boolean {
  const session = getUploadSession(userId);
  if (!session) return false;
  
  return session.photos.length < session.maxPhotos;
}

/**
 * Получить количество загруженных фото
 */
export function getPhotoCount(userId: number): number {
  const session = getUploadSession(userId);
  return session?.photos.length || 0;
}

/**
 * Установить флаг обработки
 */
export function setProcessingFlag(userId: number, isProcessing: boolean): void {
  const session = getUploadSession(userId);
  if (session) {
    session.isProcessing = isProcessing;
  }
}

/**
 * Проверить, обрабатывается ли фото
 */
export function isProcessing(userId: number): boolean {
  const session = getUploadSession(userId);
  return session?.isProcessing || false;
}

