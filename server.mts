import {WebSocketServer, WebSocket} from 'ws';
import * as common from './common.mjs'
import {PlayerMoving, PlayerJoined, PlayerLeft, Player, Event, Hello, Direction} from './common.mjs'

const SERVER_FPS = 30;
const SERVER_LIMIT = 69;
const STATS_AVERAGE_CAPACITY = 30;

interface Stats {
    startedAt: number,
    ticksCount: number,
    tickTimes: Array<number>,
    messagesSent: number,
    messagesReceived: number,
    tickMessagesSent: Array<number>,
    tickMessagesReceived: Array<number>,
    bytesSent: number,
    bytesReceived: number,
    tickByteSent: Array<number>,
    tickByteReceived: Array<number>,
    playersJoined: number,
    playersLeft: number,
    bogusAmogusMessages: number,
}

const stats: Stats = {
    ticksCount: 0,
    tickTimes: [],
    messagesSent: 0,
    messagesReceived: 0,
    tickMessagesSent: [],
    tickMessagesReceived: [],
    bytesSent: 0,
    bytesReceived: 0,
    tickByteSent: [],
    tickByteReceived: [],
    playersJoined: 0,
    playersLeft: 0,
    bogusAmogusMessages: 0,
    startedAt: performance.now(),
};

function average(xs: Array<number>): number {
    return xs.reduce((a, b) => a + b, 0)/xs.length
}

function pushAverage(xs: Array<number>, x: number) {
    if (xs.push(x) > STATS_AVERAGE_CAPACITY) {
        xs.shift();
    }
}

function printStats() {
    console.log("Stats:")
    console.log("  Ticks count", stats.ticksCount)
    console.log("  Uptime (secs)", (performance.now() - stats.startedAt)/1000);
    console.log("  Average time to process a tick", average(stats.tickTimes));
    console.log("  Total messages sent", stats.messagesSent);
    console.log("  Total messages received", stats.messagesReceived);
    console.log("  Average messages sent per tick", average(stats.tickMessagesSent));
    console.log("  Average messages received per tick", average(stats.tickMessagesReceived));
    console.log("  Total bytes sent", stats.bytesSent);
    console.log("  Total bytes received", stats.bytesReceived);
    console.log("  Average bytes sent per tick", average(stats.tickByteSent));
    console.log("  Average bytes received per tick", average(stats.tickByteReceived));
    console.log("  Currently players", players.size);
    console.log("  Total players joined", stats.playersJoined);
    console.log("  Total players left", stats.playersLeft);
    console.log("  Total bogus-amogus messages", stats.bogusAmogusMessages);
}

interface PlayerWithSocket extends Player {
    ws: WebSocket
}

const players = new Map<number, PlayerWithSocket>();
let idCounter = 0;
let eventQueue: Array<Event> = [];
let bytesReceivedWithinTick = 0;
const wss = new WebSocketServer({
    port: common.SERVER_PORT,
})
const joinedIds = new Set<number>()
const leftIds = new Set<number>()

function randomStyle(): string {
    return `hsl(${Math.floor(Math.random()*360)} 80% 50%)`
}

wss.on("connection", (ws) => {
    if (players.size >= SERVER_LIMIT) {
        ws.close();
        return;
    }
    const id = idCounter++;
    const x = Math.random()*(common.WORLD_WIDTH - common.PLAYER_SIZE);
    const y = Math.random()*(common.WORLD_HEIGHT - common.PLAYER_SIZE);
    const style = randomStyle();
    const player = {
        ws,
        id,
        x,
        y,
        moving: {
            'left': false,
            'right': false,
            'up': false,
            'down': false,
        },
        style
    }
    players.set(id, player);
    console.log(`Player ${id} connected`);
    eventQueue.push({
        kind: 'PlayerJoined',
        id, x, y, style
    })
    stats.playersJoined += 1;
    ws.addEventListener("message", (event) => {
        stats.messagesReceived += 1;
        stats.bytesReceived += event.data.toString().length;
        bytesReceivedWithinTick += event.data.toString().length;
        let message;
        try {
            message = JSON.parse(event.data.toString());
        } catch(e) {
            stats.bogusAmogusMessages += 1;
            console.log(`Recieved bogus-amogus message from client ${id} on parsing JSON:`, event.data);
            ws.close();
            return;
        }
        if (common.isAmmaMoving(message)) {
            // console.log(`Received message from player ${id}`, message)
            eventQueue.push({
                kind: 'PlayerMoving',
                id,
                x: player.x,
                y: player.y,
                start: message.start,
                direction: message.direction,
            });
        } else {
            stats.bogusAmogusMessages += 1;
            console.log(`Received bogus-amogus message from client ${id}:`, message)
            ws.close();
            return;
        }
    });
    ws.on("close", () => {
        console.log(`Player ${id} disconnected`);
        players.delete(id);
        stats.playersLeft += 1;
        eventQueue.push({
            kind: 'PlayerLeft',
            id
        })
    })
})

function tick() {
    const beginTickTime = performance.now();
    let messageSentCounter = 0;
    let bytesSentCounter = 0;

    joinedIds.clear();
    leftIds.clear();

    // This makes sure that if somebody joined and left within a single tick they are never handled
    for (const event of eventQueue) {
        switch (event.kind) {
            case 'PlayerJoined': {
                joinedIds.add(event.id);
            } break;
            case 'PlayerLeft': {
                if (!joinedIds.delete(event.id)) {
                    leftIds.add(event.id);
                }
            } break;
        }
    }

    // Greeting all the joined players and notifying them about other players
    joinedIds.forEach((joinedId) => {
        const joinedPlayer = players.get(joinedId);
        if (joinedPlayer !== undefined) { // This should never happen, but we handling none existing ids for more robustness
            // The greetings
            bytesSentCounter += common.sendMessage<Hello>(joinedPlayer.ws, {
                kind: 'Hello',
                id: joinedPlayer.id,
                x: joinedPlayer.x,
                y: joinedPlayer.y,
                style: joinedPlayer.style,
            })
            messageSentCounter += 1
            // Reconstructing the state of the other players
            players.forEach((otherPlayer) => {
                if (joinedId !== otherPlayer.id) { // Joined player should already know about themselves
                    bytesSentCounter += common.sendMessage<PlayerJoined>(joinedPlayer.ws, {
                        kind: 'PlayerJoined',
                        id: otherPlayer.id,
                        x: otherPlayer.x,
                        y: otherPlayer.y,
                        style: otherPlayer.style,
                    })
                    messageSentCounter += 1
                    let direction: Direction;
                    for (direction in otherPlayer.moving) {
                        if (otherPlayer.moving[direction]) {
                            bytesSentCounter += common.sendMessage<PlayerMoving>(joinedPlayer.ws, {
                                kind: 'PlayerMoving',
                                id: otherPlayer.id,
                                x: otherPlayer.x,
                                y: otherPlayer.y,
                                start: true,
                                direction
                            })
                            messageSentCounter += 1
                        }
                    }
                }
            })
        }
    })

    // Notifying about who joined
    joinedIds.forEach((joinedId) => {
        const joinedPlayer = players.get(joinedId);
        if (joinedPlayer !== undefined) { // This should never happen, but we handling none existing ids for more robustness
            players.forEach((otherPlayer) => {
                if (joinedId !== otherPlayer.id) { // Joined player should already know about themselves
                    bytesSentCounter += common.sendMessage<PlayerJoined>(otherPlayer.ws, {
                        kind: 'PlayerJoined',
                        id: joinedPlayer.id,
                        x: joinedPlayer.x,
                        y: joinedPlayer.y,
                        style: joinedPlayer.style,
                    })
                    messageSentCounter += 1
                }
            })
        }
    })

    // Notifying about who left
    leftIds.forEach((leftId) => {
        players.forEach((player) => {
            bytesSentCounter += common.sendMessage<PlayerLeft>(player.ws, {
                kind: 'PlayerLeft',
                id: leftId,
            });
            messageSentCounter += 1
        })
    })

    // Notifying about the movements
    for (let event of eventQueue) {
        switch (event.kind) {
            case 'PlayerMoving': {
                const player = players.get(event.id);
                if (player !== undefined) { // This MAY happen if somebody joined, moved and left within a single tick. Just skipping.
                    player.moving[event.direction] = event.start;
                    const eventString = JSON.stringify(event);
                    players.forEach((player) => {
                        player.ws.send(eventString)
                        messageSentCounter += 1
                        bytesSentCounter += eventString.length
                    });
                }
            } break;
        }
    }


    // Simulating the world for one server tick.
    players.forEach((player) => common.updatePlayer(player, 1/SERVER_FPS))

    stats.ticksCount += 1;
    pushAverage(stats.tickTimes, (performance.now() - beginTickTime)/1000);
    stats.messagesSent += messageSentCounter;
    pushAverage(stats.tickMessagesSent, messageSentCounter);
    pushAverage(stats.tickMessagesReceived, eventQueue.length);
    stats.bytesSent += bytesSentCounter;
    pushAverage(stats.tickByteSent, bytesSentCounter);
    pushAverage(stats.tickByteReceived, bytesReceivedWithinTick);

    eventQueue.length = 0;
    bytesReceivedWithinTick = 0;

    if (stats.ticksCount%SERVER_FPS === 0) {
        printStats()
    }

    setTimeout(tick, 1000/SERVER_FPS);
}
setTimeout(tick, 1000/SERVER_FPS);

console.log(`Listening to ws://0.0.0.0:${common.SERVER_PORT}`)
