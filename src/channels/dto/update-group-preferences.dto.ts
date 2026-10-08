import { IsBoolean } from 'class-validator';

export class UpdateGroupPreferencesDto {
  @IsBoolean() receiveGroupMessages: boolean;
}
