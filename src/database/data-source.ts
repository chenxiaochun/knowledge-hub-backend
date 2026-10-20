import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';

import { typeormEntities } from './typeorm.entities';

loadEnv({ path: resolve(process.cwd(), '.env') });

const port = Number(process.env.POSTGRES_PORT ?? 5432);

/**
 * TypeORM CLI 用 DataSource（migration:generate / run / revert）。
 * 与 AppModule 共用实体列表；不在此开启 synchronize。
 */
export default new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: Number.isFinite(port) ? port : 5432,
  username: process.env.POSTGRES_USER ?? 'user',
  password: process.env.POSTGRES_PASSWORD ?? '',
  database: process.env.POSTGRES_DB ?? 'knowledge_hub',
  entities: typeormEntities,
  migrations: ['src/database/migrations/*{.ts,.js}'],
  synchronize: false,
});
