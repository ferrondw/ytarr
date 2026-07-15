import { FolderNameSanitizer } from '../utils/FolderNameSanitizer.js';
import Constants from '../../constants.js';
import parseTorrent from "parse-torrent";
import { exec, execSync } from 'child_process';
import { releases } from './indexer.js';
import { promisify } from 'util';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const execAsync = promisify(execSync);

export const jobs = new Map();
const upload = multer({ storage: multer.memoryStorage() });

//#region Client
export default function initClient(app) {
    app.post('/api/v2/auth/login', (req, res) => {
        res.cookie('SID', 'ytarr'); // not really needed but lidarr refuses to connect without cookie
        res.type('text/plain');
        res.send('Ok.');
    });

    app.get('/api/v2/app/version', (req, res) => {
        res.type('text/plain');
        res.send('v5.0.5');
    });

    app.get('/api/v2/app/webapiVersion', (req, res) => {
        res.type('text/plain');
        res.send('2.11.2');
    });

    app.get('/api/v2/app/buildInfo', (req, res) => {
        res.json({});
    });

    app.get('/api/v2/app/preferences', (req, res) => {
        res.json({});
    });

    app.get('/api/v2/torrents/categories', (req, res) => {
        res.json({
            "lidarr": {
                "name": "lidarr",
                "savePath": Constants.downloadPath
            }
        })
    });

    app.get('/api/v2/transfer/info', (req, res) => {
        res.json({
            "connection_status": "connected",
            "dht_nodes": 83,
            "dl_info_data": 0,
            "dl_info_speed": 0,
            "dl_rate_limit": 0,
            "up_info_data": 0,
            "up_info_speed": 0,
            "up_rate_limit": 0
        });
    });

    app.get('/api/v2/sync/maindata', (req, res) => {
        res.json({
            "categories": {
                "lidarr": {
                    "name": "lidarr",
                    "savePath": Constants.downloadPath
                }
            },
            "server_state": {
                "connection_status": "connected",
            }
        });
    });

    // https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-5.0)#add-new-torrent
    app.post("/api/v2/torrents/add", upload.single("torrents"), async (req, res) => {
        try {
            const torrent = await parseTorrent(req.file.buffer);
            const id = torrent.name;
            const album = releases.get(id);

            downloadAlbum(album, id);

            res.type("text/plain").send("Ok.");
        }
        catch (err) {
            console.error(err);
            res.status(400).send("nah");
        }
    }
    );

    app.post('/api/v2/torrents/delete', (req, res) => {
        console.log(req.protocol + '://' + req.get('host') + req.originalUrl);
    });

    app.post('/api/v2/torrents/pause', (req, res) => {
    });

    app.post('/api/v2/torrents/resume', (req, res) => {
    });

    app.get('/api/v2/torrents/info', (req, res) => {
        console.log(Array.from(jobs.values()));
        res.json(Array.from(jobs.values()));
    });
}
//#endregion

//#region Downloader
async function downloadAlbum(album, jobId) {
    // youtube by default compresses an image to 90% quality and 544x544, so here i just remove compression and return the original size image
    const coverUrl = `${album.thumbnails[0].url.split('=')[0]}=s0-l100`;
    const coverImage = Buffer.from(await (await fetch(coverUrl)).arrayBuffer());
    const completeAlbum = await Constants.YTMusic.getAlbum(album.albumId);

    const folderName = `${completeAlbum.artist.name} - ${completeAlbum.name} (${completeAlbum.year})`;
    const job = jobs.set(jobId, {
        "category": "lidarr",
        "content_path": `${Constants.downloadPath}\\${folderName}`,
        "eta": completeAlbum.songs.length * 10,
        "has_metadata": true,
        "hash": `hash-${jobId}`,
        "infohash_v1": `infohash-${jobId}`,
        "name": folderName,
        "progress": 0.1,
        "root_path": `${Constants.downloadPath}\\${folderName}`,
        "save_path": Constants.downloadPath,
        "size": 100000, // lidarr ignores progress if the download doesn't have a size
        "state": "downloading", // stalledUP is completed

        "ytarr": {
            "id": jobId,
            "album": completeAlbum,
            "coverImage": coverImage,
        },
    });

    for (const song of completeAlbum.songs) { // https://stackoverflow.com/questions/37576685/using-async-await-with-a-foreach-loop
        downloadSong(song, completeAlbum, coverImage);
    }
}

async function downloadSong(song, album, coverImage, retryCounter = 3) {
    try {
        const downloadPath = await execSync(
            `yt-dlp --js-runtimes node -x -P "./downloads" --audio-format "mp3" --no-keep-video --no-playlist "https://www.youtube.com/watch?v=${song.videoId}" --print after_move:filepath`
        ).toString().trim();
        console.log(`downloaded`);
        
        const fileExtension = downloadPath.split('.').slice(-1)[0];
        const fileName = FolderNameSanitizer.sanitize(`${song.album.name} - ${song.name} [${song.videoId}].${fileExtension}`);
        const destination = `${__dirname}/downloads/${fileName}`;
        
        await fs.promises.mkdir(path.dirname(destination), { recursive: true });
        await fs.promises.rename(downloadPath, destination);
        console.log(`renamed`);
        
        await new Promise(resolve => setTimeout(resolve, 300)); // wait for rename because it sometimes takes a bit
        
        await embedMetadata(song, album, coverImage, destination);
        console.log(`embedded`);
    } catch (err) {
        console.log(`error downloading: ${err}`);
        if (retryCounter > 0) downloadSong(song, album, coverImage, retryCounter - 1);
    }
}

async function embedMetadata(song, album, coverImage, filePath) {
    let trackNumber = -1;
    for (let index = 0; index < album.songs.length; index++) {
        if (album.songs[index].videoId !== song.videoId) continue;
        
        trackNumber = index + 1;
        break;
    }
    
    const tags = {
        title: song.name,
        album: album.name,
        artist: song.artist.name,
        performerInfo: song.artist.name,
        year: album.year,
        length: song.duration,
        trackNumber,
        image: {
            mime: "image/jpeg",
            type: {
                id: 0x03 // NodeID3.TagConstants.AttachedPicture.PictureType.FRONT_COVER
            },
            description: "album cover",
            imageBuffer: coverImage
        }
    }
    
    console.log(`embedding....`);
    const success = Constants.NodeID3.write(tags, filePath);
    
    if (!success) {
        console.error("Failed to write metadata:", Constants.NodeID3.read(filePath));
    }

    console.log(`end of embedding...`);
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
//#endregion