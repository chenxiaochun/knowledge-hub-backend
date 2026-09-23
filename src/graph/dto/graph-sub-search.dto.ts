/** 图谱检索子图节点：供 ECharts graph 系列直接使用 */
export class GraphSubgraphNodeDto {
  /** 稳定 key：doc:{uuid} / entity:{name} */
  id!: string;
  /** 展示名 */
  name!: string;
  /** KnowledgeDocument | KnowledgeEntity */
  label!: string;
  /** 实体类型 PERSON / ORGANIZATION 等 */
  type?: string | null;
  /** 仅文档节点，供前端 openDetail */
  documentId?: string;
}

/** 图谱检索子图边 */
export class GraphSubgraphEdgeDto {
  /** 对应 node.id */
  source!: string;
  target!: string;
  /** RELATED_TO 边属性 relation（或 MENTIONS） */
  relation!: string;
  weight?: number;
}

/** 图谱检索子图结果 */
export class GraphSubgraphResultDto {
  nodes!: GraphSubgraphNodeDto[];
  edges!: GraphSubgraphEdgeDto[];
}
