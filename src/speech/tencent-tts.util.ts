import { createHmac } from 'node:crypto';

export type TencentTtsCredentials = {
  secretId: string;
  secretKey: string;
  appId: number;
  voiceType: number;
};

/** 腾讯云流式 TTS WebSocket 握手 URL（TextToStreamAudioWSv2） */
export function buildTencentStreamTtsWsUrl(
  synthesisId: string,
  creds: TencentTtsCredentials,
): string {
  const now = Math.floor(Date.now() / 1000);
  const params: Record<string, string | number> = {
    Action: 'TextToStreamAudioWSv2',
    AppId: creds.appId,
    Codec: 'mp3',
    Expired: now + 3600,
    SampleRate: 16000,
    SecretId: creds.secretId,
    SessionId: synthesisId,
    Speed: 0,
    Timestamp: now,
    VoiceType: creds.voiceType,
    Volume: 5,
  };

  const signStr = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  const rawStr = `GETtts.cloud.tencent.com/stream_wsv2?${signStr}`;
  const signature = createHmac('sha1', creds.secretKey).update(rawStr).digest('base64');
  const searchParams = new URLSearchParams({
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    Signature: signature,
  });

  return `wss://tts.cloud.tencent.com/stream_wsv2?${searchParams.toString()}`;
}

export function readTencentTtsCredentials(config: {
  get: (key: string) => string | undefined;
}): TencentTtsCredentials {
  return {
    secretId:
      config.get('TENCENT_CLOUD_SECRET_ID') ?? config.get('SECRET_ID') ?? '',
    secretKey:
      config.get('TENCENT_CLOUD_SECRET_KEY') ?? config.get('SECRET_KEY') ?? '',
    appId: Number(config.get('TENCENT_CLOUD_APP_ID') ?? config.get('APP_ID') ?? 0),
    voiceType: Number(config.get('TTS_VOICE_TYPE') ?? 101001),
  };
}
