import express from 'express';
import { Server, matchMaker } from 'colyseus';
import { createServer } from 'http';
import { OfficeRoom } from './rooms/OfficeRoom';

// Setup Express
const app = express();
app.use(express.json());

// Basic REST API for Office Management
app.get('/api/offices', (req, res) => {
    res.json({ status: 'ok', offices: [] });
});

// Create HTTP and Colyseus server
const httpServer = createServer(app);
const colyseusServer = new Server({
    server: httpServer,
});

// Define Rooms
colyseusServer.define('office', OfficeRoom);

// Start listening, then boot the office room immediately
const PORT = Number(process.env.PORT || 3000);
colyseusServer.listen(PORT).then(async () => {
    console.log(`[Server] AgentOffice Engine listening on ws://localhost:${PORT}`);

    // Create the office room on server start — agents run in the background
    // Clients will join this existing room via joinOrCreate
    await matchMaker.createRoom('office', {});
    console.log(`[Server] Office room created — agents are running`);
});
