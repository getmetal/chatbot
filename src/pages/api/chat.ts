import { OpenAIStream, StreamingTextResponse } from 'ai';
import { Configuration, OpenAIApi } from 'openai-edge';
import { retrieveContext } from '../../helpers/metal';
import { encode } from 'gpt-tokenizer';

export const config = {
  runtime: 'edge'
}

const openAiConfig = new Configuration({
  apiKey: process.env.OPENAI_API_KEY
})

const openai = new OpenAIApi(openAiConfig)

const DEFAULT_SYSTEM_MSG_CONTENT = `You are an AI Assistant that is an intelligent chatbot designed to answer questions related to the context provided.
  The context is contained in the text delimited by triple quotes.
  Questions can be related to the context or previous chat messages within the conversation.
  If the question is a follow up to a previous question, make sure to reference prior questions and answers.
  When appropriate, include a formatted citation to the source of the answer.
  If you're not sure of an answer, say 'I don't know'.`;

const DEFAULT_TEMPERATURE = 0;

async function getRetrievalQuery(messages: any[], last: any) {
  const origQ = last?.content;

  last.content = `Question: ${origQ}
    Answer:`;

  const messagesWSystem = [
    {
      role: 'system',
      content: `Generate a text query that captures the objective of the question below.
      You must generates a fully-formed, semantically rich question factoring in previous chat messages.
      This text query will be used to run a retrieval of context that will be used to answer the below question.
      It should be as semantically rich as possible.
      Do not go beyond 25 tokens.
      It is critical that this generated query fetches as much relevant context as possible.
      If you do not know, return with the "question" asked.
      `,
    },
    ...messages,
    last,
  ]

  const res = await openai.createChatCompletion({
    model: 'gpt-4',
    messages: messagesWSystem,
    max_tokens: 35,
  });

  if (res?.status === 400) {
    throw new Error('Context window exceeded. Please clear history and try again.')
  }

  const json = await res.json();
  const txt = json?.choices.reduce((acc: any, curr: any) => {
    return acc + curr.message.content;
  }, '')
  return txt || origQ;
}

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
  const { messages, chunkCount, maxTokens, temperature, system } = await req.json()

  try {
    const last = messages.pop();
    const retrievalQResponse = await getRetrievalQuery(messages, { ...last });

    const responseQ = { ...last };
    const ctx = await retrieveContext(retrievalQResponse, {
      limit: chunkCount
    });

    responseQ.content = `
      Context: '''${ctx}'''
      Question: ${last.content}
      Answer:
    `;

    const messagesWSystem = [
      {
        role: "system",
        content: system || DEFAULT_SYSTEM_MSG_CONTENT,
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
