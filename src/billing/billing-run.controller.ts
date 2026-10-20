import { BillingDelivery } from './billing-delivery';
import { Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { BillingCalendar } from './billing-calendar';
@Controller('billing/calendar')
export class BillingRunController {
  constructor(private calendar: BillingCalendar,private delivery:BillingDelivery) {}
  @Post('run')
  async run(@Headers('x-billing-run-token') token?: string) {
    const expected = process.env.BILLING_RUN_TOKEN;
    if (!expected || expected.length < 32 || !token || Buffer.byteLength(token) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) throw new UnauthorizedException();
    const result=await this.calendar.run();
    const deliveries=await this.delivery.run();
    return {...result,deliveries};
  }
}
