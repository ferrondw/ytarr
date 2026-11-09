import Constants from '../../constants.js';
import createTorrent from "create-torrent";
import crypto from 'crypto';

export let releases = new Map();

export default function initIndexer(app) {
    const LIDARR_URL = process.env.LIDARR_URL || "http://localhost:8686";
    const LIDARR_API_KEY = process.env.LIDARR_API_KEY;

    app.get('/indexer/api', async (req, res) => {
        const t = req.query.t;
        if (t === 'caps') return sendCapabilities(req, res);
        if (t === 'music') return search(req, res);
        if (t === 'search') return search(req, res);
        if (t === 'get') return getRelease(req, res);

        res.status(400).send('nah');
    });

    async function sendCapabilities(req, res) {
        res.type('application/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<caps>
    <server version="1.0" title="ytarr"/>
    <limits max="100" default="50"/>
    <searching>
        <search available="yes" supportedParams="q"/>
        <music-search available="yes" supportedParams="q,artist,album"/>
        <audio-search available="yes" supportedParams="q,artist,album"/>
    </searching>
    <categories>
        <category id="3000" name="Audio">
            <subcat id="3010" name="MP3"/>
        </category>
    </categories>
</caps>`);
    }

    async function lidarrGet(path, params = {}) {
        const url = new URL(`/api/v1/${path}`, LIDARR_URL);

        for (const [key, value] of Object.entries(params)) {
            url.searchParams.set(key, value);
        }

        const response = await fetch(url, {
            headers: {
                "X-Api-Key": LIDARR_API_KEY,
                Accept: "application/json"
            }
        });

        if (!response.ok) {
            throw new Error(
                `Lidarr API error ${response.status}: ${await response.text()}`
            );
        }

        return response.json();
    }

    function xmlEscape(value = "") {
        return String(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&apos;");
    }

    async function search(req, res) {
        const query = String(req.query.q ?? "ytarr").trim();

        if (!query) {
            return sendEmptyRss(res);
        }

        try {
            const artists = await lidarrGet("artist/lookup", {
                term: query
            });

            if (!Array.isArray(artists) || artists.length === 0) {
                console.log(`[Lidarr] No artist found for: ${query}`);
                return sendEmptyRss(res);
            }

            const normalize = value =>
                String(value ?? "")
                    .toLowerCase()
                    .replace(/[^\p{L}\p{N}]/gu, "");

            const artist =
                artists.find(a =>
                    normalize(a.artistName) === normalize(query)
                ) ?? artists[0];

            if (!artist.foreignArtistId) {
                console.error("[Lidarr] Artist has no foreignArtistId:", artist);
                return sendEmptyRss(res);
            }

            console.log(
                `[Lidarr] Artist: ${artist.artistName} (${artist.foreignArtistId})`
            );

            const albums = await lidarrGet("album", {
                artistId: artist.id
            });

            console.log(
                `[Lidarr] Found ${albums.length} albums for ${artist.artistName}`
            );

            if (!albums.length) {
                return sendEmptyRss(res);
            }

            if (!Array.isArray(albums) || albums.length === 0) {
                console.log(`[Lidarr] No albums found for ${artist.artistName}`);
                return sendEmptyRss(res);
            }

            console.log(`[Lidarr] Found ${albums.length} albums`);

            const items = [];

            for (const lidarrAlbum of albums) {
                try {
                    const albumTitle = lidarrAlbum.title;

                    if (!albumTitle) continue;

                    console.log(`[YTMusic] Searching: ${artist.artistName} - ${albumTitle}`);

                    const ytResults = await Constants.YTMusic.searchAlbums(
                        `${artist.artistName} ${albumTitle}`
                    );

                    if (!Array.isArray(ytResults) || ytResults.length === 0) {
                        console.log(`[YTMusic] No match for: ${albumTitle}`);
                        continue;
                    }

                    const ytMatch =
                        ytResults.find(a =>
                            normalize(a.name) === normalize(albumTitle)
                        ) ?? ytResults[0];

                    if (!ytMatch.albumId) {
                        console.log(`[YTMusic] Missing albumId for: ${albumTitle}`);
                        continue;
                    }

                    const ytAlbum = await Constants.YTMusic.getAlbum(ytMatch.albumId);

                    if (!ytAlbum?.songs?.length) {
                        console.log(`[YTMusic] Album has no songs: ${albumTitle}`);
                        continue;
                    }

                    const id = crypto.randomUUID();
                    releases.set(id, ytAlbum);

                    const length = ytAlbum.songs.reduce((size, song) => size + (Number(song.duration) || 0) * (185 * 1000 / 8), 0);

                    const downloadUrl = `http://localhost:${process.env.PORT ?? 5071}/indexer/api?t=get&amp;id=${id}`;

                    items.push(`<item>
                                    <title>${xmlEscape(`${artist.artistName} - ${albumTitle}`)}</title>
                                    <link>${downloadUrl}</link>
                                    <pubDate>${new Date().toUTCString()}</pubDate>
                                    <category>3000</category>
                                    <guid isPermaLink="false">${id}</guid>
                                    <enclosure
                                        url="${downloadUrl}"
                                        length="${length}"
                                        type="application/x-bittorrent"/>
                                    <newznab:attr name="artist" value="${xmlEscape(artist.artistName)}"/>
                                    <newznab:attr name="album" value="${xmlEscape(albumTitle)}"/>
                                </item>`);

                } catch (error) {
                    console.error(
                        `[YTMusic] Failed to resolve ${lidarrAlbum.title}:`,
                        error.message
                    );
                }
            }

            const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:newznab="http://www.newznab.com/DTD/2010/feeds/attributes/">
    <channel>
        ${items.join("\n")}
    </channel>
</rss>`;

            console.log(`[Indexer] Returning ${items.length} releases`);

            return res.type("application/xml").send(xml);

        } catch (error) {
            console.error("[Indexer] Search failed:", error);

            return sendEmptyRss(res);
        }
    }

    function sendEmptyRss(res) {
        return res.type("application/xml").send(
            `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel></channel></rss>`
        );
    }

    async function getRelease(req, res) {
        // kinda for myself to remember
        // i make a fake torrent with a name equal to the id of the download
        // i export releases so that client.js can get that release from the empty torrents name
        // and i NEED to make a 'real' torrent because lidarr checks for malformed torrent files
        createTorrent(
            Buffer.from(""),
            {
                name: req.query.id,
            },
            (err, torrent) => {
                if (err) return res.status(500).send('nah');

                res.type("application/x-bittorrent");
                res.send(torrent);
            }
        );
    }
}