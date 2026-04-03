import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "../../db";
import { messages } from "../../db/schema";
import pipeline from "../core/pipeline";

export const sendMessage = async (req: any, res: any) => {
    try {
        const { content, platform } = req.body;
        const userId = req.user.id;

        const response = await pipeline({ content, platform, userId });

        return res.status(200).json({ response });

    } catch (error) {
        console.log(error);
        return res.status(500).json({ message: 'Something went wrong' });
    }
}

export const messageHistory = async (req: any, res: any) => {
    try {
        const userId = req.user.id;
        const cursorId = req.query.cursorId as string | undefined;

        let conditions = eq(messages.userId, userId);

        if (cursorId && cursorId !== "null" && cursorId !== "undefined" && cursorId !== "Infinity") {
            conditions = and(conditions, lt(messages.createdAt, cursorId)) as any;
        }

        const history = await db
            .select({
                id: messages.id,
                content: messages.content,
                role: messages.role,
                createdAt: messages.createdAt,
                platform: messages.platform,
                isProactive: messages.isProactive
            })
            .from(messages)
            .where(conditions)
            .orderBy(desc(messages.createdAt))
            .limit(50);

        return res.status(200).json({ history });

    } catch (error) {
        console.error("SQL Error:", error);
        return res.status(500).json({ message: "Something went wrong!" });
    }
}