import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "../../db";
import { messages } from "../../db/schema";
import pipeline from "../core/pipeline";
import extractMemory from "../rag/extract";
import storeMemory from "../rag/store";

export const sendMessage = async (req: any, res: any) => {

    try {
        const { content, platform } = req.body;
        const userId = req.user.id;

        const response = await pipeline({
            content, platform, userId
        })

        res.status(200).json({ response: response });

        try {
            const memoryExtract = await extractMemory(content, response!);
            if (memoryExtract !== 'NONE') {
                await storeMemory(memoryExtract, 'general', userId);
            }
        } catch (memoryError) {
            console.log('Memory extraction failed:', memoryError);
        }


        return
    } catch (error) {
        console.log(error);
        return res.status(500).json({ message: 'Something went wrong' });
    }
}

export const messageHistory = async (req: any, res: any) => {

    try {
        const cursorId = req.query.cursorId ? Number(req.query.cursorId) : null;
        const userId = req.user.id;

        const history = await db.select().from(messages).where(cursorId ? and(eq(messages.userId, userId), lt(messages.id, cursorId)) : eq(messages.userId, userId)).orderBy(desc(messages.createdAt)).limit(50);

        return res.status(200).json({ history: history });
    } catch (error) {
        console.log(error);

        return res.status(500).json({ message: "Something went wrong!"})
    }
}