import type * as ws from "ws";

export const SERVER_PORT = 6970;
export const STATS_FEED_PORT = 6971;
export const WORLD_FACTOR = 200;
export const WORLD_WIDTH = 4*WORLD_FACTOR;
export const WORLD_HEIGHT = 3*WORLD_FACTOR;
export const PLAYER_SIZE = 30;
export const PLAYER_SPEED = 500;

export interface Counter {
    kind: "counter",
    counter: number,
    description: string,
}

export interface Average {
    kind: "average",
    samples: Array<number>,
    description: string
}

export interface Timer {
    kind: "timer",
    startedAt: number,
    description: string,
}

export type Stat = Counter | Average | Timer;
export type Stats = {[key: string]: Stat}

export type Direction = "left" | "right" | "up" | "down";


type Moving = {
    [key in Direction]: boolean
}

export type Vector2 = {x: number, y: number};
export const DIRECTION_VECTORS: {[key in Direction]: Vector2} = {
    "left":  {x: -1, y: 0},
    "right": {x: 1, y: 0},
    "up":    {x: 0, y: -1},
    "down":  {x: 0, y: 1},
};

function isDirection(arg: any): arg is Direction {
    return DIRECTION_VECTORS[arg as Direction] !== undefined;
}

export interface Player {
    id: number,
    x: number,
    y: number,
    moving: Moving,
    hue: number,
}

export function isNumber(arg: any): arg is number {
    return typeof(arg) === "number";
}

export function isString(arg: any): arg is string {
    return typeof(arg) === "string";
}

export function isBoolean(arg: any): arg is boolean {
    return typeof(arg) === "boolean";
}

export interface Hello {
    kind: "Hello",
    id: number,
    x: number,
    y: number,
    hue: number,
}

export function isHello(arg: any): arg is Hello {
    return arg
        && arg.kind === "Hello"
        && isNumber(arg.id);
}

export interface PlayerJoined {
    kind: "PlayerJoined",
    id: number,
    x: number,
    y: number,
    hue: number,
}

export function isPlayerJoined(arg: any): arg is PlayerJoined {
    return arg
        && arg.kind === "PlayerJoined"
        && isNumber(arg.id)
        && isNumber(arg.x)
        && isNumber(arg.y)
        && isNumber(arg.hue)
}

export interface PlayerLeft {
    kind: "PlayerLeft",
    id: number,
}

export function isPlayerLeft(arg: any): arg is PlayerLeft {
    return arg
        && arg.kind === "PlayerLeft"
        && isNumber(arg.id)
}

export interface AmmaMoving {
    kind: "AmmaMoving",
    start: boolean,
    direction: Direction,
}

export function isAmmaMoving(arg: any): arg is AmmaMoving {
    return arg
        && arg.kind === "AmmaMoving"
        && isBoolean(arg.start)
        && isDirection(arg.direction);
}

export interface PlayerMoving {
    kind: "PlayerMoving",
    id: number,
    x: number,
    y: number,
    start: boolean,
    direction: Direction,
}

export function isPlayerMoving(arg: any): arg is PlayerMoving {
    return arg
        && arg.kind === "PlayerMoving"
        && isNumber(arg.id)
        && isNumber(arg.x)
        && isNumber(arg.y)
        && isBoolean(arg.start)
        && isDirection(arg.direction);
}

export type Event = PlayerJoined | PlayerLeft | PlayerMoving;

function properMod(a: number, b: number): number {
    return (a%b + b)%b;
}

export function updatePlayer(player: Player, deltaTime: number) {
    let dir: Direction;
    let dx = 0;
    let dy = 0;
    for (dir in DIRECTION_VECTORS) {
        if (player.moving[dir]) {
            dx += DIRECTION_VECTORS[dir].x;
            dy += DIRECTION_VECTORS[dir].y;
        }
    }
    const l = dx*dx + dy*dy;
    if (l !== 0) {
        dx /= l;
        dy /= l;
    }
    player.x = properMod(player.x + dx*PLAYER_SPEED*deltaTime, WORLD_WIDTH);
    player.y = properMod(player.y + dy*PLAYER_SPEED*deltaTime, WORLD_HEIGHT);
}

interface Message {
    kind: string,
}

export function sendMessage<T extends Message>(socket: ws.WebSocket | WebSocket, message: T): number {
    const text = JSON.stringify(message);
    socket.send(text);
    return text.length;
}
