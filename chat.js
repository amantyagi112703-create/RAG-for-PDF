require('dotenv').config({ path: require('path').resolve(process.cwd(), '.env') });

const readline = require('readline');
const { OpenAI } = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const { DataAPIClient } = require('@datastax/astra-db-ts');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic(process.env.ANTHROPIC_API_KEY);

const astraClient = new DataAPIClient(process.env.ASTRA_DB_APPLICATION_TOKEN);
const db = astraClient.db(process.env.ASTRA_DB_API_ENDPOINT);
const collection = db.collection('documents');

async function findRelevantChunks(question) {
    const response = await openai.embeddings.create({
        model: 'text-embedding-ada-002',
        input: question
    });

    const questionEmbedding = response.data[0].embedding;
    
    const results = await collection.find({}, {
    sort: { $vector: questionEmbedding },
    limit: 5,
    projection: { text: 1 }
  }).toArray();

    return results.map(r => r.text).join('\n\n---\n\n');
}

async function askClaude(question, context, history) {
    const systemPrompt = `You are a helpful assistant that answeers questions
based on the provided document context.

Only use the information in the context to answer.
If the answer is not in the context, say "I don't see 
that information in the document."

Context from the document:
${context}`;

    const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [
        ...history,
        { role: 'user', content: question }
    ]
    });

    return response.content[0].text;
}

async function chat() {
    const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
    });

    const history = [];

console.log('\nDocument chatbot ready. Type your question or "exit" to quit.\n')

    const ask = () => {
    rl.question('You ', async (input) => {
        const question = input.trim();

        if (question.toLowerCase() === 'exit') {
            console.log('Goodbye!');
            rl.close();
            return;
        }

        if (!question) { ask(); return; }

        try {
            console.log('\nSearching document...');
            const context = await findRelevantChunks(question);

            console.log('Asking Claude...\n');
            const answer = await askClaude(question, context, history);

            console.log(`Claude ${answer}\n`);

            history.push({ role: 'user', content: question });
            history.push({ role: 'assistant', content: answer });

        } catch (error) {
            console.error('Error:', error.message);
        }

        ask();

    
    });
    };
    ask();
}

chat().catch(console.error);