// User table schema
export interface User {
  id: number; // 用户ID
  name: string; // 用户名称
  email: string; // 电子邮箱
  created_at: Date; // 创建时间
}

export const usersTable = {
  name: "users",
  columns: ["id", "name", "email", "created_at"],
};
