import { IsOptional, IsUUID } from 'class-validator';

export class AssignConversationDto {
  // Omitido = auto-atribuir para quem esta chamando o endpoint
  @IsOptional()
  @IsUUID()
  userId?: string;
}
