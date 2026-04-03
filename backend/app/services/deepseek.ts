import openai from './openai'
import 'dotenv/config'
import { SOUL } from "../core/soul"
import searchMemory from "../rag/search"

const deepseek = async (messageHistory: any, currentMessage: string, userId: number) => {

    const formattedHistory = messageHistory.map((msg: any) => {
        
        let dateObj = new Date(msg.createdAt);
        
        if (typeof msg.createdAt === 'string' && !msg.createdAt.includes('Z')) {
            dateObj = new Date(msg.createdAt.replace(' ', 'T') + 'Z');
        }

        const localTime = dateObj.toLocaleTimeString('en-US', {
            timeZone: 'Asia/Bangkok',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });

        return {
            role: msg.role,
            content: `[${localTime}] ${msg.content.replace(/^\[.*?\]\s*/, '')}`
        };
    }).reverse();

    const relevantMemory = await searchMemory(currentMessage, userId);

    const currentTime = new Date().toLocaleString('en-US', {
        timeZone: 'Asia/Bangkok',
        weekday: 'long',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });

    const completion = await openai.chat.completions.create({
        model: 'deepseek-chat',
        messages: [
            { role: 'system', content: SOUL },
            { role: 'system', content: `Relevant context: \n ${relevantMemory.map(m => m.content).join("\n")}` },

            ...formattedHistory,

            {
                role: 'system',
                content: `IMPORTANT: Respond in plain text as Cantarella. 
                The user's message history includes local timestamps (e.g., [1:12 PM]) for your context so you understand gaps in time. 
                Do NOT include timestamps, brackets, or dates in your own replies.
                CURRENT REAL-WORLD TIME: ${currentTime}. Use the timestamps in the history to understand how long it has been since the user last spoke.`
            },
            { role: 'user', content: `[${new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Bangkok', hour: 'numeric', minute: '2-digit', hour12: true })}] ${currentMessage}` }
        ],
        max_completion_tokens: 1500,
        stream: false,
        temperature: 1.1 // Slightly higher to break repetition
    })
    const reply = completion.choices[0].message.content;

    return reply?.replace(/^\[.*?\]\s*/, '') || "";
}

export default deepseek;