import type * as ws from 'ws';

export const SERVER_PORT = 6970;
export const WORLD_FACTOR = 200;
export const WORLD_WIDTH = 4*WORLD_FACTOR;
export const WORLD_HEIGHT = 3*WORLD_FACTOR;
export const PLAYER_SIZE = 30;
export const PLAYER_SPEED = 500;

export type Direction = 'left' | 'right' | 'up' | 'down';

type Moving = {
    [key in Direction]: boolean
}

// TODO: it's realy easy to forget to update this array if the definition of type Direction changes.
const directions: Direction[] = ['left', 'right', 'up', 'down'];

export function movingMask(moving: Moving): number {
    let mask = 0;
    for (let i = 0; i < directions.length; ++i) {
        if (moving[directions[i]]) {
            mask = mask|(1<<i);
        }
    }
    return mask;
}

export function setMovingMask(moving: Moving, mask: number) {
    for (let i = 0; i < directions.length; ++i) {
        moving[directions[i]] = ((mask>>i)&1) !== 0;
    }
}

export type Vector2 = {x: number, y: number};
export const DIRECTION_VECTORS: {[key in Direction]: Vector2} = {
    'left':  {x: -1, y: 0},
    'right': {x: 1, y: 0},
    'up':    {x: 0, y: -1},
    'down':  {x: 0, y: 1},
};

export interface Player {
    id: number,
    x: number,
    y: number,
    moving: Moving,
    hue: number,
}

export enum MessageKind {
    Hello,
    PlayerJoined,
    PlayerLeft,
    PlayerMoving,
    AmmaMoving,
}

interface Field {
    offset: number,
    size: number,
    read(view: DataView, baseOffset: number): number;
    write(view: DataView, baseOffset: number, value: number): void;
}

const UINT8_SIZE = 1;
const UINT32_SIZE = 4;
const FLOAT32_SIZE = 4;

function allocUint8Field(allocator: { iota: number }): Field {
    const offset = allocator.iota;
    const size = UINT8_SIZE;
    allocator.iota += size;
    return {
        offset,
        size,
        read: (view, baseOffset) => view.getUint8(baseOffset + offset),
        write: (view, baseOffset, value) => view.setUint8(baseOffset + offset, value)
    }
}

function allocUint32Field(allocator: { iota: number }): Field {
    const offset = allocator.iota;
    const size = UINT32_SIZE;
    allocator.iota += size;
    return {
        offset,
        size,
        read: (view, baseOffset) => view.getUint32(baseOffset + offset, true),
        write: (view, baseOffset, value) => view.setUint32(baseOffset + offset, value, true)
    }
}

function allocFloat32Field(allocator: { iota: number }): Field {
    const offset = allocator.iota;
    const size = FLOAT32_SIZE;
    allocator.iota += size;
    return {
        offset,
        size,
        read: (view, baseOffset) => view.getFloat32(baseOffset + offset, true),
        write: (view, baseOffset, value) => view.setFloat32(baseOffset + offset, value, true)
    }
}

function verifier(kindField: Field, kind: number, size: number): (view: DataView, baseOffset: number) => boolean {
    return (view, baseOffset) =>
        view.byteLength - baseOffset >= size &&
        kindField.read(view, baseOffset) == kind
}

export const HelloStruct = (() => {
    const allocator = { iota: 0 };
    const kind     = allocUint8Field(allocator);
    const id       = allocUint32Field(allocator);
    const x        = allocFloat32Field(allocator);
    const y        = allocFloat32Field(allocator);
    const hue      = allocUint8Field(allocator);
    const size     = allocator.iota;
    const verifyAt = verifier(kind, MessageKind.Hello, size);
    return {kind, id, x, y, hue, size, verifyAt}
})();

export const PlayerJoinedStruct = (() => {
    const allocator = { iota: 0 };
    const kind   = allocUint8Field(allocator);
    const id     = allocUint32Field(allocator);
    const x      = allocFloat32Field(allocator);
    const y      = allocFloat32Field(allocator);
    const hue    = allocUint8Field(allocator);
    const moving = allocUint8Field(allocator);
    const size   = allocator.iota;
    const verifyAt = verifier(kind, MessageKind.PlayerJoined, size);
    return {kind, id, x, y, hue, moving, size, verifyAt};
})();

export const PlayerLeftStruct = (() => {
    const allocator = { iota: 0 };
    const kind     = allocUint8Field(allocator);
    const id       = allocUint32Field(allocator);
    const size     = allocator.iota;
    const verifyAt = verifier(kind, MessageKind.PlayerLeft, size);
    return {kind, id, size, verifyAt};
})();

export const AmmaMovingStruct = (() => {
    const allocator = { iota: 0 };
    const kind     = allocUint8Field(allocator);
    const moving   = allocUint8Field(allocator);
    const size     = allocator.iota;
    const verifyAt = verifier(kind, MessageKind.AmmaMoving, size);
    return {kind, moving, size, verifyAt}
})();

export const PlayerMovingStruct = (() => {
    const allocator = { iota: 0 };
    const kind   = allocUint8Field(allocator);
    const id     = allocUint32Field(allocator);
    const x      = allocFloat32Field(allocator);
    const y      = allocFloat32Field(allocator);
    const moving = allocUint8Field(allocator);
    const size   = allocator.iota;
    const verifyAt = verifier(kind, MessageKind.PlayerMoving, size);
    return {kind, id, x, y, moving, size, verifyAt};
})();

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
