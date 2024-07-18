import {WebSocketServer, WebSocket} from 'ws';
import * as common from './common.mjs'
import {PlayerMoving, PlayerJoined, PlayerLeft, Player, Event, Direction} from './common.mjs'

namespace Stats {
    const AVERAGE_CAPACITY = 30;

    export interface Counter {
        kind: 'counter',
        counter: number,
        description: string,
    }

    export interface Average {
        kind: 'average';
        samples: Array<number>;
        description: string;
        pushSample(sample: number): void;
    }

    export interface Timer {
        kind: 'timer',
        startedAt: number,
        description: string,
    }

    type Stat = Counter | Average | Timer;
    type Stats = {[key: string]: Stat}
    const stats: Stats = {}

    function average(samples: Array<number>): number {
        return samples.reduce((a, b) => a + b, 0)/samples.length
    }

    function pluralNumber(num: number, singular: string, plural: string): string {
        return num === 1 ? singular : plural;
    }

    function displayTimeInterval(diffMs: number): string {
        const result = []
        const diffSecs = Math.floor(diffMs/1000);

        const days = Math.floor(diffSecs/60/60/24)
        if (days > 0) result.push(`${days} ${pluralNumber(days, 'day', 'days')}`);
        const hours = Math.floor(diffSecs/60/60%24);
        if (hours > 0) result.push(`${hours} ${pluralNumber(hours, 'hour', 'hours')}`);
        const mins = Math.floor(diffSecs/60%60);
        if (mins > 0) result.push(`${mins} ${pluralNumber(mins, 'min', 'mins')}`);
        const secs = Math.floor(diffSecs%60);
        if (secs > 0) result.push(`${secs} ${pluralNumber(secs, 'sec', 'secs')}`);
        return result.length === 0 ? '0 secs' : result.join(' ');
    }

    function getStat(stat: Stat): string {
        switch (stat.kind) {
            case 'counter': return stat.counter.toString();
            case 'average': return average(stat.samples).toString();
            case 'timer':   return displayTimeInterval(Date.now() - stat.startedAt);
        }
    }

    function registerCounter(name: string, description: string): Counter {
        const stat: Counter = {
            kind: 'counter',
            counter: 0,
            description,
        }
        stats[name] = stat;
        return stat;
    }

    function pushSample(this: Average, sample: number) {
        while (this.samples.length > AVERAGE_CAPACITY) this.samples.shift();
        this.samples.push(sample);
    }

    function registerAverage(name: string, description: string): Average {
        const stat: Average = {
            kind: 'average',
            samples: [],
            description,
            pushSample,
        }
        stats[name] = stat;
        return stat;
    }

    function registerTimer(name: string, description: string): Timer {
        const stat: Timer = {
            kind: 'timer',
            startedAt: 0,
            description,
        }
        stats[name] = stat;
        return stat;
    }

    export function print() {
        console.log("Stats:")
        for (let key in stats) {
            console.log(`  ${stats[key].description}`, getStat(stats[key]));
        }
    }

    export const uptime               = registerTimer  ("uptime",               "Uptime");
    export const ticksCount           = registerCounter("ticksCount",           "Ticks count");
    export const tickTimes            = registerAverage("tickTimes",            "Average time to process a tick");
    export const messagesSent         = registerCounter("messagesSent",         "Total messages sent");
    export const messagesReceived     = registerCounter("messagesReceived",     "Total messages received");
    export const tickMessagesSent     = registerAverage("tickMessagesSent",     "Average messages sent per tick");
    export const tickMessagesReceived = registerAverage("tickMessagesReceived", "Average messages received per tick");
    export const bytesSent            = registerCounter("bytesSent",            "Total bytes sent");
    export const bytesReceived        = registerCounter("bytesReceived",        "Total bytes received");
    export const tickByteSent         = registerAverage("tickByteSent",         "Average bytes sent per tick");
    export const tickByteReceived     = registerAverage("tickByteReceived",     "Average bytes received per tick");
    export const playersCurrently     = registerCounter("playersCurrently",     "Currently players");
    export const playersJoined        = registerCounter("playersJoined",        "Total players joined");
    export const playersLeft          = registerCounter("playersLeft",          "Total players left");
    export const bogusAmogusMessages  = registerCounter("bogusAmogusMessages",  "Total bogus-amogus messages");
    export const playersRejected      = registerCounter("playersRejected",      "Total players rejected");
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
            const view = new DataView(new ArrayBuffer(common.HelloStruct.size));
            common.HelloStruct.kind.write(view, 0, common.MessageKind.Hello);
            common.HelloStruct.id.write(view, 0, joinedPlayer.id);
            common.HelloStruct.x.write(view, 0, joinedPlayer.x);
            common.HelloStruct.y.write(view, 0, joinedPlayer.y);
            common.HelloStruct.hue.write(view, 0, Math.floor(joinedPlayer.hue/360*256));
            joinedPlayer.ws.send(view);
            bytesSentCounter += view.byteLength;
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
    Stats.tickTimes.pushSample(tickTime/1000);
    Stats.messagesSent.counter += messageSentCounter;
    Stats.tickMessagesSent.pushSample(messageSentCounter);
    Stats.tickMessagesReceived.pushSample(eventQueue.length);
    Stats.bytesSent.counter += bytesSentCounter;
    Stats.tickByteSent.pushSample(bytesSentCounter);
    Stats.tickByteReceived.pushSample(bytesReceivedWithinTick);

    eventQueue.length = 0;
    bytesReceivedWithinTick = 0;

    if (Stats.ticksCount.counter%SERVER_FPS === 0) {
        // TODO: serve the stats over a separate websocket, so a separate html page can poll it once in a while
        Stats.print()
    }

    setTimeout(tick, Math.max(0, 1000/SERVER_FPS - tickTime));
}
Stats.uptime.startedAt = Date.now()
setTimeout(tick, 1000/SERVER_FPS);

console.log(`Listening to ws://0.0.0.0:${common.SERVER_PORT}`)
