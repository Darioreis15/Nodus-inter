import { Controller, Post, Req } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request = require('supertest');
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { configureHttp } from './bootstrap';

@Controller()
class ProbeController {
  @Post('probe') probe(@Req() req: any) {
    return { raw: req.rawBody.toString('utf8'), ip: req.ip };
  }
}

describe('HTTP security integration', () => {
  let app: NestExpressApplication;
  const previous = { ...process.env };
  beforeAll(async () => {
    process.env.META_APP_SECRET = 'test-only-meta-secret';
    process.env.EVOLUTION_WEBHOOK_TOKEN = 'test-only-evolution-token';
    process.env.ASAAS_WEBHOOK_TOKEN = 'test-only-asaas-token';
    process.env.CORS_ORIGINS = 'https://app.example.com';
    delete process.env.TRUSTED_PROXY_CIDRS;
    const module = await Test.createTestingModule({ controllers: [ProbeController] }).compile();
    app = module.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureHttp(app);
    await app.init();
  });
  afterAll(async () => { await app?.close(); process.env = previous; });
  it('resolves all application modules without a live database', async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue({}).compile();
    await module.close();
  });
  it('preserves original bytes, sets headers and refuses spoofed forwarding', async () => {
    const raw = '{ "event" : "test" }';
    const res = await request(app.getHttpServer()).post('/probe')
      .set('Content-Type', 'application/json').set('Origin', 'https://app.example.com')
      .set('X-Forwarded-For', '198.51.100.1').send(raw).expect(201);
    expect(res.body.raw).toBe(raw);
    expect(res.body.ip).not.toBe('198.51.100.1');
    expect(res.headers['access-control-allow-origin']).toBe('https://app.example.com');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('no-store');
  });
  it('does not grant CORS to unapproved origins', async () => {
    const res = await request(app.getHttpServer()).post('/probe')
      .set('Origin', 'https://evil.example.com').send({ test: true }).expect(201);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('rejects oversized JSON before the controller', async () => {
    await request(app.getHttpServer()).post('/probe').send({ text: 'x'.repeat(270000) }).expect(413);
  });
});
