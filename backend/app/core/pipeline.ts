import { db } from "../../db"
import { messages, memories } from "../../db/schema"
import { eq, desc } from "drizzle-orm"
import deepseek from "../services/deepseek"
import storeMemory from "../rag/store"


interface PipelineInput {
  content: string
  userId: number
  platform: 'web' | 'telegram' | 'system'
}

const pipeline = async ({ content, userId, platform} : PipelineInput) => {

    let AIresponse: string | null = null;
    
    await db.transaction(async(tx)=>{
        const messagesHistory = await tx.select().from(messages).where(eq(messages.userId, userId)).orderBy(desc(messages.createdAt)).limit(50);

        await tx.insert(messages).values({role: "user", content: content, platform: platform, isProactive: 0, userId: userId});

        AIresponse = await deepseek(messagesHistory, content, userId);

        if(AIresponse === null){
            tx.rollback()
        }

        await tx.insert(messages).values({role:"assistant", content: AIresponse!, platform: platform, isProactive: 0, userId: userId});
    })
    return AIresponse;
}

export default pipeline;