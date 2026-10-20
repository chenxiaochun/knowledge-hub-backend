import { AiMessageEntity } from '../ai/entities/ai-message.entity';
import { AiSessionEntity } from '../ai/entities/ai-session.entity';
import { DocumentReviewEntity } from '../document/entities/document-review.entity';
import { DocumentEntity } from '../document/entities/document.entity';
import { TeamEntity } from '../team/entities/team.entity';
import { PermissionEntity } from '../user/entities/permission.entity';
import { RolePermissionEntity } from '../user/entities/role-permission.entity';
import { RoleEntity } from '../user/entities/role.entity';
import { UserRoleEntity } from '../user/entities/user-role.entity';
import { UserEntity } from '../user/entities/user.entity';

/** Nest 运行时与 TypeORM CLI 共用的实体列表 */
export const typeormEntities = [
  UserEntity,
  RoleEntity,
  PermissionEntity,
  UserRoleEntity,
  RolePermissionEntity,
  DocumentEntity,
  DocumentReviewEntity,
  AiSessionEntity,
  AiMessageEntity,
  TeamEntity,
];
