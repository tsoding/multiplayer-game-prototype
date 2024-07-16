import {WebSocketServer, WebSocket} from 'ws';
import * as common from './common.mjs'
import {PlayerMoving, PlayerJoined, PlayerLeft, Player, Event, Hello, Direction} from './common.mjs'

namespace Stats {
    const AVERAGE_CAPACITY = 30;

    export interface Counter {
        kind: 'counter',
        counter: number,
        description: string,
    }

    export interface Average {
        kind: 'average',
        samples: Array<number>,
        description: string
    }

    export interface Timer {
        kind: 'timer',
        startedAt: number,
        description: string,
    }

    type Stat = Counter | Average | Timer;
    type Stats = {[key: string]: Stat}
    const stats: Stats = {}

    // TODO: keeping the AVERAGE_CAPACITY checked relies on calling Stats.print() periodically.
    //   It would be better to go back to having a custom method for pushing samples
    function average(xs: Array<number>): number {
        while (xs.length > AVERAGE_CAPACITY) xs.shift();
        return xs.reduce((a, b) => a + b, 0)/xs.length
    }

    function getStat(stat: Stat): number {
        switch (stat.kind) {
            case 'counter': return stat.counter;
            case 'average': return average(stat.samples);
            case 'timer':   return performance.now() - stat.startedAt;
        }
    }

    function formatStat(stat: Stat): string {
        switch (stat.kind) {
            case 'counter': return stat.counter.toString();
            case 'average': return average(stat.samples).toString();
            case 'timer':
                const dt = (performance.now() - stat.startedAt)*60;
                const nsecs = dt/1000;
                const nmins = dt/1000/60;
                const nhrs = dt/1000/60/60;
                const fsecs = Math.floor(nsecs%60).toString().padStart(2,'0');
                const fmins = Math.floor(nmins%60).toString().padStart(2,'0');
                const fhrs = Math.floor(nhrs);
                if (nsecs < 1)
                    return `${dt}ms`;
                if (nmins < 1)
                    return `${(dt/1000).toFixed(3)}s`;
                if (nhrs < 1)
                    return `${fmins}:${fsecs}m`;
                return `${fhrs}:${fmins}:${fsecs}h`;
        }
    }

    function register<T extends Stat>(name: string, stat: T): T {
        stats[name] = stat;
        return stat;
    }

    export function print() {
        console.log("Stats:")
        for (let key in stats) {
            console.log(`  ${stats[key].description}`, formatStat(stats[key]));
        }
    }

    export const uptime               : Timer   = register("uptime",               {kind: 'timer', startedAt: 0, description: "Uptime"});
    export const ticksCount           : Counter = register("ticksCount",           {kind: 'counter', counter: 0, description: "Ticks count",});
    export const tickTimes            : Average = register("tickTimes",            {kind: 'average', samples: [], description: "Average time to process a tick",});
    export const messagesSent         : Counter = register("messagesSent",         {kind: 'counter', counter: 0, description: 'Total messages sent',});
    export const messagesReceived     : Counter = register("messagesReceived",     {kind: 'counter', counter: 0, description: 'Total messages received',});
    export const tickMessagesSent     : Average = register("tickMessagesSent",     {kind: 'average', samples: [], description: "Average messages sent per tick",});
    export const tickMessagesReceived : Average = register("tickMessagesReceived", {kind: 'average', samples: [], description: "Average messages received per tick",});
    export const bytesSent            : Counter = register("bytesSent",            {kind: 'counter', counter: 0, description: "Total bytes sent",});
    export const bytesReceived        : Counter = register("bytesReceived",        {kind: 'counter', counter: 0, description: "Total bytes received",});
    export const tickByteSent         : Average = register("tickByteSent",         {kind: 'average', samples: [], description: "Average bytes sent per tick",});
    export const tickByteReceived     : Average = register("tickByteReceived",     {kind: 'average', samples: [], description: "Average bytes received per tick",});
    export const playersCurrently     : Counter = register("playersCurrently",     {kind: 'counter', counter: 0, description: "Currently players",});
    export const playersJoined        : Counter = register("playersJoined",        {kind: 'counter', counter: 0, description: "Total players joined",});
    export const playersLeft          : Counter = register("playersLeft",          {kind: 'counter', counter: 0, description: "Total players left",});
    export const bogusAmogusMessages  : Counter = register("bogusAmogusMessages",  {kind: 'counter', counter: 0, description: "Total bogus-amogus messages",});
    export const playersRejected      : Counter = register("playersRejected",      {kind: 'counter', counter: 0, description: "Total players rejected",});
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

    if (Stats.ticksCount.counter%SERVER_FPS === 0) {
        // TODO: serve the stats over a separate websocket, so a separate html page can poll it once in a while
        Stats.print()
    }

    setTimeout(tick, Math.max(0, 1000/SERVER_FPS - tickTime));
}
Stats.uptime.startedAt = performance.now()
setTimeout(tick, 1000/SERVER_FPS);

console.log(`Listening to ws://0.0.0.0:${common.SERVER_PORT}`)
