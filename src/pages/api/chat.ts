import { OpenAIStream, StreamingTextResponse } from 'ai';
import { Configuration, OpenAIApi } from 'openai-edge';
import { retrieveContext } from '@/helpers/motorhead';
import { DEFAULT_PROMPT } from '@/helpers/prompts';
import { encode } from 'gpt-tokenizer';

export const config = {
  runtime: 'edge'
}

const openAiConfig = new Configuration({
  apiKey: process.env.OPENAI_API_KEY
})

const openai = new OpenAIApi(openAiConfig)

const DEFAULT_TEMPERATURE = 0;


function getTokenCount(messages: any[]) {
  return new Promise((resolve, _reject) => {
    const tokens = messages.reduce((acc: number, curr: any) => {
      const content = curr.content;
      const tokens = encode(content).length;
      return acc + tokens;
    }, 0);

    resolve(tokens);
  })
}


export default async function handler(req: any) {
  const { messages, chunkCount, maxTokens, temperature, system, pw, session } = await req.json()

  try {
    const last = messages.pop();

    await fetch(`http://localhost:8080/sessions/${session}/memory`, {
      method: 'POST',
      body: JSON.stringify({ messages: [last] }),
      headers: {
        'Content-Type': 'application/json',
      }
    } as any)

    const ctx = await retrieveContext(last.content, session);

    const responseQ = { ...last };
    responseQ.content = `
      Context: '''${ctx}'''
      Question: ${last.content}
      Answer:
    `;

    console.log('responseQ', responseQ.content)

    const messagesWSystem = [
      {
        role: "system",
        content: system || DEFAULT_PROMPT,
      },
      ...messages,
      responseQ,
    ];

    const openAiBody = {
      model: 'gpt-4',
      stream: true,
      messages: messagesWSystem,
      temperature: temperature || DEFAULT_TEMPERATURE,
    };

    if (maxTokens !== undefined) {
      // @ts-ignore
      openAiBody.max_tokens = maxTokens;
    }

    const [response, tokenCount] = await Promise.all([
      openai.createChatCompletion(openAiBody),
      getTokenCount(messagesWSystem),
    ]);

    if (response?.status === 400) {
      throw new Error('Context window exceeded. Please clear history and try again.')
    }
    const stream = OpenAIStream(response)
    return new StreamingTextResponse(stream, {
      headers: {
        'x-metal-tokens': tokenCount,
      } as any,
    })
  } catch (e: any) {
    return new Response(e.message, {
      status: 400,
      headers: {
        "content-type": "application/json",
      }
    });
  }

}
