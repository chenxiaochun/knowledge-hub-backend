import { MigrationInterface, QueryRunner } from 'typeorm';

export class BaselineSchema1792461165208 implements MigrationInterface {
  name = 'BaselineSchema1792461165208';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "kh_ai_message" ("id" bigint NOT NULL, "session_id" bigint NOT NULL, "role" character varying(16) NOT NULL, "content" text NOT NULL, "sources" jsonb, "images" jsonb, "graph" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_29f538aeb2e02235b71832d69d6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "kh_ai_session" ("id" bigint NOT NULL, "user_id" bigint NOT NULL, "title" character varying(80) NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_006232d4f82dbb48648bf853b16" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "kh_document_review" ("id" bigint NOT NULL, "document_id" bigint NOT NULL, "review_id" bigint, "reviewer_name" character varying(255), "review_result" smallint, "review_comment" text, "before_status" smallint, "review_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_79472df7adbfb8f91724c7471d7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "kh_document" ("id" bigint NOT NULL, "title" character varying NOT NULL, "content_id" character varying NOT NULL, "author_id" bigint, "team_id" bigint, "file_url" character varying, "file_ext" character varying(20), "status" smallint NOT NULL DEFAULT '0', "word_count" integer NOT NULL DEFAULT '0', "tags" character varying, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "publish_time" TIMESTAMP, "deleted" boolean NOT NULL DEFAULT false, "is_public" boolean NOT NULL DEFAULT false, CONSTRAINT "UQ_4c1eb297d1d3b977b4020da55b2" UNIQUE ("content_id"), CONSTRAINT "PK_318b5b6626ee09452b2d25db975" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "kh_team" ("id" bigint NOT NULL, "team_name" character varying(100) NOT NULL, "team_code" character varying(50), "description" character varying(500), "parent_id" bigint NOT NULL DEFAULT '0', "sort" integer NOT NULL DEFAULT '0', "status" smallint NOT NULL DEFAULT '1', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_9e1d4ae6d5671734ddfe1a4d2ce" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "kh_permission" ("id" bigint NOT NULL, "permission_name" character varying(50) NOT NULL, "permission_code" character varying(100) NOT NULL, "permission_type" smallint NOT NULL DEFAULT '3', "status" smallint NOT NULL DEFAULT '1', CONSTRAINT "UQ_286f1592e42dbda84b09ef7a2ec" UNIQUE ("permission_code"), CONSTRAINT "PK_a132af5259ea610d4f88f907ef0" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "kh_role_permission" ("id" bigint NOT NULL, "role_id" bigint NOT NULL, "permission_id" bigint NOT NULL, CONSTRAINT "PK_d9bd4002750d018edc5e47bd05b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "kh_role" ("id" bigint NOT NULL, "role_name" character varying(50) NOT NULL, "role_code" character varying(50) NOT NULL, "description" character varying(200), "status" smallint NOT NULL DEFAULT '1', CONSTRAINT "UQ_fb62542853f02db6dda55b1b76b" UNIQUE ("role_code"), CONSTRAINT "PK_13401089460f7373fa540a04317" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "kh_user_role" ("id" bigint NOT NULL, "user_id" bigint NOT NULL, "role_id" bigint NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_f4f506902b704bef37a3e937f31" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "kh_user" ("id" bigint NOT NULL, "username" character varying(50) NOT NULL, "password" character varying(255) NOT NULL, "email" character varying(100), "email_verified" smallint NOT NULL DEFAULT '0', "real_name" character varying(50), "avatar" character varying(500), "status" smallint NOT NULL DEFAULT '1', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted" boolean NOT NULL DEFAULT false, "role_codes" text NOT NULL DEFAULT '', CONSTRAINT "PK_2c6c8349b32d11366305e4daefd" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "kh_user"`);
    await queryRunner.query(`DROP TABLE "kh_user_role"`);
    await queryRunner.query(`DROP TABLE "kh_role"`);
    await queryRunner.query(`DROP TABLE "kh_role_permission"`);
    await queryRunner.query(`DROP TABLE "kh_permission"`);
    await queryRunner.query(`DROP TABLE "kh_team"`);
    await queryRunner.query(`DROP TABLE "kh_document"`);
    await queryRunner.query(`DROP TABLE "kh_document_review"`);
    await queryRunner.query(`DROP TABLE "kh_ai_session"`);
    await queryRunner.query(`DROP TABLE "kh_ai_message"`);
  }
}
