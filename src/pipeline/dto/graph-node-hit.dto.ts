/** 图谱 flat 检索节点命中 */
export class GraphNodeHitDto {
  labels!: string[];
  /** 节点属性（随 label 变化：title/name/type/id 等） */
  props!: Record<string, unknown>;
}
