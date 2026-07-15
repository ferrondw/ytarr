import initIndexer from './src/bittorrent/indexer.js';
import initClient from './src/bittorrent/client.js';
import { fileURLToPath } from 'url';
import express from 'express';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();
const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

initClient(app);
initIndexer(app);

app.listen(process.env.PORT ?? 5071, () => {
    console.log(`Server listening at http://localhost:${process.env.PORT ?? 5071}`);
});