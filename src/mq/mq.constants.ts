/**
 * RabbitMQ 拓扑常量
 *
 * 交换机：rag.reindex / search.index / kg.graph
 * 队列名带 `kh.` 前缀，避免和本机同时跑的其他项目冲突。
 */

/** RAG 重建索引交换机（topic） */
export const RAG_REINDEX_EXCHANGE = 'rag.reindex.exchange';
/** 文档级搜索索引交换机（topic） */
export const SEARCH_INDEX_EXCHANGE = 'search.index.exchange';
/** KG 知识图谱构建交换机（topic） */
export const KG_GRAPH_EXCHANGE = 'kg.graph.exchange';

/** 本服务消费的队列 */
export const RAG_REINDEX_QUEUE = 'kh.rag.reindex.queue';
export const SEARCH_INDEX_QUEUE = 'kh.search.index.queue';
export const KG_GRAPH_QUEUE = 'kh.kg.graph.queue';

/** 路由键：按文档 ID 重建 / 删除 */
export const RAG_RK_BY_IDS = 'rag.reindex.by_ids';
export const RAG_RK_DELETE = 'rag.reindex.delete';
export const SEARCH_RK_INDEX = 'search.index.document';
export const SEARCH_RK_DELETE = 'search.index.delete';
export const KG_RK_BUILD_BY_IDS = 'kg.graph.build.by_ids';
export const KG_RK_DELETE = 'kg.graph.delete';
