export const MEDIA_MAX_BYTES = 10 * 1024 * 1024;
const extensions: Record<string,string> = {
 'image/jpeg':'jpg','image/png':'png','image/webp':'webp','application/pdf':'pdf',
 'application/msword':'doc','application/vnd.ms-excel':'xls','application/vnd.ms-powerpoint':'ppt',
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx',
 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'xlsx',
 'application/vnd.openxmlformats-officedocument.presentationml.presentation':'pptx',
 'application/vnd.oasis.opendocument.text':'odt','application/vnd.oasis.opendocument.spreadsheet':'ods','application/vnd.oasis.opendocument.presentation':'odp',
 'text/plain':'txt','text/csv':'csv','application/rtf':'rtf','text/rtf':'rtf',
 'application/json':'json','application/xml':'xml','text/xml':'xml',
 'application/zip':'zip','application/x-zip-compressed':'zip','application/x-rar-compressed':'rar','application/vnd.rar':'rar','application/x-7z-compressed':'7z',
 'application/octet-stream':'bin'
};
const supported = new Set(Object.keys(extensions));
export interface MessageMedia { kind: 'image' | 'document'; mimeType: string; fileName: string; providerId?: string; sizeBytes?: number }
export function mediaMetadata(mime: unknown, name?: unknown, providerId?: unknown, size?: unknown): MessageMedia | null {
  if (typeof mime !== 'string' || !supported.has(mime.toLowerCase())) return null;
  const mimeType = mime.toLowerCase();
  const kind = mimeType.startsWith('image/') ? 'image' : 'document';
  const extension = extensions[mimeType];
  const clean = typeof name === 'string' ? Buffer.from(name.replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 120), 'utf8').toString('utf8') : '';
  const fileName = `${clean ? clean.replace(/\.[^.]*$/, '') : kind === 'image' ? 'foto' : 'documento'}.${extension}`;
  return { kind, mimeType, fileName, ...(typeof providerId === 'string' && /^\d+$/.test(providerId) ? {providerId} : {}),
    ...(Number.isSafeInteger(Number(size)) && Number(size) > 0 ? {sizeBytes:Number(size)} : {}) };
}
export function publicMedia(value: unknown) {
  const m = value as MessageMedia | null;
  return m ? mediaMetadata(m.mimeType, m.fileName, undefined, m.sizeBytes) : null;
}
function receivedMetadata(mime:unknown, name:unknown, providerId:unknown, size:unknown, document:boolean) {
  const normalized=typeof mime==='string' ? mime.toLowerCase().split(';')[0].trim() : '';
  // Active web formats are not rendered or accepted. Unknown documents download as .bin.
  if (['text/html','application/xhtml+xml','image/svg+xml'].includes(normalized)) return null;
  return mediaMetadata(normalized,name,providerId,size) || (document ? mediaMetadata('application/octet-stream',name,providerId,size) : null);
}
export function evolutionContent(raw: any) {
  let message = raw?.message;
  for (let i = 0; i < 3; i++) {
    if (message?.ephemeralMessage?.message) message = message.ephemeralMessage.message;
    else if (message?.documentWithCaptionMessage?.message) message = message.documentWithCaptionMessage.message;
    else break;
  }
  const file = message?.imageMessage || message?.documentMessage;
  const media = file ? receivedMetadata(file.mimetype, file.fileName, undefined, file.fileLength, !!message?.documentMessage) : null;
  return { text: message?.conversation ?? message?.extendedTextMessage?.text ?? file?.caption ?? (file && !media ? '[Arquivo não suportado]' : ''), media };
}
export function metaContent(message: any) {
  const file = message?.type === 'image' ? message.image : message?.type === 'document' ? message.document : null;
  const media = file ? receivedMetadata(file.mime_type, file.filename, file.id, file.file_size, message.type === 'document') : null;
  return { text: message?.text?.body ?? file?.caption ?? (file && !media ? '[Arquivo não suportado]' : ''), media };
}
export function validMediaBytes(buffer: Buffer, mime: string) {
  if (!buffer.length || buffer.length > MEDIA_MAX_BYTES) return false;
  if (mime === 'application/pdf') return buffer.subarray(0,5).toString() === '%PDF-';
  if (mime === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === 'image/png') return buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (mime === 'image/webp') return buffer.subarray(0,4).toString() === 'RIFF' && buffer.subarray(8,12).toString() === 'WEBP';
  // Documents are download-only. Signature checks are format checks, not malware scanning.
  if (['application/msword','application/vnd.ms-excel','application/vnd.ms-powerpoint'].includes(mime)) return buffer.subarray(0,8).equals(Buffer.from([208,207,17,224,161,177,26,225]));
  if (mime.includes('openxmlformats') || mime.includes('oasis.opendocument') || ['application/zip','application/x-zip-compressed'].includes(mime)) return buffer[0]===80 && buffer[1]===75 && [3,5,7].includes(buffer[2]);
  if (mime === 'application/vnd.rar' || mime === 'application/x-rar-compressed') return buffer.subarray(0,4).toString()==='Rar!';
  if (mime === 'application/x-7z-compressed') return buffer.subarray(0,6).equals(Buffer.from([55,122,188,175,39,28]));
  if (mime === 'application/rtf' || mime === 'text/rtf') return buffer.subarray(0,5).toString()==='{\\rtf';
  return supported.has(mime);
}
