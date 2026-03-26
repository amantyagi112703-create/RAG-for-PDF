require('dotenv').config({ path: require('path').resolve(process.cwd(), '.env') });
 
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');
const { OpenAI } = require('openai');
const { DataAPIClient } = require('@datastax/astra-db-ts');
 
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
 
const astraClient = new DataAPIClient(process.env.ASTRA_DB_APPLICATION_TOKEN);
const db = astraClient.db(process.env.ASTRA_DB_API_ENDPOINT);
const collection = db.collection('documents');
 
async function extractText(filePath) {
    const ext = path.extname(filePath).toLowerCase();
 
    if (ext === '.pdf') {
        const buffer = fs.readFileSync(filePath);
        const data = await pdf(buffer);
        return data.text;
    }
 
    if (ext === '.txt') {
        return fs.readFileSync(filePath, 'utf-8');
    }
 
    throw new Error('Unsupported file type. Use .pdf or .txt');
}
 
function splitIntoChunks(text, chunkSize = 500, overlap = 50) {
    const words = text.split(/\s+/);
    const chunks = [];
 
    for (let i = 0; i < words.length; i += chunkSize - overlap) {
        const chunk = words
            .slice(i, i + chunkSize)
            .join(' ');
 
        if (chunk.trim().length > 0) {
            chunks.push(chunk);
        }
    }
 
    return chunks;
}
 
async function generateEmbedding(text) {
    const response = await openai.embeddings.create({
        model: 'text-embedding-ada-002',
        input: text,
    });
 
    return response.data[0].embedding;
}
 
async function seed() {
    const filePath = path.join(process.cwd(), 'Trial_Document.pdf');
 
    console.log('Reading document...');
    const text = await extractText(filePath);
 
    console.log('Splitting into chunks...');
    const chunks = splitIntoChunks(text);
    console.log(`Found ${chunks.length} chunks`);
 
    for (let i = 0; i < chunks.length; i++) {
        console.log(`Embedding chunk ${i + 1} of ${chunks.length}...`);
 
        const embedding = await generateEmbedding(chunks[i]);
 
        await collection.insertOne({
            text: chunks[i],
            $vector: embedding,
            chunkIndex: i,
        });
    }
 
    console.log('Done! All chunks saved to Astra DB.');
}
 
seed().catch(console.error);