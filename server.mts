import {WebSocketServer, WebSocket} from 'ws';
import * as common from './common.mjs'
import {Player} from './common.mjs';

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

interface PlayerOnServer extends Player {
    ws: WebSocket,
    newMoving: number,
}

const players = new Map<number, PlayerOnServer>();
let idCounter = 0;
let bytesReceivedWithinTick = 0;
let messagesRecievedWithinTick = 0;
const wss = new WebSocketServer({
    port: common.SERVER_PORT,
})
const joinedIds = new Set<number>()
const leftIds = new Set<number>()
const pingIds = new Map<number, number>()

wss.on("connection", (ws) => {
    ws.binaryType = 'arraybuffer';
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
        moving: 0,
        newMoving: 0,
        hue,
        moved: false,
    }
    players.set(id, player);
    // console.log(`Player ${id} connected`);
    joinedIds.add(id);
    Stats.playersJoined.counter += 1;
    Stats.playersCurrently.counter += 1;
    ws.addEventListener("message", (event) => {
        Stats.messagesReceived.counter += 1;
        messagesRecievedWithinTick += 1;

        if (!(event.data instanceof ArrayBuffer)){
            Stats.bogusAmogusMessages.counter += 1;
            // console.log(`Received bogus-amogus message from client ${id}:`, message)
            ws.close();
            return;
        }

        const view = new DataView(event.data);
        Stats.bytesReceived.counter += view.byteLength;
        bytesReceivedWithinTick += view.byteLength;
        if (common.AmmaMovingStruct.verify(view)) {
            // console.log(`Received message from player ${id}`, message)
            const direction = common.AmmaMovingStruct.direction.read(view);
            const start = common.AmmaMovingStruct.start.read(view);
            if (start) {
                player.newMoving |= (1<<direction);
            } else {
                player.newMoving &= ~(1<<direction);
            }
        } else if (common.PingPongStruct.verifyPing(view)) {
            pingIds.set(id, common.PingPongStruct.timestamp.read(view));
        } else {
            // console.log(`Received bogus-amogus message from client ${id}:`, message)
            Stats.bogusAmogusMessages.counter += 1;
            ws.close();
            return;
        }
    });
    ws.on("close", () => {
        // console.log(`Player ${id} disconnected`);
        players.delete(id);
        Stats.playersLeft.counter += 1;
        Stats.playersCurrently.counter -= 1;
        if (!joinedIds.delete(id)) {
            leftIds.add(id);
        }
    })
})

let previousTimestamp = performance.now();
function tick() {
    const timestamp = performance.now();
    const deltaTime = (timestamp - previousTimestamp)/1000
    previousTimestamp = timestamp;
    let messageSentCounter = 0;
    let bytesSentCounter = 0;

    // Greeting all the joined players and notifying them about other players
    joinedIds.forEach((joinedId) => {
        const joinedPlayer = players.get(joinedId);
        if (joinedPlayer !== undefined) { // This should never happen, but we handling none existing ids for more robustness
            // The greetings
            const view = new DataView(new ArrayBuffer(common.HelloStruct.size));
            common.HelloStruct.kind.write(view, common.MessageKind.Hello);
            common.HelloStruct.id.write(view, joinedPlayer.id);
            common.HelloStruct.x.write(view, joinedPlayer.x);
            common.HelloStruct.y.write(view, joinedPlayer.y);
            common.HelloStruct.hue.write(view, Math.floor(joinedPlayer.hue/360*256));
            joinedPlayer.ws.send(view);
            bytesSentCounter += view.byteLength;
            messageSentCounter += 1

            // Reconstructing the state of the other players
            players.forEach((otherPlayer) => {
                if (joinedId !== otherPlayer.id) { // Joined player should already know about themselves
                    const view = new DataView(new ArrayBuffer(common.PlayerJoinedStruct.size))
                    common.PlayerJoinedStruct.kind.write(view, common.MessageKind.PlayerJoined);
                    common.PlayerJoinedStruct.id.write(view, otherPlayer.id);
                    common.PlayerJoinedStruct.x.write(view, otherPlayer.x);
                    common.PlayerJoinedStruct.y.write(view, otherPlayer.y);
                    common.PlayerJoinedStruct.hue.write(view, otherPlayer.hue/360*256);
                    common.PlayerJoinedStruct.moving.write(view, otherPlayer.moving);
                    joinedPlayer.ws.send(view);
                    bytesSentCounter += view.byteLength;
                    messageSentCounter += 1
                }
            })
        }
    })

    // Notifying about who joined
    joinedIds.forEach((joinedId) => {
        const joinedPlayer = players.get(joinedId);
        if (joinedPlayer !== undefined) { // This should never happen, but we handling none existing ids for more robustness
            const view = new DataView(new ArrayBuffer(common.PlayerJoinedStruct.size))
            common.PlayerJoinedStruct.kind.write(view, common.MessageKind.PlayerJoined);
            common.PlayerJoinedStruct.id.write(view, joinedPlayer.id);
            common.PlayerJoinedStruct.x.write(view, joinedPlayer.x);
            common.PlayerJoinedStruct.y.write(view, joinedPlayer.y);
            common.PlayerJoinedStruct.hue.write(view, joinedPlayer.hue/360*256);
            common.PlayerJoinedStruct.moving.write(view, joinedPlayer.moving);
            players.forEach((otherPlayer) => {
                if (joinedId !== otherPlayer.id) { // Joined player should already know about themselves
                    otherPlayer.ws.send(view);
                    bytesSentCounter += view.byteLength;
                    messageSentCounter += 1
                }
            })
        }
    })

    // Notifying about who left
    leftIds.forEach((leftId) => {
        const view = new DataView(new ArrayBuffer(common.PlayerLeftStruct.size))
        common.PlayerJoinedStruct.kind.write(view, common.MessageKind.PlayerLeft);
        common.PlayerJoinedStruct.id.write(view, leftId);
        players.forEach((player) => {
            player.ws.send(view);
            bytesSentCounter += view.byteLength;
            messageSentCounter += 1
        })
    })

    players.forEach((player) => {
        if (player.newMoving !== player.moving) {
            player.moving = player.newMoving;

            const view = new DataView(new ArrayBuffer(common.PlayerMovingStruct.size));
            common.PlayerMovingStruct.kind.write(view, common.MessageKind.PlayerMoving);
            common.PlayerMovingStruct.id.write(view, player.id);
            common.PlayerMovingStruct.x.write(view, player.x);
            common.PlayerMovingStruct.y.write(view, player.y);
            common.PlayerMovingStruct.moving.write(view, player.moving);

            players.forEach((otherPlayer) => {
                otherPlayer.ws.send(view);
                bytesSentCounter += view.byteLength;
                messageSentCounter += 1;
            });
        }
    });

    // Simulating the world for one server tick.
    players.forEach((player) => common.updatePlayer(player, deltaTime))

    // Sending out pings
    pingIds.forEach((timestamp, id) => {
        const player = players.get(id);
        if (player !== undefined) { // This MAY happen. A player may send a ping and leave.
            const view = new DataView(new ArrayBuffer(common.PingPongStruct.size));
            common.PingPongStruct.kind.write(view, common.MessageKind.Pong);
            common.PingPongStruct.timestamp.write(view, timestamp);
            player.ws.send(view);
            bytesSentCounter += view.byteLength;
            messageSentCounter += 1;
        }
    });

    const tickTime = performance.now() - timestamp;
    Stats.ticksCount.counter += 1;
    Stats.tickTimes.pushSample(tickTime/1000);
    Stats.messagesSent.counter += messageSentCounter;
    Stats.tickMessagesSent.pushSample(messageSentCounter);
    Stats.tickMessagesReceived.pushSample(messagesRecievedWithinTick);
    Stats.bytesSent.counter += bytesSentCounter;
    Stats.tickByteSent.pushSample(bytesSentCounter);
    Stats.tickByteReceived.pushSample(bytesReceivedWithinTick);

    joinedIds.clear();
    leftIds.clear();
    pingIds.clear();
    bytesReceivedWithinTick = 0;
    messagesRecievedWithinTick = 0;

    if (Stats.ticksCount.counter%SERVER_FPS === 0) {
        // TODO: serve the stats over a separate websocket, so a separate html page can poll it once in a while
        Stats.print()
    }

    setTimeout(tick, Math.max(0, 1000/SERVER_FPS - tickTime));
}
Stats.uptime.startedAt = Date.now()
setTimeout(tick, 1000/SERVER_FPS);

console.log(`Listening to ws://0.0.0.0:${common.SERVER_PORT}`)
