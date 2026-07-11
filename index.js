import { FolderNameSanitizer } from './src/utils/FolderNameSanitizer.js';
import { exec, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import initClient from './src/bittorrent/client.js';
import initIndexer from './src/bittorrent/indexer.js';
import YTMusic from 'ytmusic-api';
import NodeID3 from 'node-id3';
import express from 'express';
import path from 'path';
import fs from 'fs';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());

const ytmusic = new YTMusic();
await ytmusic.initialize();

initClient(app);
initIndexer(app);

app.get('/', (req, res) => {
    res.sendFile(`${__dirname}/public/index.html`);
});

app.get('/search/:songName', async (req, res) => {
    const song = (await ytmusic.searchSongs(req.params.songName))[0];
    downloadSong(song);
});

app.get('/search/album/:albumName', async (req, res) => {
    const albumId = (await ytmusic.searchAlbums(req.params.albumName))[0].albumId;
    const album = (await ytmusic.getAlbum(albumId));
    for (const song of album.songs) { // https://stackoverflow.com/questions/37576685/using-async-await-with-a-foreach-loop
        downloadSong(song);
    }
});

app.listen(5071, () => {
    console.log('Server listening at http://localhost:5071');
});

async function downloadSong(song) {
    const downloadPath = await execSync(
        `yt-dlp --js-runtimes node -x -P "./temp" --cookies "./cookies.txt" --audio-format "mp3" --no-keep-video --no-playlist "https://www.youtube.com/watch?v=${song.videoId}" --print after_move:filepath`
    ).toString().trim();

    const fileExtension = downloadPath.split('.').slice(-1)[0];
    const fileName = FolderNameSanitizer.sanitize(`${song.album.name} - ${song.name} [${song.videoId}].${fileExtension}`);
    const destination = `${__dirname}/temp/${fileName}`;

    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    await fs.promises.rename(downloadPath, destination);

    embedMetadata(song, destination);
}

async function embedMetadata(song, filePath, album = null) {
    const youtubeAlbum = album ? album : await ytmusic.getAlbum(song.album.albumId);

    // youtube by default compresses an image to 90% quality and 544x544, so here i just remove compression and return the original size image
    const coverUrl = `${youtubeAlbum.thumbnails[0].url.split('=')[0]}=s0-l100`;
    const coverImage = Buffer.from(await (await fetch(coverUrl)).arrayBuffer());

    const tags = {
        title: song.name,
        album: youtubeAlbum.name,
        artist: song.artist.name,
        performerInfo: song.artist.name,
        year: youtubeAlbum.year,
        length: song.duration,
        trackNumber: findTrackNumber(song, youtubeAlbum),
        image: {
            mime: "image/jpeg",
            type: {
                id: NodeID3.TagConstants.AttachedPicture.PictureType.FRONT_COVER
            },
            description: "album cover",
            imageBuffer: coverImage
        }
    }

    NodeID3.write(tags, filePath);

    /*
    await fetch(`https://lrclib.net/api/search?q=${song.name} ${song.artist.name}`).then(function (response) {
        return response.json();
    }).then(async function (data) {
        const lrcPath = `${filePath.replace(/\.[^\.]+$/, '')}.lrc`; // https://gist.github.com/MarshySwamp/40aefebb39e0eef2d7599ac4050490d9
        if (data.length < 5) return;
        await fs.promises.writeFile(lrcPath, data[0].syncedLyrics.replace(`\n`, `\r\n`)); // windows fucked newlines or something no clue but this works
    }).catch(() => { });
    */
}

//#region Helpers
function findTrackNumber(song, album) {
    for (let index = 0; index < album.songs.length; index++) {
        if (album.songs[index].videoId === song.videoId) return index;
    }
}
//#endregion