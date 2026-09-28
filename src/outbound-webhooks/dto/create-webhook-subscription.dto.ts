import { ArrayMinSize, IsArray, IsIn, IsUrl } from 'class-validator';

export const WEBHOOK_EVENTS = ['message.received', 'conversation.assigned'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export class CreateWebhookSubscriptionDto {
  @IsUrl({ protocols: ['https'], require_protocol: true })
  url: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsIn(WEBHOOK_EVENTS, { each: true })
  events: WebhookEvent[];
}
