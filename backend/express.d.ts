import { users } from '../db/schema'
import { InferSelectModel } from 'drizzle-orm'

declare global {
  namespace Express {
    interface Request {
      user?: InferSelectModel<typeof users>
    }
  }
}