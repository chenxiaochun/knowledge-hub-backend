import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import * as tencentcloud from 'tencentcloud-sdk-nodejs';

const AsrClient = tencentcloud.asr.v20190614.Client;

@Injectable()
export class AsrClientService {
  readonly client: InstanceType<typeof AsrClient>;

  constructor(private readonly configService: ConfigService) {
    this.client = new AsrClient({
      credential: {
        secretId: this.configService.get<string>('TENCENT_CLOUD_SECRET_ID'),
        secretKey: this.configService.get<string>('TENCENT_CLOUD_SECRET_KEY'),
      },
      region: 'ap-shanghai',
      profile: {
        httpProfile: {
          reqMethod: 'POST',
          reqTimeout: 30,
        },
      },
    });
  }
}
