/*
  Warnings:

  - You are about to drop the `ggb_files` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "ggb_files" DROP CONSTRAINT "ggb_files_user_id_fkey";

-- DropTable
DROP TABLE "ggb_files";
