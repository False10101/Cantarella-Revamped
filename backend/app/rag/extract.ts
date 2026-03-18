import openai from "../services/openai"

const extractMemory = async(userMessage : string, AIresponse : string) => {
    const completion = await openai.chat.completions.create({
        model: 'deepseek-chat',
        messages:[
            {
                role: 'system',
                content: 'You extract important facts worth remembering about Ian from conversations. Respond with ONE sentence fact or exactly "NONE" if nothing important was said. No explanation, just the fact or NONE.' 
            },
            {
                role: 'user',
                content: `User said: ${userMessage} \n Ai Assistant said: ${AIresponse}`
            },
        ],
        max_completion_tokens: 100,
        temperature: 0.3
    })
    return completion.choices[0].message.content ?? 'NONE';
}

export default extractMemory;