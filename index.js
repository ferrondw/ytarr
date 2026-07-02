import { fileURLToPath } from 'url';
import { exec, execSync } from 'child_process';
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

app.get('/', (req, res) => {
    res.sendFile(`${__dirname}/public/index.html`);
});

app.get('/search/:songName', async (req, res) => {
    const song = (await ytmusic.searchSongs(req.params.songName))[0];
    console.log(song);

    let filePath = await downloadSong(song);
    await embedMetadata(song, filePath);
});

app.listen(3000, () => {
    console.log('Server listening at http://localhost:3000');
});

async function downloadSong(song) {
    const downloadPath = await execSync(
        `yt-dlp --js-runtimes node -x --audio-format "mp3" --no-keep-video --no-playlist "https://www.youtube.com/watch?v=${song.videoId}" --print after_move:filepath`
    ).toString().trim();
    const fileExtension = downloadPath.split('.').slice(-1)[0];
    const destination = `${__dirname}/temp/${song.album.name} - ${song.name} [${song.videoId}].${fileExtension}`;

    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    await fs.promises.rename(downloadPath, destination);

    return destination;
}

async function embedMetadata(song, filePath, album = null) {
    const youtubeAlbum = album ? album : await ytmusic.getAlbum(song.album.albumId);

    // youtube by default compresses an image to 90% quality and 544x544, so here i just remove compression and return the original size image
    const coverUrl = `${youtubeAlbum.thumbnails[0].url.split('=')[0]}=s0-l100`;
    const coverImage = Buffer.from(await (await fetch(coverUrl)).arrayBuffer());

    // write lyrics to lrc file because youtube delivers lrc formatted lyrics anyways and id3 tags barely work (especially in wmp for some reason)
    await fetch(`https://lyrics.paxsenix.org/youtube/lyrics?id=${song.videoId}`).then(function (response) {
        return response.text();
    }).then(async function (data) {
        const lrcPath = `${filePath.replace(/\.[^\.]+$/, '')}.lrc`; // https://gist.github.com/MarshySwamp/40aefebb39e0eef2d7599ac4050490d9
        await fs.promises.writeFile(lrcPath, data);
    }).catch(() => { });

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
}

//#region Helpers
function findTrackNumber(song, album) {
    for (let index = 0; index < album.songs.length; index++) {
        if (album.songs[index].videoId === song.videoId) return index;
    }
}
//#endregion