import { FolderNameSanitizer } from '../utils/FolderNameSanitizer.js';
import Constants from '../../constants.js';
import parseTorrent from "parse-torrent";
import { execFile } from 'child_process';
import { releases } from './indexer.js';
import { promisify } from 'util';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const queue = [];
const queueLimit = 3;
const musicFileExtension = 'opus';

const timePerSongEstimate = 10;
let currentDownloadCount = 0;

const upload = multer({ storage: multer.memoryStorage() });
const execFileAsync = promisify(execFile);

//#region Client
export default function initClient(app) {
    app.get('/', (req, res) => {
        res.type('text/plain');
        res.send('ytarr is working!');
    });

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
            if (album === null) throw new Error('no album found');

            await enqueue(album, id);
            moveQueue();

            res.type("text/plain").send("Ok.");
        }
        catch (err) {
            console.error(err);
            res.status(400).send("nah");
        }
    }
    );

    app.post('/api/v2/torrents/delete', (req, res) => {
    });

    app.post('/api/v2/torrents/pause', (req, res) => {
    });

    app.post('/api/v2/torrents/resume', (req, res) => {
    });

    app.get('/api/v2/torrents/info', (req, res) => {
        res.json(queue);
    });
}
//#endregion

//#region Downloader
async function downloadAlbum(job) {
    job.state = "downloading";
    currentDownloadCount++;
    console.log(`Started downloading: ${job.ytarr.album.artist.name} - ${job.ytarr.album.name}`);

    try {
        for (const song of job.ytarr.album.songs) { // https://stackoverflow.com/questions/37576685/using-async-await-with-a-foreach-loop
            await downloadSong(song, job); // removing await downloads all songs concurrently
        }
    }
    catch (err) {
        console.error(err);
        job.state = "error";
        currentDownloadCount--;
        return;
    }

    console.log(`Finished downloading: ${job.ytarr.album.artist.name} - ${job.ytarr.album.name}`);
    moveQueue();
    currentDownloadCount--;
}

async function downloadSong(song, job, retryCounter = 3) {
    try {
        const downloadFolder = FolderNameSanitizer.sanitize(`${job.ytarr.album.artist.name} - ${job.ytarr.album.name} (${job.ytarr.album.year})`);
        const downloadPath = `${Constants.downloadPath}\\${downloadFolder}\\${song.videoId}.${musicFileExtension}`;

        await execFileAsync( // just exec promisified doesn't work for some reason, it never exits, execFile does though
            "yt-dlp",
            [
                "--js-runtimes", "node",
                "-x",
                "-o", downloadPath,
                "--audio-format", musicFileExtension,
                "--no-keep-video",
                "--no-playlist",
                `https://www.youtube.com/watch?v=${song.videoId}`
            ]
        );

        console.log(`Downloaded ${song.artist.name} - ${song.name} to: ${downloadPath}`);

        const fileName = FolderNameSanitizer.sanitize(`${song.artist.name} - ${song.album.name} - ${findTrackNumber(song, job.ytarr.album)} - ${song.name}.${musicFileExtension}`);
        const destination = `${Constants.downloadPath}\\${downloadFolder}\\${fileName}`;

        await fs.promises.mkdir(path.dirname(destination), { recursive: true });
        await fs.promises.rename(downloadPath, destination);

        await new Promise(resolve => setTimeout(resolve, 300)); // wait for rename because it sometimes takes a bit

        let progressToAdd = 1 / (job.ytarr.album.songs.length);
        job.progress += progressToAdd;
        job.eta -= timePerSongEstimate;
        if (job.progress >= 1) job.state = 'stalledUP';

    } catch (err) {
        if (retryCounter > 0) return downloadSong(song, job, retryCounter - 1);
        throw err;
    }
}

function findTrackNumber(song, album) {
    for (let index = 0; index < album.songs.length; index++) {
        if (album.songs[index].videoId !== song.videoId) continue;
        return index + 1;
    }
}
//#endregion

//#region Queue
async function enqueue(album, jobId) {
    // youtube by default compresses an image to 90% quality and 544x544, so here i just remove compression and return the original size image
    const coverUrl = `${album.thumbnails[0].url.split('=')[0]}=s0-l100`;
    const coverImage = Buffer.from(await (await fetch(coverUrl)).arrayBuffer());
    const completeAlbum = await Constants.YTMusic.getAlbum(album.albumId);

    const folderName = FolderNameSanitizer.sanitize(`${album.artist.name} - ${album.name} (${album.year})`);
    const job = {
        "category": "lidarr",
        "content_path": `${Constants.downloadPath}\\${folderName}`,
        "eta": completeAlbum.songs.length * timePerSongEstimate,
        "has_metadata": true,
        "hash": `hash-${jobId}`,
        "infohash_v1": `infohash-${jobId}`,
        "name": folderName,
        "progress": 0.0001,
        "root_path": `${Constants.downloadPath}\\${folderName}`,
        "save_path": Constants.downloadPath,
        "size": 100000, // lidarr ignores progress if the download doesn't have a size
        "state": "queuedDL",

        "ytarr": {
            "id": jobId,
            "album": completeAlbum,
            "coverImage": coverImage,
        },
    };
    queue.push(job);
}

function moveQueue() {
    while (currentDownloadCount < queueLimit) {
        let nextJob = queue.find(job => job.state === 'queuedDL');
        if (!nextJob) break;
        downloadAlbum(nextJob);
    }
}

//#endregion