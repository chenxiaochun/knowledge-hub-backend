import SnowflakeId from 'snowflake-id';

const snowflake = new SnowflakeId({
  mid: Number(process.env.SNOWFLAKE_WORKER_ID ?? 1),
  offset: Number(process.env.SNOWFLAKE_OFFSET ?? 1704067200000),
});

/** 生成雪花 ID（string），对应 Postgres BIGINT */
export function nextSnowflakeId(): string {
  return snowflake.generate();
}
