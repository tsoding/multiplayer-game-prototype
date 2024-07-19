export const SERVER_PORT = 6970;
export const WORLD_FACTOR = 200;
export const WORLD_WIDTH = 4*WORLD_FACTOR;
export const WORLD_HEIGHT = 3*WORLD_FACTOR;
export const PLAYER_SIZE = 30;
export const PLAYER_SPEED = 500;

export enum Direction {
    Left = 0,
    Right,
    Up,
    Down,
    Count,
}

export type Vector2 = {x: number, y: number};
export const DIRECTION_VECTORS: Vector2[] = (() => {
    console.assert(Direction.Count == 4, "The definition of Direction have changed");
    const vectors = Array(Direction.Count);
    vectors[Direction.Left]  = {x: -1, y: 0};
    vectors[Direction.Right] = {x: 1, y: 0};
    vectors[Direction.Up]    = {x: 0, y: -1};
    vectors[Direction.Down]  = {x: 0, y: 1};
    return vectors;
})()

export interface Player {
    id: number,
    x: number,
    y: number,
    moving: number,
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
    let dx = 0;
    let dy = 0;
    for (let dir = 0; dir < Direction.Count; dir += 1) {
        if ((player.moving>>dir)&1) {
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
