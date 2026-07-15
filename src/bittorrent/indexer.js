import Constants from '../../constants.js';
import createTorrent from "create-torrent";
import crypto from 'crypto';

export let releases = new Map();

export default function initIndexer(app) {
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
    </searching>
    <categories>
        <category id="3000" name="Audio">
            <subcat id="3010" name="MP3"/>
        </category>
    </categories>
</caps>`);
    }

    async function search(req, res) {
        const results = await Constants.YTMusic.searchAlbums(decodeURIComponent(req.query.q));

        if (results.length < 1) {
            res.type('application/xml'); // send dummy empty xml so the indexer failure isn't triggered in lidarr
            res.send(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel></channel></rss>`);
            return;
        }

        const album = results[0];
        const id = crypto.randomUUID();

        res.type('application/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:newznab="http://www.newznab.com/DTD/2010/feeds/attributes/">
	<channel>
		<item>
			<title>${album.artist.name} - ${album.name}</title>
            <link>http://localhost:${process.env.PORT ?? 5071}/indexer/api?t=get&amp;id=${id}</link>
			<pubDate>Thu, 1 Jan 2026 00:00:00 GMT</pubDate>
            <category>3000</category>
            <guid isPermaLink="false">${id}</guid>
			<enclosure
                url="http://localhost:${process.env.PORT ?? 5071}/indexer/api?t=get&amp;id=${id}"
                length="72351744"
                type="application/x-bittorrent"/>
            <newznab:attr name="artist" value="${album.artist.name}"/>
            <newznab:attr name="album" value="${album.name}"/>
            <newznab:attr name="artist" value="${album.artist.name}"/>
		</item>
	</channel>
</rss>`);

        releases.set(id, album);
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