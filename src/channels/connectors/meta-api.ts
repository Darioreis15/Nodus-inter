import { BadGatewayException } from '@nestjs/common';

// Same version exercised in the staging Postman integration.
export const META_GRAPH_VERSION = 'v25.0';

export function metaErrorInfo(error: any) {
  const code = Number.isSafeInteger(error?.code) ? error.code : undefined;
  const subcode = Number.isSafeInteger(error?.error_subcode) ? error.error_subcode : undefined;
  const messages: Record<number, string> = {
    190: 'Token Meta invalido ou expirado. Atualize o token do canal.',
    10: 'Permissao insuficiente na Meta. Confira as permissoes do token e o acesso ao numero.',
    200: 'Permissao insuficiente na Meta. Confira as permissoes do token e o acesso ao numero.',
    130497: 'A Meta restringiu o envio para o pais do destinatario.',
    131030: 'Destinatario nao autorizado para este numero de teste da Meta.',
    131047: 'Janela de atendimento encerrada. E necessario um modelo aprovado pela Meta.',
  };
  // Never echo provider messages/details: they can contain secrets or personal data.
  return { code, subcode, message: messages[code] || 'Falha informada pela Meta. Consulte o codigo retornado.' };
}

export async function metaRequest(path: string, accessToken: string, body?: unknown): Promise<any> {
  let response: Response;
  let data: any;
  try {
    response = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    data = await response.json().catch(() => null);
  } catch {
    throw new BadGatewayException('Nao foi possivel comunicar com a Meta. Verifique a disponibilidade antes de repetir um envio.');
  }
  if (!response.ok || data?.error) {
    const info = metaErrorInfo(data?.error);
    throw new BadGatewayException({
      statusCode: 502, error: 'Bad Gateway',
      message: response.status === 401 && info.code === undefined
        ? 'A Meta recusou a autenticacao. Confira o token salvo no canal.' : info.message,
      provider: 'META', providerStatus: response.status,
      ...(info.code === undefined ? {} : { providerCode: info.code }),
      ...(info.subcode === undefined ? {} : { providerSubcode: info.subcode }),
    });
  }
  return data;
}

export async function validateMetaToken(phoneNumberId: string, accessToken: string): Promise<void> {
  const identity = await metaRequest(`${encodeURIComponent(phoneNumberId)}?fields=id`, accessToken);
  if (identity?.id !== phoneNumberId) {
    throw new BadGatewayException('Nao foi possivel validar o acesso ao numero Meta. Token anterior preservado, se existente.');
  }
}
