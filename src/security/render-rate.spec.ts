import { Controller, Get } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { RateGuard } from './rate.guard';

@Controller()
class Probe { @Get('probe') get() { return { ok: true }; } }

describe('Render client IP rate limiting over HTTP', () => {
  let app: any;
  const previous = { ...process.env };
  const buckets = new Map<string, number>();
  beforeAll(async () => {
    process.env.CLIENT_IP_SOURCE = 'render-true-client-ip';
    jest.spyOn(Date, 'now').mockReturnValue(1800000000000);
    const module = await Test.createTestingModule({ controllers: [Probe] }).compile();
    app = module.createNestApplication();
    app.useGlobalGuards(new RateGuard({ rateBucket: { upsert: async ({ where }: any) => {
      const hits = (buckets.get(where.key) || 0) + 1; buckets.set(where.key, hits); return { hits };
    } } } as any));
    await app.init();
  });
  afterAll(async () => { await app?.close(); jest.restoreAllMocks(); process.env = previous; });
  const get = () => request(app.getHttpServer()).get('/probe');
  it('separates two clients on the same socket and enforces 429 despite changed XFF/CF headers', async () => {
    for (let i = 0; i < 300; i++) await get().set('True-Client-IP', '203.0.113.1').expect(200);
    const blocked = await get().set('True-Client-IP', '203.0.113.1')
      .set('X-Forwarded-For', '198.51.100.42').set('CF-Connecting-IP', '198.51.100.43').expect(429);
    expect(blocked.body.retryAfter).toBeGreaterThan(0);
    const other = await get().set('True-Client-IP', '203.0.113.2').expect(200);
    expect(other.headers['x-ratelimit-remaining']).toBe('299');
    await get().set('True-Client-IP', '::ffff:203.0.113.1').expect(429);
  });
  it('shares one fallback bucket for absent and invalid headers', async () => {
    const first = await get().expect(200);
    const second = await get().set('True-Client-IP', 'not-an-ip').set('X-Forwarded-For', '1.2.3.4').expect(200);
    expect(Number(second.headers['x-ratelimit-remaining'])).toBe(Number(first.headers['x-ratelimit-remaining']) - 1);
  });
});
