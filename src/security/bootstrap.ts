import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { validateSecurityConfig } from './config';

export function configureHttp(app: NestExpressApplication) {
  validateSecurityConfig();
  // Configure somente CIDRs/IPs dos proxies reais. Nao confiar em todos os hops.
  const proxies = process.env.TRUSTED_PROXY_CIDRS?.split(',').map(x => x.trim()).filter(Boolean);
  app.set('trust proxy', proxies?.length ? proxies : false);
  app.use(helmet());
  app.use(json({ limit: '256kb', verify: (req: any, _res, body) => { req.rawBody = body; } }));
  app.use(urlencoded({ extended: false, limit: '16kb' }));
  const origins = process.env.CORS_ORIGINS!.split(',').map(x => x.trim());
  if (origins.some(x => x === '*' || !/^https:\/\/[^/]+$/.test(x))) throw new Error('CORS_ORIGINS deve conter origens HTTPS exatas.');
  app.enableCors({ origin: origins, methods: ['GET', 'POST', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'], credentials: false });
  app.use((_req: any, res: any, next: () => void) => { res.setHeader('Cache-Control', 'no-store'); next(); });
}
