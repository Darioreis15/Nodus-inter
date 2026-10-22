import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map } from 'rxjs/operators';

/** Map API structure only: never rewrite message text, names or file content. */
export function nodusResponse(value: any): any {
  if (Array.isArray(value)) return value.map(nodusResponse);
  if (!value || typeof value !== 'object' || value instanceof Date || Buffer.isBuffer(value)) return value;
  const result = { ...value };
  delete result.raw;
  if (result.type === 'QR_EVOLUTION') result.type = 'QR_NODUS';
  for (const key of ['channel', 'lastMessage', 'data', 'messages', 'channels']) {
    if (result[key] !== undefined) result[key] = nodusResponse(result[key]);
  }
  return result;
}
@Injectable()
export class NodusResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest();
    const v2 = /^\/public\/v2(?:\/|$)/i.test(req.path || '');
    return v2 ? next.handle().pipe(map(nodusResponse)) : next.handle();
  }
}
