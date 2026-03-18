import openai from './openai'
import 'dotenv/config'
import { SOUL } from "../core/soul"
import searchMemory from "../rag/search"

const deepseek = async (messageHistory: any, currentMessage: string, userId : number) => {

    const formattedHistory = messageHistory.map((msg: any) => ({
        role: msg.role,
        content: `[${msg.createdAt}] ${msg.content}`
    }))

    const relevantMemory = await searchMemory(currentMessage, userId);

    const completion = await openai.chat.completions.create({
        model: 'deepseek-chat',
        messages: [
            { role: 'system', content: SOUL },
            { role: 'system', content: `Current date and time: ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok', dateStyle: 'full', timeStyle: 'medium' })}` },
            { role: 'system', content: `Relevant memories about Ian: \n ${relevantMemory.map(m=> m.content).join("\n")}`},
            ...formattedHistory,
            { role: 'system', content: 'Timestamps in messages are for your context only — never include them in your responses. Speak naturally.' },
            { role: 'user', content: `[${new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' })}] ${currentMessage}` }
        ],
        max_completion_tokens: 1500,
        stream: false,
        temperature: 1.0
    })

    return completion.choices[0].message.content;
}

export default deepseek;