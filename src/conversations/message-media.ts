export const MEDIA_MAX_BYTES = 10 * 1024 * 1024;
const supported = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
export interface MessageMedia { kind: 'image' | 'document'; mimeType: string; fileName: string; providerId?: string; sizeBytes?: number }
export function mediaMetadata(mime: unknown, name?: unknown, providerId?: unknown, size?: unknown): MessageMedia | null {
  if (typeof mime !== 'string' || !supported.has(mime.toLowerCase())) return null;
  const mimeType = mime.toLowerCase();
  const kind = mimeType === 'application/pdf' ? 'document' : 'image';
  const extension = { 'application/pdf':'pdf', 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp' }[mimeType];
  const clean = typeof name === 'string' ? Buffer.from(name.replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 120), 'utf8').toString('utf8') : '';
  const fileName = `${clean ? clean.replace(/\.[^.]*$/, '') : kind === 'image' ? 'foto' : 'documento'}.${extension}`;
  return { kind, mimeType, fileName, ...(typeof providerId === 'string' && /^\d+$/.test(providerId) ? {providerId} : {}),
    ...(Number.isSafeInteger(Number(size)) && Number(size) > 0 ? {sizeBytes:Number(size)} : {}) };
}
export function publicMedia(value: unknown) {
  const m = value as MessageMedia | null;
  return m ? mediaMetadata(m.mimeType, m.fileName, undefined, m.sizeBytes) : null;
}
export function evolutionContent(raw: any) {
  let message = raw?.message;
  for (let i = 0; i < 3; i++) {
    if (message?.ephemeralMessage?.message) message = message.ephemeralMessage.message;
    else if (message?.documentWithCaptionMessage?.message) message = message.documentWithCaptionMessage.message;
    else break;
  }
  const file = message?.imageMessage || message?.documentMessage;
  const media = file ? mediaMetadata(file.mimetype, file.fileName, undefined, file.fileLength) : null;
  return { text: message?.conversation ?? message?.extendedTextMessage?.text ?? file?.caption ?? (file && !media ? '[Arquivo não suportado]' : ''), media };
}
export function metaContent(message: any) {
  const file = message?.type === 'image' ? message.image : message?.type === 'document' ? message.document : null;
  const media = file ? mediaMetadata(file.mime_type, file.filename, file.id, file.file_size) : null;
  return { text: message?.text?.body ?? file?.caption ?? (file && !media ? '[Arquivo não suportado]' : ''), media };
}
export function validMediaBytes(buffer: Buffer, mime: string) {
  if (!buffer.length || buffer.length > MEDIA_MAX_BYTES) return false;
  if (mime === 'application/pdf') return buffer.subarray(0,5).toString() === '%PDF-';
  if (mime === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === 'image/png') return buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  return mime === 'image/webp' && buffer.subarray(0,4).toString() === 'RIFF' && buffer.subarray(8,12).toString() === 'WEBP';
}
