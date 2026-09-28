import { registerDecorator, ValidationOptions } from 'class-validator';
export function PasswordBytes(options?: ValidationOptions) {
  return (object: object, propertyName: string) => registerDecorator({
    name: 'passwordBytes', target: object.constructor, propertyName, options,
    validator: { validate: (value: unknown) => typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= 72,
      defaultMessage: () => 'Senha deve ter no maximo 72 bytes UTF-8.' },
  });
}
