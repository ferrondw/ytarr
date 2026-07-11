import { fileURLToPath } from 'url';
import { exec, execSync } from 'child_process';
import { FolderNameSanitizer } from '../utils/FolderNameSanitizer.js';
import YTMusic from 'ytmusic-api';
import NodeID3 from 'node-id3';
import express from 'express';
import path from 'path';
import fs from 'fs';

export default function initClient(app) {
    app.post('/api/v2/auth/login', (req, res) => {
        res.status(200);
    });

    app.get('/api/v2/app/version', (req, res) => {
        res.setHeader('content-type', 'text/plain'); // https://stackoverflow.com/questions/51661744/how-to-set-content-type-when-doing-res-send
        res.send('v4.1.3');
    });

    app.get('/api/v2/app/webapiVersion', (req, res) => {
        res.setHeader('content-type', 'text/plain');
        res.send('2.0');
    });

    app.get('/api/v2/app/buildInfo', (req, res) => {
        res.json({ "bitness": 64, "boost": "1.86.0", "libtorrent": "1.2.20.0", "openssl": "3.5.0", "platform": "windows", "qt": "6.7.3", "zlib": "1.3.1" });
    });

    app.get('/api/v2/app/preferences', (req, res) => {
    });

    app.get('/api/v2/torrents/categories', (req, res) => {
        res.json({
            "Audio": {
                "name": "Audio",
                "savePath": "./temp"
            }
        })
    });

    app.post('/api/v2/torrents/add', (req, res) => {
    });

    app.get('/api/v2/torrents/info', (req, res) => {
    });

    app.post('/api/v2/torrents/delete', (req, res) => {
    });

    app.post('/api/v2/torrents/pause', (req, res) => {
    });

    app.post('/api/v2/torrents/resume', (req, res) => {
    });

    app.get('/api/v2/transfer/info', (req, res) => {
    });

    app.get('/api/v2/sync/maindata', (req, res) => {
    });
}