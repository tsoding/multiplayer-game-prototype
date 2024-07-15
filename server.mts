import {WebSocketServer, WebSocket} from 'ws';
import * as common from './common.mjs'
import {PlayerMoving, PlayerJoined, PlayerLeft, Player, Event, Hello, Direction} from './common.mjs'
import http from "node:http";

namespace Stats {
    export const AVERAGE_CAPACITY = 30;
    const STATS_FEED_INTERVAL_MS = 2000;
    const stats: common.Stats = {}

    export const server = http.createServer((req, res) => { 
        console.log("New client connected to stats server.", req.headers['user-agent']);
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Access-Control-Allow-Origin': '*',
            'Connection': 'keep-alive'
        });
        const timer = setInterval(()=> {
            const msg = `data:${JSON.stringify(stats)} \n\n`
            res.write(msg);
        }, STATS_FEED_INTERVAL_MS);
        req.on("close", () => clearInterval(timer));
    }).listen(
        common.STATS_FEED_PORT,
        undefined,
        undefined, 
        () => console.log("Stats feed listening to http://0.0.0.0:" + common.STATS_FEED_PORT)
    );

    function getStat(stat: common.Stat): number {
        switch (stat.kind) {
            case 'counter': return stat.counter;
            case 'average': return average(stat.samples);
            case 'timer':   return performance.now() - stat.startedAt;
        }
    }

    function register<T extends common.Stat>(name: string, stat: T): T {
        stats[name] = stat;
        return stat;
    }

    export function print() {
        console.log("Stats:")
        for (let key in stats) {
            console.log(`  ${stats[key].description}`, getStat(stats[key]));
        }
    }

    // TODO: keeping the AVERAGE_CAPACITY checked relies on calling Stats.print() periodically.
    //   It would be better to go back to having a custom method for pushing samples
    function average(xs: Array<number>): number {
        while (xs.length > AVERAGE_CAPACITY) xs.shift();
        return xs.reduce((a, b) => a + b, 0)/xs.length
    }

    export const uptime               : common.Timer   = register("uptime",               {kind: 'timer', startedAt: 0, description: "Uptime (secs)"});
    export const ticksCount           : common.Counter = register("ticksCount",           {kind: 'counter', counter: 0, description: "Ticks count",});
    export const tickTimes            : common.Average = register("tickTimes",            {kind: 'average', samples: [], description: "Average time to process a tick",});
    export const messagesSent         : common.Counter = register("messagesSent",         {kind: 'counter', counter: 0, description: 'Total messages sent',});
    export const messagesReceived     : common.Counter = register("messagesReceived",     {kind: 'counter', counter: 0, description: 'Total messages received',});
    export const tickMessagesSent     : common.Average = register("tickMessagesSent",     {kind: 'average', samples: [], description: "Average messages sent per tick",});
    export const tickMessagesReceived : common.Average = register("tickMessagesReceived", {kind: 'average', samples: [], description: "Average messages received per tick",});
    export const bytesSent            : common.Counter = register("bytesSent",            {kind: 'counter', counter: 0, description: "Total bytes sent",});
    export const bytesReceived        : common.Counter = register("bytesReceived",        {kind: 'counter', counter: 0, description: "Total bytes received",});
    export const tickByteSent         : common.Average = register("tickByteSent",         {kind: 'average', samples: [], description: "Average bytes sent per tick",});
    export const tickByteReceived     : common.Average = register("tickByteReceived",     {kind: 'average', samples: [], description: "Average bytes received per tick",});
    export const playersCurrently     : common.Counter = register("playersCurrently",     {kind: 'counter', counter: 0, description: "Currently players",});
    export const playersJoined        : common.Counter = register("playersJoined",        {kind: 'counter', counter: 0, description: "Total players joined",});
    export const playersLeft          : common.Counter = register("playersLeft",          {kind: 'counter', counter: 0, description: "Total players left",});
    export const bogusAmogusMessages  : common.Counter = register("bogusAmogusMessages",  {kind: 'counter', counter: 0, description: "Total bogus-amogus messages",});
    export const playersRejected      : common.Counter = register("playersRejected",      {kind: 'counter', counter: 0, description: "Total players rejected",});
}

const SERVER_FPS = 60;
const SERVER_LIMIT = 69;

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

wss.on("connection", (ws) => {
    if (players.size >= SERVER_LIMIT) {
        Stats.playersRejected.counter += 1
        ws.close();
        return;
    }
    const id = idCounter++;
    const x = Math.random()*(common.WORLD_WIDTH - common.PLAYER_SIZE);
    const y = Math.random()*(common.WORLD_HEIGHT - common.PLAYER_SIZE);
    const hue = Math.floor(Math.random()*360);
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
        hue,
    }
    players.set(id, player);
    // console.log(`Player ${id} connected`);
    eventQueue.push({
        kind: 'PlayerJoined',
        id, x, y, hue
    })
    Stats.playersJoined.counter += 1;
    Stats.playersCurrently.counter += 1;
    ws.addEventListener("message", (event) => {
        Stats.messagesReceived.counter += 1;
        Stats.bytesReceived.counter += event.data.toString().length;
        bytesReceivedWithinTick += event.data.toString().length;
        let message;
        try {
            message = JSON.parse(event.data.toString());
        } catch(e) {
            Stats.bogusAmogusMessages.counter += 1;
            // console.log(`Recieved bogus-amogus message from client ${id} on parsing JSON:`, event.data);
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
            Stats.bogusAmogusMessages.counter += 1;
            // console.log(`Received bogus-amogus message from client ${id}:`, message)
            ws.close();
            return;
        }
    });
    ws.on("close", () => {
        // console.log(`Player ${id} disconnected`);
        players.delete(id);
        Stats.playersLeft.counter += 1;
        Stats.playersCurrently.counter -= 1;
        eventQueue.push({
            kind: 'PlayerLeft',
            id
        })
    })
})

let previousTimestamp = performance.now();
function tick() {
    const timestamp = performance.now();
    const deltaTime = (timestamp - previousTimestamp)/1000
    previousTimestamp = timestamp;
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
                hue: joinedPlayer.hue,
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
                        hue: otherPlayer.hue,
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
                        hue: joinedPlayer.hue,
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
    players.forEach((player) => common.updatePlayer(player, deltaTime))

    const tickTime = performance.now() - timestamp;
    Stats.ticksCount.counter += 1;
    Stats.tickTimes.samples.push(tickTime/1000);
    Stats.messagesSent.counter += messageSentCounter;
    Stats.tickMessagesSent.samples.push(messageSentCounter);
    Stats.tickMessagesReceived.samples.push(eventQueue.length);
    Stats.bytesSent.counter += bytesSentCounter;
    Stats.tickByteSent.samples.push(bytesSentCounter);
    Stats.tickByteReceived.samples.push(bytesReceivedWithinTick);

    eventQueue.length = 0;
    bytesReceivedWithinTick = 0;

    // if (Stats.ticksCount.counter%SERVER_FPS === 0) {
        // TODO: serve the stats over a separate websocket, so a separate html page can poll it once in a while
        // console.log(Stats.print())
    // }

    setTimeout(tick, Math.max(0, 1000/SERVER_FPS - tickTime));
}
Stats.uptime.startedAt = performance.now()
setTimeout(tick, 1000/SERVER_FPS);

console.log(`WSS listening to ws://0.0.0.0:${common.SERVER_PORT}`)
