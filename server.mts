import {WebSocketServer, WebSocket} from 'ws';
import * as common from './common.mjs'
import {PlayerMoving, PlayerJoined, PlayerLeft, Player, Event, Hello, Direction} from './common.mjs'

const SERVER_FPS = 30;
const SERVER_LIMIT = 69;

interface PlayerWithSocket extends Player {
    ws: WebSocket
}

const players = new Map<number, PlayerWithSocket>();
let idCounter = 0;
let eventQueue: Array<Event> = [];
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
    ws.addEventListener("message", (event) => {
        let message;
        try {
            message = JSON.parse(event.data.toString());
        } catch(e) {
            console.log(`Recieved bogus-amogus message from client ${id} on parsing JSON:`, event.data);
            ws.close();
            return;
        }
        if (common.isAmmaMoving(message)) {
            console.log(`Received message from player ${id}`, message)
            eventQueue.push({
                kind: 'PlayerMoving',
                id,
                x: player.x,
                y: player.y,
                start: message.start,
                direction: message.direction,
            });
        } else {
            console.log(`Received bogus-amogus message from client ${id}:`, message)
            ws.close();
            return;
        }
    });
    ws.on("close", () => {
        console.log(`Player ${id} disconnected`);
        players.delete(id);
        eventQueue.push({
            kind: 'PlayerLeft',
            id
        })
    })
})

function tick() {
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
            common.sendMessage<Hello>(joinedPlayer.ws, {
                kind: 'Hello',
                id: joinedPlayer.id,
                x: joinedPlayer.x,
                y: joinedPlayer.y,
                style: joinedPlayer.style,
            })
            // Reconstructing the state of the other players
            players.forEach((otherPlayer) => {
                if (joinedId !== otherPlayer.id) { // Joined player should already know about themselves
                    common.sendMessage<PlayerJoined>(joinedPlayer.ws, {
                        kind: 'PlayerJoined',
                        id: otherPlayer.id,
                        x: otherPlayer.x,
                        y: otherPlayer.y,
                        style: otherPlayer.style,
                    })
                    let direction: Direction;
                    for (direction in otherPlayer.moving) {
                        if (otherPlayer.moving[direction]) {
                            common.sendMessage<PlayerMoving>(joinedPlayer.ws, {
                                kind: 'PlayerMoving',
                                id: otherPlayer.id,
                                x: otherPlayer.x,
                                y: otherPlayer.y,
                                start: true,
                                direction
                            })
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
                    common.sendMessage<PlayerJoined>(otherPlayer.ws, {
                        kind: 'PlayerJoined',
                        id: joinedPlayer.id,
                        x: joinedPlayer.x,
                        y: joinedPlayer.y,
                        style: joinedPlayer.style,
                    })
                }
            })
        }
    })

    // Notifying about who left
    leftIds.forEach((leftId) => {
        players.forEach((player) => {
            common.sendMessage<PlayerLeft>(player.ws, {
                kind: 'PlayerLeft',
                id: leftId,
            });
        })
    })

    // Notifying about the movements
    for (let event of eventQueue) {
        switch (event.kind) {
            case 'PlayerMoving': {
                const player = players.get(event.id);
                if (player !== undefined) { // This MAY happen if somebody joined, moved and left withing a single tick. Just skipping.
                    player.moving[event.direction] = event.start;
                    const eventString = JSON.stringify(event);
                    players.forEach((player) => player.ws.send(eventString));
                }
            } break;
        }
    }

    eventQueue.length = 0;

    // Simulating the world for one server tick.
    players.forEach((player) => common.updatePlayer(player, 1/SERVER_FPS))

    setTimeout(tick, 1000/SERVER_FPS);
}
setTimeout(tick, 1000/SERVER_FPS);

console.log(`Listening to ws://0.0.0.0:${common.SERVER_PORT}`)
