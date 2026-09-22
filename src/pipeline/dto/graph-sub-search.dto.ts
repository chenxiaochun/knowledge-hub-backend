/** 图谱检索子图：供 ECharts graph 系列直接使用 */
export type GraphSubgraphNode = {
  id: string; // 稳定 key：doc:{uuid} / entity:{name}
  name: string; // 展示名
  label: string; // KnowledgeDocument | KnowledgeEntity
  type?: string | null; // 实体类型 PERSON / ORGANIZATION …
  documentId?: string; // 仅文档节点，供前端 openDetail
};

export type GraphSubgraphEdge = {
  source: string; // 对应 node.id
  target: string;
  relation: string; // RELATED_TO 边属性 relation（或 MENTIONS）
  weight?: number;
};

export type GraphSubgraphResult = {
  nodes: GraphSubgraphNode[];
  edges: GraphSubgraphEdge[];
};
