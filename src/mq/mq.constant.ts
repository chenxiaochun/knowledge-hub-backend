// 下面都分别是什么意思？
// SEARCH_INDEX_EXCHANGE: 搜索索引交换机
// SEARCH_INDEX_QUEUE: 搜索索引队列
// SEARCH_RK_INDEX: 搜索索引文档路由键
// SEARCH_RK_DELETE: 搜索索引删除路由键
export const SEARCH_INDEX_EXCHANGE = 'search.index.exchange';
export const SEARCH_INDEX_QUEUE = 'kh.search.index.queue';
export const SEARCH_RK_INDEX = 'search.index.document';
export const SEARCH_RK_DELETE = 'search.index.delete';

// RAG_REINDEX_EXCHANGE: RAG重索引交换机
// RAG_REINDEX_QUEUE: RAG重索引队列
// RAG_RK_BY_IDS: RAG重索引文档路由键
// RAG_RK_DELETE: RAG重索引删除路由键
export const RAG_REINDEX_EXCHANGE = 'rag.reindex.exchange';
export const RAG_REINDEX_QUEUE = 'kh.rag.reindex.queue';
export const RAG_RK_BY_IDS = 'rag.reindex.by_ids';
export const RAG_RK_DELETE = 'rag.reindex.delete';

// KG_GRAPH_EXCHANGE: KG图谱交换机
// KG_GRAPH_QUEUE: KG图谱队列
// KG_RK_BUILD_BY_IDS: KG图谱构建文档路由键
// KG_RK_DELETE: KG图谱删除路由键
export const KG_GRAPH_EXCHANGE = 'kg.graph.exchange';
export const KG_GRAPH_QUEUE = 'kh.kg.graph.queue';
export const KG_RK_BUILD_BY_IDS = 'kg.graph.build.by_ids';
export const KG_RK_DELETE = 'kg.graph.delete';
