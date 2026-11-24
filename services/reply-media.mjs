/**
 * services/reply-media.mjs
 * ─────────────────────────
 * المسؤولية: قراءة الصور المحفوظة محلياً لردود واتساب (صورة مع أي رد / صورة بطاقة من المعرض)
 *            مع منع الخروج عن مجلد المستخدم.
 * تعتمد على: لا شيء (fs فقط)
 * Exports: REPLY_MEDIA_ROOT, userMediaDir, normalizeImageRef, readImageRef, imageMime, isLocalRef
 */
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';

/** جذر مجلد وسائط الردود — يُحسب عند الطلب حتى لا يتأثر بتغيّر مجلد العمل. */
export function replyMediaRoot() {
  return path.resolve('data/auto-reply-media');
}
/** متوافق مع الاستخدامات القديمة. */
export const REPLY_MEDIA_ROOT = 'data/auto-reply-media';
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

export function safeUserKey(uid) {
  return String(uid ?? '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function userMediaDir(uid) {
  return path.resolve(replyMediaRoot(), safeUserKey(uid));
}

export function imageMime(filePath) {
  return MIME_BY_EXT[path.extname(String(filePath || '')).toLowerCase()] || '';
}

export function isLocalRef(ref) {
  return String(ref || '').startsWith('local:');
}

/**
 * يتحقق أن المرجع يخص المستخدم ويعيد المسار المطلق.
 * يرجع '' إذا لم يوجد مرجع. يرمي خطأً عربياً إذا كان المرجع خارج مجلد المستخدم.
 */
export function normalizeImageRef(uid, ref) {
  const raw = String(ref ?? '').trim();
  if (!raw) return '';
  if (!isLocalRef(raw)) throw new Error('اختر الصورة من المعرض (زر «إضافة صورة»)');
  const full = path.resolve(raw.slice(6));
  const root = userMediaDir(uid);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error('الصورة لا تخص حسابك؛ أعد اختيارها من المعرض');
  }
  if (!imageMime(full)) throw new Error('صيغة الصورة غير مدعومة؛ استخدم JPG أو PNG أو WebP');
  return 'local:' + full;
}

/** يقرأ الصورة ويعيد {buffer, mimetype, size} أو null إذا لم يوجد مرجع. */
export async function readImageRef(uid, ref) {
  const normalized = normalizeImageRef(uid, ref);
  if (!normalized) return null;
  const full = normalized.slice(6);
  const info = await stat(full).catch(() => null);
  if (!info || !info.isFile()) return null;
  if (info.size > MAX_IMAGE_BYTES) throw new Error('حجم الصورة أكبر من 5 ميغابايت');
  const buffer = await readFile(full);
  return { buffer, mimetype: imageMime(full) || 'image/jpeg', size: buffer.length, path: full };
}

/** يقرأ صورة من مسار مطلق تم التحقق منه مسبقاً (استخدام داخلي للبث). */
export async function readAbsoluteImage(fullPath) {
  const info = await stat(fullPath).catch(() => null);
  if (!info || !info.isFile()) return null;
  if (info.size > MAX_IMAGE_BYTES) throw new Error('حجم الصورة أكبر من 5 ميغابايت');
  const buffer = await readFile(fullPath);
  return { buffer, mimetype: imageMime(fullPath) || 'image/jpeg', size: buffer.length, path: fullPath };
}
