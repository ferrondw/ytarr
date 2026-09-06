import { fileURLToPath } from 'url';
import YTMusicAPI from 'ytmusic-api';
import NodeID3 from 'node-id3';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config(); // index.js also uses config, but this file loads faster, so DOWNLOADS_PATH will always be null otherwise

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ytmusic = new YTMusicAPI();
await ytmusic.initialize();

const Constants = {
    downloadPath: process.env.DOWNLOAD_PATH || `${__dirname}\\downloads`,
    YTMusic: ytmusic,
    NodeID3: NodeID3
}

export default Constants;