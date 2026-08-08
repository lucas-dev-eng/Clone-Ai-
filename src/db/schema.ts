import { pgTable, text, timestamp, jsonb } from 'drizzle-orm/pg-core';

// Table for users managed by Firebase Auth
export const users = pgTable('users', {
  uid: text('uid').primaryKey(), // Firebase Auth UID
  email: text('email').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Table for chat sessions
export const chatSessions = pgTable('chat_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.uid, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  messages: jsonb('messages').notNull().$type<any[]>().default([]),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Table for persistent agent memories
export const memories = pgTable('memories', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.uid, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  category: text('category').notNull(),
  embedding: jsonb('embedding').$type<number[]>(), // Store vector embedding as a JSON array
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
