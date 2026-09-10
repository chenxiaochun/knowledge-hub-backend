import { Global, Module } from '@nestjs/common';

import { LocalStorageService } from './local-storage.service';
import { RustfsService } from './rustfs.service';

/** 为什么要全局注入？
 * 1. 方便在其他模块中使用
 *
 * 不用在 app.module.ts 中手动导入了吗？
 * 1. 是的，不用在 app.module.ts 中手动导入了
 */
@Global()
@Module({
  providers: [LocalStorageService, RustfsService],
  exports: [LocalStorageService, RustfsService],
})
export class StorageModule {}
